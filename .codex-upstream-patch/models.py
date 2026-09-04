import json
import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class JobStatus(StrEnum):
    OPEN = "open"
    CLOSED = "closed"


class ApplicationStatus(StrEnum):
    SAVED = "saved"
    RESEARCHING = "researching"
    APPLYING = "applying"
    APPLIED = "applied"
    INTERVIEWING = "interviewing"
    OFFER = "offer"
    REJECTED = "rejected"


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    industry: Mapped[str | None] = mapped_column(String(100))
    career_url: Mapped[str] = mapped_column(String(2048))
    connector_type: Mapped[str] = mapped_column(String(64), default="official")
    source_url: Mapped[str | None] = mapped_column(String(2048))
    connector_config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CompanySource(Base):
    __tablename__ = "company_sources"
    __table_args__ = (UniqueConstraint("company_id", "source_url", name="uq_company_source_url"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    source_type: Mapped[str] = mapped_column(String(64), default="official")
    source_url: Mapped[str] = mapped_column(String(2048))
    priority: Mapped[int] = mapped_column(default=1, index=True)
    connector_config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("company_id", "external_job_id", name="uq_company_external_job"),
        Index("ix_jobs_search", "status", "country", "industry", "job_function", "level"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    company: Mapped["Company"] = relationship("Company", lazy="joined")
    lifecycle_events: Mapped[list["JobLifecycleEvent"]] = relationship(
        "JobLifecycleEvent",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="JobLifecycleEvent.observed_at",
        lazy="selectin",
    )
    external_job_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_type: Mapped[str] = mapped_column(String(64), default="official", index=True)
    source_url: Mapped[str] = mapped_column(String(2048))
    url_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    identity_hash: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(500), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(500))
    country: Mapped[str | None] = mapped_column(String(100), index=True)
    department: Mapped[str | None] = mapped_column(String(255))
    industry: Mapped[str | None] = mapped_column(String(100), index=True)
    job_function: Mapped[str | None] = mapped_column(String(100), index=True)
    level: Mapped[str | None] = mapped_column(String(100), index=True)
    required_skills: Mapped[list] = mapped_column(JSON, default=list)
    preferred_skills: Mapped[list] = mapped_column(JSON, default=list)
    visa_sponsorship: Mapped[bool | None] = mapped_column(Boolean)
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.OPEN, index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Operational refreshes happen on every successful crawl. Keep a separate
    # downstream revision so an unchanged job does not get retransmitted.
    feed_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    enriched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    enrichment_provider: Mapped[str | None] = mapped_column(String(32))
    enrichment_error: Mapped[str | None] = mapped_column(Text)

    @property
    def company_name(self) -> str | None:
        return self.company.name if self.company else None

    @property
    def metadata_quality(self) -> str | None:
        return (self.raw_payload or {}).get("metadata_quality")

    @property
    def detail_status(self) -> str | None:
        return (self.raw_payload or {}).get("detail_status")

    @property
    def detail_status_reason(self) -> str | None:
        return (self.raw_payload or {}).get("detail_status_reason")

    @property
    def data_completeness(self) -> str | None:
        return (self.raw_payload or {}).get("data_completeness")

    @property
    def department_status(self) -> str | None:
        return (self.raw_payload or {}).get("department_status")

    @property
    def department_source(self) -> str | None:
        return (self.raw_payload or {}).get("department_source")

    @property
    def enrichment_field_sources(self) -> dict:
        value = (self.raw_payload or {}).get("enrichment_field_sources")
        return value if isinstance(value, dict) else {}

    @property
    def structured_field_sources(self) -> dict:
        value = (self.raw_payload or {}).get("structured_field_sources")
        return value if isinstance(value, dict) else {}

    @property
    def structured_missing_fields(self) -> list[str]:
        return list((self.raw_payload or {}).get("structured_missing_fields") or [])

    @property
    def structured_extraction_version(self) -> str | None:
        value = (self.raw_payload or {}).get("structured_extraction_version")
        return str(value) if value not in (None, "") else None

    @property
    def missing_fields(self) -> list[str]:
        return list((self.raw_payload or {}).get("missing_fields") or [])

    @property
    def details_checked_at(self) -> str | None:
        return (self.raw_payload or {}).get("details_checked_at")

    @property
    def description_source(self) -> str | None:
        return (self.raw_payload or {}).get("description_source")

    @property
    def description_status(self) -> str | None:
        return (self.raw_payload or {}).get("description_status")

    @staticmethod
    def _coerce_structured_text(value) -> str | None:
        """Convert connector JSON values to scalar strings exposed by JobOut."""
        if value is None or value == "" or value == [] or value == {}:
            return None
        if isinstance(value, str):
            return value
        if isinstance(value, (list, tuple, set)):
            parts = [Job._coerce_structured_text(item) for item in value]
            parts = [part for part in parts if part]
            return ", ".join(parts) or None
        if isinstance(value, dict):
            for name in ("name", "label", "value", "text", "title", "description"):
                if name in value:
                    text = Job._coerce_structured_text(value[name])
                    if text:
                        return text
            return json.dumps(value, ensure_ascii=False, sort_keys=True)
        return str(value)

    def _structured_payload_value_raw(self, key: str, *aliases: str):
        payload = self.raw_payload or {}
        for name in (key, *aliases):
            value = payload.get(name)
            if value not in (None, "", [], {}):
                return value
        detail = payload.get("detail_payload")
        if isinstance(detail, dict):
            for name in (key, *aliases):
                value = detail.get(name)
                if value not in (None, "", [], {}):
                    return value
        return None

    def _structured_payload_value(self, key: str, *aliases: str) -> str | None:
        return self._coerce_structured_text(self._structured_payload_value_raw(key, *aliases))

    @property
    def date_posted(self) -> str | None:
        return self._structured_payload_value("date_posted", "ExternalPostedStartDate", "postedOn")

    @property
    def valid_through(self) -> str | None:
        return self._structured_payload_value("valid_through", "ExternalPostedEndDate", "PostingEndDate", "validThrough")

    @property
    def employment_type(self) -> str | None:
        return self._structured_payload_value("employment_type", "JobSchedule", "WorkerType", "JobType", "employmentType")

    @property
    def workplace_type(self) -> str | None:
        return self._structured_payload_value(
            "workplace_type", "work_arrangement", "WorkplaceType", "WorkplaceTypeCode", "workplaceType",
        )

    @property
    def remote_type(self) -> str | None:
        return self._structured_payload_value(
            "remote_type", "remoteType", "remoteWorkType", "workplaceType", "WorkplaceType",
        )

    @property
    def work_arrangement(self) -> str | None:
        return self._structured_payload_value(
            "work_arrangement", "workplace_type", "workArrangement", "workLocationType", "locationType",
        )

    @property
    def responsibilities(self) -> str | None:
        return self._structured_payload_value("responsibilities", "ExternalResponsibilitiesStr", "responsibilities")

    @property
    def qualifications(self) -> str | None:
        return self._structured_payload_value(
            "qualifications", "qualification", "ExternalQualificationsStr", "qualifications",
        )

    @property
    def education(self) -> str | None:
        return self._structured_payload_value("education", "education_level", "StudyLevel", "educationRequirements")

    @property
    def experience(self) -> str | None:
        return self._structured_payload_value("experience", "Experience", "experienceRequirements")

    @property
    def compensation(self) -> str | None:
        value = self._structured_payload_value("compensation", "salary_range", "salary", "salaryRange")
        return str(value) if value is not None else None

    @property
    def salary_range(self) -> str | None:
        value = self._structured_payload_value(
            "salary_range", "compensation", "salaryRange", "basePay", "baseSalary",
            "primaryLocationFullTimeSalaryRange", "payRange",
        )
        return str(value) if value is not None else None

    @property
    def education_level(self) -> str | None:
        return self._structured_payload_value(
            "education_level", "education", "educationLevel", "StudyLevel", "minimumEducation",
        )

    @property
    def qualification(self) -> str | None:
        return self._structured_payload_value(
            "qualification", "qualificationSummary", "requiredQualifications",
            "ExternalQualificationsStr", "jobQualifications",
        )

    @property
    def additional_locations(self) -> list:
        value = self._structured_payload_value_raw("additional_locations", "secondaryLocations", "otherWorkLocations")
        return value if isinstance(value, list) else []

    @property
    def team_context(self) -> str | None:
        return self._structured_payload_value("team_context", "teamDescription", "aboutTheTeam", "teamOverview")

    @property
    def benefits(self) -> str | None:
        return self._structured_payload_value("benefits", "benefitSummary", "totalRewards", "perks")

    @property
    def application_process(self) -> str | None:
        return self._structured_payload_value(
            "application_process", "applicationProcess", "howToApply", "selectionProcess", "interviewProcess",
        )

    @property
    def work_authorization(self) -> str | None:
        return self._structured_payload_value(
            "work_authorization", "workAuthorization", "rightToWork", "visaSponsorship", "sponsorship",
        )

    @property
    def travel(self) -> str | None:
        return self._structured_payload_value("travel", "travelRequirements", "travelExpectation", "travelPercentage")

    @property
    def application_deadline(self) -> str | None:
        return self._structured_payload_value(
            "application_deadline", "applicationDeadline", "closingDate", "applyBy", "validThrough", "PostingEndDate",
        )

    @property
    def recruiting_program(self) -> str | None:
        return self._structured_payload_value(
            "recruiting_program", "programType", "programmeType", "experienceCategory", "careerProgram", "recruitingProgram",
        )


class JobLifecycleEvent(Base):
    """Immutable observations of a role opening, closing, or reopening.

    ``first_seen_at`` and ``closed_at`` on Job are convenient current-state
    fields. This table preserves the history needed by downstream consumers
    when a requisition is later reopened or replaced.
    """

    __tablename__ = "job_lifecycle_events"
    __table_args__ = (Index("ix_job_lifecycle_events_job_observed", "job_id", "observed_at"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    job: Mapped["Job"] = relationship("Job", back_populates="lifecycle_events")
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    reason: Mapped[str | None] = mapped_column(String(255))
    source_type: Mapped[str | None] = mapped_column(String(64))


class JobTracker(Base):
    __tablename__ = "job_trackers"
    __table_args__ = (Index("ix_job_trackers_status_follow_up", "status", "follow_up_at"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), unique=True, index=True)
    job: Mapped["Job"] = relationship(lazy="joined")
    status: Mapped[ApplicationStatus] = mapped_column(Enum(ApplicationStatus), default=ApplicationStatus.SAVED, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CrawlRun(Base):
    __tablename__ = "crawl_runs"
    __table_args__ = (UniqueConstraint("company_id", "external_batch_id", name="uq_crawl_company_batch"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)
    connector_type: Mapped[str] = mapped_column(String(64))
    external_batch_id: Mapped[str | None] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(32))
    discovered_count: Mapped[int] = mapped_column(default=0)
    # Keep source coverage separate from execution status. A short batch must
    # never be mistaken for a complete crawl merely because the request ran.
    expected_count: Mapped[int | None] = mapped_column(Integer)
    # ``expected_count`` is the coverage boundary used by lifecycle safety.
    # Keep the publisher's official total separate: a source can report an
    # exact total while a transient page failure leaves the fetched list short.
    official_count: Mapped[int | None] = mapped_column(Integer, index=True)
    official_count_status: Mapped[str | None] = mapped_column(String(32))
    official_count_source: Mapped[str | None] = mapped_column(String(128))
    official_count_observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    official_count_lower_bound: Mapped[int | None] = mapped_column(Integer)
    complete_count: Mapped[int] = mapped_column(default=0)
    partial_count: Mapped[int] = mapped_column(default=0)
    created_count: Mapped[int] = mapped_column(default=0)
    updated_count: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SyncEvent(Base):
    __tablename__ = "sync_events"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    __table_args__ = (UniqueConstraint("job_id", "target", name="uq_sync_job_target"),)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    target: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32))
    remote_id: Mapped[str | None] = mapped_column(String(255))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (UniqueConstraint("report_date", name="uq_audit_report_date"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    report_date: Mapped[date] = mapped_column(Date, index=True)
    open_jobs: Mapped[int] = mapped_column(Integer, default=0)
    new_jobs: Mapped[int] = mapped_column(Integer, default=0)
    closed_jobs: Mapped[int] = mapped_column(Integer, default=0)
    crawl_runs: Mapped[int] = mapped_column(Integer, default=0)
    failed_crawls: Mapped[int] = mapped_column(Integer, default=0)
    sync_failures: Mapped[int] = mapped_column(Integer, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
