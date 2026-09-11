from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


class RecordMixin:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class TenantRecordMixin(RecordMixin):
    organization_id: Mapped[str] = mapped_column(String(36), index=True)


class Organization(RecordMixin, Base):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(200), unique=True)
    status: Mapped[str] = mapped_column(String(30), default="active")
    brand_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    brand_subtitle: Mapped[str | None] = mapped_column(String(200), nullable=True)
    brand_mark: Mapped[str | None] = mapped_column(String(8), nullable=True)
    brand_logo_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    brand_logo_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)


class User(TenantRecordMixin, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    session_version: Mapped[int] = mapped_column(Integer, default=1)


class UserSession(TenantRecordMixin, Base):
    __tablename__ = "user_sessions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip_address: Mapped[str | None] = mapped_column(String(80))
    user_agent: Mapped[str | None] = mapped_column(String(500))


class Role(TenantRecordMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("organization_id", "key"),)
    key: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class Permission(RecordMixin, Base):
    __tablename__ = "permissions"
    code: Mapped[str] = mapped_column(String(120), unique=True)
    name: Mapped[str] = mapped_column(String(120))


class RolePermission(TenantRecordMixin, Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission_id"),)
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    permission_id: Mapped[str] = mapped_column(ForeignKey("permissions.id", ondelete="CASCADE"))


class UserRole(TenantRecordMixin, Base):
    __tablename__ = "user_roles"
    __table_args__ = (UniqueConstraint("user_id", "role_id"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))


class ProjectType(TenantRecordMixin, Base):
    __tablename__ = "project_types"
    __table_args__ = (UniqueConstraint("organization_id", "code"),)
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class ProjectCodeRule(TenantRecordMixin, Base):
    """Organization-scoped rule for auto-allocating project codes."""

    __tablename__ = "project_code_rules"
    __table_args__ = (UniqueConstraint("organization_id"),)
    pattern: Mapped[str] = mapped_column(String(120), default="{project_type}_{date}_{seq}")
    date_format: Mapped[str] = mapped_column(String(20), default="YYYYMMDD")
    seq_width: Mapped[int] = mapped_column(Integer, default=4)
    reset_scope: Mapped[str] = mapped_column(String(30), default="type_day")


class Project(TenantRecordMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("organization_id", "code"),)
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(300))
    project_type: Mapped[str] = mapped_column(String(80), default="government_investment")
    workspace_kind: Mapped[str] = mapped_column(String(30), default="managed", index=True)
    status: Mapped[str] = mapped_column(String(30), default="active")
    description: Mapped[str | None] = mapped_column(Text)


class ProjectMember(TenantRecordMixin, Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role_key: Mapped[str] = mapped_column(String(80))


class ProjectStage(TenantRecordMixin, Base):
    __tablename__ = "project_stages"
    __table_args__ = (UniqueConstraint("project_id", "stage"),)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30), default="not_started")
    source_type: Mapped[str | None] = mapped_column(String(40))
    source_file_version_id: Mapped[str | None] = mapped_column(String(36))
    finalized_document_version_id: Mapped[str | None] = mapped_column(String(36))
    upstream_revision: Mapped[int | None] = mapped_column(Integer)
    stale_reason: Mapped[str | None] = mapped_column(Text)


class File(TenantRecordMixin, Base):
    __tablename__ = "files"
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[str | None] = mapped_column(String(40))
    original_name: Mapped[str] = mapped_column(String(500))
    extension: Mapped[str] = mapped_column(String(12))
    mime_type: Mapped[str] = mapped_column(String(160))
    size_bytes: Mapped[int] = mapped_column(Integer)
    latest_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(30), default="uploaded")
    auto_generate_draft: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_generation_job_id: Mapped[str | None] = mapped_column(
        ForeignKey("generation_jobs.id", ondelete="SET NULL"), nullable=True
    )
    auto_generation_error: Mapped[str | None] = mapped_column(Text)


class FileVersion(TenantRecordMixin, Base):
    __tablename__ = "file_versions"
    __table_args__ = (UniqueConstraint("file_id", "version"),)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_key: Mapped[str] = mapped_column(String(700), unique=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    mime_type: Mapped[str] = mapped_column(String(160))
    scan_status: Mapped[str] = mapped_column(String(30), default="not_configured")


class FileParseJob(TenantRecordMixin, Base):
    __tablename__ = "file_parse_jobs"
    file_version_id: Mapped[str] = mapped_column(ForeignKey("file_versions.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    needs_ocr: Mapped[bool] = mapped_column(Boolean, default=False)
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    error: Mapped[str | None] = mapped_column(Text)
    task_id: Mapped[str | None] = mapped_column(String(80))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocumentBlock(TenantRecordMixin, Base):
    __tablename__ = "document_blocks"
    file_version_id: Mapped[str] = mapped_column(ForeignKey("file_versions.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(Text)
    page_number: Mapped[int | None] = mapped_column(Integer)
    section_path: Mapped[str | None] = mapped_column(String(500))
    locator: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))


class ParsedDocument(TenantRecordMixin, Base):
    __tablename__ = "parsed_documents"
    file_version_id: Mapped[str] = mapped_column(ForeignKey("file_versions.id"), unique=True)
    parse_job_id: Mapped[str] = mapped_column(ForeignKey("file_parse_jobs.id"))
    status: Mapped[str] = mapped_column(String(30), default="parsed")
    page_count: Mapped[int | None] = mapped_column(Integer)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class ParsedTable(TenantRecordMixin, Base):
    __tablename__ = "parsed_tables"
    parsed_document_id: Mapped[str] = mapped_column(ForeignKey("parsed_documents.id"))
    document_block_id: Mapped[str | None] = mapped_column(ForeignKey("document_blocks.id"))
    sequence: Mapped[int] = mapped_column(Integer)
    rows: Mapped[list[object]] = mapped_column(JSON, default=list)
    locator: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class FieldDefinition(TenantRecordMixin, Base):
    __tablename__ = "field_definitions"
    __table_args__ = (UniqueConstraint("organization_id", "stage", "field_key"),)
    stage: Mapped[str] = mapped_column(String(40))
    field_key: Mapped[str] = mapped_column(String(120))
    field_label: Mapped[str] = mapped_column(String(200))
    data_type: Mapped[str] = mapped_column(String(40), default="string")
    unit: Mapped[str | None] = mapped_column(String(40))
    criticality: Mapped[str] = mapped_column(String(20), default="P2")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    is_base: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    rules: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class FieldValue(TenantRecordMixin, Base):
    __tablename__ = "field_values"
    __table_args__ = (UniqueConstraint("project_id", "stage", "field_key", "revision"),)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(40))
    definition_id: Mapped[str | None] = mapped_column(ForeignKey("field_definitions.id"))
    field_key: Mapped[str] = mapped_column(String(120))
    field_label: Mapped[str] = mapped_column(String(200))
    data_type: Mapped[str] = mapped_column(String(40), default="string")
    value: Mapped[object | None] = mapped_column(JSON)
    normalized_value: Mapped[object | None] = mapped_column(JSON)
    unit: Mapped[str | None] = mapped_column(String(40))
    criticality: Mapped[str] = mapped_column(String(20), default="P2")
    status: Mapped[str] = mapped_column(String(40), default="missing")
    source_type: Mapped[str] = mapped_column(String(40), default="missing")
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)


class FieldEvidence(TenantRecordMixin, Base):
    __tablename__ = "field_evidence"
    field_value_id: Mapped[str] = mapped_column(ForeignKey("field_values.id", ondelete="CASCADE"))
    source_file_id: Mapped[str | None] = mapped_column(ForeignKey("files.id"))
    source_file_version_id: Mapped[str | None] = mapped_column(ForeignKey("file_versions.id"))
    document_block_id: Mapped[str | None] = mapped_column(ForeignKey("document_blocks.id"))
    page_number: Mapped[int | None] = mapped_column(Integer)
    section_path: Mapped[str | None] = mapped_column(String(500))
    excerpt: Mapped[str | None] = mapped_column(Text)
    extraction_method: Mapped[str] = mapped_column(String(80), default="manual")
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class FieldConfirmation(TenantRecordMixin, Base):
    __tablename__ = "field_confirmations"
    field_value_id: Mapped[str] = mapped_column(ForeignKey("field_values.id", ondelete="CASCADE"))
    confirmed_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    value_snapshot: Mapped[object] = mapped_column(JSON)
    evidence_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)


class FieldConflict(TenantRecordMixin, Base):
    __tablename__ = "field_conflicts"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(40))
    field_key: Mapped[str] = mapped_column(String(120))
    candidate_field_value_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="open")
    resolution: Mapped[str | None] = mapped_column(Text)


class FieldSnapshot(TenantRecordMixin, Base):
    __tablename__ = "field_snapshots"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(40))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    values_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class Template(TenantRecordMixin, Base):
    __tablename__ = "templates"
    name: Mapped[str] = mapped_column(String(300))
    stage: Mapped[str] = mapped_column(String(40), index=True)
    specialty: Mapped[str | None] = mapped_column(String(120))
    procurement_type: Mapped[str | None] = mapped_column(String(120))
    contract_type: Mapped[str | None] = mapped_column(String(120))
    scope: Mapped[str] = mapped_column(String(40), default="organization")
    source_kind: Mapped[str] = mapped_column(String(40), default="other_official_template")
    issuing_authority: Mapped[str | None] = mapped_column(String(300))
    document_number: Mapped[str | None] = mapped_column(String(120))
    publish_year: Mapped[int | None] = mapped_column(Integer)
    source_url: Mapped[str | None] = mapped_column(String(1000))
    applicability: Mapped[str | None] = mapped_column(Text)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    generation_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    current_version: Mapped[int] = mapped_column(Integer, default=1)


class TemplateVersion(TenantRecordMixin, Base):
    __tablename__ = "template_versions"
    __table_args__ = (UniqueConstraint("template_id", "version"),)
    template_id: Mapped[str] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    effective_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    storage_key: Mapped[str | None] = mapped_column(String(700))
    sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    format_profile: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocumentFormatProfile(TenantRecordMixin, Base):
    __tablename__ = "document_format_profiles"
    __table_args__ = (UniqueConstraint("organization_id", "key", "version"),)
    key: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(300))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    rules: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    required_fonts: Mapped[list[str]] = mapped_column(JSON, default=list)
    strict_compliance: Mapped[bool] = mapped_column(Boolean, default=False)


class TemplateSection(TenantRecordMixin, Base):
    __tablename__ = "template_sections"
    __table_args__ = (
        UniqueConstraint("template_version_id", "key", name="uq_template_sections_version_key"),
    )
    template_version_id: Mapped[str] = mapped_column(ForeignKey("template_versions.id"))
    sequence: Mapped[int] = mapped_column(Integer)
    key: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(300))
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("template_sections.id", ondelete="CASCADE"), nullable=True
    )
    level: Mapped[int] = mapped_column(Integer, default=1)
    section_type: Mapped[str] = mapped_column(String(40), default="editable")
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    content: Mapped[str | None] = mapped_column(Text)


class TemplateVariable(TenantRecordMixin, Base):
    __tablename__ = "template_variables"
    template_version_id: Mapped[str] = mapped_column(ForeignKey("template_versions.id"))
    variable_key: Mapped[str] = mapped_column(String(120))
    field_key: Mapped[str | None] = mapped_column(String(120))
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    default_value: Mapped[object | None] = mapped_column(JSON)


class TemplateExtractionJob(TenantRecordMixin, Base):
    __tablename__ = "template_extraction_jobs"
    file_version_id: Mapped[str] = mapped_column(ForeignKey("file_versions.id"), index=True)
    stage: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    task_id: Mapped[str | None] = mapped_column(String(80))
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    provider_name: Mapped[str | None] = mapped_column(String(80))
    model_name: Mapped[str | None] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(80))
    result_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    confirmed_template_id: Mapped[str | None] = mapped_column(ForeignKey("templates.id"))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProcurementAnalysisRun(TenantRecordMixin, Base):
    __tablename__ = "procurement_analysis_runs"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_kind: Mapped[str] = mapped_column(String(40))
    source_version_id: Mapped[str] = mapped_column(String(36), index=True)
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    provider_name: Mapped[str] = mapped_column(String(80))
    model_name: Mapped[str] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(80))
    task_id: Mapped[str | None] = mapped_column(String(80))
    coverage_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    result_sha256: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProcurementAnalysisCheckpoint(TenantRecordMixin, Base):
    __tablename__ = "procurement_analysis_checkpoints"
    __table_args__ = (UniqueConstraint("run_id", "phase", "chunk_index"),)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("procurement_analysis_runs.id", ondelete="CASCADE"), index=True
    )
    phase: Mapped[str] = mapped_column(String(30))
    chunk_index: Mapped[int] = mapped_column(Integer)
    input_sha256: Mapped[str] = mapped_column(String(64))
    first_sequence: Mapped[int | None] = mapped_column(Integer)
    last_sequence: Mapped[int | None] = mapped_column(Integer)
    block_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    result_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    result_sha256: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProcurementPlan(TenantRecordMixin, Base):
    __tablename__ = "procurement_plans"
    __table_args__ = (UniqueConstraint("project_id", "version", "option_key"),)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    analysis_run_id: Mapped[str] = mapped_column(
        ForeignKey("procurement_analysis_runs.id", ondelete="CASCADE"), index=True
    )
    source_kind: Mapped[str] = mapped_column(String(40))
    source_version_id: Mapped[str] = mapped_column(String(36), index=True)
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer)
    option_key: Mapped[str] = mapped_column(String(80), default="recommended")
    name: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(30), default="draft")
    is_recommended: Mapped[bool] = mapped_column(Boolean, default=False)
    recommended_document_count: Mapped[int | None] = mapped_column(Integer)
    confirmed_document_count: Mapped[int | None] = mapped_column(Integer)
    procurement_package_count: Mapped[int] = mapped_column(Integer, default=0)
    other_procurement_document_count: Mapped[int] = mapped_column(Integer, default=0)
    analysis_summary: Mapped[str | None] = mapped_column(Text)
    confirmation_blocked: Mapped[bool] = mapped_column(Boolean, default=True)
    draft_generation_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    finalization_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))


class ProcurementContentItem(TenantRecordMixin, Base):
    __tablename__ = "procurement_content_items"
    __table_args__ = (UniqueConstraint("plan_id", "item_key"),)
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id", ondelete="CASCADE"), index=True)
    item_key: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    scope_status: Mapped[str] = mapped_column(String(40), default="unknown")
    procurement_method: Mapped[str | None] = mapped_column(String(80))
    deliverables: Mapped[list[object]] = mapped_column(JSON, default=list)
    phase: Mapped[str | None] = mapped_column(String(120))
    evidence_status: Mapped[str] = mapped_column(String(40), default="missing")


class ProcurementPackage(TenantRecordMixin, Base):
    __tablename__ = "procurement_packages"
    __table_args__ = (UniqueConstraint("plan_id", "code"),)
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(300))
    procurement_category: Mapped[str] = mapped_column(String(120), default="other")
    business_subcategory: Mapped[str | None] = mapped_column(String(120))
    procurement_method: Mapped[str] = mapped_column(String(80), default="unknown")
    scope: Mapped[str] = mapped_column(Text)
    exclusions: Mapped[str | None] = mapped_column(Text)
    deliverables: Mapped[list[object]] = mapped_column(JSON, default=list)
    implementation_period: Mapped[str | None] = mapped_column(String(160))
    estimated_amount: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    confirmed_budget: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    maximum_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    currency: Mapped[str] = mapped_column(String(12), default="CNY")
    original_unit: Mapped[str | None] = mapped_column(String(40))
    tax_included: Mapped[bool | None] = mapped_column(Boolean)
    budget_period: Mapped[str | None] = mapped_column(String(120))
    budget_status: Mapped[str] = mapped_column(String(40), default="missing")
    budget_basis: Mapped[str | None] = mapped_column(Text)
    evidence_status: Mapped[str] = mapped_column(String(40), default="missing")


class ProcurementPackageContent(TenantRecordMixin, Base):
    __tablename__ = "procurement_package_contents"
    __table_args__ = (UniqueConstraint("package_id", "content_item_id"),)
    package_id: Mapped[str] = mapped_column(
        ForeignKey("procurement_packages.id", ondelete="CASCADE"), index=True
    )
    content_item_id: Mapped[str] = mapped_column(
        ForeignKey("procurement_content_items.id", ondelete="CASCADE"), index=True
    )
    allocation_scope: Mapped[str | None] = mapped_column(Text)
    split_basis: Mapped[str | None] = mapped_column(Text)


class ProcurementBudgetItem(TenantRecordMixin, Base):
    __tablename__ = "procurement_budget_items"
    __table_args__ = (UniqueConstraint("plan_id", "item_key"),)
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id", ondelete="CASCADE"), index=True)
    item_key: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(300))
    cost_type: Mapped[str] = mapped_column(String(80), default="unclassified")
    amount: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    currency: Mapped[str] = mapped_column(String(12), default="CNY")
    original_value: Mapped[str | None] = mapped_column(String(200))
    original_unit: Mapped[str | None] = mapped_column(String(40))
    tax_included: Mapped[bool | None] = mapped_column(Boolean)
    budget_period: Mapped[str | None] = mapped_column(String(120))
    allocation_status: Mapped[str] = mapped_column(String(40), default="unallocated")


class ProcurementBudgetAllocation(TenantRecordMixin, Base):
    __tablename__ = "procurement_budget_allocations"
    __table_args__ = (UniqueConstraint("budget_item_id", "package_id"),)
    budget_item_id: Mapped[str] = mapped_column(
        ForeignKey("procurement_budget_items.id", ondelete="CASCADE"), index=True
    )
    package_id: Mapped[str] = mapped_column(
        ForeignKey("procurement_packages.id", ondelete="CASCADE"), index=True
    )
    allocated_amount: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    allocation_basis: Mapped[str] = mapped_column(Text)


class TenderDocumentGroup(TenantRecordMixin, Base):
    __tablename__ = "tender_document_groups"
    __table_args__ = (UniqueConstraint("plan_id", "code"),)
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(500))
    procurement_category: Mapped[str] = mapped_column(String(120), default="other")
    business_subcategory: Mapped[str | None] = mapped_column(String(120))
    procurement_method: Mapped[str] = mapped_column(String(80), default="public_tender")
    organization_method: Mapped[str | None] = mapped_column(String(120))
    scope: Mapped[str] = mapped_column(Text)
    exclusions: Mapped[str | None] = mapped_column(Text)
    deliverables: Mapped[list[object]] = mapped_column(JSON, default=list)
    implementation_period: Mapped[str | None] = mapped_column(String(160))
    rationale: Mapped[str] = mapped_column(Text)
    template_id: Mapped[str | None] = mapped_column(ForeignKey("templates.id"))
    template_version: Mapped[int | None] = mapped_column(Integer)
    template_match_basis: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="active")


class TenderDocumentGroupPackage(TenantRecordMixin, Base):
    __tablename__ = "tender_document_group_packages"
    __table_args__ = (
        UniqueConstraint("document_group_id", "package_id"),
        UniqueConstraint("package_id"),
    )
    document_group_id: Mapped[str] = mapped_column(
        ForeignKey("tender_document_groups.id", ondelete="CASCADE"), index=True
    )
    package_id: Mapped[str] = mapped_column(
        ForeignKey("procurement_packages.id", ondelete="CASCADE"), index=True
    )


class ProcurementEvidence(TenantRecordMixin, Base):
    __tablename__ = "procurement_evidence"
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(36), index=True)
    field_key: Mapped[str] = mapped_column(String(120))
    source_version_id: Mapped[str] = mapped_column(String(36), index=True)
    document_block_id: Mapped[str | None] = mapped_column(String(36))
    page_number: Mapped[int | None] = mapped_column(Integer)
    section_path: Mapped[str | None] = mapped_column(String(500))
    locator: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    excerpt: Mapped[str | None] = mapped_column(Text)
    extracted_value: Mapped[object | None] = mapped_column(JSON)
    normalized_value: Mapped[object | None] = mapped_column(JSON)
    evidence_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(40), default="pending_review")


class ProcurementIssue(TenantRecordMixin, Base):
    __tablename__ = "procurement_issues"
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(60), default="plan")
    entity_id: Mapped[str | None] = mapped_column(String(36))
    code: Mapped[str] = mapped_column(String(120))
    severity: Mapped[str] = mapped_column(String(20), default="P1")
    category: Mapped[str] = mapped_column(String(80), default="missing")
    status: Mapped[str] = mapped_column(String(30), default="open")
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[str] = mapped_column(Text)
    impact: Mapped[str] = mapped_column(Text)
    resolution_guidance: Mapped[str | None] = mapped_column(Text)
    resolution: Mapped[str | None] = mapped_column(Text)


class ProcurementConfirmation(TenantRecordMixin, Base):
    __tablename__ = "procurement_confirmations"
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id", ondelete="CASCADE"), index=True)
    confirmed_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    plan_revision: Mapped[int] = mapped_column(Integer)
    snapshot_sha256: Mapped[str] = mapped_column(String(64), index=True)
    snapshot_json: Mapped[dict[str, object]] = mapped_column(JSON)
    decision_note: Mapped[str] = mapped_column(Text)


class ProcurementRuleSet(TenantRecordMixin, Base):
    __tablename__ = "procurement_rule_sets"
    __table_args__ = (UniqueConstraint("organization_id", "key", "version"),)
    key: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(300))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    applicable_subject: Mapped[str | None] = mapped_column(String(160))
    region: Mapped[str | None] = mapped_column(String(160))
    funding_nature: Mapped[str | None] = mapped_column(String(160))
    source_name: Mapped[str] = mapped_column(String(500))
    source_url: Mapped[str | None] = mapped_column(String(1000))
    effective_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    rules_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class ProcurementGenerationBatch(TenantRecordMixin, Base):
    __tablename__ = "procurement_generation_batches"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("procurement_plans.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    succeeded_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)


class GenerationJob(TenantRecordMixin, Base):
    __tablename__ = "generation_jobs"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30), default="queued")
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    field_snapshot_id: Mapped[str] = mapped_column(String(64))
    source_file_id: Mapped[str | None] = mapped_column(String(36))
    source_file_version: Mapped[int | None] = mapped_column(Integer)
    source_kind: Mapped[str | None] = mapped_column(String(40))
    source_version_id: Mapped[str | None] = mapped_column(String(36))
    source_sha256: Mapped[str | None] = mapped_column(String(64))
    template_id: Mapped[str | None] = mapped_column(ForeignKey("templates.id"))
    template_version: Mapped[int | None] = mapped_column(Integer)
    template_sha256: Mapped[str | None] = mapped_column(String(64))
    prompt_version: Mapped[str] = mapped_column(String(80))
    generation_provider: Mapped[str] = mapped_column(String(80))
    generation_model: Mapped[str] = mapped_column(String(120))
    procurement_plan_id: Mapped[str | None] = mapped_column(ForeignKey("procurement_plans.id"))
    procurement_document_group_id: Mapped[str | None] = mapped_column(ForeignKey("tender_document_groups.id"))
    procurement_batch_id: Mapped[str | None] = mapped_column(ForeignKey("procurement_generation_batches.id"))
    procurement_snapshot: Mapped[dict[str, object] | None] = mapped_column(JSON)
    template_applicability_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    task_id: Mapped[str | None] = mapped_column(String(80))
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)


class GenerationJobStep(TenantRecordMixin, Base):
    __tablename__ = "generation_job_steps"
    __table_args__ = (UniqueConstraint("generation_job_id", "step_key"),)
    generation_job_id: Mapped[str] = mapped_column(ForeignKey("generation_jobs.id"))
    step_key: Mapped[str] = mapped_column(String(120))
    sequence: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    output: Mapped[dict[str, object] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)


class GenerationEvent(TenantRecordMixin, Base):
    __tablename__ = "generation_events"
    generation_job_id: Mapped[str] = mapped_column(ForeignKey("generation_jobs.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class Document(TenantRecordMixin, Base):
    __tablename__ = "documents"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(30), default="draft")
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    procurement_plan_id: Mapped[str | None] = mapped_column(ForeignKey("procurement_plans.id"))
    procurement_document_group_id: Mapped[str | None] = mapped_column(ForeignKey("tender_document_groups.id"))
    procurement_package_ids: Mapped[list[str]] = mapped_column(JSON, default=list)


class DocumentVersion(TenantRecordMixin, Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version"),)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    immutable: Mapped[bool] = mapped_column(Boolean, default=False)
    parent_version_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    provenance: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finalized_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))


class DocumentSection(TenantRecordMixin, Base):
    __tablename__ = "document_sections"
    __table_args__ = (
        UniqueConstraint("document_version_id", "key", name="uq_document_sections_version_key"),
    )
    document_version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    sequence: Mapped[int] = mapped_column(Integer)
    key: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(500))
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("document_sections.id", ondelete="CASCADE"), nullable=True
    )
    level: Mapped[int] = mapped_column(Integer, default=1)


class DocumentContentBlock(TenantRecordMixin, Base):
    __tablename__ = "document_content_blocks"
    document_section_id: Mapped[str] = mapped_column(ForeignKey("document_sections.id"))
    sequence: Mapped[int] = mapped_column(Integer)
    block_type: Mapped[str] = mapped_column(String(40))
    content: Mapped[object] = mapped_column(JSON)
    source_kind: Mapped[str] = mapped_column(String(40))
    field_refs: Mapped[list[str]] = mapped_column(JSON, default=list)
    evidence_refs: Mapped[list[str]] = mapped_column(JSON, default=list)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)


class DocumentComment(TenantRecordMixin, Base):
    __tablename__ = "document_comments"
    document_version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    content_block_id: Mapped[str | None] = mapped_column(ForeignKey("document_content_blocks.id"))
    author_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="open")


class ValidationRule(TenantRecordMixin, Base):
    __tablename__ = "validation_rules"
    key: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(300))
    stage: Mapped[str | None] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(20))
    implementation: Mapped[str] = mapped_column(String(120))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class ValidationRun(TenantRecordMixin, Base):
    __tablename__ = "validation_runs"
    document_version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    status: Mapped[str] = mapped_column(String(30), default="running")
    issue_counts: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ValidationIssue(TenantRecordMixin, Base):
    __tablename__ = "validation_issues"
    validation_run_id: Mapped[str] = mapped_column(ForeignKey("validation_runs.id"))
    rule_key: Mapped[str] = mapped_column(String(120))
    severity: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30), default="open")
    message: Mapped[str] = mapped_column(Text)
    location: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    resolution: Mapped[str | None] = mapped_column(Text)


class FinalizationRecord(TenantRecordMixin, Base):
    __tablename__ = "finalization_records"
    document_version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"), unique=True)
    finalized_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    finalized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    validation_run_id: Mapped[str] = mapped_column(ForeignKey("validation_runs.id"))
    field_snapshot_sha256: Mapped[str] = mapped_column(String(64))
    declaration: Mapped[str] = mapped_column(Text)


class ComparisonRun(TenantRecordMixin, Base):
    __tablename__ = "comparison_runs"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    left_version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    right_version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    comparison_type: Mapped[str] = mapped_column(String(40), default="internal")
    status: Mapped[str] = mapped_column(String(30), default="queued")
    summary: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class ComparisonItem(TenantRecordMixin, Base):
    __tablename__ = "comparison_items"
    comparison_run_id: Mapped[str] = mapped_column(ForeignKey("comparison_runs.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    change_type: Mapped[str] = mapped_column(String(30))
    location: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    before: Mapped[object | None] = mapped_column(JSON)
    after: Mapped[object | None] = mapped_column(JSON)


class ExportJob(TenantRecordMixin, Base):
    __tablename__ = "export_jobs"
    document_version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    document_revision: Mapped[int] = mapped_column(Integer, default=1)
    output_format: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30), default="queued")
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    storage_key: Mapped[str | None] = mapped_column(String(700))
    sha256: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)


class ExportArtifact(TenantRecordMixin, Base):
    __tablename__ = "export_artifacts"
    export_job_id: Mapped[str] = mapped_column(ForeignKey("export_jobs.id"), index=True)
    storage_key: Mapped[str] = mapped_column(String(700), unique=True)
    filename: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(160))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class AuditLog(TenantRecordMixin, Base):
    __tablename__ = "audit_logs"
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(120), index=True)
    object_type: Mapped[str] = mapped_column(String(80))
    object_id: Mapped[str | None] = mapped_column(String(36))
    request_id: Mapped[str | None] = mapped_column(String(80))
    ip_address: Mapped[str | None] = mapped_column(String(80))
    before: Mapped[dict[str, object] | None] = mapped_column(JSON)
    after: Mapped[dict[str, object] | None] = mapped_column(JSON)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class ApprovalRequest(TenantRecordMixin, Base):
    """Organization-scoped approval tickets (e.g. project deletion)."""

    __tablename__ = "approval_requests"
    request_type: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    title: Mapped[str] = mapped_column(String(300))
    reason: Mapped[str] = mapped_column(Text)
    target_type: Mapped[str] = mapped_column(String(80), index=True)
    target_id: Mapped[str] = mapped_column(String(36), index=True)
    target_code: Mapped[str | None] = mapped_column(String(80))
    target_name: Mapped[str | None] = mapped_column(String(300))
    payload_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    requester_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LlmModelProfile(TenantRecordMixin, Base):
    """Organization-managed AI model connection profiles."""

    __tablename__ = "llm_model_profiles"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)
    name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(40), default="openai_compatible")
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=90)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
