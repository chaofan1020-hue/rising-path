import asyncio
import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.connectors import AppleCareersConnector, BeesiteConnector, EightfoldConnector, MicrosoftCareersConnector, OracleHCMConnector, RawJob, WorkdayConnector, fetch_public_detail, get_connector
from app.enrichment import extract_with_llm
from app.models import Company, CompanySource, CrawlRun, Job, JobLifecycleEvent, JobStatus, SyncEvent
from app.structured_extract import (
    STRUCTURED_EXTRACTION_VERSION,
    html_to_text,
    _payload_text,
    _payload_value,
    _normalize_compensation,
    _stringify_value,
    extract_structured_fields,
    structured_missing_fields,
)


def _hash(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()


_FEED_STRUCTURED_FIELDS = (
    "date_posted", "valid_through", "employment_type", "workplace_type",
    "remote_type", "work_arrangement", "responsibilities", "qualifications",
    "qualification", "education", "education_level", "experience",
    "compensation", "salary_range", "additional_locations", "team_context",
    "benefits", "application_process", "work_authorization", "travel",
    "application_deadline", "recruiting_program",
)


def _feed_content_signature(job: Job) -> str:
    """Hash only values that the downstream site is allowed to display.

    Crawl timestamps, retry state and detail-probe diagnostics are intentionally
    excluded. They change frequently but must not turn an otherwise unchanged
    role into a new downstream feed event.
    """

    payload = dict(job.raw_payload or {})
    projection = {
        "external_job_id": job.external_job_id,
        "source_type": job.source_type,
        "source_url": job.source_url,
        "title": job.title,
        "description": job.description,
        "location": job.location,
        "country": job.country,
        "department": job.department,
        "industry": job.industry,
        "job_function": job.job_function,
        "level": job.level,
        "required_skills": job.required_skills or [],
        "preferred_skills": job.preferred_skills or [],
        "visa_sponsorship": job.visa_sponsorship,
        "status": job.status.value if isinstance(job.status, JobStatus) else str(job.status),
        "closed_at": job.closed_at.isoformat() if job.closed_at else None,
        "structured": {name: getattr(job, name) for name in _FEED_STRUCTURED_FIELDS},
        "structured_field_sources": payload.get("structured_field_sources") or {},
        "enrichment_field_sources": payload.get("enrichment_field_sources") or {},
        "description_source": payload.get("description_source"),
        "description_status": payload.get("description_status"),
        "detail_status": payload.get("detail_status"),
    }
    serialized = json.dumps(projection, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def refresh_feed_revision(job: Job, previous_signature: str | None, now: datetime) -> bool:
    """Advance the downstream cursor only when public job data changed."""

    payload = dict(job.raw_payload or {})
    payload.pop("feed_content_signature", None)
    job.raw_payload = payload
    signature = _feed_content_signature(job)
    payload["feed_content_signature"] = signature
    job.raw_payload = payload
    changed = signature != previous_signature
    if changed:
        job.feed_updated_at = now
    return changed


def identity_hash(company_id: str, title: str, location: str | None) -> str:
    return _hash(f"{company_id}|{title}|{location or ''}")


def _limit_text(value: str | None, maximum: int) -> str | None:
    return value[:maximum] if value else value


def _official_description(payload: dict[str, Any]) -> str | None:
    """Extract a public posting body when a connector only returned its JSON."""

    return _payload_text(
        payload,
        # Prefer full/detail fields over short listing teasers.
        "jobDescription", "ExternalDescriptionStr", "descriptionHtml", "jobDescriptionHtml",
        "contentHtml", "content", "postingDescription", "jobPostingDescription",
        "description",
        limit=30000,
    )


def infer_country(location: str | None) -> str | None:
    if not location:
        return None
    last = re.split(r"[,|/;]", location)[-1].strip()
    return last[:100] if len(last) > 1 else None


def quality_missing_fields(raw: RawJob | Job) -> list[str]:
    """Fields required before a role can enter the AI matching feature store."""
    missing: list[str] = []
    if not raw.location:
        missing.append("location")
    if not raw.department:
        missing.append("department")
    if not raw.description or len(raw.description.strip()) < 300:
        missing.append("description")
    return missing


def record_job_lifecycle(session: Session, job: Job, event_type: str, observed_at: datetime,
                         *, reason: str | None = None, source_type: str | None = None) -> None:
    """Persist an immutable lifecycle observation for downstream consumers."""

    session.add(JobLifecycleEvent(
        job=job,
        event_type=event_type,
        observed_at=observed_at,
        reason=reason,
        source_type=source_type,
    ))


def backfill_lifecycle_events(session: Session, batch_size: int = 1000) -> dict[str, int]:
    """Seed lifecycle observations for roles created before event tracking."""

    inserted = 0
    opened = 0
    closed = 0
    event_exists = select(JobLifecycleEvent.id).where(JobLifecycleEvent.job_id == Job.id).exists()
    while True:
        jobs = session.scalars(
            select(Job).where(~event_exists).order_by(Job.first_seen_at, Job.id).limit(max(1, batch_size))
        ).all()
        if not jobs:
            break
        for job in jobs:
            record_job_lifecycle(
                session,
                job,
                "opened",
                job.first_seen_at,
                reason="backfill_first_seen",
                source_type=job.source_type,
            )
            opened += 1
            if job.closed_at:
                record_job_lifecycle(
                    session,
                    job,
                    "closed",
                    job.closed_at,
                    reason=(job.raw_payload or {}).get("closed_reason") or "backfill_closed_at",
                    source_type=job.source_type,
                )
                closed += 1
            inserted += 1
        session.commit()
    return {"jobs": inserted, "opened": opened, "closed": closed}


# These fields are extracted only when the official listing exposes an
# explicit value or a recognisable section.  Their absence is reported as
# feature-store coverage, not as a fabricated value or a crawl failure.
STRUCTURED_FEATURE_FIELDS = (
    "responsibilities",
    "qualifications",
    "qualification",
    "education",
    "education_level",
    "experience",
    "required_skills",
    "preferred_skills",
    "employment_type",
    "workplace_type",
    "remote_type",
    "work_arrangement",
    "compensation",
    "salary_range",
)

# Optional facts are measured separately from the core completeness gate. A
# missing optional section means the employer did not publish it, not that the
# crawler failed.
EXTENDED_FEATURE_FIELDS = (
    "team_context",
    "benefits",
    "application_process",
    "work_authorization",
    "travel",
    "application_deadline",
    "recruiting_program",
)

ENRICHMENT_EXTRACTION_VERSION = "4"

# Bump when deterministic classification coverage changes. The value is kept
# in the payload so existing open roles can be reclassified without a crawl.
DEPARTMENT_EXTRACTION_VERSION = "4"

ENRICHMENT_FEATURE_FIELDS = (
    "job_function",
    "level",
    "visa_sponsorship",
)


def structured_missing_for_job(raw: RawJob | Job) -> list[str]:
    """Return deterministic AI fields not present on a job record."""

    payload = dict(getattr(raw, "raw_payload", None) or getattr(raw, "payload", None) or {})
    missing = structured_missing_fields(
        payload,
        required_skills=list(getattr(raw, "required_skills", None) or []),
        preferred_skills=list(getattr(raw, "preferred_skills", None) or []),
    )
    return [field for field in STRUCTURED_FEATURE_FIELDS if field in missing]


def structured_coverage_for_job(raw: RawJob | Job) -> dict[str, object]:
    """Summarize deterministic field coverage without treating unknown facts as false."""

    missing = structured_missing_for_job(raw)
    total = len(STRUCTURED_FEATURE_FIELDS)
    present = total - len(missing)
    return {
        "fields": list(STRUCTURED_FEATURE_FIELDS),
        "present": present,
        "total": total,
        "rate": round(present / total, 4) if total else 1.0,
        "missing_fields": missing,
    }


def extended_missing_for_job(raw: RawJob | Job) -> list[str]:
    """Return optional published facts absent from one normalized role."""

    return [field for field in EXTENDED_FEATURE_FIELDS if getattr(raw, field, None) in (None, "", [])]


def enrichment_missing_for_job(raw: RawJob | Job) -> list[str]:
    """Return enrichment fields that are still unknown for a job."""

    return [
        field for field in ENRICHMENT_FEATURE_FIELDS
        if getattr(raw, field, None) in (None, "", [])
    ]


def _explicit_department(payload: dict[str, Any]) -> str | None:
    """Return a department/business classification explicitly present in ATS JSON."""

    value = _payload_value(
        payload,
        "department", "Department", "detail_department", "jobFamily", "JobFamily", "businessUnit",
        "BusinessUnit", "businessUnitName", "division", "Division", "team", "Team",
        "primary_category", "category",
    )
    if value in (None, "", []):
        return None
    text = _stringify_value(value).strip()
    return text[:255] if text else None


def _department_from_rules(text: str | None) -> str | None:
    if not text:
        return None
    for label, expression in _DEPARTMENT_RULES:
        if re.search(expression, text, re.IGNORECASE):
            return label
    return None


def _labelled_classification_text(description: str | None) -> str | None:
    """Read only an explicitly labelled team/function value from body text."""

    if not description:
        return None
    text = html_to_text(description)[:3000]
    match = re.search(
        r"(?im)(?:^|\n)\s*(?:department|division|business\s+unit|job\s+family\s+group|job\s+family|job\s+function|career\s+area|business\s+area|line\s+of\s+business|team|job\s+category|category)\s*[:\-]\s*([^\n.;]{2,160})",
        text,
    )
    return match.group(1).strip() if match else None


def resolve_department(title: str, description: str | None, payload: dict[str, Any]) -> tuple[str | None, str, str]:
    """Resolve department with an auditable publication/inference status."""

    explicit = _explicit_department(payload)
    if explicit:
        return explicit, "published", "official_payload"
    labelled = _labelled_classification_text(description)
    if labelled:
        inferred = _department_from_rules(labelled)
        return (inferred or labelled[:255]), "published", "official_description_label"
    inferred = _department_from_rules(title)
    if inferred:
        return inferred, "inferred", "title_rule"
    inferred = _department_from_context(description)
    if inferred:
        return inferred, "inferred", "description_rule"
    return None, "not_published", "none"


def _explicit_enrichment(payload: dict[str, Any]) -> dict[str, Any]:
    """Read enrichment fields exposed by an ATS without inferring missing facts."""

    result: dict[str, Any] = {}
    function = _payload_text(
        payload, "job_function", "jobFunction", "JobFunction", "function", "careerFunction",
        limit=100,
    )
    level = _payload_text(
        payload, "level", "job_level", "jobLevel", "JobLevel", "careerLevel", "experienceLevel",
        limit=100,
    )
    sponsorship = _payload_value(
        payload, "visa_sponsorship", "visaSponsorship", "VisaSponsorship", "sponsorship",
        "workAuthorizationSponsorship", "visaSupport",
    )
    if function:
        result["job_function"] = function
    if level:
        result["level"] = level
    if isinstance(sponsorship, bool):
        result["visa_sponsorship"] = sponsorship
    elif isinstance(sponsorship, (int, float)) and sponsorship in (0, 1):
        result["visa_sponsorship"] = bool(sponsorship)
    elif isinstance(sponsorship, str):
        normalized = sponsorship.strip().casefold()
        if normalized in {"yes", "true", "y", "1", "supported", "available"}:
            result["visa_sponsorship"] = True
        elif normalized in {"no", "false", "n", "0", "not supported", "unavailable"}:
            result["visa_sponsorship"] = False
    return result


def _explicit_enrichment_sources(payload: dict[str, Any]) -> dict[str, str]:
    values = _explicit_enrichment(payload)
    return {key: "official_payload" for key in values}


def _rule_enrichment(title: str, description: str | None) -> dict[str, Any]:
    """Infer only title-led enrichment fields and explicit visa statements."""

    result: dict[str, Any] = {}
    for label, expression in _JOB_FUNCTION_RULES:
        if re.search(expression, title or "", re.IGNORECASE):
            result["job_function"] = label
            break

    level_rules: tuple[tuple[str, str], ...] = (
        ("Internship", r"\bintern(?:ship)?\b|\bsummer\s+analyst\b|\bcampus\b"),
        ("Graduate", r"\bgraduate\s+(?:program|role)\b"),
        ("Managing Director", r"\bmanaging\s+director\b|\bMD\b"),
        ("Partner", r"\bpartner\b"),
        ("Director", r"\bdirector\b"),
        ("VP", r"\bvice\s+president\b|\b(?:senior\s+)?VP\b"),
        ("Manager / Lead", r"\bmanager\b|\blead\b|\bhead\s+of\b"),
        ("Senior Associate", r"\bsenior\s+associate\b"),
        ("Associate", r"\bassociate\b"),
        ("Analyst", r"\banalyst\b"),
        ("Coordinator / Assistant", r"\bcoordinator\b|\b(?:executive\s+)?assistant\b"),
    )
    for label, expression in level_rules:
        if re.search(expression, title or "", re.IGNORECASE):
            result["level"] = label
            break

    text = html_to_text(description or "")
    negative_visa = re.search(
        r"\b(?:no|without|not?)\s+(?:visa\s+)?sponsorship\b|\bwill\s+not\s+sponsor\b|\bsponsorship\s+(?:is\s+)?unavailable\b|\bdoes\s+not\s+sponsor\b|\bnot\s+eligible\s+for\s+sponsorship\b",
        text,
        re.IGNORECASE,
    )
    positive_visa = re.search(
        r"\bvisa\s+sponsorship\s+(?:is\s+)?(?:available|provided|supported)\b|\bwill\s+sponsor\b|\bsponsor(?:s|ing)?\s+(?:a\s+)?work\s+visa\b|\beligible\s+for\s+sponsorship\b",
        text,
        re.IGNORECASE,
    )
    if negative_visa:
        result["visa_sponsorship"] = False
    elif positive_visa:
        result["visa_sponsorship"] = True
    return result


VERIFIED_DETAIL_STATUSES = frozenset({
    "fetched",
    "fetched_json",
    "fetched_jsonld",
    "fetched_html",
})

# Availability is deliberately separate from detail quality. A public ATS can
# reject the crawler while the same URL still works in a normal browser.
LINK_HEALTH_VALID = "valid"
LINK_HEALTH_CLOSED = "closed"
LINK_HEALTH_BLOCKED = "blocked"
LINK_HEALTH_TIMEOUT = "timeout"
LINK_HEALTH_UNKNOWN = "unknown"

_CLOSED_TEXT_RE = re.compile(
    r"(?:job|position|role|opening|vacancy|requisition|opportunity|职位|岗位)"
    r".{0,120}(?:no longer available|has been filled|is closed|was closed|expired|"
    r"removed|not found|no longer accepting|已关闭|已过期|已下架|不存在)|"
    r"(?:no longer available|position filled|job expired|job not found|opening closed|"
    r"requisition closed|no longer accepting applications|posting has been removed|"
    r"this role is no longer|职位已关闭|岗位已下架|申请已结束)",
    re.IGNORECASE,
)
_BLOCKED_TEXT_RE = re.compile(
    r"(?:access denied|forbidden|captcha|verify you are human|unusual traffic|"
    r"enable javascript to continue|checking your browser|security verification|"
    r"cloudflare|akamai bot)",
    re.IGNORECASE,
)


def _availability_payload(
    *,
    availability: str,
    link_health: str,
    reason: str,
    checked_at: str,
    http_status: int | None = None,
) -> dict[str, Any]:
    """Build an auditable availability result without changing Job.status."""

    payload: dict[str, Any] = {
        "availability_status": availability,
        "link_health": link_health,
        "link_check_error": reason[:500],
        "availability_checked_at": checked_at,
        "details_checked_at": checked_at,
    }
    retry_hours = {
        LINK_HEALTH_BLOCKED: 12,
        LINK_HEALTH_TIMEOUT: 4,
        LINK_HEALTH_UNKNOWN: 6,
    }.get(link_health)
    if retry_hours is not None:
        payload["detail_retry_after"] = (
            datetime.fromisoformat(checked_at) + timedelta(hours=retry_hours)
        ).isoformat()
    if http_status is not None:
        payload["link_check_http_status"] = http_status
    return payload


def _classify_detail_exception(exc: Exception) -> tuple[str, str, int | None]:
    """Classify a failed detail request without treating bot protection as closure."""

    if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
        status = exc.response.status_code
        if status in {404, 410}:
            return LINK_HEALTH_CLOSED, f"HTTP {status}: official detail is gone", status
        if status in {401, 403, 429}:
            return LINK_HEALTH_BLOCKED, f"HTTP {status}: official detail requires browser verification", status
        if status >= 500:
            return LINK_HEALTH_UNKNOWN, f"HTTP {status}: official detail server error", status
        return LINK_HEALTH_UNKNOWN, f"HTTP {status}: official detail request was inconclusive", status

    message = str(exc)
    if _BLOCKED_TEXT_RE.search(message):
        return LINK_HEALTH_BLOCKED, "official detail returned an anti-bot or browser-verification challenge", None
    if isinstance(exc, httpx.TimeoutException):
        return LINK_HEALTH_TIMEOUT, f"{type(exc).__name__}: official detail request timed out", None
    return LINK_HEALTH_UNKNOWN, f"{type(exc).__name__}: {message}"[:500], None


def _listing_state(raw: RawJob) -> tuple[str, str | None]:
    """Reject explicit closed rows before they reach the open-job table."""

    payload = raw.payload or {}
    for key in ("status", "job_status", "jobStatus", "state", "availability_status"):
        value = payload.get(key)
        if isinstance(value, str):
            normalized = value.strip().casefold().replace("-", "_").replace(" ", "_")
            if normalized in {"closed", "close", "expired", "withdrawn", "removed", "filled", "inactive", "not_found"}:
                return "closed", f"source payload {key}={value}"
            if normalized in {"blocked", "challenge", "captcha"}:
                return "blocked", f"source payload {key}={value}"
    if payload.get("is_active") is False or payload.get("isActive") is False:
        return "closed", "source payload marked the listing inactive"
    if not raw.url or not raw.url.strip():
        return "invalid", "listing did not provide a URL"
    try:
        parsed = urlparse(raw.url)
    except ValueError:
        return "invalid", "listing URL could not be parsed"
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return "invalid", "listing URL is not an HTTP(S) URL"
    if not raw.title or not raw.title.strip() or raw.title.strip().casefold() in {"untitled", "job", "position"}:
        return "invalid", "listing did not provide a real title"
    return "open", None

# Listing connectors are allowed to add their own freshness metadata, but they
# must not replace evidence from a previously successful official detail fetch.
# Keep this list explicit so future connector payloads cannot accidentally
# downgrade the quality state by reusing a generic ``detail_status`` key.
DETAIL_METADATA_KEYS = frozenset({
    "detail_status",
    "detail_status_reason",
    "detail_source_url",
    "detail_url",
    "detail_request_url",
    "detail_payload",
    "detail_location",
    "detail_department",
    "metadata_quality",
    "official_page_title",
    "official_page_status",
    "department_status",
    "department_source",
    "department_extraction_version",
    "fetched_by",
    "fetched_at",
    "details_checked_at",
    "availability_status",
    "link_health",
    "link_check_http_status",
    "link_check_error",
    "availability_checked_at",
})


_DEPARTMENT_RULES: tuple[tuple[str, str], ...] = (
    ("Fund Accounting", r"\bfund\s+accounting\b"),
    ("Fund Services", r"\bfund\s+services?\b|\btransfer\s+agency\b|\bcustody\s+services?\b"),
    ("Private Equity", r"\bprivate\s+equity\b|\bprivate\s+markets?\b"),
    ("Investment Banking", r"\binvestment\s+bank(?:ing)?\b|\bm\s*&\s*a\b|mergers?\s+and\s+acquisitions?|\bleveraged\s+finance\b|\bfinancial\s+sponsors?\b"),
    ("Capital Markets", r"\bcapital\s+markets?\b|\bdebt\s+capital\b|\bequity\s+capital\b|\bcapital\s+origination\b"),
    ("Mortgage Banking", r"\bmortgage\b|\bhome\s+lending\b|\bloan\s+servicing\b"),
    ("Wealth Management", r"\bwealth\s+management\b|\bprivate\s+wealth\b|\bprivate\s+client\b|\bprivate\s+banker\b|\bfinancial\s+(?:solutions\s+)?advisor\b|\bfinancial\s+adviser\b|\bmerrill\b|\bregistered\s+client\s+associate\b|\binvestment\s+consultant\b|\btrust\s+officer\b"),
    ("Asset Management", r"\basset\s+management\b|\binvestment\s+management\b|\bportfolio\s+management\b|\bportfolio\s+manager\b"),
    ("Real Estate", r"\breal\s+estate\b|\bproperty\s+investment\b"),
    ("Commercial Banking", r"\bcommercial\s+(?:banking|loan|lending|relationship|term)\b|\bbusiness\s+banking\b|\bbusiness\s+relationship\s+manager\b|\btrade\s+services?\b|\bcash\s+management\b"),
    ("Corporate Banking", r"\bcorporate\s+banking\b|\bglobal\s+corporate\b"),
    ("Retail Banking", r"\brelationship\s+banker\b|\bpersonal\s+banker\b|\bbranch\b|\bfinancial\s+center\b|\bconsumer\s+banking\b|\bretail\s+banking\b|\bcustomer\s+service\s+representative\b"),
    ("Payments", r"\bpayments?\b|\bmerchant\s+services?\b|\bcard\s+(?:services?|products?)\b"),
    ("Product Management", r"\bproduct\s+(?:manager|owner|management)\b"),
    ("Sales & Trading", r"\bsales\s*&\s*trading\b|\bsales\s+and\s+trading\b|\btrader\b|\btrading\b"),
    ("Research", r"\bequity\s+research\b|\bcredit\s+research\b|\bresearch\s+(?:analyst|associate|scientist)\b"),
    ("Risk", r"\brisk\s+(?:management|analyst|manager|officer)\b|\bmarket\s+risk\b|\bcredit\s+risk\b|\boperational\s+risk\b"),
    ("Compliance", r"\bcompliance\b|\bfinancial\s+crime\b|\banti[- ]money\s+laundering\b|\bAML\b"),
    ("Legal", r"\blegal\b|\battorney\b|\bcounsel\b|\bsolicitor\b"),
    ("Audit", r"\binternal\s+audit\b|\bauditor\b|\baudit\b"),
    ("Tax", r"\btax\b|\btaxation\b"),
    ("Finance & Accounting", r"\baccount(?:ing|ancy)\b|\bfinance\b|\bfinancial\s+planning\b|\bcontroller\b|\btreasury\b"),
    ("Data & Analytics", r"\bdata\s+(?:analyst|analytics?|scientist|engineering)\b|\bmachine\s+learning\b|\banalytics\b"),
    ("Technology", r"\bsoftware\s+(?:engineer|developer)\b|\bsite\s+reliability\b|\bplatform\s+engineer(?:ing)?\b|\bapplications?\s+development\b|\btechnology\b|\bdeveloper\b|\bengineering\b|\bcyber\s*security\b|\bfull[- ]?stack\b"),
    ("Operations", r"\boperations?\b|\bmiddle\s+office\b|\bback\s+office\b|\btrade\s+support\b"),
    ("Client Service", r"\bclient\s+(?:service|support|relationship)\b|\bclient\s+management\b"),
    ("Investor Relations", r"\binvestor\s+relations?\b"),
    ("Human Resources", r"\bhuman\s+resources?\b|\bHR\b|\btalent\s+acquisition\b|\brecruit(?:er|ing)\b"),
    ("Marketing & Communications", r"\bmarketing\b|\bcommunications?\b|\bpublic\s+relations?\b"),
    ("Corporate Strategy", r"\bcorporate\s+strategy\b|\bstrateg(?:y|ic)\b"),
    ("Administrative", r"\badministrative\b|\badministrator\b|\bexecutive\s+assistant\b|\bcoordinator\b"),
)

# Body-level inference is intentionally narrower than title classification.
# Generic employer boilerplate often mentions finance, clients, or risk even
# for technology and HR roles, so only distinctive business phrases qualify.
_DEPARTMENT_CONTEXT_RULES: tuple[tuple[str, str], ...] = (
    ("Mortgage Banking", r"\b(?:mortgage|home\s+lending|loan\s+servicing)\b"),
    ("Retail Banking", r"\b(?:retail\s+bank|consumer\s+bank|financial\s+center|universal\s+banker|branch\s+banking)\b"),
    ("Commercial Banking", r"\b(?:commercial\s+bank|business\s+bank|cash\s+management|trade\s+services?)\b"),
    ("Corporate Banking", r"\b(?:corporate\s+bank|corporate\s+banking)\b"),
    ("Payments", r"\b(?:payments?|merchant\s+services?|commercial\s+cards?)\b"),
    ("Wealth Management", r"\b(?:wealth\s+management|private\s+bank(?:er|ing)|financial\s+solutions\s+advisor|investment\s+consultant)\b"),
    ("Investment Banking", r"\b(?:investment\s+bank(?:ing)?|mergers?\s+and\s+acquisitions?|leveraged\s+finance|financial\s+sponsors?)\b"),
    ("Private Equity", r"\b(?:private\s+equity|private\s+markets?)\b"),
    ("Asset Management", r"\b(?:asset\s+management|investment\s+management|portfolio\s+management|fixed\s+income)\b"),
    ("Sales & Trading", r"\b(?:sales\s+and\s+trading|trading\s+desk|physical\s+(?:gas|power)|energy\s+marketing|commodit(?:y|ies)\s+trading)\b"),
    ("Research", r"\b(?:equity\s+research|credit\s+research|quantitative\s+research)\b"),
    ("Risk", r"\b(?:market\s+risk|credit\s+risk|operational\s+risk|risk\s+management)\b"),
    ("Compliance", r"\b(?:financial\s+crime|anti[- ]money\s+laundering|AML|compliance\s+function)\b"),
    ("Technology", r"\b(?:site\s+reliability|software\s+engineering|platform\s+engineering|applications?\s+development|information\s+technology|cyber\s+security)\b"),
    ("Data & Analytics", r"\b(?:data\s+science|data\s+analytics|machine\s+learning|artificial\s+intelligence)\b"),
    ("Finance & Accounting", r"\b(?:fund\s+accounting|financial\s+reporting|general\s+ledger|corporate\s+finance|treasury\s+function)\b"),
)


def _department_from_context(text: str | None) -> str | None:
    if not text:
        return None
    for label, expression in _DEPARTMENT_CONTEXT_RULES:
        if re.search(expression, html_to_text(text), re.IGNORECASE):
            return label
    return None


def _department_matches(current: str | None, resolved: str | None) -> bool:
    """Compare normalized labels without requiring identical punctuation."""

    if not current or not resolved:
        return False
    left = re.sub(r"[^a-z0-9]+", "", current.casefold())
    right = re.sub(r"[^a-z0-9]+", "", resolved.casefold())
    return bool(left and right and (left == right or left in right or right in left))


_JOB_FUNCTION_RULES: tuple[tuple[str, str], ...] = (
    ("Investment Banking", r"\binvestment\s+bank(?:ing)?\b|\bm\s*&\s*a\b|mergers?\s+and\s+acquisitions?|\bleveraged\s+finance\b"),
    ("Private Equity", r"\bprivate\s+equity\b|\bprivate\s+markets?\b"),
    ("Asset Management", r"\basset\s+management\b|\binvestment\s+management\b"),
    ("Portfolio Management", r"\bportfolio\s+management\b|\bportfolio\s+manager\b"),
    ("Quantitative Research", r"\bquantitative\s+research\b|\bquant\s+research\b|\bquantitative\b|\bquant\b"),
    ("Trading", r"\btrader\b|\btrading\b"),
    ("Research", r"\bequity\s+research\b|\bcredit\s+research\b|\bresearch\s+(?:analyst|associate|scientist)\b"),
    ("Risk", r"\brisk\b"),
    ("Compliance", r"\bcompliance\b|\bfinancial\s+crime\b|\banti[- ]money\s+laundering\b|\bAML\b"),
    ("Legal", r"\blegal\b|\battorney\b|\bcounsel\b|\bsolicitor\b"),
    ("Finance", r"\bfinance\b|\bfinancial\s+planning\b|\btreasury\b"),
    ("Accounting", r"\baccount(?:ing|ancy)\b|\bcontroller\b"),
    ("Audit", r"\bauditor\b|\baudit\b"),
    ("Tax", r"\btax\b|\btaxation\b"),
    ("Operations", r"\boperations?\b|\bmiddle\s+office\b|\btrade\s+support\b"),
    ("Client Service", r"\bclient\s+(?:service|support|relationship|management)\b"),
    ("Wealth Management", r"\bwealth\s+management\b|\bprivate\s+wealth\b|\bprivate\s+client\b|\bprivate\s+banker\b|\bfinancial\s+(?:solutions\s+)?advisor\b|\bfinancial\s+adviser\b|\bmerrill\b|\bregistered\s+client\s+associate\b|\binvestment\s+consultant\b|\btrust\s+officer\b"),
    ("Mortgage Banking", r"\bmortgage\b|\bhome\s+lending\b|\bloan\s+servicing\b"),
    ("Commercial Banking", r"\bcommercial\s+(?:banking|loan|lending|relationship|term)\b|\bbusiness\s+banking\b|\bbusiness\s+relationship\s+manager\b|\btrade\s+services?\b|\bcash\s+management\b"),
    ("Corporate Banking", r"\bcorporate\s+banking\b|\bglobal\s+corporate\b"),
    ("Retail Banking", r"\brelationship\s+banker\b|\bpersonal\s+banker\b|\bbranch\b|\bfinancial\s+center\b|\bconsumer\s+banking\b|\bretail\s+banking\b|\bcustomer\s+service\s+representative\b"),
    ("Payments", r"\bpayments?\b|\bmerchant\s+services?\b|\bcard\s+(?:services?|products?)\b"),
    ("Product Management", r"\bproduct\s+(?:manager|owner|management)\b"),
    ("Technology", r"\btechnology\b|\bcyber\s*security\b|\bsite\s+reliability\b|\bplatform\s+engineering\b|\bapplications?\s+development\b"),
    ("Software Engineering", r"\bsoftware\s+(?:engineer|developer|development)\b|\bbackend\b|\bfrontend\b|\bfull[- ]stack\b|\bfullstack\b|\bdeveloper\b|\bSRE\b"),
    ("Data & Analytics", r"\bdata\s+(?:analyst|analytics?|scientist|engineer)\b|\banalytics\b|\bmachine\s+learning\b"),
    ("Real Estate", r"\breal\s+estate\b|\bproperty\s+investment\b"),
    ("Investor Relations", r"\binvestor\s+relations?\b"),
    ("Human Resources", r"\bhuman\s+resources?\b|\bHR\b|\btalent\s+acquisition\b"),
    ("Marketing", r"\bmarketing\b|\bcommunications?\b|\bpublic\s+relations?\b"),
    ("Corporate Strategy", r"\bcorporate\s+strategy\b|\bstrateg(?:y|ic)\b"),
    ("Administrative", r"\badministrative\b|\badministrator\b|\bexecutive\s+assistant\b|\bcoordinator\b"),
)


def _has_verified_detail(payload: dict) -> bool:
    """Return whether a stored payload contains a successful detail fetch."""

    return payload.get("detail_status") in VERIFIED_DETAIL_STATUSES or payload.get("metadata_quality") in {
        "official_browser_detail",
        "official_detail",
    }


_APPLICATION_DEADLINE_DATE_RE = re.compile(
    r"\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?)\b",
    re.IGNORECASE,
)
_APPLICATION_DEADLINE_STATUS_RE = re.compile(
    r"\b(?:rolling basis|open until filled|until filled|ongoing|no deadline|none)\b",
    re.IGNORECASE,
)


def _plausible_application_deadline(value: Any) -> bool:
    """Reject a whole posting body accidentally stored as a deadline."""

    if value in (None, "", []):
        return False
    if not isinstance(value, str):
        value = _stringify_value(value)
    text = re.sub(r"\s+", " ", str(value)).strip()
    if len(text) > 160:
        return False
    return bool(_APPLICATION_DEADLINE_DATE_RE.search(text) or _APPLICATION_DEADLINE_STATUS_RE.search(text))


def _merge_structured_fields(title: str, description: str | None, payload: dict,
                             *, replace_longer: bool = False) -> tuple[dict, dict]:
    """Merge deterministic fields without overwriting better explicit values."""

    before = dict(payload)
    if "application_deadline" in payload and not _plausible_application_deadline(payload.get("application_deadline")):
        payload.pop("application_deadline", None)
        payload.pop("applicationDeadline", None)
        payload.pop("closingDate", None)
        payload.pop("applyBy", None)
    # Remove stale ATS sentinels from records created before salary validation
    # was added. Unknown compensation must remain unknown, never zero dollars.
    for salary_key in ("compensation", "salary_range"):
        if salary_key in payload:
            normalized_salary = _normalize_compensation(payload.get(salary_key))
            if normalized_salary is None:
                payload.pop(salary_key, None)
            else:
                payload[salary_key] = normalized_salary
    extracted = extract_structured_fields(title, description, payload)
    inferred_fields = set(extracted.get("_structured_inferred_fields") or [])
    field_sources = dict(payload.get("structured_field_sources") or {})
    def normalized(value: Any) -> str:
        return re.sub(r"\s+", " ", html_to_text(str(value or ""))).strip().casefold()

    # A few ATS JSON-LD implementations copy the entire description into
    # both ``responsibilities`` and ``qualifications``. Remove that stale
    # top-level projection before merging the corrected section extraction;
    # the original detail payload remains intact as source evidence.
    current_responsibilities = normalized(payload.get("responsibilities"))
    current_qualifications = normalized(payload.get("qualifications"))
    current_qualification_alias = normalized(payload.get("qualification"))
    extracted_responsibilities = normalized(extracted.get("responsibilities"))
    extracted_qualifications = normalized(extracted.get("qualifications"))
    if (
        current_responsibilities
        and not current_qualifications
        and current_responsibilities == current_qualification_alias
        and len(current_responsibilities) < 200
    ):
        payload.pop("qualification", None)
        field_sources.pop("qualification", None)
    if (
        current_responsibilities
        and current_responsibilities == current_qualifications
        and (
            current_responsibilities != extracted_responsibilities
            or current_qualifications != extracted_qualifications
        )
    ):
        for stale_key in ("responsibilities", "qualifications", "qualification"):
            payload.pop(stale_key, None)
            field_sources.pop(stale_key, None)
    explicit_aliases: dict[str, tuple[str, ...]] = {
        "responsibilities": ("ExternalResponsibilitiesStr", "jobResponsibilities"),
        "qualifications": ("ExternalQualificationsStr", "jobQualifications", "requiredQualifications"),
        "qualification": ("ExternalQualificationsStr", "jobQualifications", "requiredQualifications"),
        "education": ("StudyLevel", "educationRequirements", "EducationLevel", "degreeRequirement"),
        "education_level": ("educationLevel", "StudyLevel", "minimumEducation", "degreeRequirement"),
        "experience": ("Experience", "experienceRequirements", "YearsOfExperience", "minimumExperience"),
        "required_skills": ("requiredSkills", "mustHaveSkills", "keySkills"),
        "preferred_skills": ("preferredSkills", "preferredQualifications", "desiredSkills", "niceToHaveSkills"),
        "employment_type": ("EmploymentType", "JobSchedule", "WorkerType", "WorkerTypeName", "JobType", "employmentType"),
        "workplace_type": ("WorkplaceType", "WorkplaceTypeCode", "workplaceType", "workLocationType", "locationType"),
        "remote_type": ("remoteType", "remoteWorkType", "telecommuteType", "workplaceType", "WorkplaceType"),
        "work_arrangement": ("workArrangement", "work_arrangement_type", "workLocationType", "locationType", "workplaceType"),
        "compensation": ("salary", "salaryRange", "salary_range", "baseSalary", "basePay", "payRange", "compensation"),
        "salary_range": ("salaryRange", "baseSalary", "basePay", "payRange", "compensation", "salary"),
        "additional_locations": ("additionalLocations", "secondaryLocations", "otherWorkLocations"),
        "date_posted": ("ExternalPostedStartDate", "PostedDate", "PublicationStartDate", "postedOn"),
        "valid_through": ("ExternalPostedEndDate", "PostingEndDate", "validThrough"),
        "team_context": ("teamDescription", "aboutTheTeam", "teamOverview", "whoYoullWorkWith"),
        "benefits": ("benefits", "benefitSummary", "totalRewards", "perks"),
        "application_process": ("applicationProcess", "howToApply", "selectionProcess", "interviewProcess"),
        "work_authorization": ("workAuthorization", "rightToWork", "visaSponsorship", "sponsorship"),
        "travel": ("travelRequirements", "travelExpectation", "travelPercentage", "travel"),
        "application_deadline": ("applicationDeadline", "closingDate", "applyBy", "validThrough", "PostingEndDate"),
        "recruiting_program": ("programType", "programmeType", "experienceCategory", "careerProgram", "recruitingProgram"),
    }

    def source_for(key: str) -> str:
        if key in inferred_fields:
            return "official_description_inferred"
        aliases = explicit_aliases.get(key, ())
        detail = before.get("detail_payload")
        if isinstance(detail, dict) and any(detail.get(name) not in (None, "", []) for name in (key, *aliases)):
            return "official_payload"
        if any(before.get(name) not in (None, "", []) for name in aliases):
            return "official_payload"
        if description:
            return "official_description"
        return "unknown"

    for key, value in extracted.items():
        if key in {"structured_extraction_version", "structured_extraction_method", "_structured_inferred_fields"}:
            payload[key] = value
            if key == "_structured_inferred_fields":
                payload.pop(key, None)
            continue
        if key == "application_deadline" and not _plausible_application_deadline(value):
            continue
        current = payload.get(key)
        if current in (None, "", []):
            payload[key] = value
            field_sources[key] = source_for(key)
            continue
        if replace_longer and isinstance(value, str) and isinstance(current, str) and len(value) > len(current):
            payload[key] = value
            field_sources[key] = source_for(key)
        elif replace_longer and isinstance(value, list) and isinstance(current, list) and len(value) > len(current):
            payload[key] = value
            field_sources[key] = source_for(key)
        else:
            field_sources.setdefault(key, source_for(key))
    payload["structured_field_sources"] = field_sources
    payload["structured_missing_fields"] = structured_missing_fields(payload)
    return payload, extracted


def upsert_job(session: Session, company: Company, raw: RawJob, source_type: str | None = None) -> tuple[Job, bool]:
    now = datetime.now(timezone.utc)
    external_job_id = _limit_text(raw.external_job_id, 255)
    source_url = _limit_text(raw.url, 2048) or company.career_url
    title = _limit_text(raw.title, 500) or "Untitled"
    incoming_payload = dict(raw.payload or {})
    payload_description = _official_description(incoming_payload)
    raw_description = raw.description
    description_from_payload = False
    if payload_description and len(payload_description.strip()) > len((raw_description or "").strip()):
        raw_description = payload_description
        description_from_payload = True
    payload_location = _payload_text(
        incoming_payload,
        "location", "Location", "primaryLocation", "PrimaryLocation", "locationsText",
        "jobRequisitionLocation", limit=500,
    )
    payload_department = _explicit_department(incoming_payload)
    location = _limit_text(raw.location or payload_location, 500)
    department = _limit_text(raw.department or payload_department, 255)
    url_hash = _hash(source_url)
    candidate_identity = identity_hash(str(company.id), title, location)
    existing = session.scalar(select(Job).where(Job.url_hash == url_hash))
    if not existing and external_job_id:
        existing = session.scalar(select(Job).where(Job.company_id == company.id, Job.external_job_id == external_job_id))
    if not existing and not external_job_id:
        # Identity hashes are a fallback for sources without a stable job ID. Some
        # boards legitimately publish multiple roles with the same title/location.
        # Never apply this fallback when the source supplied a stable ID: two
        # distinct requisitions can intentionally share both fields.
        existing = session.scalars(select(Job).where(Job.identity_hash == candidate_identity).order_by(Job.first_seen_at)).first()
    created = existing is None
    was_closed = bool(existing and existing.status == JobStatus.CLOSED)
    job = existing or Job(company_id=company.id, source_url=source_url, url_hash=url_hash,
                          identity_hash=candidate_identity, title=title)
    existing_payload = dict(job.raw_payload or {}) if existing else {}
    previous_feed_signature = existing_payload.get("feed_content_signature")
    if not department and existing_payload:
        department = _limit_text(_explicit_department(existing_payload), 255)
    incoming_detail = incoming_payload.get("detail_status") in VERIFIED_DETAIL_STATUSES
    existing_verified_detail = bool(existing and _has_verified_detail(existing_payload))
    # A later listing refresh often contains only a short teaser. Keep a
    # previously hydrated body and its structured detail payload unless the
    # incoming record is itself a verified detail response.
    effective_description = raw_description
    if existing and not incoming_detail and len((job.description or "").strip()) > len((raw_description or "").strip()):
        effective_description = job.description
    description_grew = existing and len((effective_description or "").strip()) > len((job.description or "").strip())
    effective_location = location or (job.location if existing else None)
    effective_department = department or (job.department if existing else None)
    if raw.department:
        department_status, department_source = "published", "connector_field"
    elif payload_department:
        department_status, department_source = "published", "official_payload"
    elif existing and effective_department:
        department_status = existing_payload.get("department_status") or (
            "published" if _explicit_department(existing_payload) else "legacy_unknown"
        )
        department_source = existing_payload.get("department_source") or "existing_record"
    else:
        resolved_department, department_status, department_source = resolve_department(
            title, effective_description, {**existing_payload, **incoming_payload}
        )
        if resolved_department:
            effective_department = _limit_text(resolved_department, 255)
    effective_source_type = source_type or company.connector_type
    if existing_verified_detail and not incoming_detail and job.source_type:
        # A sitemap/RSS listing refresh can carry a synthetic ``not_fetched``
        # marker. Preserve the source family that produced the authoritative
        # detail body so downstream repair and dashboard quality remain true.
        effective_source_type = job.source_type
        incoming_payload = {
            key: value for key, value in incoming_payload.items()
            if key not in DETAIL_METADATA_KEYS
        }
    job.external_job_id, job.source_url, job.source_type, job.title = external_job_id, source_url, effective_source_type, title
    job.location, job.country, job.department, job.description = effective_location, infer_country(effective_location), effective_department, effective_description
    payload = {**existing_payload, **incoming_payload}
    if incoming_detail:
        # A successful remote/detail refresh supersedes a previous transient
        # error. Do not leave a stale failure reason visible in the dashboard.
        payload.pop("detail_status_reason", None)
    payload["department_status"] = department_status
    payload["department_source"] = department_source
    payload["department_extraction_version"] = DEPARTMENT_EXTRACTION_VERSION
    payload, extracted = _merge_structured_fields(
        title, effective_description, payload, replace_longer=bool(description_grew and incoming_detail)
    )
    if description_from_payload and effective_description == raw_description:
        payload["description_source"] = "official_payload"
        payload["description_status"] = "official_payload_body"
    effective_raw = RawJob(raw.external_job_id, title, source_url, effective_location, effective_department, effective_description, payload)
    missing_fields = quality_missing_fields(effective_raw)
    payload["data_completeness"] = "complete" if not missing_fields else "partial"
    payload["missing_fields"] = missing_fields
    payload["quality_checked_at"] = now.isoformat()
    job.raw_payload, job.status, job.last_seen_at, job.closed_at, job.updated_at = payload, JobStatus.OPEN, now, None, now
    if created:
        session.add(job)
        record_job_lifecycle(session, job, "opened", now, reason="first_seen", source_type=effective_source_type)
    elif was_closed:
        record_job_lifecycle(
            session,
            job,
            "reopened",
            now,
            reason="present_in_successful_crawl",
            source_type=effective_source_type,
        )
    if not job.required_skills and extracted.get("required_skills"):
        job.required_skills = extracted["required_skills"]
    if not job.preferred_skills and extracted.get("preferred_skills"):
        job.preferred_skills = extracted["preferred_skills"]
    if description_grew:
        # A longer official body changes the feature-extraction input. Force a
        # fresh enrichment pass instead of serving vectors derived from a teaser.
        job.enriched_at = None
        job.enrichment_provider = None
        job.enrichment_error = None
        job.required_skills, job.preferred_skills = [], []
    refresh_feed_revision(job, previous_feed_signature, now)
    return job, created


# These values have appeared in legacy connectors as a fake "large enough"
# total. They are never a count that can be shown as official.
_OFFICIAL_COUNT_SENTINELS = {9999, 99999}
_COUNT_METADATA_KEYS = {
    "source_reported_count", "source_expected_count", "source_complete",
    "source_invalid_count", "source_duplicate_count", "source_missing_count",
}


def _safe_source_count(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or parsed > 1_000_000 or parsed in _OFFICIAL_COUNT_SENTINELS:
        return None
    return parsed


def _source_count_observation(source: CompanySource, source_jobs: list[RawJob]) -> dict[str, Any]:
    """Return an auditable official count for one fetched official source.

    Older adapters return only rows.  Their pagination still terminates at an
    empty page, so a non-empty result is an exact list count when no explicit
    publisher total exists.  Adapters that expose a publisher total retain it
    even when the fetched page set is short; that is useful for reconciliation,
    while ``source_complete`` continues to protect lifecycle closing.
    """
    payloads = [raw.payload or {} for raw in source_jobs]
    reported_values = [
        _safe_source_count(payload.get("source_reported_count"))
        for payload in payloads
        if payload.get("source_reported_count") is not None
    ]
    canonical_values = [
        _safe_source_count(payload.get("source_expected_count"))
        for payload in payloads
        if payload.get("source_expected_count") is not None
    ]
    reported = max((value for value in reported_values if value is not None), default=None)
    canonical = max((value for value in canonical_values if value is not None), default=None)
    complete_flags = [payload.get("source_complete") for payload in payloads if "source_complete" in payload]
    explicitly_incomplete = any(value is False for value in complete_flags)
    explicitly_complete = bool(complete_flags) and not explicitly_incomplete and all(value is True for value in complete_flags)
    unique_ids = {str(raw.external_job_id or raw.url) for raw in source_jobs if raw.external_job_id or raw.url}
    fetched_count = len(unique_ids)
    # Amazon's public search endpoint reports ``hits=10000`` as a provider
    # ceiling.  Older payloads do not carry a coverage note, so identify that
    # source explicitly and keep the number as a lower bound only.
    source_name = str(source.source_type or "").casefold()
    amazon_cap = source_name == "amazon" and reported == 10000 and fetched_count >= 10000
    capped = amazon_cap or any("ceiling" in str(payload.get("source_coverage_note") or "").casefold() for payload in payloads)

    # Greenhouse, Ashby, Lever, RSS and the other list adapters have no source
    # total but do fetch until the official listing ends. Record that exact
    # list count in the row metadata so the existing run aggregation and older
    # consumers can use it too. The generic HTML discovery adapter is excluded
    # because one page of JSON-LD is not a completeness boundary.
    inferred = None
    if reported is None and canonical is None and not explicitly_incomplete:
        if fetched_count > 0 and source.source_type != "official":
            inferred = fetched_count
            canonical = fetched_count
            explicitly_complete = True
            for raw in source_jobs:
                raw.payload.setdefault("source_reported_count", fetched_count)
                raw.payload.setdefault("source_expected_count", fetched_count)
                raw.payload.setdefault("source_complete", True)
                raw.payload.setdefault("source_count_basis", "complete_official_list")

    if capped:
        return {
            "source_type": source.source_type,
            "count": None,
            "status": "capped_unavailable",
            "basis": "provider_cap",
            "complete": False,
            "fetched_count": fetched_count,
            "lower_bound": reported or fetched_count or None,
        }
    if reported is not None:
        return {
            "source_type": source.source_type,
            "count": reported,
            "status": "publisher_reported_complete" if explicitly_complete else "publisher_reported",
            "basis": "publisher_total",
            "complete": explicitly_complete,
            "fetched_count": fetched_count,
            "lower_bound": None,
        }
    if canonical is not None and (explicitly_complete or not complete_flags):
        return {
            "source_type": source.source_type,
            "count": canonical,
            "status": "complete_official_list" if inferred is not None else "canonical_list_count",
            "basis": "complete_official_list" if inferred is not None else "connector_canonical_count",
            "complete": True,
            "fetched_count": fetched_count,
            "lower_bound": None,
        }
    return {
        "source_type": source.source_type,
        "count": None,
        "status": "unavailable",
        "basis": "unavailable",
        "complete": False,
        "fetched_count": fetched_count,
        "lower_bound": None,
    }


async def crawl_company(session: Session, company: Company) -> CrawlRun:
    run = CrawlRun(company_id=company.id, connector_type=company.connector_type, status="running")
    session.add(run); session.flush()
    try:
        sources = list(session.scalars(select(CompanySource).where(CompanySource.company_id == company.id, CompanySource.is_active.is_(True)).order_by(CompanySource.priority, CompanySource.created_at)))
        if not sources:
            sources = [CompanySource(company_id=company.id, source_type=company.connector_type,
                                     source_url=company.source_url or company.career_url,
                                     connector_config=company.connector_config, priority=1)]
        # The catalog stores a company's careers page for provenance and
        # discovery. Once a company has an explicit ATS/public-job source,
        # that generic page is neither a complete listing nor a useful crawl
        # dependency, and may be protected or slow.
        has_explicit_source = any(source.source_type != "official" for source in sources)
        if has_explicit_source:
            sources = [
                source for source in sources
                if not (source.source_type == "official" and source.connector_config.get("auto_discover"))
            ]
        raw_jobs: list[tuple[RawJob, str]] = []
        source_errors: list[str] = []
        source_observations: list[dict[str, Any]] = []
        for source in sources:
            try:
                source_jobs = await get_connector(source.source_type).fetch(source.source_url, source.connector_config)
                source_observations.append(_source_count_observation(source, source_jobs))
                raw_jobs.extend((raw, source.source_type) for raw in source_jobs)
                source.last_crawled_at = datetime.now(timezone.utc)
                source.last_error = None
            except Exception as exc:
                error = f"{source.source_type}: {type(exc).__name__}: {exc}"
                source.last_error = error[:4000]
                source_errors.append(error)
        # Some ATS pagination endpoints repeat records across page boundaries.
        # Deduplicate the current payload before querying/inserting because the
        # session intentionally batches writes until the successful crawl ends.
        unique_jobs: dict[str, tuple[RawJob, str]] = {}
        for raw, source_type in raw_jobs:
            key = raw.external_job_id or raw.url
            unique_jobs.setdefault(key, (raw, source_type))
        if sources and not unique_jobs:
            detail = "; ".join(source_errors)
            message = "All configured sources returned zero jobs; preserving existing open roles"
            raise RuntimeError(f"{message}. {detail}" if detail else message)
        run.discovered_count = len(unique_jobs)
        partial_count = 0
        complete_count = 0
        missing_description_count = 0
        rejected_count = 0
        rejected_reasons: dict[str, int] = {}
        closed_from_source = 0
        now = datetime.now(timezone.utc)
        seen_ids: set[str] = set()
        for raw, source_type in unique_jobs.values():
            listing_state, listing_reason = _listing_state(raw)
            if listing_state == "invalid":
                rejected_count += 1
                reason_key = listing_reason or "invalid listing"
                rejected_reasons[reason_key] = rejected_reasons.get(reason_key, 0) + 1
                continue
            if listing_state == "closed":
                # A connector that explicitly reports closure must close the
                # existing requisition immediately instead of re-opening it.
                existing = None
                source_url = _limit_text(raw.url, 2048)
                if source_url:
                    existing = session.scalar(select(Job).where(Job.url_hash == _hash(source_url)))
                if not existing and raw.external_job_id:
                    existing = session.scalar(select(Job).where(
                        Job.company_id == company.id,
                        Job.external_job_id == _limit_text(raw.external_job_id, 255),
                    ))
                if existing and existing.status == JobStatus.OPEN:
                    previous_feed_signature = (existing.raw_payload or {}).get("feed_content_signature")
                    existing.status = JobStatus.CLOSED
                    existing.closed_at = now
                    existing.updated_at = now
                    closed_payload = dict(existing.raw_payload or {})
                    closed_payload["closed_reason"] = listing_reason or "source marked the listing closed"
                    closed_payload["closed_checked_at"] = now.isoformat()
                    existing.raw_payload = closed_payload
                    record_job_lifecycle(
                        session,
                        existing,
                        "closed",
                        now,
                        reason=closed_payload["closed_reason"],
                        source_type=source_type,
                    )
                    refresh_feed_revision(existing, previous_feed_signature, now)
                    closed_from_source += 1
                continue
            job, created = upsert_job(session, company, raw, source_type)
            seen_ids.add(str(job.id))
            run.created_count += int(created); run.updated_count += int(not created)
            # Count the effective row after merge. A sitemap/RSS listing may
            # omit a body while an earlier official detail fetch is retained.
            missing = quality_missing_fields(job)
            if "description" in missing:
                missing_description_count += 1
            if missing:
                partial_count += 1
            else:
                complete_count += 1
        run.complete_count = complete_count
        run.partial_count = partial_count
        expected_values: list[int] = []
        boundary_warnings: list[str] = []
        source_metadata: dict[str, dict[str, Any]] = {}
        for raw, source_type in unique_jobs.values():
            payload = raw.payload or {}
            if not any(key in payload for key in (
                "source_reported_count", "source_expected_count", "source_complete",
                "source_invalid_count", "source_duplicate_count", "source_missing_count",
            )):
                continue
            meta = source_metadata.setdefault(source_type, {})
            for key in ("source_reported_count", "source_expected_count", "source_invalid_count",
                        "source_duplicate_count", "source_missing_count"):
                value = payload.get(key)
                if value is not None:
                    try:
                        meta[key] = max(int(meta.get(key, 0)), int(value))
                    except (TypeError, ValueError):
                        pass
            if payload.get("source_complete") is False:
                meta["source_complete"] = False
            elif "source_complete" in payload:
                meta.setdefault("source_complete", True)
        for source in sources:
            config = source.connector_config or {}
            value = config.get("expected_count", config.get("source_expected_count", config.get("total_count")))
            if value is None:
                observed = {
                    raw.payload.get("source_expected_count")
                    for raw, source_type in unique_jobs.values()
                    if source_type == source.source_type and raw.payload.get("source_expected_count") is not None
                }
                if len(observed) == 1:
                    value = observed.pop()
            if value is None:
                pass
            else:
                try:
                    expected_values.append(max(0, int(value)))
                except (TypeError, ValueError):
                    source_errors.append(f"{source.source_type}: invalid expected_count")
            if config.get("complete") is False or config.get("source_complete") is False:
                boundary_warnings.append(f"{source.source_type}: source marked incomplete; no roles were closed")
            meta = source_metadata.get(source.source_type, {})
            reported = meta.get("source_reported_count")
            canonical = meta.get("source_expected_count")
            if meta.get("source_complete") is False:
                detail = f"{source.source_type}: source reported {reported}, canonical {canonical or run.discovered_count}"
                if meta.get("source_invalid_count") or meta.get("source_duplicate_count"):
                    detail += (
                        f", invalid={meta.get('source_invalid_count', 0)}"
                        f", duplicate={meta.get('source_duplicate_count', 0)}"
                    )
                boundary_warnings.append(f"{detail}; source coverage not verified; no roles were closed")
        # With multiple sources, summing totals would over-count roles that
        # appear on more than one board.  A single canonical total is still
        # safe to expose when all configured sources agree (or only one source
        # reports a total); this is common when the generic ``official`` row
        # sits alongside its explicit ATS source.  Never persist connector
        # sentinels such as 9999/99999 as an official count.
        valid_expected_values = [value for value in expected_values if value not in (9999, 99999)]
        run.expected_count = (
            valid_expected_values[0]
            if valid_expected_values and len(set(valid_expected_values)) == 1
            else None
        )

        # Persist a separate official count for the directory API.  Prefer a
        # publisher-reported total (even when the page set is short), because
        # it is still the most precise official number available. If no source
        # publishes a total, the union of fully fetched official lists is an
        # exact count. Never use the local database count here.
        count_observations = [item for item in source_observations if item.get("count") is not None]
        publisher_observations = [item for item in count_observations if item.get("basis") == "publisher_total"]
        if publisher_observations:
            selected = max(publisher_observations, key=lambda item: int(item["count"]))
            run.official_count = int(selected["count"])
            run.official_count_status = str(selected.get("status") or "publisher_reported")
            run.official_count_source = ",".join(sorted({str(item.get("source_type")) for item in publisher_observations}))[:128]
            run.official_count_observed_at = now
        elif count_observations and all(item.get("complete") for item in count_observations) and not source_errors:
            run.official_count = run.discovered_count
            run.official_count_status = "complete_official_list"
            run.official_count_source = ",".join(sorted({str(item.get("source_type")) for item in count_observations}))[:128]
            run.official_count_observed_at = now
        else:
            run.official_count = None
            run.official_count_status = "unavailable"
            run.official_count_source = None
            run.official_count_observed_at = None
            run.official_count_lower_bound = max(
                (int(item.get("lower_bound")) for item in source_observations if item.get("lower_bound") is not None),
                default=None,
            )
        coverage_warning = None
        if run.expected_count is not None and run.discovered_count != run.expected_count:
            coverage_warning = f"incomplete source coverage: discovered={run.discovered_count}, expected={run.expected_count}"
        if boundary_warnings:
            coverage_warning = "; ".join(boundary_warnings) if not coverage_warning else f"{coverage_warning}; {'; '.join(boundary_warnings)}"
        now = datetime.now(timezone.utc)
        # A failed or short source must not close old roles that it may have
        # omitted. Closing is reserved for a verified complete source result.
        if not source_errors and not coverage_warning:
            open_jobs = session.scalars(select(Job).where(Job.company_id == company.id, Job.status == JobStatus.OPEN)).all()
            for job in open_jobs:
                if str(job.id) not in seen_ids:
                    previous_feed_signature = (job.raw_payload or {}).get("feed_content_signature")
                    job.status, job.closed_at, job.updated_at = JobStatus.CLOSED, now, now
                    payload = dict(job.raw_payload or {})
                    payload["closed_reason"] = "source_missing_on_complete_crawl"
                    payload["closed_checked_at"] = now.isoformat()
                    job.raw_payload = payload
                    record_job_lifecycle(
                        session,
                        job,
                        "closed",
                        now,
                        reason="source_missing_on_complete_crawl",
                        source_type=job.source_type,
                    )
                    refresh_feed_revision(job, previous_feed_signature, now)
        company.last_crawled_at, run.completed_at = now, now
        if rejected_count:
            boundary_warnings.append(
                f"rejected_invalid={rejected_count}"
                + (f" ({rejected_reasons})" if rejected_reasons else "")
            )
        quality_warning = (
            f"partial data: {partial_count}/{len(unique_jobs)} records miss one or more quality fields; "
            f"missing_description={missing_description_count}"
            if partial_count else None
        )
        warnings = [*source_errors, *([coverage_warning] if coverage_warning else []), *([quality_warning] if quality_warning else [])]
        run.status = "partial" if warnings else "success"
        run.error = "; ".join(warnings)[:4000] or None
    except Exception as exc:
        run.status = "failed"
        run.error = f"{type(exc).__name__}: {exc}"[:4000]
        run.completed_at = datetime.now(timezone.utc)
    session.commit()
    return run


DETAIL_PAGE_SOURCES = {
    "amazon", "avature", "beesite", "eightfold", "goldman_sachs", "google", "microsoft", "mckinsey", "oracle_hcm",
    "rothschild_web", "sitemap", "smartrecruiters", "symphony_talent", "talentbrew", "talent_gateway", "meta", "apple", "phenom",
    # Some RSS feeds (Jefferies, Two Sigma, and Evercore) carry canonical job
    # URLs in each entry. Those URLs can be hydrated like any other public
    # detail page; the feed URL itself is never treated as a detail page.
    "rss",
}


async def _fetch_missing_detail(job: Job, config: dict, semaphore: asyncio.Semaphore,
                                client: httpx.AsyncClient) -> tuple[str, dict] | None:
    async with semaphore:
        detail_source_type = str(config.get("_detail_source_type") or job.source_type)
        checked_at = datetime.now(timezone.utc).isoformat()
        try:
            raw = RawJob(job.external_job_id, job.title, job.source_url, job.location, job.department,
                         job.description, dict(job.raw_payload or {}))
            if detail_source_type == "workday":
                detailed = await WorkdayConnector.fetch_detail(client, raw, config)
                description = detailed.description
                payload = dict(detailed.payload or {})
            elif detail_source_type == "apple":
                detailed = await AppleCareersConnector.fetch_detail(client, raw, config)
                description = detailed.description
                payload = dict(detailed.payload or {})
            elif detail_source_type == "microsoft":
                detailed = await MicrosoftCareersConnector.fetch_detail(client, raw, config)
                description = detailed.description
                payload = dict(detailed.payload or {})
            elif detail_source_type == "beesite":
                detailed = await BeesiteConnector.fetch_detail(client, raw, config)
                description = detailed.description
                payload = dict(detailed.payload or {})
            elif detail_source_type == "oracle_hcm":
                detailed = await OracleHCMConnector.fetch_detail(client, raw, config)
                description = detailed.description
                payload = dict(detailed.payload or {})
            elif detail_source_type == "eightfold":
                detailed = await EightfoldConnector.fetch_detail(client, raw, config)
                description = detailed.description
                payload = dict(detailed.payload or {})
            elif detail_source_type in DETAIL_PAGE_SOURCES:
                detail_headers = None
                if detail_source_type == "apple":
                    detail_headers = {
                        "User-Agent": str(config.get("user_agent") or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Referer": "https://jobs.apple.com/en-us/search",
                    }
                description, detail_meta = await fetch_public_detail(
                    job.source_url, client=client, headers=detail_headers
                )
                payload = {**raw.payload, **detail_meta}
            else:
                return None
            # Carry structured values from connectors through the repair result
            # so the database row is hydrated consistently with the body.
            if detail_source_type in {"workday", "oracle_hcm"}:
                if detailed.location:
                    payload["detail_location"] = detailed.location
                if detailed.department:
                    payload["detail_department"] = detailed.department
            # A 200 response can still be a closed-role page or a bot challenge.
            # Check the extracted text before calling it a valid detail fetch.
            body_text = str(description or "")
            if _CLOSED_TEXT_RE.search(body_text):
                return "detail_unavailable", {
                    **payload,
                    "detail_status": "detail_unavailable",
                    "detail_status_reason": "official detail page says the role is closed",
                    **_availability_payload(
                        availability="closed",
                        link_health=LINK_HEALTH_CLOSED,
                        reason="official detail page says the role is closed",
                        checked_at=checked_at,
                    ),
                }
            if _BLOCKED_TEXT_RE.search(body_text):
                return "detail_unavailable", {
                    **payload,
                    "detail_status": "detail_unavailable",
                    "detail_status_reason": "official detail page returned a browser-verification challenge",
                    **_availability_payload(
                        availability="open_unverified",
                        link_health=LINK_HEALTH_BLOCKED,
                        reason="official detail page returned a browser-verification challenge",
                        checked_at=checked_at,
                    ),
                }
            if not description:
                return "detail_unavailable", {
                    **payload,
                    "detail_status": "detail_unavailable",
                    "detail_status_reason": payload.get(
                        "detail_status_reason", "Official detail page returned no usable description"
                    ),
                    **_availability_payload(
                        availability="open_unverified",
                        link_health=LINK_HEALTH_UNKNOWN,
                        reason=payload.get(
                            "detail_status_reason", "Official detail page returned no usable description"
                        ),
                        checked_at=checked_at,
                    ),
                }
            return description, {
                **payload,
                "detail_status": payload.get("detail_status", "fetched"),
                **_availability_payload(
                    availability="open",
                    link_health=LINK_HEALTH_VALID,
                    reason="official detail content fetched successfully",
                    checked_at=checked_at,
                ),
            }
        except Exception as exc:
            # Oracle can return HTTP 200 with an empty `items` array when the
            # requisition has been withdrawn or is no longer publicly exposed.
            # This is a terminal availability result, not a transient request
            # failure.
            if (detail_source_type == "oracle_hcm" and isinstance(exc, ValueError)
                    and "Oracle HCM detail response did not contain a requisition" in str(exc)):
                return "detail_unavailable", {
                    **(job.raw_payload or {}),
                    "detail_status": "detail_unavailable",
                    "detail_status_reason": "Oracle HCM detail returned no requisition",
                    **_availability_payload(
                        availability="closed",
                        link_health=LINK_HEALTH_CLOSED,
                        reason="Oracle HCM detail returned no requisition",
                        checked_at=checked_at,
                    ),
                }
            health, reason, http_status = _classify_detail_exception(exc)
            if isinstance(exc, ValueError) and "no externalPath" in str(exc):
                health, reason = LINK_HEALTH_UNKNOWN, "listing record has no externalPath"
            availability = "closed" if health == LINK_HEALTH_CLOSED else "open_unverified"
            detail_status = "detail_unavailable" if health == LINK_HEALTH_CLOSED else "detail_error"
            if health == LINK_HEALTH_BLOCKED:
                detail_status = "detail_unavailable"
            return_value = "detail_unavailable" if health in {LINK_HEALTH_CLOSED, LINK_HEALTH_BLOCKED} else "detail_error"
            return return_value, {
                **(job.raw_payload or {}),
                "detail_status": detail_status,
                "detail_status_reason": reason,
                **_availability_payload(
                    availability=availability,
                    link_health=health,
                    reason=reason,
                    checked_at=checked_at,
                    http_status=http_status,
                ),
            }


def repair_job_details(session: Session, batch_size: int = 250, source_type: str | None = None,
                       company_name: str | None = None,
                       include_structured_missing: bool = False,
                       include_unverified_detail: bool = False,
                       include_short_verified: bool = False,
                       include_closed: bool = False) -> dict[str, int]:
    """Hydrate missing/short public descriptions without deleting existing data."""

    source_types = (*DETAIL_PAGE_SOURCES, "workday")
    detail_status = Job.raw_payload["detail_status"].as_string()
    link_health = Job.raw_payload["link_health"].as_string()
    detail_retry_after = Job.raw_payload["detail_retry_after"].as_string()
    retryable_unverified = and_(
        detail_status == "detail_unavailable",
        link_health.in_((LINK_HEALTH_BLOCKED, LINK_HEALTH_TIMEOUT, LINK_HEALTH_UNKNOWN)),
        or_(detail_retry_after.is_(None), detail_retry_after <= datetime.now(timezone.utc).isoformat()),
    )
    short_body_gap = or_(Job.description.is_(None), func.length(Job.description) < 300)
    # Once an official detail request succeeded, a short body is evidence that
    # the publisher exposed only that amount of text. Avoid hammering the same
    # page on every scheduled repair pass while keeping never-fetched/error
    # records eligible for retry.
    quality_gap = and_(
        short_body_gap,
        or_(detail_status.is_(None), ~detail_status.in_(tuple(VERIFIED_DETAIL_STATUSES))),
    )
    if include_structured_missing:
        # Some official ATS details expose a full body but omit structured
        # fields from the listing. Opt into those records for targeted audits;
        # the scheduled repair keeps the cheaper short-body-only behavior.
        # Do not repeatedly re-fetch a verified detail page that explicitly
        # omitted a location/department. Such a row is an official
        # "not-published" result, not an unresolved transport failure.
        structured_gap = and_(
            or_(Job.location.is_(None), Job.department.is_(None)),
            or_(detail_status.is_(None), ~detail_status.in_(tuple(VERIFIED_DETAIL_STATUSES))),
        )
        quality_gap = or_(quality_gap, structured_gap)
    if include_unverified_detail:
        # A listing can contain a long teaser while still lacking proof that
        # the official detail endpoint was read. Include those rows in an
        # explicit audit pass, but keep ``detail_unavailable`` out so a known
        # access-control response is not hammered on every run.
        unverified_gap = or_(
            detail_status.is_(None),
            ~detail_status.in_(tuple(VERIFIED_DETAIL_STATUSES | {"detail_unavailable"})),
            retryable_unverified,
        )
        quality_gap = or_(quality_gap, unverified_gap)
    if include_short_verified:
        # A bounded, operator-triggered audit may re-read a verified listing
        # whose body is shorter than the feature-store threshold. Scheduled
        # repairs keep the default no-hammer behavior above.
        quality_gap = short_body_gap
    # Retry anti-bot, timeout and other inconclusive outcomes after their
    # cooldown even when the listing already has a long teaser/body.
    quality_gap = or_(quality_gap, retryable_unverified)
    status_filter = Job.status.in_((JobStatus.OPEN, JobStatus.CLOSED)) if include_closed else Job.status == JobStatus.OPEN
    statement = select(Job).where(
        status_filter,
        quality_gap,
        Job.source_type == source_type if source_type else Job.source_type.in_(source_types),
        or_(Job.raw_payload["detail_status"].as_string().is_(None),
            Job.raw_payload["detail_status"].as_string() != "detail_unavailable",
            retryable_unverified),
    )
    if company_name:
        statement = statement.join(Company).where(Company.name == company_name)
    priority = case((Job.raw_payload["detail_status"].as_string() == "detail_error", 0), else_=1)
    candidates = session.scalars(statement.order_by(priority, Job.last_seen_at.desc()).limit(max(1, batch_size))).all()
    if not candidates:
        return {"selected": 0, "fetched": 0, "unavailable": 0, "errors": 0}
    source_rows = session.scalars(
        select(CompanySource).where(CompanySource.is_active.is_(True))
    ).all()
    source_configs: dict[tuple[object, str], dict] = {}
    source_configs_by_company: dict[object, list[tuple[str, dict]]] = {}
    for source in source_rows:
        config = source.connector_config or {}
        source_configs.setdefault((source.company_id, source.source_type), config)
        source_configs_by_company.setdefault(source.company_id, []).append((source.source_type, config))

    def detail_config(job: Job) -> dict:
        config = dict(source_configs.get((job.company_id, job.source_type), {}))
        # A feed may contain canonical links from a different official ATS.
        # Jefferies' RSS feed is one such mixed source: Oracle links should use
        # the company's Oracle configuration instead of the RSS page parser.
        hostname = (urlparse(job.source_url).hostname or "").lower()
        if job.source_type == "rss" and "oraclecloud.com" in hostname:
            oracle_config = next(
                (candidate for source_type, candidate in source_configs_by_company.get(job.company_id, [])
                 if source_type == "oracle_hcm"),
                None,
            )
            if oracle_config:
                return {**oracle_config, "_detail_source_type": "oracle_hcm"}
        return config

    async def fetch_all() -> list[tuple[Job, tuple[str, dict] | None]]:
        # Workday tenants commonly return transient 5xx responses when a
        # single tenant receives too many parallel detail requests.
        # Workday tenants rate-limit detail pages aggressively. Two in-flight
        # requests keeps normal repairs moving while avoiding a burst of 429s.
        semaphore = asyncio.Semaphore(1 if company_name in {"Barclays", "Citigroup"} else 2)
        async with httpx.AsyncClient(
            headers={"User-Agent": get_settings().crawler_user_agent}, timeout=35, follow_redirects=True
        ) as client:
            results = await asyncio.gather(*(
                _fetch_missing_detail(
                    job,
                    {**detail_config(job), "detail_retry_client_errors": True},
                    semaphore,
                    client,
                )
                for job in candidates
            ))
        return list(zip(candidates, results, strict=True))

    hydrated = asyncio.run(fetch_all())
    fetched = unavailable = errors = closed = blocked = timeouts = unknown = 0
    now = datetime.now(timezone.utc)
    for job, result in hydrated:
        if result is None:
            continue
        previous_feed_signature = (job.raw_payload or {}).get("feed_content_signature")
        value, payload = result
        job.raw_payload = payload
        availability = payload.get("availability_status")
        link_health = payload.get("link_health")
        if availability == "closed" or link_health == LINK_HEALTH_CLOSED:
            closed += 1
            unavailable += 1
            if job.status != JobStatus.CLOSED:
                job.status = JobStatus.CLOSED
                job.closed_at = now
                job.updated_at = now
                closed_payload = dict(job.raw_payload or {})
                closed_payload["closed_reason"] = closed_payload.get(
                    "detail_status_reason", "official detail confirmed the role is closed"
                )
                closed_payload["closed_checked_at"] = now.isoformat()
                job.raw_payload = closed_payload
                record_job_lifecycle(
                    session,
                    job,
                    "closed",
                    now,
                    reason=closed_payload["closed_reason"],
                    source_type=job.source_type,
                )
            missing = quality_missing_fields(job)
            job.raw_payload = {
                **(job.raw_payload or {}),
                "data_completeness": "partial",
                "missing_fields": missing,
                "quality_checked_at": now.isoformat(),
                "details_checked_at": now.isoformat(),
            }
            refresh_feed_revision(job, previous_feed_signature, now)
            continue
        if link_health == LINK_HEALTH_BLOCKED:
            blocked += 1
        elif link_health == LINK_HEALTH_TIMEOUT:
            timeouts += 1
        elif link_health == LINK_HEALTH_UNKNOWN:
            unknown += 1
        if value == "detail_error":
            errors += 1
            missing = quality_missing_fields(job)
            job.raw_payload = {**(job.raw_payload or {}), "data_completeness": "partial",
                               "missing_fields": missing, "quality_checked_at": now.isoformat(),
                               "details_checked_at": now.isoformat()}
            refresh_feed_revision(job, previous_feed_signature, now)
            continue
        if value == "detail_unavailable":
            unavailable += 1
            missing = quality_missing_fields(job)
            job.raw_payload = {**(job.raw_payload or {}), "data_completeness": "partial",
                               "missing_fields": missing, "quality_checked_at": now.isoformat(),
                               "details_checked_at": now.isoformat()}
            refresh_feed_revision(job, previous_feed_signature, now)
            continue
        detail_location = payload.get("detail_location")
        if detail_location and (not job.location or len(str(detail_location)) > len(job.location)):
            job.location = _limit_text(str(detail_location), 500)
            job.country = infer_country(job.location)
        detail_department = payload.get("detail_department")
        if detail_department and not job.department:
            job.department = _limit_text(str(detail_department), 255)
        job.raw_payload, extracted = _merge_structured_fields(
            job.title, value if value not in {"detail_error", "detail_unavailable"} else job.description,
            dict(job.raw_payload or {}), replace_longer=True,
        )
        if not job.required_skills and extracted.get("required_skills"):
            job.required_skills = extracted["required_skills"]
        if not job.preferred_skills and extracted.get("preferred_skills"):
            job.preferred_skills = extracted["preferred_skills"]
        if len(value.strip()) > len((job.description or "").strip()):
            job.description = value
            job.enriched_at = None
            job.enrichment_provider = None
            job.enrichment_error = None
            job.required_skills, job.preferred_skills = [], []
            fetched += 1
        missing = quality_missing_fields(job)
        job.raw_payload = {**(job.raw_payload or {}), "data_completeness": "complete" if not missing else "partial",
                           "missing_fields": missing, "quality_checked_at": now.isoformat(),
                           "details_checked_at": now.isoformat()}
        refresh_feed_revision(job, previous_feed_signature, now)
    session.commit()
    return {
        "selected": len(candidates),
        "fetched": fetched,
        "unavailable": unavailable,
        "closed": closed,
        "blocked": blocked,
        "timeouts": timeouts,
        "unknown": unknown,
        "errors": errors,
    }


def enrich_job(job: Job) -> None:
    """Populate structured and enrichment fields while preserving evidence sources."""
    previous_feed_signature = (job.raw_payload or {}).get("feed_content_signature")
    job.raw_payload, structured = _merge_structured_fields(
        job.title, job.description, dict(job.raw_payload or {}), replace_longer=True
    )
    payload = dict(job.raw_payload or {})
    field_sources = dict(payload.get("enrichment_field_sources") or {})
    explicit_values = _explicit_enrichment(payload)
    for key, value in explicit_values.items():
        if getattr(job, key, None) in (None, "", []):
            setattr(job, key, value)
        field_sources.setdefault(key, "official_payload")

    # Apply deterministic title/body rules before the optional LLM. This gives
    # every role a reproducible baseline and makes any later LLM value clearly
    # distinguishable from an ATS-published value.
    rule_values = _rule_enrichment(job.title, job.description)
    for key, value in rule_values.items():
        if getattr(job, key, None) in (None, "", []):
            setattr(job, key, value)
            field_sources[key] = "text_rule" if key == "visa_sponsorship" else "title_rule"

    if not job.required_skills and structured.get("required_skills"):
        job.required_skills = structured["required_skills"]
    if not job.preferred_skills and structured.get("preferred_skills"):
        job.preferred_skills = structured["preferred_skills"]
    payload["enrichment_extraction_version"] = ENRICHMENT_EXTRACTION_VERSION
    payload["enrichment_field_sources"] = field_sources
    payload["enrichment_metadata_source"] = (
        "official_payload" if explicit_values else ("title_rules" if rule_values else "llm_or_unknown")
    )
    job.raw_payload = payload
    if not job.industry and job.company and job.company.industry:
        job.industry = job.company.industry
    if not job.industry:
        if job.job_function in {"Investment Banking", "Private Equity", "Asset Management", "Portfolio Management", "Trading", "Research", "Quantitative Research"}:
            job.industry = "Investment Management"
        elif job.job_function in {"Technology", "Software Engineering", "Data & Analytics"}:
            job.industry = "Technology"
    try:
        extracted = extract_with_llm(job.title, job.location, job.description)
        for key, value in extracted.model_dump().items():
            if value not in (None, [], "") and getattr(job, key, None) in (None, "", []):
                setattr(job, key, value)
                field_sources[key] = "llm"
        payload["enrichment_field_sources"] = field_sources
        payload["enrichment_metadata_source"] = "official_payload+rules+llm"
        job.raw_payload = payload
        job.enrichment_provider, job.enrichment_error = "openai", None
        job.enriched_at = datetime.now(timezone.utc)
        refresh_feed_revision(job, previous_feed_signature, job.enriched_at)
        return
    except Exception as exc:
        job.enrichment_provider, job.enrichment_error = "rules", str(exc)[:500]
    payload["enrichment_field_sources"] = field_sources
    job.raw_payload = payload
    job.enriched_at = datetime.now(timezone.utc)
    refresh_feed_revision(job, previous_feed_signature, job.enriched_at)


def backfill_structured_fields(session: Session, batch_size: int = 1000,
                               company_name: str | None = None,
                               include_closed: bool = False) -> dict[str, int]:
    """Populate deterministic feature fields and auditable metadata.

    Open roles are the default operational scope; the one-time historical
    export can opt into closed roles so the downstream archive has the same
    feature contract.
    """

    version = STRUCTURED_EXTRACTION_VERSION
    department_version = DEPARTMENT_EXTRACTION_VERSION
    processed = changed = 0
    while True:
        structured_version = Job.raw_payload["structured_extraction_version"].as_string()
        department_extracted_version = Job.raw_payload["department_extraction_version"].as_string()
        status_clause = True if include_closed else Job.status == JobStatus.OPEN
        statement = select(Job).where(
            status_clause,
            or_(structured_version.is_(None), structured_version != version,
                department_extracted_version.is_(None), department_extracted_version != department_version),
        ).order_by(Job.last_seen_at.desc()).limit(max(1, batch_size))
        if company_name:
            statement = statement.join(Company).where(Company.name == company_name)
        jobs = session.scalars(statement).all()
        if not jobs:
            break
        for job in jobs:
            before = dict(job.raw_payload or {})
            previous_feed_signature = before.get("feed_content_signature")
            before_department = job.department
            description_before = job.description
            payload_description = _official_description(before)
            if payload_description and len(payload_description.strip()) > len((job.description or "").strip()):
                job.description = payload_description
            payload, extracted = _merge_structured_fields(
                job.title, job.description, dict(before), replace_longer=False
            )
            if job.description != description_before:
                payload["description_source"] = "official_payload"
                payload["description_status"] = "official_payload_body"
                job.enriched_at = None
            if not job.department:
                resolved_department, status, source = resolve_department(
                    job.title, job.description, payload
                )
                if resolved_department:
                    job.department = _limit_text(resolved_department, 255)
            else:
                existing_status = payload.get("department_status")
                existing_source = payload.get("department_source")
                if existing_status in {"published", "inferred"}:
                    status = existing_status
                    source = existing_source or "existing_record"
                else:
                    resolved_department, resolved_status, resolved_source = resolve_department(
                        job.title, job.description, payload
                    )
                    if _department_matches(job.department, resolved_department):
                        status, source = resolved_status, resolved_source
                    else:
                        status = existing_status or "legacy_unknown"
                        source = existing_source or "existing_record"
            if status == "published_or_explicit":
                status = "published"
                source = "official_payload"
            payload["department_status"] = status
            payload["department_source"] = source
            payload["department_extraction_version"] = department_version
            missing_fields = quality_missing_fields(job)
            payload["data_completeness"] = "complete" if not missing_fields else "partial"
            payload["missing_fields"] = missing_fields
            payload["quality_checked_at"] = datetime.now(timezone.utc).isoformat()
            job.raw_payload = payload
            if not job.required_skills and extracted.get("required_skills"):
                job.required_skills = extracted["required_skills"]
            elif extracted.get("required_skills"):
                job.required_skills = list(dict.fromkeys(
                    list(job.required_skills or []) + list(extracted["required_skills"])
                ))
            if not job.preferred_skills and extracted.get("preferred_skills"):
                job.preferred_skills = extracted["preferred_skills"]
            elif extracted.get("preferred_skills"):
                job.preferred_skills = list(dict.fromkeys(
                    list(job.preferred_skills or []) + list(extracted["preferred_skills"])
                ))
            refresh_feed_revision(job, previous_feed_signature, datetime.now(timezone.utc))
            processed += 1
            changed += int(
                payload != before
                or job.department != before_department
                or job.description != description_before
            )
        session.commit()
    return {"processed": processed, "changed": changed}


def promote_listing_teasers(session: Session, batch_size: int = 500) -> dict[str, int]:
    """Use an explicit official listing teaser when the detail endpoint is unavailable.

    A teaser is never presented as a detail body: its provenance and limited
    completeness remain visible in the payload, and the normal 300-character
    quality gate still applies.
    """

    detail_status = Job.raw_payload["detail_status"].as_string()
    candidates = session.scalars(
        select(Job).where(
            Job.status == JobStatus.OPEN,
            or_(Job.description.is_(None), func.length(Job.description) < 300),
            detail_status == "detail_unavailable",
        ).order_by(Job.last_seen_at.desc()).limit(max(1, batch_size))
    ).all()
    updated = 0
    now = datetime.now(timezone.utc)
    for job in candidates:
        payload = dict(job.raw_payload or {})
        previous_feed_signature = payload.get("feed_content_signature")
        teaser = _payload_text(
            payload,
            "ShortDescriptionStr", "shortDescription", "listingDescription",
            "descriptionTeaser", "teaser", "summary", limit=12000,
        )
        if not teaser or len(teaser.strip()) <= len((job.description or "").strip()):
            continue
        job.description = teaser
        payload["description_source"] = "official_listing_teaser"
        payload["description_status"] = "listing_teaser_only"
        payload["description_checked_at"] = now.isoformat()
        payload, extracted = _merge_structured_fields(
            job.title, job.description, payload, replace_longer=True
        )
        if not job.required_skills and extracted.get("required_skills"):
            job.required_skills = extracted["required_skills"]
        if not job.preferred_skills and extracted.get("preferred_skills"):
            job.preferred_skills = extracted["preferred_skills"]
        missing = quality_missing_fields(job)
        payload["data_completeness"] = "complete" if not missing else "partial"
        payload["missing_fields"] = missing
        payload["quality_checked_at"] = now.isoformat()
        job.raw_payload = payload
        refresh_feed_revision(job, previous_feed_signature, now)
        updated += 1
    session.commit()
    return {"selected": len(candidates), "updated": updated}


def sync_job(session: Session, job: Job) -> SyncEvent:
    settings = get_settings()
    event = session.scalar(select(SyncEvent).where(SyncEvent.job_id == job.id, SyncEvent.target == "table"))
    if event and event.status == "success" and event.last_synced_at and job.updated_at and event.last_synced_at >= job.updated_at:
        return event
    event = event or SyncEvent(job_id=job.id, target="table", status="skipped")
    if not settings.table_sync_enabled:
        session.add(event); return event
    if settings.table_sync_provider == "nocodb":
        if not all([settings.table_sync_token, settings.table_sync_base_id, settings.table_sync_table_id]):
            event.status, event.error = "failed", "NocoDB sync requires TABLE_SYNC_TOKEN, TABLE_SYNC_BASE_ID and TABLE_SYNC_TABLE_ID"
            session.add(event); return event
        endpoint = settings.table_sync_url or f"https://kekeio04.online/api/v1/db/data/noco/{settings.table_sync_base_id}/{settings.table_sync_table_id}"
        try:
            field_map = json.loads(settings.table_sync_field_map)
            values = {}
            for target, source in field_map.items():
                value = getattr(job, source, None)
                if isinstance(value, list):
                    value = ", ".join(str(item) for item in value)
                elif isinstance(value, (datetime, date)):
                    value = value.isoformat()
                elif isinstance(value, Enum):
                    value = value.value
                values[target] = value
            values.setdefault("Title", job.title)
            headers = {"xc-token": settings.table_sync_token, **({"xc-shared-base-id": settings.table_sync_shared_base_id} if settings.table_sync_shared_base_id else {})}
            if event.remote_id:
                response = httpx.patch(f"{endpoint.rstrip('/')}/{event.remote_id}", json=values, headers=headers, timeout=20)
            else:
                response = httpx.post(endpoint, json=values, headers=headers, timeout=20)
            response.raise_for_status(); event.status = "success"; event.remote_id = event.remote_id or str(response.json().get("Id") or response.json().get("id")); event.last_synced_at = datetime.now(timezone.utc)
        except Exception as exc:
            event.status, event.error = "failed", str(exc)[:4000]
        session.add(event); return event
    if not all([settings.table_sync_url, settings.table_sync_token, settings.table_sync_table_id]):
        event.status, event.error = "failed", "Table sync is enabled but not configured"
        session.add(event); return event
    payload = {"table_id": settings.table_sync_table_id, "record": {"job_id": str(job.id), "company_id": str(job.company_id),
        "title": job.title, "location": job.location, "country": job.country, "url": job.source_url, "status": job.status.value}}
    try:
        response = httpx.post(settings.table_sync_url, json=payload, headers={"Authorization": f"Bearer {settings.table_sync_token}"}, timeout=20)
        response.raise_for_status(); event.status = "success"; event.remote_id = response.json().get("id"); event.last_synced_at = datetime.now(timezone.utc)
    except Exception as exc:
        event.status, event.error = "failed", str(exc)[:4000]
    session.add(event); return event


def repair_workday_job_urls(session: Session) -> dict[str, int]:
    """Repair links created before Workday career-site paths were preserved."""
    sources = session.scalars(select(CompanySource).where(CompanySource.source_type == "workday", CompanySource.is_active.is_(True))).all()
    source_by_company = {source.company_id: source.source_url for source in sources}
    updated = 0
    skipped = 0
    jobs = session.scalars(select(Job).where(Job.source_type == "workday")).all()
    for job in jobs:
        source_url = source_by_company.get(job.company_id)
        external_path = (job.raw_payload or {}).get("externalPath")
        if not source_url or not external_path:
            skipped += 1
            continue
        corrected_url = WorkdayConnector.public_job_url(source_url, external_path)
        if corrected_url == job.source_url:
            continue
        corrected_hash = _hash(corrected_url)
        conflicting = session.scalar(select(Job.id).where(Job.url_hash == corrected_hash, Job.id != job.id))
        if conflicting:
            skipped += 1
            continue
        job.source_url = corrected_url
        job.url_hash = corrected_hash
        updated += 1
    session.commit()
    return {"updated": updated, "skipped": skipped}
