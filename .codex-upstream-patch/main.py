from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.database import Base, engine, get_session
from app.config import get_settings
from app.discovery import detect_connector_type, guess_company_name
from app.models import AuditLog, Company, CompanySource, CrawlRun, Job, JobLifecycleEvent, JobStatus, JobTracker, SyncEvent
from app.schemas import AuditLogOut, CompanyCreate, CompanyOut, CompanySourceCreate, CompanySourceOut, JobEvidenceOut, JobFeedOut, JobOut, JobTrackerOut, JobTrackerUpdate, SourceDiscoveryOut, TrackedJobOut
from app.services import (
    ENRICHMENT_FEATURE_FIELDS,
    EXTENDED_FEATURE_FIELDS,
    STRUCTURED_FEATURE_FIELDS,
    enrichment_missing_for_job,
    extended_missing_for_job,
    quality_missing_fields,
    structured_coverage_for_job,
    structured_missing_for_job,
)
from app.feed import decode_cursor, encode_cursor, serialize_job
from app.tasks import (
    crawl_one_company,
    discover_financial_sources,
    seed_financial_companies,
    seed_technology_companies,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Convenient for a new local install. Production runs use Alembic migrations.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Global Jobs Platform API", version="0.1.0", lifespan=lifespan)
_origins = [origin.strip() for origin in get_settings().allowed_origins.split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins or ["*"], allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"]) 
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")
EARLY_CAREER_TERMS = (
    "internship", "graduate", "new grad", "campus", "university",
    "early career", "apprentice", "analyst program", "analyst programme",
    "summer analyst", "summer associate", "school leaver",
)


def early_career_condition():
    title_matches = [Job.title.ilike(f"%{term}%") for term in EARLY_CAREER_TERMS]
    intern_title = or_(
        Job.title.ilike("intern"), Job.title.ilike("intern %"), Job.title.ilike("intern-%"),
        Job.title.ilike("intern/%"), Job.title.ilike("intern,%"), Job.title.ilike("intern (%"),
        Job.title.ilike("% intern"), Job.title.ilike("% intern-%"), Job.title.ilike("% intern/%"),
        Job.title.ilike("% intern,%"), Job.title.ilike("% intern (%"),
    )
    source_category = Job.raw_payload["experienceCategory"].as_string() == "EARLY_CAREER"
    return or_(Job.level == "Internship", source_category, intern_title, *title_matches)


def require_admin(x_api_key: str | None = Header(default=None)) -> None:
    expected = get_settings().admin_api_key
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


def require_integration(x_integration_key: str | None = Header(default=None),
                        authorization: str | None = Header(default=None)) -> None:
    """Protect the downstream read feed with a separate, read-only secret."""

    expected = get_settings().integration_api_key
    if not expected:
        return
    bearer = authorization.removeprefix("Bearer ").strip() if authorization else None
    if x_integration_key != expected and bearer != expected:
        raise HTTPException(status_code=401, detail="Invalid integration API key")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def dashboard() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.get("/dashboard/summary")
def dashboard_summary(session: Session = Depends(get_session)) -> dict:
    latest_audit = session.scalar(select(AuditLog).order_by(AuditLog.report_date.desc()))
    latest_crawl = session.scalar(select(CrawlRun).order_by(CrawlRun.started_at.desc()))
    sync_counts = dict(session.execute(select(SyncEvent.status, func.count(SyncEvent.id)).group_by(SyncEvent.status)).all())
    financial_industries = ("Investment Banking", "Asset Management", "Sales & Trading", "Consulting")
    return {
        "open_jobs": session.scalar(select(func.count(Job.id)).where(Job.status == JobStatus.OPEN)) or 0,
        "closed_jobs": session.scalar(select(func.count(Job.id)).where(Job.status == JobStatus.CLOSED)) or 0,
        "companies": session.scalar(select(func.count(Company.id)).where(Company.is_active.is_(True))) or 0,
        "financial": {
            "companies": session.scalar(select(func.count(Company.id)).where(Company.is_active.is_(True), Company.industry.in_(financial_industries))) or 0,
            "jobs": session.scalar(select(func.count(Job.id)).join(Company).where(Job.status == JobStatus.OPEN, Company.industry.in_(financial_industries))) or 0,
            "ats_sources": session.scalar(select(func.count(CompanySource.id)).join(Company).where(Company.industry.in_(financial_industries), CompanySource.source_type != "official")) or 0,
        },
        "last_crawled_at": session.scalar(select(func.max(Company.last_crawled_at))),
        "sync": {"success": sync_counts.get("success", 0), "failed": sync_counts.get("failed", 0), "pending": sync_counts.get("skipped", 0)},
        "latest_crawl": {"status": latest_crawl.status, "completed_at": latest_crawl.completed_at} if latest_crawl else None,
        "latest_audit": {
            "report_date": latest_audit.report_date,
            "new_jobs": latest_audit.new_jobs,
            "failed_crawls": latest_audit.failed_crawls,
            "sync_failures": latest_audit.sync_failures,
        } if latest_audit else None,
    }


def _crawl_coverage_status(run: CrawlRun | None) -> str:
    if not run or run.expected_count is None:
        return "unknown"
    error = (run.error or "").lower()
    boundary_unverified = any(
        marker in error
        for marker in (
            "incomplete source coverage",
            "source coverage not verified",
            "source marked incomplete",
        )
    )
    if boundary_unverified:
        return "partial"
    return "verified" if run.discovered_count == run.expected_count else "partial"


@app.get("/dashboard/coverage")
def dashboard_coverage(
    fresh_hours: int = Query(8, ge=1, le=72),
    session: Session = Depends(get_session),
) -> dict:
    """Show collection freshness and source-reported coverage by company.

    This endpoint intentionally does not claim market-wide completeness. A
    company is "verified" only when its source reports an expected total and
    the latest crawl reached that total without a source-boundary warning.
    "unknown" means the source does not publish a trustworthy total.
    """
    now = datetime.now(timezone.utc)
    freshness_cutoff = now - timedelta(hours=fresh_hours)
    recent_cutoff = now - timedelta(hours=24)
    companies = session.scalars(
        select(Company).where(Company.is_active.is_(True)).order_by(Company.name)
    ).all()
    company_ids = [company.id for company in companies]
    open_counts = dict(
        session.execute(
            select(Job.company_id, func.count(Job.id))
            .where(Job.status == JobStatus.OPEN, Job.company_id.in_(company_ids))
            .group_by(Job.company_id)
        ).all()
    ) if company_ids else {}
    source_rows = list(session.scalars(
        select(CompanySource).where(CompanySource.company_id.in_(company_ids))
    )) if company_ids else []
    companies_with_explicit_sources = {
        source.company_id
        for source in source_rows
        if source.is_active and source.source_type != "official"
    }
    source_by_company: dict[UUID, dict[str, object]] = {}
    for source in source_rows:
        if not source.is_active:
            continue
        # Keep dashboard source health aligned with crawl_company(): an
        # auto-discovered careers landing page is intentionally skipped once
        # the company has an explicit ATS, sitemap, or public feed source.
        if (
            source.source_type == "official"
            and (source.connector_config or {}).get("auto_discover")
            and source.company_id in companies_with_explicit_sources
        ):
            continue
        row = source_by_company.setdefault(source.company_id, {
            "active": 0,
            "errors": 0,
            "stale": 0,
            "last_crawled_at": None,
        })
        row["active"] = int(row["active"]) + 1
        if source.last_error:
            row["errors"] = int(row["errors"]) + 1
        if not source.last_crawled_at or source.last_crawled_at < freshness_cutoff:
            row["stale"] = int(row["stale"]) + 1
        current_last = row["last_crawled_at"]
        if current_last is None or (source.last_crawled_at and source.last_crawled_at > current_last):
            row["last_crawled_at"] = source.last_crawled_at
    latest_runs: dict[UUID, CrawlRun] = {}
    for run in session.scalars(select(CrawlRun).order_by(CrawlRun.started_at.desc())):
        if run.company_id is not None:
            latest_runs.setdefault(run.company_id, run)
    recent_runs = session.execute(
        select(CrawlRun.status, func.count(CrawlRun.id))
        .where(CrawlRun.started_at >= recent_cutoff)
        .group_by(CrawlRun.status)
    ).all()
    recent_run_counts = {str(status): count for status, count in recent_runs}
    closed_recent = session.scalar(
        select(func.count(Job.id)).where(Job.closed_at >= recent_cutoff)
    ) or 0
    rows: list[dict] = []
    for company in companies:
        run = latest_runs.get(company.id)
        source = source_by_company.get(company.id, {
            "active": 0, "errors": 0, "stale": 0, "last_crawled_at": None,
        })
        completed_at = run.completed_at or run.started_at if run else None
        if not run:
            freshness_status = "never"
        elif run.status == "running":
            freshness_status = "running"
        elif run.status == "failed":
            freshness_status = "failed"
        elif not completed_at or completed_at < freshness_cutoff:
            freshness_status = "stale"
        else:
            freshness_status = "healthy"
        coverage_status = _crawl_coverage_status(run)
        attention = (
            freshness_status in {"never", "running", "failed", "stale"}
            or coverage_status == "partial"
            or int(source["errors"]) > 0
            or int(source["active"]) == 0
        )
        rows.append({
            "company": company.name,
            "industry": company.industry,
            "open_jobs": open_counts.get(company.id, 0),
            "active_sources": source["active"],
            "source_errors": source["errors"],
            "stale_sources": source["stale"],
            "source_last_crawled_at": source["last_crawled_at"],
            "latest_crawl": {
                "status": run.status,
                "started_at": run.started_at,
                "completed_at": run.completed_at,
                "discovered": run.discovered_count,
                "expected": run.expected_count,
                "complete": run.complete_count,
                "partial": run.partial_count,
                "error": run.error,
            } if run else None,
            "coverage_status": coverage_status,
            "freshness_status": freshness_status,
            "needs_attention": attention,
        })
    rows.sort(key=lambda row: (not row["needs_attention"], row["company"]))
    coverage_counts = {
        status: sum(1 for row in rows if row["coverage_status"] == status)
        for status in ("verified", "partial", "unknown")
    }
    freshness_counts = {
        status: sum(1 for row in rows if row["freshness_status"] == status)
        for status in ("healthy", "stale", "failed", "running", "never")
    }
    return {
        "generated_at": now,
        "freshness_window_hours": fresh_hours,
        "market_completeness": "not_provable_from_source_feeds",
        "definition": {
            "verified": "The source reported an expected total and the latest complete crawl matched it.",
            "partial": "The latest crawl did not match the source total or the source boundary was not verified.",
            "unknown": "The source does not publish an expected total, so market coverage cannot be asserted.",
            "closed_jobs": "Jobs are retained for audit and relationships but closed jobs are excluded from open-job queries.",
        },
        "summary": {
            "active_companies": len(rows),
            "needs_attention": sum(1 for row in rows if row["needs_attention"]),
            "coverage": coverage_counts,
            "freshness": freshness_counts,
            "open_jobs": sum(row["open_jobs"] for row in rows),
            "closed_jobs_last_24h": closed_recent,
            "crawl_runs_last_24h": sum(recent_run_counts.values()),
            "crawl_success_last_24h": recent_run_counts.get("success", 0),
            "crawl_partial_last_24h": recent_run_counts.get("partial", 0),
            "crawl_failed_last_24h": recent_run_counts.get("failed", 0),
        },
        "companies": rows,
    }


@app.get("/dashboard/data-quality")
def dashboard_data_quality(session: Session = Depends(get_session)) -> dict:
    """Expose completeness separately from crawl execution success."""

    now = datetime.now(timezone.utc)
    companies = {company.id: company for company in session.scalars(select(Company).where(Company.is_active.is_(True)))}
    totals = {"open_jobs": 0, "complete": 0, "partial": 0, "no_description": 0,
              "short_description": 0, "detail_errors": 0, "detail_unavailable": 0,
              "stale_24h": 0, "missing_fields": {},
              "structured_complete": 0, "structured_missing_fields": {},
              "enrichment_complete": 0, "enrichment_missing_fields": {},
              "extended_complete": 0, "extended_missing_fields": {},
              "department_status": {}}
    by_company: dict[UUID, dict] = {
        company_id: {"company": company.name, "industry": company.industry, "open_jobs": 0,
                     "complete": 0, "partial": 0, "no_description": 0, "short_description": 0,
                     "detail_errors": 0, "detail_unavailable": 0, "stale_24h": 0,
                     "missing_fields": {}, "structured_complete": 0,
                      "structured_missing_fields": {}, "enrichment_complete": 0,
                      "enrichment_missing_fields": {}, "extended_complete": 0,
                      "extended_missing_fields": {}, "department_status": {}}
        for company_id, company in companies.items()
    }
    # Stream large job sets in bounded ORM batches.  This endpoint is used for
    # audits and must not materialize the full production corpus in memory.
    jobs_result = session.scalars(
        select(Job).where(Job.status == JobStatus.OPEN)
        .execution_options(yield_per=500)
    )
    for job in jobs_result:
        row = by_company.get(job.company_id)
        if row is None:
            continue
        description_length = len((job.description or "").strip())
        detail_status = (job.raw_payload or {}).get("detail_status")
        missing = list((job.raw_payload or {}).get("missing_fields") or quality_missing_fields(job))
        complete = description_length >= 300 and not missing and detail_status not in {"detail_error", "detail_unavailable"}
        row["open_jobs"] += 1; totals["open_jobs"] += 1
        if complete:
            row["complete"] += 1; totals["complete"] += 1
        else:
            row["partial"] += 1; totals["partial"] += 1
        if description_length == 0:
            row["no_description"] += 1; totals["no_description"] += 1
        elif description_length < 300:
            row["short_description"] += 1; totals["short_description"] += 1
        if detail_status == "detail_error":
            row["detail_errors"] += 1; totals["detail_errors"] += 1
        if detail_status == "detail_unavailable":
            row["detail_unavailable"] += 1; totals["detail_unavailable"] += 1
        for field in missing:
            row["missing_fields"][field] = row["missing_fields"].get(field, 0) + 1
            totals["missing_fields"][field] = totals["missing_fields"].get(field, 0) + 1
        department_status = (job.raw_payload or {}).get("department_status") or (
            "legacy_unknown" if job.department else "not_published"
        )
        row["department_status"][department_status] = row["department_status"].get(department_status, 0) + 1
        totals["department_status"][department_status] = totals["department_status"].get(department_status, 0) + 1
        structured_missing = structured_missing_for_job(job)
        if not structured_missing:
            row["structured_complete"] += 1; totals["structured_complete"] += 1
        for field in structured_missing:
            row["structured_missing_fields"][field] = row["structured_missing_fields"].get(field, 0) + 1
            totals["structured_missing_fields"][field] = totals["structured_missing_fields"].get(field, 0) + 1
        enrichment_missing = enrichment_missing_for_job(job)
        if not enrichment_missing:
            row["enrichment_complete"] += 1; totals["enrichment_complete"] += 1
        for field in enrichment_missing:
            row["enrichment_missing_fields"][field] = row["enrichment_missing_fields"].get(field, 0) + 1
            totals["enrichment_missing_fields"][field] = totals["enrichment_missing_fields"].get(field, 0) + 1
        extended_missing = extended_missing_for_job(job)
        if not extended_missing:
            row["extended_complete"] += 1; totals["extended_complete"] += 1
        for field in extended_missing:
            row["extended_missing_fields"][field] = row["extended_missing_fields"].get(field, 0) + 1
            totals["extended_missing_fields"][field] = totals["extended_missing_fields"].get(field, 0) + 1
        last_seen_at = job.last_seen_at
        if last_seen_at and last_seen_at.tzinfo is None:
            last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
        if last_seen_at and (now - last_seen_at).total_seconds() > 86400:
            row["stale_24h"] += 1; totals["stale_24h"] += 1
    latest_runs = {}
    for run in session.scalars(select(CrawlRun).order_by(CrawlRun.started_at.desc())):
        latest_runs.setdefault(run.company_id, run)
    companies_out = []
    for company_id, row in sorted(by_company.items(), key=lambda item: item[1]["company"]):
        run = latest_runs.get(company_id)
        coverage_status = "unknown"
        if run and run.expected_count is not None:
            run_error = (run.error or "").lower()
            source_boundary_unverified = (
                "incomplete source coverage" in run_error
                or "source coverage not verified" in run_error
                or "source marked incomplete" in run_error
            )
            coverage_status = (
                "verified"
                if run.discovered_count == run.expected_count and not source_boundary_unverified
                else "partial"
            )
        structured_field_coverage = {
            field: {
                "present": row["open_jobs"] - row["structured_missing_fields"].get(field, 0),
                "total": row["open_jobs"],
                "rate": round((row["open_jobs"] - row["structured_missing_fields"].get(field, 0)) / row["open_jobs"], 4) if row["open_jobs"] else None,
            }
            for field in STRUCTURED_FEATURE_FIELDS
        }
        enrichment_field_coverage = {
            field: {
                "present": row["open_jobs"] - row["enrichment_missing_fields"].get(field, 0),
                "total": row["open_jobs"],
                "rate": round((row["open_jobs"] - row["enrichment_missing_fields"].get(field, 0)) / row["open_jobs"], 4) if row["open_jobs"] else None,
            }
            for field in ENRICHMENT_FEATURE_FIELDS
        }
        extended_field_coverage = {
            field: {
                "present": row["open_jobs"] - row["extended_missing_fields"].get(field, 0),
                "total": row["open_jobs"],
                "rate": round((row["open_jobs"] - row["extended_missing_fields"].get(field, 0)) / row["open_jobs"], 4) if row["open_jobs"] else None,
            }
            for field in EXTENDED_FEATURE_FIELDS
        }
        companies_out.append({**row,
                              "complete_rate": round(row["complete"] / row["open_jobs"], 4) if row["open_jobs"] else None,
                              "structured_complete_rate": round(row["structured_complete"] / row["open_jobs"], 4) if row["open_jobs"] else None,
                              "structured_fields": list(STRUCTURED_FEATURE_FIELDS),
                              "structured_field_coverage": structured_field_coverage,
                              "enrichment_fields": list(ENRICHMENT_FEATURE_FIELDS),
                              "enrichment_complete_rate": round(row["enrichment_complete"] / row["open_jobs"], 4) if row["open_jobs"] else None,
                              "enrichment_field_coverage": enrichment_field_coverage,
                              "extended_fields": list(EXTENDED_FEATURE_FIELDS),
                              "extended_complete_rate": round(row["extended_complete"] / row["open_jobs"], 4) if row["open_jobs"] else None,
                              "extended_field_coverage": extended_field_coverage,
                              "coverage_status": coverage_status,
                              "latest_crawl_status": run.status if run else None,
                              "latest_discovered": run.discovered_count if run else None,
                              "latest_expected": run.expected_count if run else None,
                              "latest_complete": run.complete_count if run else None,
                              "latest_partial": run.partial_count if run else None,
                              "latest_crawl_error": run.error if run else None})
    totals["structured_field_coverage"] = {
        field: {
            "present": totals["open_jobs"] - totals["structured_missing_fields"].get(field, 0),
            "total": totals["open_jobs"],
            "rate": round((totals["open_jobs"] - totals["structured_missing_fields"].get(field, 0)) / totals["open_jobs"], 4) if totals["open_jobs"] else None,
        }
        for field in STRUCTURED_FEATURE_FIELDS
    }
    totals["enrichment_field_coverage"] = {
        field: {
            "present": totals["open_jobs"] - totals["enrichment_missing_fields"].get(field, 0),
            "total": totals["open_jobs"],
            "rate": round((totals["open_jobs"] - totals["enrichment_missing_fields"].get(field, 0)) / totals["open_jobs"], 4) if totals["open_jobs"] else None,
        }
        for field in ENRICHMENT_FEATURE_FIELDS
    }
    totals["extended_field_coverage"] = {
        field: {
            "present": totals["open_jobs"] - totals["extended_missing_fields"].get(field, 0),
            "total": totals["open_jobs"],
            "rate": round((totals["open_jobs"] - totals["extended_missing_fields"].get(field, 0)) / totals["open_jobs"], 4) if totals["open_jobs"] else None,
        }
        for field in EXTENDED_FEATURE_FIELDS
    }
    return {"generated_at": now, "definition": {"complete": "description >= 300 chars, location, department, source URL, and no detail error",
                                                    "structured_complete": "all deterministic AI feature fields are present; absence means the official posting did not expose a usable value",
                                                    "department_status": "published=explicit ATS field, inferred=title/label rule, not_published=no reliable department evidence",
                                                    "structured_fields": list(STRUCTURED_FEATURE_FIELDS),
                                                   "enrichment_fields": list(ENRICHMENT_FEATURE_FIELDS),
                                                   "extended_fields": list(EXTENDED_FEATURE_FIELDS),
                                                   "success": "source coverage verified (when a source total is available) and every discovered role is complete"},
            "totals": totals, "companies": companies_out}


@app.get("/dashboard/data-quality/jobs")
def dashboard_data_quality_jobs(
    company_name: str | None = Query(default=None),
    incomplete_only: bool = True,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> dict:
    """Return the actual roles behind the company-level quality totals."""
    statement = select(Job).join(Job.company).where(Job.status == JobStatus.OPEN)
    if company_name:
        statement = statement.where(Company.name == company_name)
    # Apply the completeness predicate before pagination. Filtering only after
    # taking a page can return zero rows even when incomplete jobs exist later
    # in the ordered result set.
    # Keep the result cursor server-side and stop once the requested page is
    # filled.  The previous .all() loaded every open role before filtering.
    jobs = session.scalars(
        statement.order_by(Job.last_seen_at.desc())
        .execution_options(yield_per=500)
    )
    items = []
    matched = 0
    for job in jobs:
        missing = list((job.raw_payload or {}).get("missing_fields") or quality_missing_fields(job))
        detail_status = (job.raw_payload or {}).get("detail_status")
        complete = not missing and detail_status not in {"detail_error", "detail_unavailable"}
        if incomplete_only and complete:
            continue
        if matched < offset:
            matched += 1
            continue
        if len(items) >= limit:
            break
        matched += 1
        items.append({
            "id": job.id,
            "company": job.company_name,
            "title": job.title,
            "source_type": job.source_type,
            "source_url": job.source_url,
            "description_length": len((job.description or "").strip()),
            "location": job.location,
            "department": job.department,
            "missing_fields": missing,
            "structured_missing_fields": structured_missing_for_job(job),
            "structured_coverage": structured_coverage_for_job(job),
            "structured_field_sources": (job.raw_payload or {}).get("structured_field_sources") or {},
            "structured_extraction_version": (job.raw_payload or {}).get("structured_extraction_version"),
            "enrichment_missing_fields": enrichment_missing_for_job(job),
            "department_status": (job.raw_payload or {}).get("department_status"),
            "department_source": (job.raw_payload or {}).get("department_source"),
            "enrichment_field_sources": (job.raw_payload or {}).get("enrichment_field_sources") or {},
            "extended_missing_fields": extended_missing_for_job(job),
            "data_completeness": "complete" if complete else "partial",
            "detail_status": detail_status,
            "detail_status_reason": (job.raw_payload or {}).get("detail_status_reason"),
            "description_source": (job.raw_payload or {}).get("description_source"),
            "description_status": (job.raw_payload or {}).get("description_status"),
            "last_seen_at": job.last_seen_at,
        })
    return {"items": items, "offset": offset, "limit": limit, "returned": len(items), "incomplete_only": incomplete_only}


@app.get("/dashboard/company-directory")
def company_directory(session: Session = Depends(get_session)) -> list[dict]:
    job_counts = dict(session.execute(
        select(Job.company_id, func.count(Job.id)).where(Job.status == JobStatus.OPEN).group_by(Job.company_id)
    ).all())
    sources_by_company: dict[UUID, list[str]] = {}
    for company_id, source_type in session.execute(
        select(CompanySource.company_id, CompanySource.source_type).where(CompanySource.is_active.is_(True))
    ):
        sources_by_company.setdefault(company_id, []).append(source_type)
    latest_runs: dict[UUID, CrawlRun] = {}
    # A crawl marked ``partial`` can still have a trustworthy source total:
    # partial commonly means some rows are missing optional quality fields,
    # not that the official listing count was unavailable.  Keep the latest
    # successful/partial run for count reconciliation, while failed runs never
    # overwrite the last observed count.
    latest_observed_runs: dict[UUID, CrawlRun] = {}
    for run in session.scalars(select(CrawlRun).order_by(CrawlRun.started_at.desc())):
        if run.company_id is not None:
            latest_runs.setdefault(run.company_id, run)
            if run.status in {"success", "partial"}:
                latest_observed_runs.setdefault(run.company_id, run)
    companies = session.scalars(select(Company).where(Company.is_active.is_(True)).order_by(Company.name)).all()
    generated_at = datetime.now(timezone.utc)
    contract_version = "job-company-directory-v1"
    return [
        {
            "id": company.id,
            "name": company.name,
            "industry": company.industry,
            "career_url": company.career_url,
            "job_count": job_counts.get(company.id, 0),
            # Stable aliases for downstream sync telemetry. Keep legacy keys
            # above so existing dashboard clients remain compatible.
            "open_jobs": job_counts.get(company.id, 0),
            "sources": sorted(set(sources_by_company.get(company.id, []))),
            "last_crawled_at": company.last_crawled_at,
            "last_crawl_at": company.last_crawled_at,
            "last_crawl_status": latest_runs.get(company.id).status if company.id in latest_runs else None,
            "latest_run_status": latest_runs.get(company.id).status if company.id in latest_runs else None,
            "last_crawl_error": latest_runs.get(company.id).error if company.id in latest_runs else None,
            # Official totals are intentionally separate from the local open
            # job count.  A reported publisher total remains useful even when
            # a crawl is partial; a provider cap is returned as null by the
            # crawl layer rather than being presented as an exact number.
            "official_open_jobs": (
                latest_observed_runs.get(company.id).official_count
                if company.id in latest_observed_runs
                and latest_observed_runs[company.id].official_count not in (None, 9999, 99999)
                else None
            ),
            "official_count_status": (
                latest_observed_runs.get(company.id).official_count_status
                if company.id in latest_observed_runs else "unavailable"
            ),
            "official_count_source": (
                latest_observed_runs.get(company.id).official_count_source
                if company.id in latest_observed_runs else None
            ),
            "official_count_observed_at": (
                latest_observed_runs.get(company.id).official_count_observed_at
                if company.id in latest_observed_runs else None
            ),
            "official_count_lower_bound": (
                latest_observed_runs.get(company.id).official_count_lower_bound
                if company.id in latest_observed_runs else None
            ),
            # Expected/discovered come from the latest successful or partial
            # crawl.  ``partial`` is retained because it often reflects field
            # quality warnings while the official source total is still valid.
            # Failed runs must not overwrite counts, and connector sentinels
            # (9999/99999) are never exposed.
            "last_crawl_expected": (
                (None
                 if latest_observed_runs[company.id].official_count_status == "capped_unavailable"
                 else (latest_observed_runs.get(company.id).official_count
                       if latest_observed_runs.get(company.id).official_count not in (None, 9999, 99999)
                       else latest_observed_runs.get(company.id).expected_count))
                if company.id in latest_observed_runs
                and (latest_observed_runs[company.id].official_count_status == "capped_unavailable"
                     or (latest_observed_runs.get(company.id).official_count not in (None, 9999, 99999))
                     or latest_observed_runs[company.id].expected_count not in (None, 9999, 99999))
                else None
            ),
            "last_crawl_discovered": (
                latest_observed_runs.get(company.id).discovered_count
                if company.id in latest_observed_runs
                and latest_observed_runs[company.id].discovered_count not in (None, 9999, 99999)
                else None
            ),
            "generated_at": generated_at,
            "contract_version": contract_version,
        }
        for company in companies
    ]


@app.get("/dashboard/recent-runs")
def recent_runs(limit: int = Query(12, ge=1, le=50), session: Session = Depends(get_session)) -> list[dict]:
    runs = session.scalars(select(CrawlRun).order_by(CrawlRun.started_at.desc()).limit(limit)).all()
    company_names = dict(session.execute(select(Company.id, Company.name)).all())
    return [
        {
            "id": run.id,
            "company": company_names.get(run.company_id, "Unknown"),
            "connector_type": run.connector_type,
            "status": run.status,
            "discovered_count": run.discovered_count,
            "expected_count": run.expected_count,
            "official_count": run.official_count,
            "official_count_status": run.official_count_status,
            "official_count_source": run.official_count_source,
            "official_count_observed_at": run.official_count_observed_at,
            "official_count_lower_bound": run.official_count_lower_bound,
            "complete_count": run.complete_count,
            "partial_count": run.partial_count,
            "created_count": run.created_count,
            "updated_count": run.updated_count,
            "error": run.error,
            "started_at": run.started_at,
            "completed_at": run.completed_at,
        }
        for run in runs
    ]


@app.get("/admin/discover-source", response_model=SourceDiscoveryOut)
def discover_source(url: str = Query(min_length=8)) -> SourceDiscoveryOut:
    return SourceDiscoveryOut(source_url=url, connector_type=detect_connector_type(url), company_name_guess=guess_company_name(url))


@app.post("/admin/financial-catalog", status_code=status.HTTP_202_ACCEPTED)
def import_financial_catalog(_: None = Depends(require_admin)) -> dict[str, str]:
    seed_financial_companies.delay()
    discover_financial_sources.delay()
    return {"status": "queued", "message": "Financial company catalog and ATS discovery queued"}


@app.post("/admin/technology-catalog", status_code=status.HTTP_202_ACCEPTED)
def import_technology_catalog(_: None = Depends(require_admin)) -> dict[str, str]:
    seed_technology_companies.delay()
    discover_financial_sources.delay()
    return {"status": "queued", "message": "Technology company catalog and ATS discovery queued"}


@app.post("/companies", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
def create_company(payload: CompanyCreate, session: Session = Depends(get_session), _: None = Depends(require_admin)) -> Company:
    if session.scalar(select(Company).where(Company.name == payload.name)):
        raise HTTPException(409, "Company already exists")
    data = payload.model_dump(mode="json")
    if data["connector_type"] == "auto":
        data["connector_type"] = detect_connector_type(data["source_url"] or data["career_url"])
    company = Company(**data)
    session.add(company); session.commit(); session.refresh(company)
    return company


@app.get("/companies", response_model=list[CompanyOut])
def list_companies(active_only: bool = True, session: Session = Depends(get_session)) -> list[Company]:
    statement = select(Company).order_by(Company.name)
    if active_only:
        statement = statement.where(Company.is_active.is_(True))
    return list(session.scalars(statement))


@app.get("/admin/audit-logs", response_model=list[AuditLogOut])
def list_audit_logs(limit: int = Query(30, ge=1, le=365), session: Session = Depends(get_session)) -> list[AuditLog]:
    return list(session.scalars(select(AuditLog).order_by(AuditLog.report_date.desc()).limit(limit)))


@app.post("/companies/{company_id}/sources", response_model=CompanySourceOut, status_code=status.HTTP_201_CREATED)
def create_company_source(company_id: UUID, payload: CompanySourceCreate, session: Session = Depends(get_session), _: None = Depends(require_admin)) -> CompanySource:
    if not session.get(Company, company_id):
        raise HTTPException(404, "Company not found")
    source = CompanySource(company_id=company_id, **payload.model_dump(mode="json"))
    session.add(source); session.commit(); session.refresh(source)
    return source


@app.get("/companies/{company_id}/sources", response_model=list[CompanySourceOut])
def list_company_sources(company_id: UUID, session: Session = Depends(get_session)) -> list[CompanySource]:
    if not session.get(Company, company_id):
        raise HTTPException(404, "Company not found")
    return list(session.scalars(select(CompanySource).where(CompanySource.company_id == company_id).order_by(CompanySource.priority, CompanySource.created_at)))


@app.get("/jobs", response_model=list[JobOut])
def list_jobs(company_id: UUID | None = None, country: str | None = None, industry: str | None = None,
              job_function: str | None = None, level: str | None = None, source_type: str | None = None,
              early_career: bool = False,
              status_filter: JobStatus = Query(JobStatus.OPEN, alias="status"),
              limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), session: Session = Depends(get_session)) -> list[Job]:
    statement = select(Job).where(Job.status == status_filter).order_by(Job.last_seen_at.desc()).limit(limit).offset(offset)
    for field, value in [(Job.company_id, company_id), (Job.country, country), (Job.industry, industry), (Job.job_function, job_function), (Job.level, level), (Job.source_type, source_type)]:
        if value is not None:
            statement = statement.where(field == value)
    if early_career:
        statement = statement.where(early_career_condition())
    return list(session.scalars(statement))


@app.get("/integrations/v1/jobs", response_model=JobFeedOut)
def integration_jobs(
    cursor: str | None = None,
    since: datetime | None = None,
    include_closed: bool = True,
    include_raw_payload: bool = False,
    company_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    _: None = Depends(require_integration),
) -> JobFeedOut:
    """Return a complete or incremental, cursor-paginated downstream feed.

    Consumers should persist ``next_cursor`` and send it on the next request.
    Closed roles are returned as ``sync_action=close`` so the receiving site
    can deactivate them without deleting historical evidence.
    """

    if cursor and since:
        raise HTTPException(status_code=400, detail="Use either cursor or since, not both")
    # `updated_at` changes for crawl bookkeeping (for example `last_seen_at`)
    # even when a public job did not change. The feed must advance only on a
    # real downstream-visible revision, otherwise every crawl becomes a full
    # downstream resync.
    statement = select(Job)
    if company_id is not None:
        statement = statement.where(Job.company_id == company_id)
    if not include_closed:
        statement = statement.where(Job.status == JobStatus.OPEN)
    if cursor:
        try:
            cursor_time, cursor_id = decode_cursor(cursor)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        # SQLite stores timezone-aware DateTime values as naive text. Normalize
        # the decoded UTC cursor for local development and test databases;
        # PostgreSQL keeps the timezone and receives the aware value.
        if session.bind is not None and session.bind.dialect.name == "sqlite":
            cursor_time = cursor_time.replace(tzinfo=None)
        statement = statement.where(or_(
            Job.feed_updated_at > cursor_time,
            and_(Job.feed_updated_at == cursor_time, Job.id > cursor_id),
        ))
    elif since:
        statement = statement.where(Job.feed_updated_at > since)
    statement = statement.order_by(Job.feed_updated_at.asc(), Job.id.asc()).limit(limit + 1)
    rows = list(session.scalars(statement))
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [serialize_job(job, include_raw_payload=include_raw_payload) for job in rows]
    next_cursor = encode_cursor(rows[-1].feed_updated_at, rows[-1].id) if has_more and rows else None
    return JobFeedOut(
        generated_at=datetime.now(timezone.utc),
        items=items,
        next_cursor=next_cursor,
        has_more=has_more,
    )


@app.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: UUID, session: Session = Depends(get_session)) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/jobs/{job_id}/evidence", response_model=JobEvidenceOut)
def get_job_evidence(job_id: UUID, session: Session = Depends(get_session)) -> dict:
    """Return the official evidence and provenance behind one normalized role.

    The regular job response intentionally omits the potentially large raw ATS
    payload. This per-role endpoint exposes it on demand for review, feature
    engineering, and troubleshooting while preserving the normalized fields.
    """
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    payload = dict(job.raw_payload or {})
    normalized = JobOut.model_validate(job).model_dump()
    return {
        **normalized,
        "job_id": job.id,
        "detail_status": payload.get("detail_status"),
        "detail_status_reason": payload.get("detail_status_reason"),
        "detail_url": payload.get("detail_url"),
        "detail_source_url": payload.get("detail_source_url"),
        "detail_request_url": payload.get("detail_request_url"),
        "metadata_quality": payload.get("metadata_quality"),
        "description_source": payload.get("description_source"),
        "description_status": payload.get("description_status"),
        "quality_checked_at": payload.get("quality_checked_at"),
        "details_checked_at": payload.get("details_checked_at"),
        "raw_payload": payload,
    }


@app.get("/jobs/{job_id}/tracker", response_model=JobTrackerOut | None)
def get_job_tracker(job_id: UUID, session: Session = Depends(get_session)) -> JobTracker | None:
    tracker = session.scalar(select(JobTracker).where(JobTracker.job_id == job_id))
    return tracker


@app.put("/jobs/{job_id}/tracker", response_model=JobTrackerOut)
def save_job_tracker(job_id: UUID, payload: JobTrackerUpdate, session: Session = Depends(get_session)) -> JobTracker:
    if not session.get(Job, job_id):
        raise HTTPException(404, "Job not found")
    tracker = session.scalar(select(JobTracker).where(JobTracker.job_id == job_id))
    if tracker:
        tracker.status = payload.status
        tracker.notes = payload.notes
        tracker.follow_up_at = payload.follow_up_at
    else:
        tracker = JobTracker(job_id=job_id, **payload.model_dump())
        session.add(tracker)
    session.commit()
    session.refresh(tracker)
    return tracker


@app.delete("/jobs/{job_id}/tracker", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_tracker(job_id: UUID, session: Session = Depends(get_session)) -> None:
    tracker = session.scalar(select(JobTracker).where(JobTracker.job_id == job_id))
    if not tracker:
        raise HTTPException(404, "Job is not being tracked")
    session.delete(tracker)
    session.commit()


@app.get("/job-tracker", response_model=list[TrackedJobOut])
def list_tracked_jobs(session: Session = Depends(get_session)) -> list[dict]:
    trackers = session.scalars(select(JobTracker).order_by(JobTracker.updated_at.desc())).all()
    return [{**JobOut.model_validate(tracker.job).model_dump(), "tracker": tracker} for tracker in trackers]


@app.get("/search", response_model=list[JobOut])
def search_jobs(q: str = Query(min_length=2), early_career: bool = False, limit: int = Query(50, ge=1, le=100), session: Session = Depends(get_session)) -> list[Job]:
    term = f"%{q}%"
    statement = select(Job).join(Job.company).where(Job.status == JobStatus.OPEN, or_(Job.title.ilike(term), Job.description.ilike(term), Job.location.ilike(term), Company.name.ilike(term)))
    if early_career:
        statement = statement.where(early_career_condition())
    statement = statement.limit(limit)
    return list(session.scalars(statement))


@app.post("/admin/ingest/{company_id}", status_code=status.HTTP_202_ACCEPTED)
def ingest_company(company_id: UUID, session: Session = Depends(get_session), _: None = Depends(require_admin)) -> dict[str, str]:
    if not session.get(Company, company_id):
        raise HTTPException(404, "Company not found")
    crawl_one_company.delay(str(company_id))
    return {"status": "queued", "company_id": str(company_id)}
