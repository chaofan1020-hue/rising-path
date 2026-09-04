import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from celery import Celery
from celery.schedules import crontab
from redis import Redis
from redis.exceptions import LockError
from sqlalchemy import and_, func, or_, select

from app.config import get_settings
from app.database import SessionLocal
from app.models import AuditLog, Company, CrawlRun, Job, JobStatus, SyncEvent
from app.models import CompanySource
from app.seed import (
    seed_financial_companies as seed_financial_catalog,
    seed_technology_companies as seed_technology_catalog,
)
from app.source_discovery import canonicalize_source_url, discover_official_page_sources
from app.services import ENRICHMENT_EXTRACTION_VERSION, backfill_lifecycle_events, backfill_structured_fields, crawl_company, enrich_job, promote_listing_teasers, repair_job_details, repair_workday_job_urls, sync_job

settings = get_settings()
celery_app = Celery("global_jobs", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.timezone = settings.timezone

# A crawl can take several minutes for large Workday/Oracle boards. Keep the
# lock longer than the observed worst case while making a dead worker recover
# without needing manual Redis cleanup.
CRAWL_LOCK_TIMEOUT_SECONDS = 20 * 60
CRAWL_DISPATCH_TTL_SECONDS = 25 * 60
CRAWL_STALE_AFTER = timedelta(minutes=20)
CRAWL_RETRY_AFTER = timedelta(minutes=30)
CRAWL_COVERAGE_RETRY_AFTER = timedelta(hours=2)
CRAWL_MAX_AGE = timedelta(hours=8)


def _crawl_lock(company_id: str):
    return Redis.from_url(settings.redis_url).lock(
        f"global_jobs:crawl:{company_id}", timeout=CRAWL_LOCK_TIMEOUT_SECONDS
    )


def _crawl_dispatch_key(company_id: str) -> str:
    return f"global_jobs:crawl-dispatch:{company_id}"


def _queue_company_crawl(company_id: str) -> bool:
    """Queue one crawl only once while it is waiting or running.

    The worker owns the execution lock; this short-lived dispatch marker closes
    the gap before Celery starts the task, where repeated watchdog ticks could
    otherwise enqueue the same company several times.
    """
    redis = Redis.from_url(settings.redis_url)
    key = _crawl_dispatch_key(company_id)
    if not redis.set(key, "queued", nx=True, ex=CRAWL_DISPATCH_TTL_SECONDS):
        return False
    try:
        crawl_one_company.apply_async(args=[company_id])
    except Exception:
        redis.delete(key)
        raise
    return True


celery_app.conf.beat_schedule = {
    "discover-financial-sources": {"task": "app.tasks.discover_financial_sources", "schedule": crontab(hour=23, minute=30)},
    # Queue each company independently so one slow/blocked source cannot delay
    # the rest of the registry. Six-hour cadence keeps public feeds fresh.
    "crawl-all": {"task": "app.tasks.crawl_all", "schedule": crontab(hour="*/6", minute=0)},
    # Recover a task lost before execution, a stale running record, or a
    # source batch that was incomplete because of a transient upstream error.
    "reconcile-crawls": {"task": "app.tasks.reconcile_crawls", "schedule": crontab(minute="*/15")},
    # Keep the two restricted official sources fresh from this server.
    "crawl-priority-official": {"task": "app.tasks.crawl_priority_official", "schedule": crontab(minute=17)},
    "repair-job-details": {"task": "app.tasks.repair_job_details_task", "schedule": crontab(minute=5)},
    "promote-listing-teasers": {"task": "app.tasks.promote_listing_teasers_task", "schedule": crontab(minute=12)},
    "enrich-new": {"task": "app.tasks.enrich_new", "schedule": crontab(hour=1, minute=0)},
    "structured-fields": {"task": "app.tasks.backfill_structured_fields_task", "schedule": crontab(hour=1, minute=30)},
    "sync-open": {"task": "app.tasks.sync_open", "schedule": crontab(hour=2, minute=0)},
    "daily-audit": {"task": "app.tasks.daily_audit", "schedule": crontab(hour=3, minute=0)},
}


@celery_app.task(name="app.tasks.seed_financial_companies")
def seed_financial_companies() -> int:
    with SessionLocal() as session:
        return seed_financial_catalog(session)


@celery_app.task(name="app.tasks.seed_technology_companies")
def seed_technology_companies() -> int:
    with SessionLocal() as session:
        return seed_technology_catalog(session)


@celery_app.task(name="app.tasks.discover_financial_sources")
def discover_financial_sources() -> dict[str, int]:
    """Refresh ATS sources from official pages before the midnight crawl."""
    discovered = 0
    failures = 0
    with SessionLocal() as session:
        companies = session.scalars(select(Company).where(Company.is_active.is_(True), Company.industry.in_(("Investment Banking", "Asset Management", "Sales & Trading", "Consulting", "Technology")))).all()
        career_urls = [company.career_url for company in companies]

        async def discover_all() -> list[list[tuple[str, str, dict]] | Exception]:
            return list(await asyncio.gather(*(discover_official_page_sources(url) for url in career_urls), return_exceptions=True))

        results = asyncio.run(discover_all())
        for company, result in zip(companies, results, strict=True):
            try:
                if isinstance(result, Exception):
                    raise result
                sources = result
                canonical_keys = {(source_type, source_url) for source_type, source_url, _ in sources}
                for source_type, source_url, config in sources:
                    existing = session.scalar(select(CompanySource).where(CompanySource.company_id == company.id, CompanySource.source_url == source_url))
                    if not existing:
                        session.add(CompanySource(company_id=company.id, source_type=source_type, source_url=source_url, priority=2, connector_config=config))
                        discovered += 1
                    elif existing.connector_config != config:
                        # Discovery refreshes generated ATS settings, but
                        # must preserve deliberate operator overrides such as
                        # Workday facet partitioning required to bypass a
                        # tenant's capped broad-search result.
                        existing.connector_config = {
                            **(existing.connector_config or {}),
                            **(config or {}),
                        }
                # A successful discovery proves the canonical board exists.
                # Deactivate only duplicate ATS detail sources; retain all jobs.
                for existing in session.scalars(select(CompanySource).where(
                    CompanySource.company_id == company.id,
                    CompanySource.is_active.is_(True),
                    CompanySource.source_type.in_(("greenhouse", "lever", "ashby", "smartrecruiters")),
                )).all():
                    canonical = canonicalize_source_url(existing.source_type, existing.source_url)
                    if (existing.source_type, canonical) in canonical_keys and existing.source_url != canonical:
                        existing.is_active = False
                        existing.last_error = "deactivated duplicate ATS detail source; canonical board retained"
            except Exception:
                failures += 1
        session.commit()
    return {"discovered": discovered, "failures": failures}


@celery_app.task(name="app.tasks.crawl_one_company")
def crawl_one_company(company_id: str) -> dict:
    # Prevent an admin-triggered crawl from overlapping with the scheduled
    # crawl for the same company. The lock expires so a killed worker recovers.
    lock = _crawl_lock(company_id)
    dispatch_key = _crawl_dispatch_key(company_id)
    if not lock.acquire(blocking=False):
        return {"status": "already_running", "company_id": company_id}
    try:
        with SessionLocal() as session:
            company = session.get(Company, company_id)
            if not company:
                return {"status": "not_found", "company_id": company_id}
            run = asyncio.run(crawl_company(session, company))
            return {
                "status": run.status,
                "created": run.created_count,
                "updated": run.updated_count,
                "discovered": run.discovered_count,
                "expected": run.expected_count,
            }
    finally:
        try:
            lock.release()
        except LockError:
            pass
        Redis.from_url(settings.redis_url).delete(dispatch_key)


@celery_app.task(name="app.tasks.crawl_all")
def crawl_all() -> dict[str, int | list[str]]:
    with SessionLocal() as session:
        statement = select(Company.id).where(Company.is_active.is_(True))
        ids = [str(company_id) for company_id in session.scalars(statement)]
    queued = []
    skipped = []
    for company_id in ids:
        if _queue_company_crawl(company_id):
            queued.append(company_id)
        else:
            skipped.append(company_id)
    return {
        "queued": len(queued),
        "skipped": len(skipped),
        "company_ids": queued,
        "skipped_company_ids": skipped,
    }


@celery_app.task(name="app.tasks.reconcile_crawls")
def reconcile_crawls() -> dict[str, int]:
    """Keep the six-hour crawl cadence self-healing.

    A Celery task can disappear after dispatch or a worker can die after the
    lock is acquired. This task turns stale running rows into explicit
    failures and requeues companies that have no recent completed crawl. A
    source-coverage warning is retried quickly; ordinary detail-quality
    warnings wait for the normal freshness window and do not create a loop.
    """
    now = datetime.now(timezone.utc)
    queue_ids: list[str] = []
    stale_count = 0
    checked_count = 0
    with SessionLocal() as session:
        companies = session.scalars(select(Company).where(Company.is_active.is_(True))).all()
        checked_count = len(companies)
        for company in companies:
            latest = session.scalar(
                select(CrawlRun)
                .where(CrawlRun.company_id == company.id)
                .order_by(CrawlRun.started_at.desc())
                .limit(1)
            )
            if latest and latest.status == "running":
                started_at = latest.started_at
                if started_at and started_at < now - CRAWL_STALE_AFTER:
                    latest.status = "failed"
                    latest.completed_at = now
                    latest.error = (
                        "watchdog: crawl exceeded the execution window; "
                        "the company was requeued"
                    )
                    stale_count += 1
                    queue_ids.append(str(company.id))
                continue
            if not latest:
                queue_ids.append(str(company.id))
                continue
            completed_at = latest.completed_at or latest.started_at
            if not completed_at:
                queue_ids.append(str(company.id))
                continue
            warning = str(latest.error or "").lower()
            hard_transient_warning = any(
                marker in warning
                for marker in (
                    "all configured sources returned zero jobs",
                    "httpstatuserror",
                    "timeout",
                )
            )
            coverage_warning = any(
                marker in warning
                for marker in (
                    "incomplete source coverage",
                    "source coverage not verified",
                    "source marked incomplete",
                )
            )
            # A near-complete board with a handful of duplicate/invalid rows is
            # stable enough for a slower retry. A large gap remains urgent.
            large_coverage_gap = (
                latest.expected_count is not None
                and latest.expected_count > 0
                and latest.discovered_count < latest.expected_count * 0.9
            )
            if latest.status == "failed" or hard_transient_warning or (
                coverage_warning and large_coverage_gap
            ):
                retry_after = CRAWL_RETRY_AFTER
            elif coverage_warning:
                retry_after = CRAWL_COVERAGE_RETRY_AFTER
            else:
                retry_after = CRAWL_MAX_AGE
            retry_at = completed_at + retry_after
            if retry_at <= now:
                queue_ids.append(str(company.id))
        session.commit()

    queued_count = 0
    deduped_count = 0
    unique_queue_ids = list(dict.fromkeys(queue_ids))
    for company_id in unique_queue_ids:
        if _queue_company_crawl(company_id):
            queued_count += 1
        else:
            deduped_count += 1
    return {
        "checked": checked_count,
        "stale_marked_failed": stale_count,
        "due": len(unique_queue_ids),
        "queued": queued_count,
        "deduped": deduped_count,
    }


@celery_app.task(name="app.tasks.crawl_priority_official")
def crawl_priority_official() -> list[dict]:
    """Refresh official sources that need more frequent server-side checks."""
    with SessionLocal() as session:
        names = {"Evercore", "Citadel"}
        companies = session.scalars(
            select(Company).where(Company.is_active.is_(True), Company.name.in_(names))
        ).all()
        results: list[dict] = []
        for company in companies:
            queued = _queue_company_crawl(str(company.id))
            results.append({"company": company.name, "status": "queued" if queued else "deduped"})
        return results


@celery_app.task(name="app.tasks.repair_job_details_task")
def repair_job_details_task(batch_size: int = 500, source_type: str | None = None,
                            company_name: str | None = None,
                            include_unverified_detail: bool = False,
                            include_short_verified: bool = False,
                            include_closed: bool = False) -> dict[str, int]:
    with SessionLocal() as session:
        return repair_job_details(session, batch_size=batch_size, source_type=source_type,
                                  company_name=company_name,
                                  include_unverified_detail=include_unverified_detail,
                                  include_short_verified=include_short_verified,
                                  include_closed=include_closed)


@celery_app.task(name="app.tasks.promote_listing_teasers_task")
def promote_listing_teasers_task(batch_size: int = 500) -> dict[str, int]:
    """Persist official list summaries when a detail endpoint is unavailable."""
    with SessionLocal() as session:
        return promote_listing_teasers(session, batch_size=batch_size)


@celery_app.task(name="app.tasks.enrich_new")
def enrich_new() -> int:
    with SessionLocal() as session:
        processed = 0
        version = Job.raw_payload["enrichment_extraction_version"].as_string()
        # Process in bounded transactions. A full registry can contain tens of
        # thousands of jobs; loading and committing it as one unit made a
        # routine enrichment pass unnecessarily vulnerable to worker restarts.
        while True:
            jobs = session.scalars(
                select(Job).where(
                    Job.status == JobStatus.OPEN,
                    or_(Job.enriched_at.is_(None), version.is_(None), version != ENRICHMENT_EXTRACTION_VERSION),
                ).order_by(Job.last_seen_at.desc()).limit(500)
            ).all()
            if not jobs:
                break
            for job in jobs:
                enrich_job(job)
            session.commit()
            processed += len(jobs)
        return processed


@celery_app.task(name="app.tasks.backfill_structured_fields_task")
def backfill_structured_fields_task(batch_size: int = 1000, company_name: str | None = None,
                                    include_closed: bool = False) -> dict[str, int]:
    with SessionLocal() as session:
        return backfill_structured_fields(
            session,
            batch_size=batch_size,
            company_name=company_name,
            include_closed=include_closed,
        )


@celery_app.task(name="app.tasks.backfill_lifecycle_events_task")
def backfill_lifecycle_events_task(batch_size: int = 1000) -> dict[str, int]:
    with SessionLocal() as session:
        return backfill_lifecycle_events(session, batch_size=batch_size)


@celery_app.task(name="app.tasks.sync_open")
def sync_open() -> int:
    if not settings.table_sync_enabled:
        return 0
    lock = Redis.from_url(settings.redis_url).lock("global_jobs:sync_open", timeout=3600)
    if not lock.acquire(blocking=False):
        return 0
    try:
        with SessionLocal() as session:
            # Avoid scanning and committing unchanged history on every schedule.
            # Closed roles remain eligible when their status changed after the
            # last table write, so the downstream directory stays accurate.
            jobs = session.scalars(
                select(Job).outerjoin(
                    SyncEvent,
                    and_(SyncEvent.job_id == Job.id, SyncEvent.target == "table"),
                ).where(
                    or_(
                        SyncEvent.id.is_(None),
                        SyncEvent.status != "success",
                        SyncEvent.last_synced_at.is_(None),
                        Job.updated_at.is_(None),
                        SyncEvent.last_synced_at < Job.updated_at,
                    )
                )
            ).all()
            for job in jobs:
                sync_job(session, job)
                # Persist each acknowledged remote write. An interrupted run can
                # resume without re-creating the rows it already synced.
                session.commit()
            return len(jobs)
    finally:
        try:
            lock.release()
        except LockError:
            pass


@celery_app.task(name="app.tasks.repair_workday_job_urls")
def repair_workday_job_urls_task() -> dict[str, int]:
    with SessionLocal() as session:
        return repair_workday_job_urls(session)


@celery_app.task(name="app.tasks.daily_audit")
def daily_audit() -> dict:
    with SessionLocal() as session:
        now = datetime.now(timezone.utc)
        report_date = now.astimezone(ZoneInfo(settings.timezone)).date()
        log = session.scalar(select(AuditLog).where(AuditLog.report_date == report_date)) or AuditLog(report_date=report_date)
        log.open_jobs = session.scalar(select(func.count(Job.id)).where(Job.status == JobStatus.OPEN)) or 0
        log.new_jobs = session.scalar(select(func.count(Job.id)).where(func.date(Job.first_seen_at) == report_date)) or 0
        log.closed_jobs = session.scalar(select(func.count(Job.id)).where(func.date(Job.closed_at) == report_date)) or 0
        log.crawl_runs = session.scalar(select(func.count(CrawlRun.id)).where(func.date(CrawlRun.started_at) == report_date)) or 0
        log.failed_crawls = session.scalar(select(func.count(CrawlRun.id)).where(func.date(CrawlRun.started_at) == report_date, CrawlRun.status == "failed")) or 0
        log.sync_failures = session.scalar(select(func.count(SyncEvent.id)).where(func.date(SyncEvent.created_at) == report_date, SyncEvent.status == "failed")) or 0
        log.generated_at = now
        session.add(log); session.commit()
        return {"generated_at": now.isoformat(), "open_jobs": log.open_jobs, "new_jobs": log.new_jobs, "closed_jobs": log.closed_jobs}
