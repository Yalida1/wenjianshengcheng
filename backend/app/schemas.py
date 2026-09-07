from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

StageKey = Literal["requirement", "feasibility", "tender", "contract"]
FieldStatus = Literal[
    "extracted",
    "user_confirmed",
    "template_default",
    "system_authoritative",
    "ai_suggested",
    "missing",
    "conflict",
    "invalid",
    "reference_only",
    "not_applicable",
]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Any = None
    request_id: str | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class UserView(ORMModel):
    id: str
    organization_id: str
    email: str
    display_name: str
    is_active: bool
    revision: int


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=256)
    role_keys: list[str] = Field(min_length=1)


class OrganizationView(ORMModel):
    id: str
    name: str
    status: str
    revision: int


class SessionView(BaseModel):
    user: UserView
    csrf_token: str
    expires_at: int


class ProjectCreate(BaseModel):
    code: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=300)
    project_type: str = Field(default="government_investment", max_length=80)
    description: str | None = Field(default=None, max_length=4_000)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=4_000)
    status: Literal["active", "archived"] | None = None
    revision: int = Field(ge=1)


class ProjectView(ORMModel):
    id: str
    organization_id: str
    code: str
    name: str
    project_type: str
    status: str
    description: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


class ProjectMemberCreate(BaseModel):
    user_id: str
    role_key: Literal["owner", "editor", "reviewer", "viewer"]


class ProjectMemberView(ORMModel):
    id: str
    project_id: str
    user_id: str
    role_key: str
    revision: int


class Page(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int


class StageSourceRequest(BaseModel):
    source_type: Literal["upstream_final", "uploaded_file"]
    source_file_version_id: str
    revision: int = Field(ge=1)


class StageView(ORMModel):
    id: str
    project_id: str
    stage: str
    status: str
    source_type: str | None
    source_file_version_id: str | None
    finalized_document_version_id: str | None
    stale_reason: str | None
    revision: int


class StageSourceOption(BaseModel):
    id: str
    source_type: Literal["upstream_final", "uploaded_file"]
    label: str
    version: int
    sha256: str
    status: str


class FileView(ORMModel):
    id: str
    project_id: str | None
    stage: str | None
    original_name: str
    extension: str
    mime_type: str
    size_bytes: int
    latest_version: int
    status: str
    revision: int


class FileVersionView(ORMModel):
    id: str
    file_id: str
    version: int
    sha256: str
    size_bytes: int
    mime_type: str
    scan_status: str
    revision: int


class ParseJobView(ORMModel):
    id: str
    file_version_id: str
    status: str
    needs_ocr: bool
    attempt: int
    max_attempts: int
    error: str | None
    task_id: str | None


class EvidenceView(ORMModel):
    id: str
    source_file_id: str | None
    source_file_version_id: str | None
    document_block_id: str | None
    page_number: int | None
    section_path: str | None
    excerpt: str | None
    extraction_method: str
    confidence: float | None


class FieldValueCreate(BaseModel):
    field_key: str = Field(min_length=1, max_length=120)
    field_label: str = Field(min_length=1, max_length=200)
    data_type: str = Field(default="string", max_length=40)
    value: Any = None
    normalized_value: Any = None
    unit: str | None = Field(default=None, max_length=40)
    criticality: Literal["P0", "P1", "P2"] = "P2"
    status: FieldStatus = "missing"
    source_type: str = Field(default="missing", max_length=40)
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence: dict[str, Any] | None = None


class FieldDefinitionView(ORMModel):
    id: str
    stage: str
    field_key: str
    field_label: str
    data_type: str
    unit: str | None
    criticality: str
    required: bool
    rules: dict[str, Any]
    revision: int


class FieldValuePatch(BaseModel):
    value: Any = None
    normalized_value: Any = None
    unit: str | None = Field(default=None, max_length=40)
    status: FieldStatus
    source_type: str = Field(max_length=40)
    revision: int = Field(ge=1)
    evidence: dict[str, Any] | None = None


class FieldValueView(ORMModel):
    id: str
    project_id: str
    stage: str
    field_key: str
    field_label: str
    data_type: str
    value: Any
    normalized_value: Any
    unit: str | None
    criticality: str
    status: str
    source_type: str
    confidence: float | None
    revision: int
    evidence: list[EvidenceView] = []


class FieldConfirmationRequest(BaseModel):
    revision: int = Field(ge=1)
    evidence_acknowledged: bool


class TemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    stage: StageKey
    specialty: str | None = Field(default=None, max_length=120)
    procurement_type: str | None = Field(default=None, max_length=120)
    contract_type: str | None = Field(default=None, max_length=120)
    source_kind: Literal["customer_template", "demo_general"] = "customer_template"
    format_profile: dict[str, Any] = {}


class TemplateView(ORMModel):
    id: str
    name: str
    stage: str
    specialty: str | None
    procurement_type: str | None
    contract_type: str | None
    source_kind: str
    status: str
    current_version: int
    revision: int


class TemplateVersionView(ORMModel):
    id: str
    template_id: str
    version: int
    status: str
    effective_date: date | None
    expiry_date: date | None
    storage_key: str | None
    sha256: str | None
    format_profile: dict[str, Any]
    published_at: datetime | None
    revision: int


class FormatProfileCreate(BaseModel):
    key: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9_]+$")
    name: str = Field(min_length=2, max_length=300)
    rules: dict[str, Any]
    required_fonts: list[str] = []
    strict_compliance: bool = False


class FormatProfileView(ORMModel):
    id: str
    key: str
    name: str
    version: int
    status: str
    rules: dict[str, Any]
    required_fonts: list[str]
    strict_compliance: bool
    revision: int


class GenerationRequest(BaseModel):
    template_id: str
    template_version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=120)


class GenerationJobView(ORMModel):
    id: str
    project_id: str
    stage: str
    status: str
    field_snapshot_id: str
    prompt_version: str
    generation_provider: str
    generation_model: str
    task_id: str | None
    attempt: int
    error: str | None
    revision: int


class ContentBlockPatch(BaseModel):
    content: Any
    reviewed: bool = False
    revision: int = Field(ge=1)


class CommentCreate(BaseModel):
    content_block_id: str | None = None
    body: str = Field(min_length=1, max_length=4_000)


class CommentResolve(BaseModel):
    revision: int = Field(ge=1)


class ComparisonRequest(BaseModel):
    left_version_id: str
    right_version_id: str
    comparison_type: Literal["internal", "historical"] = "internal"


class ValidationIssueResolve(BaseModel):
    revision: int = Field(ge=1)
    resolution: str = Field(min_length=2, max_length=2_000)


class DocumentVersionView(ORMModel):
    id: str
    document_id: str
    version: int
    status: str
    immutable: bool
    parent_version_id: str | None
    provenance: dict[str, Any]
    finalized_at: datetime | None
    revision: int


class ValidationIssueView(ORMModel):
    id: str
    rule_key: str
    severity: str
    status: str
    message: str
    location: dict[str, Any]
    resolution: str | None


class ValidationRunView(ORMModel):
    id: str
    document_version_id: str
    status: str
    issue_counts: dict[str, int]
    started_at: datetime
    finished_at: datetime | None
    issues: list[ValidationIssueView] = []


class FinalizeRequest(BaseModel):
    revision: int = Field(ge=1)
    declaration: str = Field(min_length=5, max_length=1_000)


class ExportRequest(BaseModel):
    output_format: Literal["docx", "pdf", "xlsx"]
    idempotency_key: str = Field(min_length=8, max_length=120)


class PaymentItem(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    ratio: float = Field(gt=0, le=100)
    amount: float = Field(ge=0)
    trigger: str = Field(min_length=2, max_length=500)


class ContractPaymentCheck(BaseModel):
    final_contract_amount: float = Field(gt=0)
    items: list[PaymentItem] = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def unique_labels(cls, items: list[PaymentItem]) -> list[PaymentItem]:
        if len({item.label for item in items}) != len(items):
            raise ValueError("付款节点名称不得重复")
        return items


class TemplateVersionCreate(BaseModel):
    effective_date: date | None = None
    expiry_date: date | None = None
    format_profile: dict[str, Any] = {}
