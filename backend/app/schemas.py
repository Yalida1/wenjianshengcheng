from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

StageKey = Literal["demand", "requirement", "feasibility", "tender", "contract"]
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


class BrandingView(BaseModel):
    name: str
    subtitle: str
    mark: str
    document_title: str
    has_custom_logo: bool
    logo_url: str | None = None
    revision: int


class BrandingPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    subtitle: str | None = Field(default=None, min_length=1, max_length=200)
    mark: str | None = Field(default=None, min_length=1, max_length=8)
    clear_logo: bool = False
    revision: int = Field(ge=1)


LlmProviderKind = Literal["demo", "openai_compatible"]


class LlmModelProfileView(BaseModel):
    id: str
    name: str
    provider: LlmProviderKind
    base_url: str | None = None
    model_name: str | None = None
    timeout_seconds: int
    is_active: bool
    notes: str | None = None
    has_api_key: bool
    api_key_hint: str | None = None
    revision: int
    created_at: datetime
    updated_at: datetime


class LlmModelProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: LlmProviderKind = "openai_compatible"
    base_url: str | None = Field(default=None, max_length=500)
    model_name: str | None = Field(default=None, max_length=200)
    api_key: str | None = Field(default=None, max_length=500)
    timeout_seconds: int = Field(default=90, ge=10, le=600)
    notes: str | None = Field(default=None, max_length=500)
    activate: bool = True


class LlmModelProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    provider: LlmProviderKind | None = None
    base_url: str | None = Field(default=None, max_length=500)
    model_name: str | None = Field(default=None, max_length=200)
    api_key: str | None = Field(default=None, max_length=500)
    clear_api_key: bool = False
    timeout_seconds: int | None = Field(default=None, ge=10, le=600)
    notes: str | None = Field(default=None, max_length=500)
    revision: int = Field(ge=1)


class LlmModelCatalogView(BaseModel):
    items: list[LlmModelProfileView]
    active_id: str | None = None
    env_fallback: dict[str, Any]


class SessionView(BaseModel):
    user: UserView
    csrf_token: str
    expires_at: int


class ProjectTypeCreate(BaseModel):
    code: str = Field(min_length=2, max_length=80, pattern=r"^[a-z][a-z0-9_]{1,79}$")
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2_000)
    sort_order: int = Field(default=100, ge=0, le=10_000)


class ProjectTypePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2_000)
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    is_active: bool | None = None
    revision: int = Field(ge=1)


class ProjectTypeView(ORMModel):
    id: str
    organization_id: str
    code: str
    name: str
    description: str | None
    sort_order: int
    is_active: bool
    is_system: bool
    revision: int
    created_at: datetime
    updated_at: datetime


class ProjectCodeRuleView(ORMModel):
    id: str
    organization_id: str
    pattern: str
    date_format: str
    seq_width: int
    reset_scope: str
    revision: int
    created_at: datetime
    updated_at: datetime
    preview: str


class ProjectCodeRulePut(BaseModel):
    pattern: str = Field(min_length=5, max_length=120)
    date_format: str = Field(default="YYYYMMDD", min_length=4, max_length=20)
    seq_width: int = Field(default=4, ge=1, le=8)
    reset_scope: Literal["type_day", "day", "organization"] = "type_day"
    revision: int = Field(ge=1)


class ProjectCreate(BaseModel):
    """新建项目只需名称与类型；编号按组织规则自动生成，也可显式传入。"""

    code: str | None = Field(
        default=None,
        min_length=2,
        max_length=80,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="可选；省略时按组织编号规则自动生成",
    )
    name: str = Field(min_length=2, max_length=300)
    project_type: str = Field(default="government_investment", max_length=80)
    workspace_kind: Literal["managed", "adhoc"] = "managed"
    description: str | None = Field(default=None, max_length=4_000)


class ProjectPatch(BaseModel):
    code: str | None = Field(
        default=None,
        min_length=2,
        max_length=80,
        pattern=r"^[A-Za-z0-9_\u4e00-\u9fff\-·.（）()〔〕【】\[\]/]+$",
    )
    name: str | None = Field(default=None, min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=4_000)
    status: Literal["active", "archived"] | None = None
    workspace_kind: Literal["managed", "adhoc"] | None = None
    revision: int = Field(ge=1)


class ProjectDeleteRequest(BaseModel):
    revision: int = Field(ge=1)
    confirmation_code: str = Field(min_length=2, max_length=80)


class ProjectDeleteResult(BaseModel):
    project_id: str
    deleted: bool
    storage_objects_deleted: int
    storage_cleanup_failed: int


class ProjectDeletionRequestCreate(BaseModel):
    revision: int = Field(ge=1)
    confirmation_code: str = Field(min_length=2, max_length=80)
    reason: str = Field(min_length=2, max_length=2_000)


class ApprovalDecisionRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=2_000)
    revision: int = Field(ge=1)


class ApprovalRequestView(ORMModel):
    id: str
    organization_id: str
    request_type: str
    status: str
    title: str
    reason: str
    target_type: str
    target_id: str
    target_code: str | None
    target_name: str | None
    payload_json: dict[str, Any]
    requester_id: str
    requester_name: str | None = None
    reviewer_id: str | None
    reviewer_name: str | None = None
    review_comment: str | None
    reviewed_at: datetime | None
    revision: int
    created_at: datetime
    updated_at: datetime


class ProjectView(ORMModel):
    id: str
    organization_id: str
    code: str
    name: str
    project_type: str
    workspace_kind: str
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
    auto_generate_draft: bool
    auto_generation_job_id: str | None
    auto_generation_error: str | None
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


class FieldCandidateExtractionView(BaseModel):
    file_id: str
    file_version_id: str
    created: int
    existing: int
    skipped: int
    revised: int = 0
    conflicts: int = 0
    created_keys: list[str]
    existing_keys: list[str]
    skipped_keys: list[str]
    revised_keys: list[str] = Field(default_factory=list)


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


class FieldDefinitionCreate(BaseModel):
    stage: Literal["requirement", "feasibility", "tender", "contract"]
    field_key: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]{0,119}$")
    field_label: str = Field(min_length=1, max_length=200)
    data_type: str = Field(default="string", max_length=40)
    unit: str | None = Field(default=None, max_length=40)
    criticality: Literal["P0", "P1", "P2"] = "P2"
    required: bool = False
    rules: dict[str, Any] | None = None


class FieldDefinitionPatch(BaseModel):
    field_label: str | None = Field(default=None, min_length=1, max_length=200)
    data_type: str | None = Field(default=None, max_length=40)
    unit: str | None = Field(default=None, max_length=40)
    criticality: Literal["P0", "P1", "P2"] | None = None
    required: bool | None = None
    rules: dict[str, Any] | None = None
    revision: int = Field(ge=1)


class FieldDefinitionView(ORMModel):
    id: str
    stage: str
    field_key: str
    field_label: str
    data_type: str
    unit: str | None
    criticality: str
    required: bool
    is_base: bool
    is_active: bool
    rules: dict[str, Any]
    revision: int


class ApplicableFieldView(BaseModel):
    field_key: str
    label: str
    data_type: str
    unit: str | None = None
    level: str
    required: bool
    source: Literal["template", "profile", "core", "global"]
    reason: str = ""
    profile: str
    document_group_id: str
    blocking: bool
    definition_missing: bool = False
    source_template_id: str | None = None
    source_profile: str | None = None
    display_order: int = 100
    empty_reason_code: str | None = None
    empty_reason_message: str | None = None
    source_stage: str = "upstream_or_material"
    required_for_phase: str = "both"
    input_role: str = "material"


class TemplateConfigErrorView(BaseModel):
    variable_key: str
    message: str


class ApplicableFieldsResponse(BaseModel):
    document_group_id: str
    profile: str
    resolution_source: Literal["template", "profile", "core", "mixed"]
    source_template_id: str | None = None
    source_template_version: int | None = None
    setup_incomplete: bool = False
    setup_incomplete_reason: str | None = None
    template_config_errors: list[TemplateConfigErrorView] = Field(default_factory=list)
    fields: list[ApplicableFieldView] = Field(default_factory=list)


class ProjectApplicableFieldsResponse(BaseModel):
    project_id: str
    stage: StageKey
    groups: list[ApplicableFieldsResponse] = Field(default_factory=list)


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
    source_kind: Literal[
        "national_official_text",
        "adapted_from_official_outline",
        "platform_reference_template",
        "other_official_template",
    ] = "other_official_template"
    issuing_authority: str | None = Field(default=None, max_length=300)
    document_number: str | None = Field(default=None, max_length=120)
    publish_year: int | None = Field(default=None, ge=1949, le=2100)
    source_url: str | None = Field(default=None, max_length=1000)
    applicability: str | None = Field(default=None, max_length=2000)
    format_profile: dict[str, Any] = {}

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("source_url must be an HTTP or HTTPS URL")
        return normalized


class TemplateView(ORMModel):
    id: str
    name: str
    stage: str
    specialty: str | None
    procurement_type: str | None
    contract_type: str | None
    source_kind: str
    issuing_authority: str | None
    document_number: str | None
    publish_year: int | None
    source_url: str | None
    applicability: str | None
    is_builtin: bool
    generation_enabled: bool
    status: str
    current_version: int
    revision: int
    has_docx_source: bool = False


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


class TemplateExtractionSummary(BaseModel):
    filename: str
    stage: str
    provider: str
    model: str
    block_count: int
    llm_chunk_count: int
    truncated_for_llm: bool
    paragraph_count: int
    table_count: int
    section_count: int
    header_paragraph_count: int
    footer_paragraph_count: int
    style_names: list[str]
    layout_preserved: bool


class TemplateExtractionQualityCheck(BaseModel):
    key: str
    passed: bool
    detail: str


class TemplateExtractionQuality(BaseModel):
    passed: bool
    score: float
    grade: Literal["publishable", "rejected"]
    min_blocks: int
    min_sections: int
    program_section_count: int
    checks: list[TemplateExtractionQualityCheck]
    reasons: list[str]
    preflight_placeholders: list[str] = []


class TemplateExtractionSectionCandidate(BaseModel):
    id: str
    key: str
    title: str
    level: int = 1
    parent_key: str | None = None
    source_block_ids: list[str]
    confidence: float
    basis: str
    selected: bool


class TemplateExtractionVariableCandidate(BaseModel):
    id: str
    variable_key: str
    label: str
    data_type: str
    exact_text: str
    source_block_ids: list[str]
    confidence: float
    rationale: str
    selected: bool


class TemplateExtractionConfirmation(BaseModel):
    selected_section_ids: list[str]
    selected_variable_ids: list[str]
    template_id: str
    published: bool = False


class TemplateExtractionResult(BaseModel):
    summary: TemplateExtractionSummary
    sections: list[TemplateExtractionSectionCandidate]
    variables: list[TemplateExtractionVariableCandidate]
    warnings: list[str]
    quality: TemplateExtractionQuality | None = None
    confirmation: TemplateExtractionConfirmation | None = None


class TemplateExtractionJobView(ORMModel):
    id: str
    file_version_id: str
    stage: str
    status: str
    task_id: str | None
    attempt: int
    max_attempts: int
    provider_name: str | None
    model_name: str | None
    prompt_version: str
    result_json: TemplateExtractionResult | None
    error: str | None
    confirmed_template_id: str | None
    started_at: datetime | None
    finished_at: datetime | None
    revision: int
    created_at: datetime
    updated_at: datetime

    @field_validator("result_json", mode="before")
    @classmethod
    def empty_result_as_none(cls, value: object) -> object:
        return value or None


class TemplateExtractionConfirmRequest(BaseModel):
    revision: int = Field(ge=1)
    template_name: str = Field(min_length=2, max_length=300)
    source_kind: Literal[
        "adapted_from_official_outline",
        "platform_reference_template",
        "other_official_template",
    ]
    issuing_authority: str | None = Field(default=None, max_length=300)
    document_number: str | None = Field(default=None, max_length=120)
    publish_year: int | None = Field(default=None, ge=1949, le=2100)
    source_url: str | None = Field(default=None, max_length=1000)
    applicability: str | None = Field(default=None, max_length=2000)
    selected_section_ids: list[str] = Field(min_length=1)
    selected_variable_ids: list[str] = []

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str | None) -> str | None:
        return TemplateCreate.validate_source_url(value)


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
    selected_section_keys: list[str] | None = Field(default=None, min_length=1, max_length=200)
    include_descendants: bool = True
    procurement_plan_id: str | None = None
    template_applicability_confirmed: bool = False
    procurement_document_group_id: str | None = None
    procurement_package_ids: list[str] | None = Field(default=None, min_length=1, max_length=100)


class GenerationJobView(ORMModel):
    id: str
    project_id: str
    stage: str
    status: str
    field_snapshot_id: str
    prompt_version: str
    generation_provider: str
    generation_model: str
    procurement_plan_id: str | None
    procurement_document_group_id: str | None
    procurement_batch_id: str | None
    procurement_snapshot: dict[str, Any] | None
    template_applicability_confirmed: bool
    task_id: str | None
    attempt: int
    error: str | None
    revision: int


class ProcurementAnalysisRequest(BaseModel):
    source_kind: Literal["uploaded_file", "upstream_final"] | None = None
    source_version_id: str | None = None
    include_alternative: bool = True


class ProcurementAnalysisRunView(ORMModel):
    id: str
    project_id: str
    source_kind: str
    source_version_id: str
    source_sha256: str
    status: str
    provider_name: str
    model_name: str
    prompt_version: str
    task_id: str | None
    coverage_json: dict[str, Any]
    result_sha256: str | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    revision: int


class ProcurementEvidenceView(ORMModel):
    id: str
    entity_type: str
    entity_id: str | None
    field_key: str
    source_version_id: str
    document_block_id: str | None
    page_number: int | None
    section_path: str | None
    locator: dict[str, Any]
    excerpt: str | None
    extracted_value: Any
    normalized_value: Any
    evidence_type: str
    status: str


class ProcurementContentItemView(ORMModel):
    id: str
    item_key: str
    name: str
    description: str | None
    scope_status: str
    procurement_method: str | None
    deliverables: list[Any]
    phase: str | None
    evidence_status: str
    revision: int


class ProcurementPackageView(ORMModel):
    id: str
    code: str
    name: str
    procurement_category: str
    business_subcategory: str | None
    procurement_method: str
    scope: str
    exclusions: str | None
    deliverables: list[Any]
    implementation_period: str | None
    estimated_amount: Decimal | None
    confirmed_budget: Decimal | None
    maximum_price: Decimal | None
    currency: str
    original_unit: str | None
    tax_included: bool | None
    budget_period: str | None
    budget_status: str
    budget_basis: str | None
    evidence_status: str
    content_item_ids: list[str]
    revision: int


class TenderDocumentGroupView(ORMModel):
    id: str
    code: str
    name: str
    procurement_category: str
    business_subcategory: str | None
    procurement_method: str
    organization_method: str | None
    scope: str
    exclusions: str | None
    deliverables: list[Any]
    implementation_period: str | None
    rationale: str
    template_id: str | None
    template_version: int | None
    template_match_basis: str | None
    status: str
    package_ids: list[str]
    revision: int


class ProcurementIssueView(ORMModel):
    id: str
    entity_type: str
    entity_id: str | None
    code: str
    severity: str
    category: str
    status: str
    title: str
    detail: str
    impact: str
    resolution_guidance: str | None
    resolution: str | None


class ProcurementPlanView(ORMModel):
    id: str
    project_id: str
    analysis_run_id: str
    source_kind: str
    source_version_id: str
    source_sha256: str
    version: int
    option_key: str
    name: str
    status: str
    is_recommended: bool
    recommended_document_count: int | None
    confirmed_document_count: int | None
    procurement_package_count: int
    other_procurement_document_count: int
    analysis_summary: str | None
    confirmation_blocked: bool
    draft_generation_allowed: bool
    finalization_allowed: bool
    confirmed_at: datetime | None
    content_items: list[ProcurementContentItemView]
    packages: list[ProcurementPackageView]
    document_groups: list[TenderDocumentGroupView]
    evidence: list[ProcurementEvidenceView]
    unresolved_items: list[ProcurementIssueView]
    budget_reconciliation: dict[str, Any]
    coverage_check: dict[str, Any]
    rule_check_results: list[dict[str, Any]]
    analysis_coverage: dict[str, Any]
    revision: int


class ProcurementPackageInput(BaseModel):
    id: str | None = None
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=2, max_length=300)
    procurement_category: str = Field(default="other", max_length=120)
    business_subcategory: str | None = Field(default=None, max_length=120)
    procurement_method: str = Field(default="unknown", max_length=80)
    scope: str = Field(min_length=2, max_length=20_000)
    exclusions: str | None = Field(default=None, max_length=10_000)
    deliverables: list[Any] = Field(default_factory=list, max_length=200)
    implementation_period: str | None = Field(default=None, max_length=160)
    estimated_amount: Decimal | None = Field(default=None, ge=0)
    confirmed_budget: Decimal | None = Field(default=None, ge=0)
    maximum_price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="CNY", min_length=3, max_length=12)
    original_unit: str | None = Field(default=None, max_length=40)
    tax_included: bool | None = None
    budget_period: str | None = Field(default=None, max_length=120)
    budget_status: str = Field(default="missing", max_length=40)
    budget_basis: str | None = Field(default=None, max_length=4_000)
    evidence_status: str = Field(default="missing", max_length=40)
    content_item_ids: list[str] = Field(default_factory=list, max_length=500)


class TenderDocumentGroupInput(BaseModel):
    id: str | None = None
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=2, max_length=500)
    procurement_category: str = Field(default="other", max_length=120)
    business_subcategory: str | None = Field(default=None, max_length=120)
    procurement_method: str = Field(default="public_tender", max_length=80)
    organization_method: str | None = Field(default=None, max_length=120)
    scope: str = Field(min_length=2, max_length=20_000)
    exclusions: str | None = Field(default=None, max_length=10_000)
    deliverables: list[Any] = Field(default_factory=list, max_length=200)
    implementation_period: str | None = Field(default=None, max_length=160)
    rationale: str = Field(min_length=2, max_length=8_000)
    template_id: str | None = None
    template_version: int | None = Field(default=None, ge=1)
    template_match_basis: str | None = Field(default=None, max_length=4_000)
    status: Literal["active", "excluded"] = "active"
    package_ids: list[str] = Field(min_length=1, max_length=100)


class ProcurementPlanStructureUpdate(BaseModel):
    revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=2, max_length=300)
    packages: list[ProcurementPackageInput] = Field(min_length=1, max_length=200)
    document_groups: list[TenderDocumentGroupInput] = Field(default_factory=list, max_length=100)


class ProcurementPlanConfirmRequest(BaseModel):
    revision: int = Field(ge=1)
    decision_note: str = Field(min_length=2, max_length=4_000)


class EnsureDefaultGroupingRequest(BaseModel):
    """Explicit user action to materialize document groups. No strategy ⇒ no-op."""

    strategy: Literal["one_package_one_document", "shared_single_document"] | None = None


class ProcurementIssueResolveRequest(BaseModel):
    revision: int = Field(ge=1)
    resolution: str = Field(min_length=2, max_length=4_000)


class ProcurementBatchGenerationRequest(BaseModel):
    group_ids: list[str] = Field(min_length=1, max_length=100)
    idempotency_key: str = Field(min_length=8, max_length=120)


class ProcurementGenerationBatchView(ORMModel):
    id: str
    project_id: str
    plan_id: str
    status: str
    idempotency_key: str
    total_count: int
    succeeded_count: int
    failed_count: int
    jobs: list[GenerationJobView]
    revision: int


class ProcurementRuleSetCreate(BaseModel):
    key: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=2, max_length=300)
    applicable_subject: str | None = Field(default=None, max_length=160)
    region: str | None = Field(default=None, max_length=160)
    funding_nature: str | None = Field(default=None, max_length=160)
    source_name: str = Field(min_length=2, max_length=500)
    source_url: str | None = Field(default=None, max_length=1_000)
    effective_date: date | None = None
    expiry_date: date | None = None
    rules_json: dict[str, Any] = Field(default_factory=dict)


class ProcurementRuleSetPublishRequest(BaseModel):
    revision: int = Field(ge=1)


class ProcurementRuleSetView(ORMModel):
    id: str
    key: str
    name: str
    version: int
    status: str
    applicable_subject: str | None
    region: str | None
    funding_nature: str | None
    source_name: str
    source_url: str | None
    effective_date: date | None
    expiry_date: date | None
    rules_json: dict[str, Any]
    revision: int


class ContentBlockPatch(BaseModel):
    content: Any
    reviewed: bool = False
    revision: int = Field(ge=1)


class AITextOptimizeRequest(BaseModel):
    selected_text: str = Field(min_length=1, max_length=12_000)
    prompt: str = Field(default="", max_length=2_000)
    action: Literal["polish", "rewrite", "expand", "simplify"] = "polish"


class AITextOptimizeResponse(BaseModel):
    optimized_prompt: str
    suggestion: str
    provider: str
    model: str
    prompt_version: str


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
