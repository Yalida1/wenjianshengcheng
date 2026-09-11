from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import defaultdict, deque
from datetime import date
from decimal import Decimal
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Query, Request, Response, UploadFile
from fastapi import File as UploadMarker
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .audit import record_audit
from .config import get_settings
from .dependencies import (
    CurrentUser,
    DbSession,
    require_permission,
    require_project_access,
    user_permission_codes,
)
from .errors import APIError
from .field_catalog import BASE_FIELD_DEFINITIONS, default_rules_for_field
from .models import (
    AuditLog,
    ComparisonItem,
    ComparisonRun,
    Document,
    DocumentBlock,
    DocumentComment,
    DocumentContentBlock,
    DocumentFormatProfile,
    DocumentSection,
    DocumentVersion,
    ExportArtifact,
    ExportJob,
    FieldConfirmation,
    FieldConflict,
    FieldDefinition,
    FieldEvidence,
    FieldSnapshot,
    FieldValue,
    File,
    FileParseJob,
    FileVersion,
    FinalizationRecord,
    GenerationEvent,
    GenerationJob,
    GenerationJobStep,
    ParsedDocument,
    ParsedTable,
    Permission,
    ProcurementAnalysisRun,
    ProcurementGenerationBatch,
    ProcurementIssue,
    ProcurementPlan,
    ProcurementRuleSet,
    Project,
    ProjectMember,
    ProjectStage,
    Role,
    Template,
    TemplateExtractionJob,
    TemplateSection,
    TemplateVariable,
    TemplateVersion,
    TenderDocumentGroup,
    User,
    UserRole,
    ValidationIssue,
    ValidationRun,
    utc_now,
)
from .schemas import (
    AITextOptimizeRequest,
    AITextOptimizeResponse,
    ApplicableFieldsResponse,
    ApplicableFieldView,
    CommentCreate,
    CommentResolve,
    ComparisonRequest,
    ContentBlockPatch,
    ContractPaymentCheck,
    ExportRequest,
    FieldCandidateExtractionView,
    FieldConfirmationRequest,
    FieldDefinitionCreate,
    FieldDefinitionPatch,
    FieldDefinitionView,
    FieldValueCreate,
    FieldValuePatch,
    FieldValueView,
    FileVersionView,
    FileView,
    FinalizeRequest,
    FormatProfileCreate,
    FormatProfileView,
    GenerationJobView,
    GenerationRequest,
    LoginRequest,
    OrganizationView,
    Page,
    ParseJobView,
    ProcurementAnalysisRequest,
    ProcurementAnalysisRunView,
    ProcurementBatchGenerationRequest,
    ProcurementGenerationBatchView,
    ProcurementIssueResolveRequest,
    EnsureDefaultGroupingRequest,
    ProcurementPlanConfirmRequest,
    ProcurementPlanStructureUpdate,
    ProcurementPlanView,
    ProcurementRuleSetCreate,
    ProcurementRuleSetPublishRequest,
    ProcurementRuleSetView,
    ProjectApplicableFieldsResponse,
    ProjectCreate,
    ProjectDeleteRequest,
    ProjectDeleteResult,
    ProjectMemberCreate,
    ProjectMemberView,
    ProjectPatch,
    ProjectView,
    SessionView,
    StageSourceOption,
    StageSourceRequest,
    StageView,
    TemplateConfigErrorView,
    TemplateCreate,
    TemplateExtractionConfirmRequest,
    TemplateExtractionJobView,
    TemplateVersionCreate,
    TemplateVersionView,
    TemplateView,
    UserCreate,
    UserView,
    ValidationIssueResolve,
    ValidationIssueView,
    ValidationRunView,
)
from .security import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    create_session_token,
    new_csrf_token,
    parse_session_token,
    verify_password,
)
from .services.auto_draft import build_file_auto_draft_job
from .services.exporting import export_filename
from .services.generation import build_generation_job, document_version_sha256
from .services.procurement_planning import (
    build_analysis_run,
    confirm_plan,
    ensure_default_document_groups,
    group_snapshot,
    plan_view,
    recalculate_plan,
    replace_plan_structure,
)
from .services.project_deletion import delete_project_graph
from .services.providers import (
    TEMPLATE_EXTRACTION_PROMPT_VERSION,
    TEXT_OPTIMIZATION_PROMPT_VERSION,
    get_provider,
)
from .services.section_tree import validate_parent_selection
from .services.storage import (
    get_storage,
    object_key,
    safe_filename,
    sha256_bytes,
    validate_upload,
)
from .services.template_extraction import build_candidate_template_docx
from .services.templates import DEMO_TEMPLATE_CONTENT_TYPE, preflight_docx_template
from .services.validation import validate_contract_payments, validate_document_version
from .tasks import (
    enqueue_procurement_analysis,
    export_document_task,
    extract_template_task,
    generate_document_task,
    parse_file_task,
)
from .template_catalog import NATIONAL_OFFICIAL_TEXT

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger(__name__)
auth_router = APIRouter(prefix="/auth", tags=["auth"])
project_router = APIRouter(prefix="/projects", tags=["projects"])
file_router = APIRouter(prefix="/files", tags=["files"])
field_router = APIRouter(prefix="/field-values", tags=["fields"])
template_router = APIRouter(prefix="/templates", tags=["templates"])
template_extraction_router = APIRouter(prefix="/template-extractions", tags=["templates"])
generation_router = APIRouter(prefix="/generation-jobs", tags=["generation"])
document_router = APIRouter(prefix="/documents", tags=["documents"])
validation_router = APIRouter(prefix="/validation-runs", tags=["validation"])
export_router = APIRouter(prefix="/exports", tags=["exports"])
system_router = APIRouter(tags=["system"])
comparison_router = APIRouter(prefix="/comparisons", tags=["comparisons"])
format_profile_router = APIRouter(prefix="/format-profiles", tags=["templates"])
procurement_router = APIRouter(tags=["procurement-planning"])

STAGES = ("requirement", "feasibility", "tender", "contract")
STAGE_INDEX = {stage: index for index, stage in enumerate(STAGES)}
MUTATION_ROLES = {
    "system_admin",
    "template_admin",
    "project_editor",
    "reviewer",
}
FORBIDDEN_FIELD_MAPPINGS = {
    ("feasibility", "total_investment", "tender", "procurement_budget"),
    ("feasibility", "total_investment", "tender", "maximum_price"),
    ("feasibility", "total_investment", "contract", "final_contract_amount"),
    ("tender", "maximum_price", "contract", "final_contract_amount"),
    ("requirement", "project_period", "contract", "contract_duration"),
    ("feasibility", "project_period", "contract", "contract_duration"),
    ("feasibility", "construction_scope", "tender", "procurement_scope"),
    ("feasibility", "construction_scope", "contract", "contract_scope"),
}
NO_BID_BOND_VALUE = "本项目不要求投标保证金"
_login_attempts: dict[str, deque[float]] = defaultdict(deque)


def _rate_limit_login(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    attempts = _login_attempts[key]
    while attempts and now - attempts[0] > 60:
        attempts.popleft()
    if len(attempts) >= 10:
        raise APIError(429, "rate_limited", "登录尝试过于频繁，请稍后再试")
    attempts.append(now)


def _set_auth_cookies(response: Response, user: User) -> tuple[str, int]:
    settings = get_settings()
    token = create_session_token(user.id, user.organization_id, user.session_version)
    claims = parse_session_token(token)
    if claims is None:
        raise RuntimeError("Failed to create session")
    csrf = new_csrf_token()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf,
        max_age=settings.session_ttl_seconds,
        httponly=False,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return csrf, claims.expires_at


@auth_router.post("/login", response_model=SessionView)
def login(payload: LoginRequest, request: Request, response: Response, db: DbSession) -> SessionView:
    _rate_limit_login(request)
    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.strip().lower()))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise APIError(401, "invalid_credentials", "账号或密码错误")
    csrf, expires_at = _set_auth_cookies(response, user)
    record_audit(db, request, user, "auth.login", "user", user.id)
    db.commit()
    return SessionView(user=UserView.model_validate(user), csrf_token=csrf, expires_at=expires_at)


@auth_router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession, user: CurrentUser) -> None:
    user.session_version += 1
    record_audit(db, request, user, "auth.logout", "user", user.id)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


@auth_router.post("/refresh", response_model=SessionView)
def refresh_session(response: Response, user: CurrentUser) -> SessionView:
    csrf, expires_at = _set_auth_cookies(response, user)
    return SessionView(user=UserView.model_validate(user), csrf_token=csrf, expires_at=expires_at)


@auth_router.get("/me", response_model=UserView)
def me(user: CurrentUser) -> User:
    return user


@project_router.get("", response_model=Page)
def list_projects(
    db: DbSession,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> Page:
    base = select(Project).where(Project.organization_id == user.organization_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(
        db.scalars(base.order_by(Project.updated_at.desc()).offset((page - 1) * page_size).limit(page_size))
    )
    return Page(
        items=[ProjectView.model_validate(item).model_dump() for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


def _allocate_project_code(db: DbSession, organization_id: str, preferred: str | None) -> str:
    """Allocate a unique project code; preferred may be None for temporary TMP-* codes."""
    candidates: list[str] = []
    if preferred and preferred.strip():
        candidates.append(preferred.strip())
    # Temporary codes until source materials are parsed and backfilled.
    stamp = int(time.time() * 1000)
    candidates.append(f"TMP-{stamp}")
    for index in range(1, 8):
        candidates.append(f"TMP-{stamp}-{index}")
    for code in candidates:
        exists = db.scalar(
            select(Project.id).where(
                Project.organization_id == organization_id,
                Project.code == code,
            )
        )
        if exists is None:
            return code
    raise APIError(409, "project_code_conflict", "无法分配唯一项目编号，请稍后重试")


@project_router.post("", response_model=ProjectView, status_code=201)
def create_project(
    payload: ProjectCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.create"))],
) -> Project:
    data = payload.model_dump()
    data["code"] = _allocate_project_code(db, user.organization_id, data.get("code"))
    project = Project(
        organization_id=user.organization_id,
        **data,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(project)
    db.flush()
    db.add(
        ProjectMember(
            organization_id=user.organization_id,
            project_id=project.id,
            user_id=user.id,
            role_key="owner",
            created_by=user.id,
            updated_by=user.id,
        )
    )
    for stage in STAGES:
        db.add(
            ProjectStage(
                organization_id=user.organization_id,
                project_id=project.id,
                stage=stage,
                created_by=user.id,
                updated_by=user.id,
            )
        )
    record_audit(
        db,
        request,
        user,
        "project.create",
        "project",
        project.id,
        after={"code": project.code, "name": project.name},
    )
    db.commit()
    db.refresh(project)
    return project


@project_router.get("/{project_id}", response_model=ProjectView)
def get_project(project_id: str, db: DbSession, user: CurrentUser) -> Project:
    return require_project_access(db, user, project_id)


@project_router.patch("/{project_id}", response_model=ProjectView)
def update_project(
    project_id: str,
    payload: ProjectPatch,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> Project:
    project = require_project_access(db, user, project_id)
    if project.revision != payload.revision:
        raise APIError(
            409,
            "revision_conflict",
            "项目已被其他用户修改",
            details={"expected": payload.revision, "actual": project.revision},
        )
    before = {
        "code": project.code,
        "name": project.name,
        "description": project.description,
        "status": project.status,
    }
    updates = payload.model_dump(exclude={"revision"}, exclude_none=True)
    if "code" in updates and updates["code"] != project.code:
        conflict = db.scalar(
            select(Project.id).where(
                Project.organization_id == project.organization_id,
                Project.code == updates["code"],
                Project.id != project.id,
            )
        )
        if conflict is not None:
            raise APIError(409, "project_code_conflict", "项目编号已被本组织其他项目使用")
    for key, value in updates.items():
        setattr(project, key, value)
    project.revision += 1
    project.updated_by = user.id
    record_audit(
        db,
        request,
        user,
        "project.update",
        "project",
        project.id,
        before=before,
        after={
            "code": project.code,
            "name": project.name,
            "description": project.description,
            "status": project.status,
        },
    )
    db.commit()
    db.refresh(project)
    return project


@project_router.delete("/{project_id}", response_model=ProjectDeleteResult)
def delete_project(
    project_id: str,
    payload: ProjectDeleteRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("system.admin"))],
) -> ProjectDeleteResult:
    project = db.scalar(
        select(Project)
        .where(
            Project.id == project_id,
            Project.organization_id == user.organization_id,
        )
        .with_for_update()
    )
    if project is None:
        raise APIError(404, "project_not_found", "项目不存在")
    if project.revision != payload.revision:
        raise APIError(
            409,
            "revision_conflict",
            "项目已被其他用户修改，请刷新后重试",
            details={"expected": payload.revision, "actual": project.revision},
        )
    if payload.confirmation_code != project.code:
        raise APIError(422, "project_confirmation_mismatch", "输入的项目编号不正确")

    before = {
        "code": project.code,
        "name": project.name,
        "status": project.status,
        "revision": project.revision,
    }
    storage_keys = delete_project_graph(db, project)
    record_audit(
        db,
        request,
        user,
        "project.delete",
        "project",
        project_id,
        before=before,
        metadata={"storage_object_count": len(storage_keys)},
    )
    db.commit()

    cleanup_failed = 0
    storage = get_storage()
    for key in storage_keys:
        try:
            storage.delete(key)
        except Exception:  # noqa: BLE001 - database deletion must remain committed
            cleanup_failed += 1
            logger.exception("Failed to delete project storage object", extra={"project_id": project_id})
    return ProjectDeleteResult(
        project_id=project_id,
        deleted=True,
        storage_objects_deleted=len(storage_keys) - cleanup_failed,
        storage_cleanup_failed=cleanup_failed,
    )


@project_router.get("/{project_id}/stages", response_model=list[StageView])
def list_stages(project_id: str, db: DbSession, user: CurrentUser) -> list[ProjectStage]:
    require_project_access(db, user, project_id)
    records = list(db.scalars(select(ProjectStage).where(ProjectStage.project_id == project_id)))
    return sorted(records, key=lambda item: STAGE_INDEX[item.stage])


@project_router.get("/{project_id}/members", response_model=list[ProjectMemberView])
def list_project_members(project_id: str, db: DbSession, user: CurrentUser) -> list[ProjectMember]:
    require_project_access(db, user, project_id)
    return list(
        db.scalars(
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at)
        )
    )


@project_router.post("/{project_id}/members", response_model=ProjectMemberView, status_code=201)
def add_project_member(
    project_id: str,
    payload: ProjectMemberCreate,
    request: Request,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission("project.write"))],
) -> ProjectMember:
    project = require_project_access(db, actor, project_id)
    member_user = db.get(User, payload.user_id)
    if member_user is None or member_user.organization_id != actor.organization_id:
        raise APIError(422, "invalid_project_member", "待添加用户不属于当前组织")
    existing = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == member_user.id,
        )
    )
    if existing:
        raise APIError(409, "project_member_exists", "用户已是项目成员")
    member = ProjectMember(
        organization_id=actor.organization_id,
        project_id=project.id,
        user_id=member_user.id,
        role_key=payload.role_key,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(member)
    db.flush()
    record_audit(
        db,
        request,
        actor,
        "project.member.add",
        "project_member",
        member.id,
        after={"user_id": member.user_id, "role_key": member.role_key},
    )
    db.commit()
    return member


@project_router.get("/{project_id}/stages/{stage}/sources", response_model=list[StageSourceOption])
def list_stage_sources(
    project_id: str, stage: str, db: DbSession, user: CurrentUser
) -> list[StageSourceOption]:
    _validate_stage(stage)
    require_project_access(db, user, project_id)
    options: list[StageSourceOption] = []
    uploaded = db.execute(
        select(File, FileVersion)
        .join(FileVersion, FileVersion.file_id == File.id)
        .where(File.project_id == project_id)
        .order_by(File.created_at.desc(), FileVersion.version.desc())
    ).all()
    for file_record, version in uploaded:
        options.append(
            StageSourceOption(
                id=version.id,
                source_type="uploaded_file",
                label=f"{file_record.original_name} · V{version.version}",
                version=version.version,
                sha256=version.sha256,
                status=file_record.status,
            )
        )
    if STAGE_INDEX[stage] > 0:
        expected_stage = STAGES[STAGE_INDEX[stage] - 1]
        rows = db.execute(
            select(Document, DocumentVersion)
            .join(DocumentVersion, DocumentVersion.document_id == Document.id)
            .where(
                Document.project_id == project_id,
                Document.stage == expected_stage,
                DocumentVersion.status == "finalized",
                DocumentVersion.immutable.is_(True),
            )
            .order_by(DocumentVersion.version.desc())
        ).all()
        for document, version in rows:
            options.append(
                StageSourceOption(
                    id=version.id,
                    source_type="upstream_final",
                    label=f"{document.title} · 定稿 V{version.version}",
                    version=version.version,
                    sha256=document_version_sha256(db, version),
                    status=version.status,
                )
            )
    return options


def _validate_stage(stage: str) -> None:
    if stage not in STAGE_INDEX:
        raise APIError(404, "stage_not_found", "文件阶段不存在")


@project_router.put("/{project_id}/stages/{stage}/source", response_model=StageView)
def set_stage_source(
    project_id: str,
    stage: str,
    payload: StageSourceRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.write"))],
) -> ProjectStage:
    _validate_stage(stage)
    require_project_access(db, user, project_id)
    stage_record = db.scalar(
        select(ProjectStage).where(ProjectStage.project_id == project_id, ProjectStage.stage == stage)
    )
    if stage_record is None:
        raise APIError(404, "stage_not_found", "文件阶段不存在")
    if stage_record.revision != payload.revision:
        raise APIError(409, "revision_conflict", "阶段来源已被修改")
    if payload.source_type == "uploaded_file":
        file_version = db.get(FileVersion, payload.source_file_version_id)
        source_file = db.get(File, file_version.file_id) if file_version else None
        if source_file is None or source_file.project_id != project_id:
            raise APIError(422, "invalid_stage_source", "上传文件不属于当前项目")
    else:
        if STAGE_INDEX[stage] == 0:
            raise APIError(422, "invalid_stage_source", "第一阶段没有可选的上游定稿文件")
        version = db.get(DocumentVersion, payload.source_file_version_id)
        document = db.get(Document, version.document_id) if version else None
        expected_stage = STAGES[STAGE_INDEX[stage] - 1]
        if (
            version is None
            or document is None
            or document.project_id != project_id
            or document.stage != expected_stage
            or version.status != "finalized"
            or not version.immutable
        ):
            raise APIError(422, "invalid_stage_source", "所选文件不是上一阶段的有效定稿版本")
    before = {
        "source_type": stage_record.source_type,
        "source_file_version_id": stage_record.source_file_version_id,
    }
    stage_record.source_type = payload.source_type
    stage_record.source_file_version_id = payload.source_file_version_id
    stage_record.status = "source_ready"
    stage_record.revision += 1
    stage_record.updated_by = user.id
    if stage == "tender" and before["source_file_version_id"] != payload.source_file_version_id:
        affected_plans = list(
            db.scalars(
                select(ProcurementPlan).where(
                    ProcurementPlan.project_id == project_id,
                    ProcurementPlan.source_version_id != payload.source_file_version_id,
                    ProcurementPlan.status.in_(["draft", "confirmed"]),
                )
            )
        )
        affected_plan_ids = [item.id for item in affected_plans]
        for plan in affected_plans:
            plan.status = "stale"
            plan.draft_generation_allowed = False
            plan.finalization_allowed = False
            plan.revision += 1
            plan.updated_by = user.id
        if affected_plan_ids:
            for document in db.scalars(
                select(Document).where(Document.procurement_plan_id.in_(affected_plan_ids))
            ):
                document.status = "stale"
                document.revision += 1
                document.updated_by = user.id
    record_audit(
        db,
        request,
        user,
        "stage.source.update",
        "project_stage",
        stage_record.id,
        before=before,
        after={
            "source_type": stage_record.source_type,
            "source_file_version_id": stage_record.source_file_version_id,
        },
    )
    db.commit()
    db.refresh(stage_record)
    return stage_record


@file_router.post("", response_model=FileView, status_code=201)
async def upload_file(
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.write"))],
    upload: Annotated[UploadFile, UploadMarker()],
    project_id: Annotated[str, Query(...)],
    stage: Annotated[str, Query(...)],
    auto_generate_draft: Annotated[bool, Query()] = False,
) -> File:
    _validate_stage(stage)
    if auto_generate_draft and stage != "tender":
        raise APIError(
            422,
            "auto_draft_stage_unsupported",
            "当前仅支持从可研材料自动生成招标文件草稿",
        )
    require_project_access(db, user, project_id)
    content = await upload.read(get_settings().max_upload_bytes + 1)
    extension, mime_type = validate_upload(upload.filename or "upload", upload.content_type, content)
    file_record = File(
        organization_id=user.organization_id,
        project_id=project_id,
        stage=stage,
        original_name=safe_filename(upload.filename or f"upload{extension}"),
        extension=extension,
        mime_type=mime_type,
        size_bytes=len(content),
        status="uploaded",
        auto_generate_draft=auto_generate_draft,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(file_record)
    db.flush()
    key = object_key(user.organization_id, file_record.id, 1, file_record.original_name)
    get_storage().put(key, content, mime_type)
    version = FileVersion(
        organization_id=user.organization_id,
        file_id=file_record.id,
        version=1,
        sha256=sha256_bytes(content),
        storage_key=key,
        size_bytes=len(content),
        mime_type=mime_type,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(version)
    db.flush()
    parse_job = FileParseJob(
        organization_id=user.organization_id,
        file_version_id=version.id,
        status="queued",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(parse_job)
    record_audit(
        db,
        request,
        user,
        "file.upload",
        "file",
        file_record.id,
        after={
            "name": file_record.original_name,
            "sha256": version.sha256,
            "stage": stage,
            "auto_generate_draft": auto_generate_draft,
        },
    )
    db.commit()
    result = parse_file_task.delay(parse_job.id)
    refreshed = db.get(FileParseJob, parse_job.id)
    if refreshed and refreshed.task_id is None:
        refreshed.task_id = result.id
        db.commit()
    db.refresh(file_record)
    return file_record


@file_router.get("", response_model=list[FileView])
def list_files(
    project_id: str,
    stage: str,
    db: DbSession,
    user: CurrentUser,
) -> list[File]:
    _validate_stage(stage)
    require_project_access(db, user, project_id)
    return list(
        db.scalars(
            select(File)
            .where(File.project_id == project_id, File.stage == stage)
            .order_by(File.created_at.desc())
        )
    )


@file_router.get("/{file_id}", response_model=FileView)
def get_file(file_id: str, db: DbSession, user: CurrentUser) -> File:
    file_record = db.get(File, file_id)
    if file_record is None or file_record.organization_id != user.organization_id:
        raise APIError(404, "file_not_found", "文件不存在")
    if file_record.project_id:
        require_project_access(db, user, file_record.project_id)
    return file_record


@file_router.get("/{file_id}/versions", response_model=list[FileVersionView])
def list_file_versions(file_id: str, db: DbSession, user: CurrentUser) -> list[FileVersion]:
    file_record = get_file(file_id, db, user)
    return list(
        db.scalars(
            select(FileVersion)
            .where(FileVersion.file_id == file_record.id)
            .order_by(FileVersion.version.desc())
        )
    )


@file_router.get("/{file_id}/download")
def download_file(file_id: str, db: DbSession, user: CurrentUser) -> StreamingResponse:
    file_record = get_file(file_id, db, user)
    version = db.scalar(
        select(FileVersion).where(
            FileVersion.file_id == file_id, FileVersion.version == file_record.latest_version
        )
    )
    if version is None:
        raise APIError(404, "file_version_not_found", "文件版本不存在")
    content = get_storage().get(version.storage_key)
    return StreamingResponse(
        iter([content]),
        media_type=version.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{file_record.original_name}"'},
    )


@file_router.get("/{file_id}/preview")
def preview_file(file_id: str, db: DbSession, user: CurrentUser) -> StreamingResponse:
    file_record = get_file(file_id, db, user)
    version = db.scalar(
        select(FileVersion).where(
            FileVersion.file_id == file_id,
            FileVersion.version == file_record.latest_version,
        )
    )
    if version is None:
        raise APIError(404, "file_version_not_found", "文件版本不存在")
    if file_record.extension not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise APIError(415, "preview_not_supported", "当前文件类型不支持浏览器内预览")
    return StreamingResponse(
        iter([get_storage().get(version.storage_key)]),
        media_type=version.mime_type,
        headers={"Content-Disposition": f'inline; filename="{file_record.original_name}"'},
    )


@file_router.get("/{file_id}/parse-jobs", response_model=list[ParseJobView])
def list_parse_jobs(file_id: str, db: DbSession, user: CurrentUser) -> list[FileParseJob]:
    file_record = get_file(file_id, db, user)
    versions = list(db.scalars(select(FileVersion.id).where(FileVersion.file_id == file_record.id)))
    if not versions:
        return []
    return list(
        db.scalars(
            select(FileParseJob)
            .where(FileParseJob.file_version_id.in_(versions))
            .order_by(FileParseJob.created_at.desc())
        )
    )


@file_router.post("/{file_id}/field-candidates", response_model=FieldCandidateExtractionView)
def extract_file_field_candidates(
    file_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.write"))],
) -> FieldCandidateExtractionView:
    file_record = get_file(file_id, db, user)
    if not file_record.project_id or not file_record.stage:
        raise APIError(422, "file_not_bound_to_stage", "文件未关联项目阶段")
    version = db.scalar(
        select(FileVersion).where(
            FileVersion.file_id == file_record.id,
            FileVersion.version == file_record.latest_version,
        )
    )
    if version is None:
        raise APIError(404, "file_version_not_found", "文件版本不存在")
    blocks = list(
        db.scalars(
            select(DocumentBlock)
            .where(DocumentBlock.file_version_id == version.id)
            .order_by(DocumentBlock.sequence)
        )
    )
    if file_record.status != "parsed" or not blocks:
        raise APIError(409, "file_not_parsed", "文件解析完成后才能提取字段候选")
    from .services.incremental_extraction import extract_file_field_candidates_idempotent

    summary = extract_file_field_candidates_idempotent(
        db,
        file_record=file_record,
        version=version,
        blocks=blocks,
        actor_id=user.id,
    )
    parsed_document = db.scalar(select(ParsedDocument).where(ParsedDocument.file_version_id == version.id))
    if parsed_document:
        parsed_document.metadata_json = {
            **(parsed_document.metadata_json or {}),
            "field_extraction": summary,
            "field_extraction_refresh_reason": "manual_field_candidates",
        }
    record_audit(
        db,
        request,
        user,
        "file.fields.extract",
        "file",
        file_record.id,
        after=summary,
    )
    db.commit()
    return FieldCandidateExtractionView(
        file_id=file_record.id,
        file_version_id=version.id,
        created=int(summary.get("created", 0)),
        existing=int(summary.get("existing", 0)),
        skipped=int(summary.get("skipped", 0)),
        revised=int(summary.get("revised", 0)),
        conflicts=int(summary.get("conflicts", 0)),
        created_keys=list(summary.get("created_keys", [])),
        existing_keys=list(summary.get("existing_keys", [])),
        skipped_keys=list(summary.get("skipped_keys", [])),
        revised_keys=list(summary.get("revised_keys", [])),
    )


@file_router.post("/{file_id}/auto-draft", response_model=GenerationJobView, status_code=202)
def start_file_auto_draft(
    file_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> GenerationJob:
    file_record = get_file(file_id, db, user)
    version = db.scalar(
        select(FileVersion).where(
            FileVersion.file_id == file_record.id,
            FileVersion.version == file_record.latest_version,
        )
    )
    if version is None:
        raise APIError(404, "file_version_not_found", "文件版本不存在")
    job = build_file_auto_draft_job(
        db,
        file_record=file_record,
        version=version,
        actor_id=user.id,
    )
    record_audit(
        db,
        request,
        user,
        "file.auto_draft.start",
        "generation_job",
        job.id,
        after={"file_id": file_record.id, "automatic": True},
    )
    db.commit()
    if job.status not in {"succeeded", "failed", "cancelled"}:
        result = generate_document_task.delay(job.id)
        db.expire_all()
        refreshed = db.get(GenerationJob, job.id)
        if refreshed and refreshed.task_id is None:
            refreshed.task_id = result.id
            db.commit()
    refreshed = db.get(GenerationJob, job.id)
    if refreshed is None:
        raise APIError(500, "generation_job_lost", "自动草稿生成任务创建失败")
    return refreshed


@router.get("/parse-jobs/{parse_job_id}", response_model=ParseJobView, tags=["files"])
def get_parse_job(parse_job_id: str, db: DbSession, user: CurrentUser) -> FileParseJob:
    job = db.get(FileParseJob, parse_job_id)
    if job is None or job.organization_id != user.organization_id:
        raise APIError(404, "parse_job_not_found", "解析任务不存在")
    version = db.get(FileVersion, job.file_version_id)
    file_record = db.get(File, version.file_id) if version else None
    if file_record and file_record.project_id:
        require_project_access(db, user, file_record.project_id)
    return job


@router.get("/parse-jobs/{parse_job_id}/result", response_model=dict[str, Any], tags=["files"])
def get_parse_result(parse_job_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    job = get_parse_job(parse_job_id, db, user)
    if job.status not in {"succeeded", "needs_ocr"}:
        raise APIError(409, "parse_not_ready", "解析结果尚未就绪")
    parsed = db.scalar(select(ParsedDocument).where(ParsedDocument.parse_job_id == job.id))
    blocks = list(
        db.scalars(
            select(DocumentBlock)
            .where(DocumentBlock.file_version_id == job.file_version_id)
            .order_by(DocumentBlock.sequence)
        )
    )
    tables = (
        list(
            db.scalars(
                select(ParsedTable)
                .where(ParsedTable.parsed_document_id == parsed.id)
                .order_by(ParsedTable.sequence)
            )
        )
        if parsed
        else []
    )
    return {
        "parse_job_id": job.id,
        "status": job.status,
        "needs_ocr": job.needs_ocr,
        "parsed_document_id": parsed.id if parsed else None,
        "metadata": parsed.metadata_json if parsed else {},
        "blocks": [
            {
                "id": block.id,
                "sequence": block.sequence,
                "kind": block.kind,
                "text": block.text,
                "page_number": block.page_number,
                "section_path": block.section_path,
                "locator": block.locator,
            }
            for block in blocks
        ],
        "tables": [
            {"id": table.id, "sequence": table.sequence, "rows": table.rows, "locator": table.locator}
            for table in tables
        ],
    }


@router.post("/parse-jobs/{parse_job_id}/retry", response_model=ParseJobView, tags=["files"])
def retry_parse_job(parse_job_id: str, request: Request, db: DbSession, user: CurrentUser) -> FileParseJob:
    job = get_parse_job(parse_job_id, db, user)
    if "project.write" not in user_permission_codes(db, user):
        raise APIError(403, "forbidden", "缺少权限：project.write")
    if job.status not in {"failed", "needs_ocr"}:
        raise APIError(409, "parse_job_not_retryable", "当前解析任务不能重试")
    job.status = "queued"
    job.error = None
    job.revision += 1
    record_audit(db, request, user, "file.parse.retry", "file_parse_job", job.id)
    db.commit()
    parse_file_task.delay(job.id)
    db.expire_all()
    refreshed = db.get(FileParseJob, job.id)
    if refreshed is None:
        raise APIError(500, "parse_job_lost", "解析任务不存在")
    return refreshed


def _field_view(db: Session, field: FieldValue) -> FieldValueView:
    evidence = list(db.scalars(select(FieldEvidence).where(FieldEvidence.field_value_id == field.id)))
    return FieldValueView.model_validate(field).model_copy(update={"evidence": [item for item in evidence]})


@field_router.get("", response_model=list[FieldValueView])
def list_field_values(
    project_id: str,
    stage: str,
    db: DbSession,
    user: CurrentUser,
) -> list[FieldValueView]:
    _validate_stage(stage)
    require_project_access(db, user, project_id)
    fields = list(
        db.scalars(
            select(FieldValue)
            .where(
                FieldValue.project_id == project_id,
                FieldValue.stage == stage,
                FieldValue.is_current.is_(True),
            )
            .order_by(FieldValue.criticality, FieldValue.field_key)
        )
    )
    return [_field_view(db, field) for field in fields]


@router.get("/field-definitions", response_model=list[FieldDefinitionView], tags=["fields"])
def list_field_definitions(
    db: DbSession,
    user: CurrentUser,
    stage: str | None = None,
    include_inactive: bool = False,
) -> list[FieldDefinition]:
    stmt = select(FieldDefinition).where(FieldDefinition.organization_id == user.organization_id)
    if stage:
        _validate_stage(stage)
        stmt = stmt.where(FieldDefinition.stage == stage)
    if not include_inactive:
        stmt = stmt.where(FieldDefinition.is_active.is_(True))
    return list(db.scalars(stmt.order_by(FieldDefinition.stage, FieldDefinition.field_key)))


def _applicable_fields_response(result: Any) -> ApplicableFieldsResponse:
    from .services.applicable_fields import ApplicableFieldsResult

    assert isinstance(result, ApplicableFieldsResult)
    return ApplicableFieldsResponse(
        document_group_id=result.document_group_id,
        profile=result.profile,
        resolution_source=result.resolution_source,
        source_template_id=result.source_template_id,
        source_template_version=result.source_template_version,
        setup_incomplete=result.setup_incomplete,
        setup_incomplete_reason=result.setup_incomplete_reason,
        template_config_errors=[
            TemplateConfigErrorView(variable_key=item.variable_key, message=item.message)
            for item in result.template_config_errors
        ],
        fields=[ApplicableFieldView(**item) for item in result.as_dict()["fields"]],
    )


def _refresh_tender_field_candidates(
    db: Session,
    *,
    project_id: str,
    organization_id: str,
    actor_id: str,
    reason: str,
    document_group_id: str | None = None,
) -> dict[str, Any]:
    from .services.incremental_extraction import refresh_field_candidates_from_parsed_blocks

    return refresh_field_candidates_from_parsed_blocks(
        db,
        project_id=project_id,
        organization_id=organization_id,
        actor_id=actor_id,
        stage="tender",
        reason=reason,
        document_group_id=document_group_id,
    )


@project_router.get(
    "/{project_id}/document-groups/{group_id}/applicable-fields",
    response_model=ApplicableFieldsResponse,
    tags=["fields"],
)
def get_document_group_applicable_fields(
    project_id: str,
    group_id: str,
    db: DbSession,
    user: CurrentUser,
) -> ApplicableFieldsResponse:
    require_project_access(db, user, project_id)
    from .services.applicable_fields import get_document_group_for_project, resolve_applicable_fields

    group = get_document_group_for_project(db, project_id=project_id, group_id=group_id)
    if group is None:
        raise APIError(404, "document_group_not_found", "待编制文件组不存在")
    result = resolve_applicable_fields(
        db,
        project_id=project_id,
        document_group=group,
        organization_id=user.organization_id,
    )
    return _applicable_fields_response(result)


@project_router.get(
    "/{project_id}/stages/{stage}/applicable-fields",
    response_model=ProjectApplicableFieldsResponse,
    tags=["fields"],
)
def list_stage_applicable_fields(
    project_id: str,
    stage: str,
    db: DbSession,
    user: CurrentUser,
) -> ProjectApplicableFieldsResponse:
    require_project_access(db, user, project_id)
    _validate_stage(stage)
    if stage != "tender":
        return ProjectApplicableFieldsResponse(project_id=project_id, stage=stage, groups=[])
    from .services.applicable_fields import list_project_tender_groups, resolve_applicable_fields

    groups = list_project_tender_groups(db, project_id)
    payloads: list[ApplicableFieldsResponse] = []
    for group in groups:
        result = resolve_applicable_fields(
            db,
            project_id=project_id,
            document_group=group,
            organization_id=user.organization_id,
        )
        payloads.append(_applicable_fields_response(result))
    return ProjectApplicableFieldsResponse(project_id=project_id, stage=stage, groups=payloads)


def _get_field_definition(db: Session, user: User, definition_id: str) -> FieldDefinition:
    definition = db.scalar(
        select(FieldDefinition).where(
            FieldDefinition.id == definition_id,
            FieldDefinition.organization_id == user.organization_id,
        )
    )
    if definition is None:
        raise APIError(404, "field_definition_not_found", "字段定义不存在")
    return definition


def _normalize_field_rules(
    rules: dict[str, Any] | None, *, field_key: str, field_label: str
) -> dict[str, Any]:
    from .field_catalog import merge_missing_aliases

    if rules is None:
        return default_rules_for_field(field_key, field_label)
    normalized = dict(rules)
    aliases = normalized.get("aliases")
    if not isinstance(aliases, list) or not aliases:
        return default_rules_for_field(field_key, field_label)
    cleaned = [str(item).strip() for item in aliases if str(item).strip()]
    if not cleaned:
        return default_rules_for_field(field_key, field_label)
    normalized["aliases"] = cleaned
    return merge_missing_aliases(normalized, field_key, field_label)


@router.post(
    "/field-definitions",
    response_model=FieldDefinitionView,
    status_code=201,
    tags=["fields"],
)
def create_field_definition(
    payload: FieldDefinitionCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("system.admin"))],
) -> FieldDefinition:
    _validate_stage(payload.stage)
    exists = db.scalar(
        select(FieldDefinition.id).where(
            FieldDefinition.organization_id == user.organization_id,
            FieldDefinition.stage == payload.stage,
            FieldDefinition.field_key == payload.field_key,
        )
    )
    if exists:
        raise APIError(409, "field_definition_exists", "同阶段字段键已存在")
    definition = FieldDefinition(
        organization_id=user.organization_id,
        stage=payload.stage,
        field_key=payload.field_key,
        field_label=payload.field_label,
        data_type=payload.data_type,
        unit=payload.unit,
        criticality=payload.criticality,
        required=payload.required,
        is_base=False,
        is_active=True,
        rules=_normalize_field_rules(
            payload.rules, field_key=payload.field_key, field_label=payload.field_label
        ),
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(definition)
    db.flush()
    record_audit(db, request, user, "field_definition.create", "field_definition", definition.id)
    db.commit()
    db.refresh(definition)
    return definition


@router.patch(
    "/field-definitions/{definition_id}",
    response_model=FieldDefinitionView,
    tags=["fields"],
)
def patch_field_definition(
    definition_id: str,
    payload: FieldDefinitionPatch,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("system.admin"))],
) -> FieldDefinition:
    definition = _get_field_definition(db, user, definition_id)
    if definition.revision != payload.revision:
        raise APIError(409, "revision_conflict", "字段定义已被其他用户修改")
    if payload.field_label is not None:
        definition.field_label = payload.field_label
    if payload.data_type is not None:
        definition.data_type = payload.data_type
    if payload.unit is not None or "unit" in payload.model_fields_set:
        definition.unit = payload.unit
    if payload.criticality is not None:
        definition.criticality = payload.criticality
    if payload.required is not None:
        definition.required = payload.required
    if payload.rules is not None or payload.field_label is not None:
        source_rules = payload.rules if payload.rules is not None else definition.rules
        definition.rules = _normalize_field_rules(
            source_rules if isinstance(source_rules, dict) else None,
            field_key=definition.field_key,
            field_label=definition.field_label,
        )
    definition.revision += 1
    definition.updated_by = user.id
    record_audit(db, request, user, "field_definition.update", "field_definition", definition.id)
    db.commit()
    db.refresh(definition)
    return definition


@router.post(
    "/field-definitions/{definition_id}/deactivate",
    response_model=FieldDefinitionView,
    tags=["fields"],
)
def deactivate_field_definition(
    definition_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("system.admin"))],
) -> FieldDefinition:
    definition = _get_field_definition(db, user, definition_id)
    if not definition.is_active:
        return definition
    definition.is_active = False
    definition.revision += 1
    definition.updated_by = user.id
    record_audit(db, request, user, "field_definition.deactivate", "field_definition", definition.id)
    db.commit()
    db.refresh(definition)
    return definition


@router.post(
    "/field-definitions/{definition_id}/activate",
    response_model=FieldDefinitionView,
    tags=["fields"],
)
def activate_field_definition(
    definition_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("system.admin"))],
) -> FieldDefinition:
    definition = _get_field_definition(db, user, definition_id)
    if definition.is_active:
        return definition
    definition.is_active = True
    definition.revision += 1
    definition.updated_by = user.id
    record_audit(db, request, user, "field_definition.activate", "field_definition", definition.id)
    db.commit()
    db.refresh(definition)
    return definition


@router.post(
    "/field-definitions/restore-base",
    response_model=list[FieldDefinitionView],
    tags=["fields"],
)
def restore_base_field_definitions(
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("system.admin"))],
    stage: str,
) -> list[FieldDefinition]:
    _validate_stage(stage)
    specs = BASE_FIELD_DEFINITIONS.get(stage, [])
    restored: list[FieldDefinition] = []
    for key, label, data_type, unit, criticality, required in specs:
        existing = db.scalar(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == user.organization_id,
                FieldDefinition.stage == stage,
                FieldDefinition.field_key == key,
            )
        )
        if existing is None:
            definition = FieldDefinition(
                organization_id=user.organization_id,
                stage=stage,
                field_key=key,
                field_label=label,
                data_type=data_type,
                unit=unit,
                criticality=criticality,
                required=required,
                is_base=True,
                is_active=True,
                rules=default_rules_for_field(key, label),
                created_by=user.id,
                updated_by=user.id,
            )
            db.add(definition)
            restored.append(definition)
            continue
        changed = False
        if not existing.is_active:
            existing.is_active = True
            changed = True
        if not existing.is_base:
            existing.is_base = True
            changed = True
        if changed:
            existing.revision += 1
            existing.updated_by = user.id
            restored.append(existing)
    record_audit(
        db,
        request,
        user,
        "field_definition.restore_base",
        "field_definition",
        stage,
        metadata={"restored_count": len(restored)},
    )
    db.commit()
    for item in restored:
        db.refresh(item)
    return list(
        db.scalars(
            select(FieldDefinition)
            .where(
                FieldDefinition.organization_id == user.organization_id,
                FieldDefinition.stage == stage,
                FieldDefinition.is_active.is_(True),
            )
            .order_by(FieldDefinition.field_key)
        )
    )


@router.get("/field-snapshots", response_model=list[dict[str, Any]], tags=["fields"])
def list_field_snapshots(
    project_id: str, stage: str, db: DbSession, user: CurrentUser
) -> list[dict[str, Any]]:
    _validate_stage(stage)
    require_project_access(db, user, project_id)
    snapshots = list(
        db.scalars(
            select(FieldSnapshot)
            .where(FieldSnapshot.project_id == project_id, FieldSnapshot.stage == stage)
            .order_by(FieldSnapshot.created_at.desc())
        )
    )
    return [
        {
            "id": snapshot.id,
            "stage": snapshot.stage,
            "sha256": snapshot.sha256,
            "values": snapshot.values_json,
            "created_at": snapshot.created_at,
            "revision": snapshot.revision,
        }
        for snapshot in snapshots
    ]


@router.get("/field-conflicts", response_model=list[dict[str, Any]], tags=["fields"])
def list_field_conflicts(
    project_id: str, stage: str, db: DbSession, user: CurrentUser
) -> list[dict[str, Any]]:
    _validate_stage(stage)
    require_project_access(db, user, project_id)
    conflicts = list(
        db.scalars(
            select(FieldConflict)
            .where(FieldConflict.project_id == project_id, FieldConflict.stage == stage)
            .order_by(FieldConflict.created_at.desc())
        )
    )
    return [
        {
            "id": conflict.id,
            "field_key": conflict.field_key,
            "candidate_field_value_ids": conflict.candidate_field_value_ids,
            "status": conflict.status,
            "resolution": conflict.resolution,
            "revision": conflict.revision,
        }
        for conflict in conflicts
    ]


def _add_evidence(db: Session, field: FieldValue, evidence: dict[str, Any], user: User) -> FieldEvidence:
    entry = FieldEvidence(
        organization_id=user.organization_id,
        field_value_id=field.id,
        source_file_id=evidence.get("source_file_id"),
        source_file_version_id=evidence.get("source_file_version_id"),
        document_block_id=evidence.get("document_block_id"),
        page_number=evidence.get("page_number"),
        section_path=evidence.get("section_path"),
        excerpt=evidence.get("excerpt"),
        extraction_method=evidence.get("extraction_method", "manual"),
        confidence=evidence.get("confidence"),
        metadata_json={
            key: evidence[key]
            for key in ("source_stage", "source_field_key", "source_locator")
            if key in evidence
        },
        created_by=user.id,
        updated_by=user.id,
    )
    if not any((entry.source_file_version_id, entry.document_block_id, entry.excerpt)):
        raise APIError(422, "invalid_evidence", "证据必须包含文件版本、文档块或原文片段")
    db.add(entry)
    return entry


def _reject_forbidden_mapping(stage: str, field_key: str, evidence: dict[str, Any] | None) -> None:
    if not evidence:
        return
    mapping = (
        str(evidence.get("source_stage", "")),
        str(evidence.get("source_field_key", "")),
        stage,
        field_key,
    )
    if mapping in FORBIDDEN_FIELD_MAPPINGS:
        raise APIError(
            422,
            "forbidden_field_mapping",
            "该上游字段不能直接映射为当前正式字段，必须单独提供来源或人工确认",
            details={"mapping": mapping},
        )


def _is_no_bid_bond_value(field: FieldValue) -> bool:
    if field.stage != "tender" or field.field_key.rsplit("::", 1)[-1] != "bid_bond":
        return False
    text = str(field.normalized_value if field.normalized_value is not None else field.value or "").strip()
    compact = text.replace(" ", "")
    return compact == NO_BID_BOND_VALUE or (
        "投标保证金" in compact
        and any(marker in compact for marker in ("不要求", "不收取", "不缴纳", "无需"))
    )


@field_router.post("", response_model=FieldValueView, status_code=201)
def create_field_value(
    project_id: str,
    stage: str,
    payload: FieldValueCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.write"))],
) -> FieldValueView:
    _validate_stage(stage)
    require_project_access(db, user, project_id)
    existing = db.scalar(
        select(FieldValue).where(
            FieldValue.project_id == project_id,
            FieldValue.stage == stage,
            FieldValue.field_key == payload.field_key,
            FieldValue.is_current.is_(True),
        )
    )
    if existing:
        raise APIError(409, "field_exists", "字段已存在，请使用修改接口")
    if payload.status == "user_confirmed":
        raise APIError(422, "confirmation_required", "必须通过字段确认接口形成人工确认记录")
    if payload.status == "extracted" and not payload.evidence:
        raise APIError(422, "evidence_required", "提取字段必须附带来源证据")
    _reject_forbidden_mapping(stage, payload.field_key, payload.evidence)
    data = payload.model_dump(exclude={"evidence"})
    field = FieldValue(
        organization_id=user.organization_id,
        project_id=project_id,
        stage=stage,
        **data,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(field)
    db.flush()
    if payload.evidence:
        _add_evidence(db, field, payload.evidence, user)
    record_audit(
        db,
        request,
        user,
        "field.create",
        "field_value",
        field.id,
        after={"field_key": field.field_key, "status": field.status},
    )
    db.commit()
    return _field_view(db, field)


@field_router.patch("/{field_value_id}", response_model=FieldValueView)
def update_field_value(
    field_value_id: str,
    payload: FieldValuePatch,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.write"))],
) -> FieldValueView:
    current = db.get(FieldValue, field_value_id)
    if current is None or not current.is_current:
        raise APIError(404, "field_not_found", "字段不存在")
    require_project_access(db, user, current.project_id)
    if current.revision != payload.revision:
        raise APIError(
            409,
            "revision_conflict",
            "字段已被其他用户修改",
            details={"expected": payload.revision, "actual": current.revision},
        )
    if payload.status == "user_confirmed":
        raise APIError(422, "confirmation_required", "必须通过字段确认接口形成人工确认记录")
    if payload.status == "extracted" and not payload.evidence:
        raise APIError(422, "evidence_required", "提取字段必须附带来源证据")
    _reject_forbidden_mapping(current.stage, current.field_key, payload.evidence)
    before = {"value": current.value, "status": current.status, "revision": current.revision}
    current.is_current = False
    replacement = FieldValue(
        organization_id=current.organization_id,
        project_id=current.project_id,
        stage=current.stage,
        definition_id=current.definition_id,
        field_key=current.field_key,
        field_label=current.field_label,
        data_type=current.data_type,
        value=payload.value,
        normalized_value=payload.normalized_value,
        unit=payload.unit,
        criticality=current.criticality,
        status=payload.status,
        source_type=payload.source_type,
        confidence=current.confidence,
        revision=current.revision + 1,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(replacement)
    db.flush()
    if payload.evidence:
        _add_evidence(db, replacement, payload.evidence, user)
    record_audit(
        db,
        request,
        user,
        "field.update",
        "field_value",
        replacement.id,
        before=before,
        after={
            "value": replacement.value,
            "status": replacement.status,
            "revision": replacement.revision,
        },
        metadata={"previous_field_value_id": current.id},
    )
    db.commit()
    return _field_view(db, replacement)


@field_router.post("/{field_value_id}/confirm", response_model=FieldValueView)
def confirm_field_value(
    field_value_id: str,
    payload: FieldConfirmationRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.write"))],
) -> FieldValueView:
    field = db.get(FieldValue, field_value_id)
    if field is None or not field.is_current:
        raise APIError(404, "field_not_found", "字段不存在")
    require_project_access(db, user, field.project_id)
    if field.revision != payload.revision:
        raise APIError(409, "revision_conflict", "字段已被其他用户修改")
    if field.value in (None, "", [], {}):
        raise APIError(422, "empty_field", "空值不能确认")
    if field.criticality == "P0" and field.source_type not in {
        "system_authoritative",
        "user_input",
        "extracted",
    }:
        raise APIError(422, "invalid_p0_source", "P0 字段来源不允许直接确认")
    if field.source_type == "extracted" and not payload.evidence_acknowledged:
        raise APIError(422, "evidence_not_acknowledged", "请先核对并确认来源证据")
    if _is_no_bid_bond_value(field):
        retained_basis = db.scalar(
            select(FieldEvidence.id).where(FieldEvidence.field_value_id == field.id).limit(1)
        )
        if retained_basis is None:
            raise APIError(
                422,
                "bid_bond_basis_required",
                "请先保存不收取投标保证金的确认依据",
            )
    field.status = "user_confirmed"
    field.revision += 1
    field.updated_by = user.id
    db.add(
        FieldConfirmation(
            organization_id=user.organization_id,
            field_value_id=field.id,
            confirmed_by=user.id,
            value_snapshot=field.value,
            evidence_acknowledged=payload.evidence_acknowledged,
            created_by=user.id,
            updated_by=user.id,
        )
    )
    record_audit(
        db,
        request,
        user,
        "field.confirm",
        "field_value",
        field.id,
        after={"field_key": field.field_key, "status": field.status},
    )
    db.commit()
    return _field_view(db, field)


def _validate_template_source_metadata(
    source_kind: str,
    issuing_authority: str | None,
    source_url: str | None,
) -> None:
    if source_kind == "adapted_from_official_outline" and (not issuing_authority or not source_url):
        raise APIError(
            422,
            "official_source_metadata_missing",
            "依据正式大纲适配的模板必须填写发布机关和官方来源链接",
        )
    if source_kind == "other_official_template" and not issuing_authority:
        raise APIError(
            422,
            "official_source_metadata_missing",
            "其他正式模板必须填写发布机关或确认单位",
        )
    if source_kind == NATIONAL_OFFICIAL_TEXT:
        raise APIError(
            422,
            "official_text_managed_by_platform",
            "国家正式文本由平台内置目录维护，不能作为普通生成模板新建",
        )


def _get_template_extraction_job(
    extraction_job_id: str,
    db: Session,
    user: User,
) -> TemplateExtractionJob:
    job = db.get(TemplateExtractionJob, extraction_job_id)
    if job is None or job.organization_id != user.organization_id:
        raise APIError(404, "template_extraction_not_found", "模板提取任务不存在")
    return job


def _template_view(template: Template, *, has_docx_source: bool | None = None) -> TemplateView:
    payload = TemplateView.model_validate(template).model_dump()
    if has_docx_source is not None:
        payload["has_docx_source"] = has_docx_source
    return TemplateView.model_validate(payload)


def _template_has_docx_source(db: Session, template: Template) -> bool:
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template.id,
            TemplateVersion.version == template.current_version,
        )
    )
    return bool(version and version.storage_key)


@template_extraction_router.post("", response_model=TemplateExtractionJobView, status_code=201)
async def create_template_extraction(
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
    upload: Annotated[UploadFile, UploadMarker()],
    stage: Annotated[str, Query(...)],
    authorized_external_processing: Annotated[bool, Query(...)],
) -> TemplateExtractionJob:
    _validate_stage(stage)
    if not authorized_external_processing:
        raise APIError(
            422,
            "external_processing_consent_required",
            "请先确认文件已获授权并同意发送至当前配置的模型服务",
        )
    content = await upload.read(get_settings().max_upload_bytes + 1)
    extension, mime_type = validate_upload(
        upload.filename or "finished-document.docx", upload.content_type, content
    )
    if extension != ".docx":
        raise APIError(415, "template_extraction_requires_docx", "模板反向提取当前仅支持 DOCX")
    file_record = File(
        organization_id=user.organization_id,
        project_id=None,
        stage=stage,
        original_name=safe_filename(upload.filename or "finished-document.docx"),
        extension=extension,
        mime_type=mime_type,
        size_bytes=len(content),
        status="template_extract_queued",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(file_record)
    db.flush()
    key = object_key(user.organization_id, file_record.id, 1, file_record.original_name)
    get_storage().put(key, content, mime_type)
    version = FileVersion(
        organization_id=user.organization_id,
        file_id=file_record.id,
        version=1,
        sha256=sha256_bytes(content),
        storage_key=key,
        size_bytes=len(content),
        mime_type=mime_type,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(version)
    db.flush()
    job = TemplateExtractionJob(
        organization_id=user.organization_id,
        file_version_id=version.id,
        stage=stage,
        status="queued",
        prompt_version=TEMPLATE_EXTRACTION_PROMPT_VERSION,
        result_json={},
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(job)
    db.flush()
    record_audit(
        db,
        request,
        user,
        "template.extraction.create",
        "template_extraction_job",
        job.id,
        after={"filename": file_record.original_name, "sha256": version.sha256, "stage": stage},
    )
    db.commit()
    result = extract_template_task.delay(job.id)
    db.expire_all()
    refreshed = db.get(TemplateExtractionJob, job.id)
    if refreshed and refreshed.task_id is None:
        refreshed.task_id = result.id
        db.commit()
    return db.get(TemplateExtractionJob, job.id) or job


@template_extraction_router.get("", response_model=list[TemplateExtractionJobView])
def list_template_extractions(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> list[TemplateExtractionJob]:
    return list(
        db.scalars(
            select(TemplateExtractionJob)
            .where(TemplateExtractionJob.organization_id == user.organization_id)
            .order_by(TemplateExtractionJob.created_at.desc())
        )
    )


@template_extraction_router.get("/{extraction_job_id}", response_model=TemplateExtractionJobView)
def get_template_extraction(
    extraction_job_id: str,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> TemplateExtractionJob:
    return _get_template_extraction_job(extraction_job_id, db, user)


@template_extraction_router.post("/{extraction_job_id}/retry", response_model=TemplateExtractionJobView)
def retry_template_extraction(
    extraction_job_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> TemplateExtractionJob:
    job = _get_template_extraction_job(extraction_job_id, db, user)
    if job.status != "failed":
        raise APIError(409, "template_extraction_not_retryable", "只有失败的模板提取任务可以重试")
    if job.attempt >= job.max_attempts:
        raise APIError(409, "template_extraction_attempts_exhausted", "模板提取任务已达到最大尝试次数")
    job.status = "queued"
    job.error = None
    job.finished_at = None
    job.revision += 1
    record_audit(
        db,
        request,
        user,
        "template.extraction.retry",
        "template_extraction_job",
        job.id,
        after={"attempt": job.attempt},
    )
    db.commit()
    result = extract_template_task.delay(job.id)
    db.expire_all()
    refreshed = db.get(TemplateExtractionJob, job.id)
    if refreshed:
        refreshed.task_id = result.id
        db.commit()
        return refreshed
    return job


@template_extraction_router.post("/{extraction_job_id}/confirm", response_model=TemplateView)
def confirm_template_extraction(
    extraction_job_id: str,
    payload: TemplateExtractionConfirmRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> TemplateView:
    job = _get_template_extraction_job(extraction_job_id, db, user)
    if job.confirmed_template_id:
        existing = db.get(Template, job.confirmed_template_id)
        if existing is not None:
            return _template_view(existing, has_docx_source=True)
    if job.status != "review_required":
        if job.status == "quality_rejected":
            raise APIError(
                409,
                "template_extraction_quality_rejected",
                "提取结果未通过正式模板质量门禁，不能建立或发布模板",
            )
        raise APIError(409, "template_extraction_not_ready", "模板候选尚未进入人工确认阶段")
    quality = job.result_json.get("quality") if isinstance(job.result_json, dict) else None
    if not isinstance(quality, dict) or not quality.get("passed"):
        raise APIError(
            409,
            "template_extraction_quality_rejected",
            "提取结果未通过正式模板质量门禁，不能建立或发布模板",
        )
    if job.revision != payload.revision:
        raise APIError(409, "revision_conflict", "模板提取结果已被其他用户更新")
    _validate_template_source_metadata(
        payload.source_kind,
        payload.issuing_authority,
        payload.source_url,
    )
    raw_sections = job.result_json.get("sections", [])
    raw_variables = job.result_json.get("variables", [])
    if not isinstance(raw_sections, list) or not isinstance(raw_variables, list):
        raise APIError(409, "template_extraction_result_invalid", "模板提取结果结构无效")
    selected_section_ids = set(payload.selected_section_ids)
    selected_variable_ids = set(payload.selected_variable_ids)
    sections = [
        item for item in raw_sections if isinstance(item, dict) and item.get("id") in selected_section_ids
    ]
    variables = [
        item for item in raw_variables if isinstance(item, dict) and item.get("id") in selected_variable_ids
    ]
    if len(sections) != len(selected_section_ids):
        raise APIError(422, "template_section_selection_invalid", "所选章节包含不存在的候选项")
    if len(variables) != len(selected_variable_ids):
        raise APIError(422, "template_variable_selection_invalid", "所选变量包含不存在的候选项")
    try:
        validate_parent_selection(raw_sections, selected_section_ids)
    except ValueError as exc:
        raise APIError(422, "template_section_parent_required", str(exc)) from exc
    # Preserve DFS order from extraction result.
    sections = sorted(
        sections,
        key=lambda item: next(
            (
                index
                for index, raw in enumerate(raw_sections)
                if isinstance(raw, dict) and raw.get("id") == item.get("id")
            ),
            0,
        ),
    )
    file_version = db.get(FileVersion, job.file_version_id)
    file_record = db.get(File, file_version.file_id) if file_version else None
    if file_version is None or file_record is None:
        raise APIError(409, "template_extraction_source_missing", "模板提取源文件不存在")
    source_content = get_storage().get(file_version.storage_key)
    candidate_content = build_candidate_template_docx(
        source_content,
        template_name=payload.template_name,
        source_filename=file_record.original_name,
    )
    preflight = preflight_docx_template(candidate_content)
    if not preflight.valid:
        raise APIError(
            422,
            "template_preflight_failed",
            "提取生成的候选模板预检未通过",
            details={"warnings": preflight.warnings},
        )
    template = Template(
        organization_id=user.organization_id,
        name=payload.template_name,
        stage=job.stage,
        source_kind=payload.source_kind,
        issuing_authority=payload.issuing_authority,
        document_number=payload.document_number,
        publish_year=payload.publish_year,
        source_url=payload.source_url,
        applicability=payload.applicability,
        is_builtin=False,
        generation_enabled=True,
        status="draft",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(template)
    db.flush()
    template_version = TemplateVersion(
        organization_id=user.organization_id,
        template_id=template.id,
        version=1,
        status="draft",
        format_profile={"page_size": "A4", "standard": "customer_template"},
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(template_version)
    db.flush()
    template_key = f"{user.organization_id}/templates/{template.id}/v1/template.docx"
    get_storage().put(template_key, candidate_content, DEMO_TEMPLATE_CONTENT_TYPE)
    template_version.storage_key = template_key
    template_version.sha256 = sha256_bytes(candidate_content)
    selected_block_ids = {
        str(block_id) for section in sections for block_id in section.get("source_block_ids", []) if block_id
    }
    source_blocks = {
        block.id: block
        for block in db.scalars(
            select(DocumentBlock).where(
                DocumentBlock.file_version_id == file_version.id,
                DocumentBlock.id.in_(selected_block_ids),
            )
        )
    }
    protected_title_tokens = ("投标人须知", "评标办法", "通用合同条款", "标准条款")
    used_keys: set[str] = set()
    key_to_section: dict[str, TemplateSection] = {}
    for sequence, section in enumerate(sections, 1):
        key = str(section.get("key") or f"section_{sequence}")[:120]
        if key in used_keys:
            key = f"{key[:110]}_{sequence}"
        used_keys.add(key)
        parent_key = section.get("parent_key")
        parent = key_to_section.get(str(parent_key)) if parent_key else None
        level = max(1, min(3, int(section.get("level") or (parent.level + 1 if parent else 1))))
        title = str(section.get("title") or f"章节 {sequence}")[:300]
        source_text = "\n".join(
            source_blocks[block_id].text
            for block_id in section.get("source_block_ids", [])
            if block_id in source_blocks and source_blocks[block_id].text.strip()
        )
        protected = payload.source_kind == "other_official_template" and any(
            token in title for token in protected_title_tokens
        )
        record = TemplateSection(
            organization_id=user.organization_id,
            template_version_id=template_version.id,
            sequence=sequence,
            key=key,
            title=title,
            parent_id=parent.id if parent else None,
            level=level,
            section_type="fixed_template" if protected else "editable",
            required=True,
            content=source_text if protected else None,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(record)
        db.flush()
        key_to_section[key] = record
        # Allow children that still reference the original candidate key.
        original_key = str(section.get("key") or "")
        if original_key and original_key not in key_to_section:
            key_to_section[original_key] = record
    for variable in variables:
        variable_key = str(variable.get("variable_key", ""))[:120]
        if not variable_key:
            continue
        db.add(
            TemplateVariable(
                organization_id=user.organization_id,
                template_version_id=template_version.id,
                variable_key=variable_key,
                field_key=variable_key,
                required=True,
                default_value=None,
                created_by=user.id,
                updated_by=user.id,
            )
        )
    result_json = dict(job.result_json)
    result_json["confirmation"] = {
        "selected_section_ids": payload.selected_section_ids,
        "selected_variable_ids": payload.selected_variable_ids,
        "template_id": template.id,
        "published": True,
    }
    job.result_json = result_json
    job.confirmed_template_id = template.id
    job.status = "confirmed"
    job.revision += 1
    job.updated_by = user.id
    file_record.status = "template_candidate_confirmed"
    template_version.status = "published"
    template_version.published_at = utc_now()
    template.status = "published"
    template.revision += 1
    record_audit(
        db,
        request,
        user,
        "template.extraction.confirm",
        "template_extraction_job",
        job.id,
        after={
            "template_id": template.id,
            "section_count": len(sections),
            "variable_count": len(variables),
            "source_sha256": file_version.sha256,
            "published": True,
        },
    )
    db.commit()
    return _template_view(template, has_docx_source=True)


@template_router.get("", response_model=list[TemplateView])
def list_templates(
    db: DbSession,
    user: CurrentUser,
    stage: str | None = None,
    current_only: bool = True,
    generation_only: bool = False,
    project_id: str | None = None,
) -> list[TemplateView]:
    preferred_template_ids: set[str] = set()
    if project_id:
        require_project_access(db, user, project_id)
        plan_ids = list(
            db.scalars(
                select(ProcurementPlan.id).where(
                    ProcurementPlan.project_id == project_id,
                    ProcurementPlan.status == "confirmed",
                )
            )
        )
        if plan_ids:
            preferred_template_ids = {
                template_id
                for template_id in db.scalars(
                    select(TenderDocumentGroup.template_id).where(
                        TenderDocumentGroup.plan_id.in_(plan_ids),
                        TenderDocumentGroup.template_id.is_not(None),
                    )
                )
                if template_id
            }
    stmt = select(Template).where(Template.organization_id == user.organization_id)
    if stage:
        _validate_stage(stage)
        stmt = stmt.where(Template.stage == stage)
    if current_only:
        stmt = stmt.where(Template.status == "published")
    if generation_only:
        today = date.today()
        stmt = stmt.join(
            TemplateVersion,
            (TemplateVersion.template_id == Template.id)
            & (TemplateVersion.version == Template.current_version),
        ).where(
            Template.generation_enabled.is_(True),
            TemplateVersion.status == "published",
            (TemplateVersion.effective_date.is_(None)) | (TemplateVersion.effective_date <= today),
            (TemplateVersion.expiry_date.is_(None)) | (TemplateVersion.expiry_date >= today),
        )
    templates = list(db.scalars(stmt))
    templates.sort(
        key=lambda item: (
            item.id not in preferred_template_ids,
            item.is_builtin,
            item.procurement_type is None,
            item.name,
        )
    )
    return [
        _template_view(template, has_docx_source=_template_has_docx_source(db, template))
        for template in templates
    ]


@template_router.get("/{template_id}", response_model=dict[str, Any])
def get_template(template_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    template = db.get(Template, template_id)
    if template is None or template.organization_id != user.organization_id:
        raise APIError(404, "template_not_found", "模板不存在")
    versions = list(
        db.scalars(
            select(TemplateVersion)
            .where(TemplateVersion.template_id == template.id)
            .order_by(TemplateVersion.version.desc())
        )
    )
    return {
        **TemplateView.model_validate(template).model_dump(),
        "versions": [TemplateVersionView.model_validate(version).model_dump() for version in versions],
    }


@template_router.get("/{template_id}/versions", response_model=list[TemplateVersionView])
def list_template_versions(template_id: str, db: DbSession, user: CurrentUser) -> list[TemplateVersion]:
    template = db.get(Template, template_id)
    if template is None or template.organization_id != user.organization_id:
        raise APIError(404, "template_not_found", "模板不存在")
    return list(
        db.scalars(
            select(TemplateVersion)
            .where(TemplateVersion.template_id == template.id)
            .order_by(TemplateVersion.version.desc())
        )
    )


@template_router.get("/{template_id}/versions/{version_number}/source")
def download_template_source(
    template_id: str,
    version_number: int,
    db: DbSession,
    user: CurrentUser,
) -> StreamingResponse:
    template = db.get(Template, template_id)
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template_id,
            TemplateVersion.version == version_number,
        )
    )
    if (
        template is None
        or version is None
        or template.organization_id != user.organization_id
        or version.organization_id != user.organization_id
        or not version.storage_key
    ):
        raise APIError(404, "template_source_not_found", "模板 DOCX 源不存在")
    return StreamingResponse(
        iter([get_storage().get(version.storage_key)]),
        media_type=DEMO_TEMPLATE_CONTENT_TYPE,
        headers={"Content-Disposition": f'attachment; filename="template-v{version.version}.docx"'},
    )


@template_router.post(
    "/{template_id}/versions/{version_number}/source",
    response_model=TemplateVersionView,
)
async def upload_template_source(
    template_id: str,
    version_number: int,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
    upload: Annotated[UploadFile, UploadMarker()],
) -> TemplateVersion:
    template = db.get(Template, template_id)
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template_id,
            TemplateVersion.version == version_number,
        )
    )
    if (
        template is None
        or version is None
        or template.organization_id != user.organization_id
        or version.organization_id != user.organization_id
    ):
        raise APIError(404, "template_version_not_found", "模板版本不存在")
    if template.is_builtin:
        raise APIError(409, "builtin_template_immutable", "内置模板不能直接覆盖，请创建新模板")
    if version.status == "published":
        raise APIError(409, "template_version_immutable", "已发布模板版本不可覆盖")
    content = await upload.read(get_settings().max_upload_bytes + 1)
    extension, mime = validate_upload(upload.filename or "template.docx", upload.content_type, content)
    if extension != ".docx":
        raise APIError(415, "template_must_be_docx", "模板正式源必须是 DOCX")
    preflight = preflight_docx_template(content)
    if not preflight.valid:
        raise APIError(
            422,
            "template_preflight_failed",
            "DOCX 模板预检未通过",
            details={"warnings": preflight.warnings, "placeholders": preflight.placeholders},
        )
    key = f"{user.organization_id}/templates/{template.id}/v{version.version}/template.docx"
    get_storage().put(key, content, mime)
    version.storage_key = key
    version.sha256 = sha256_bytes(content)
    version.revision += 1
    version.updated_by = user.id
    record_audit(
        db,
        request,
        user,
        "template.source.upload",
        "template_version",
        version.id,
        after={"sha256": version.sha256, "version": version.version},
    )
    db.commit()
    return version


@template_router.get("/{template_id}/versions/{version_number}/preflight")
def preflight_template_version(
    template_id: str,
    version_number: int,
    db: DbSession,
    user: CurrentUser,
) -> dict[str, Any]:
    template = db.get(Template, template_id)
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template_id,
            TemplateVersion.version == version_number,
        )
    )
    if (
        template is None
        or version is None
        or template.organization_id != user.organization_id
        or not version.storage_key
    ):
        raise APIError(404, "template_source_not_found", "模板 DOCX 源不存在")
    result = preflight_docx_template(get_storage().get(version.storage_key))
    return {
        "valid": result.valid,
        "placeholders": result.placeholders,
        "warnings": result.warnings,
        "sha256": version.sha256,
    }


@template_router.get("/{template_id}/versions/{version_number}/sections")
def list_template_sections(
    template_id: str,
    version_number: int,
    db: DbSession,
    user: CurrentUser,
) -> list[dict[str, Any]]:
    template = db.get(Template, template_id)
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template_id,
            TemplateVersion.version == version_number,
        )
    )
    if template is None or version is None or template.organization_id != user.organization_id:
        raise APIError(404, "template_version_not_found", "模板版本不存在")
    sections = list(
        db.scalars(
            select(TemplateSection)
            .where(TemplateSection.template_version_id == version.id)
            .order_by(TemplateSection.sequence)
        )
    )
    return [
        {
            "id": section.id,
            "sequence": section.sequence,
            "key": section.key,
            "title": section.title,
            "parent_id": section.parent_id,
            "level": section.level,
            "section_type": section.section_type,
            "required": section.required,
            "content": section.content,
            "revision": section.revision,
        }
        for section in sections
    ]


@template_router.get("/{template_id}/versions/{version_number}/variables")
def list_template_variables(
    template_id: str,
    version_number: int,
    db: DbSession,
    user: CurrentUser,
) -> list[dict[str, Any]]:
    template = db.get(Template, template_id)
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template_id,
            TemplateVersion.version == version_number,
        )
    )
    if template is None or version is None or template.organization_id != user.organization_id:
        raise APIError(404, "template_version_not_found", "模板版本不存在")
    variables = list(
        db.scalars(
            select(TemplateVariable)
            .where(TemplateVariable.template_version_id == version.id)
            .order_by(TemplateVariable.variable_key)
        )
    )
    return [
        {
            "id": variable.id,
            "variable_key": variable.variable_key,
            "field_key": variable.field_key,
            "required": variable.required,
            "default_value": variable.default_value,
            "revision": variable.revision,
        }
        for variable in variables
    ]


@template_router.post("", response_model=TemplateView, status_code=201)
def create_template(
    payload: TemplateCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> Template:
    _validate_template_source_metadata(
        payload.source_kind,
        payload.issuing_authority,
        payload.source_url,
    )
    template = Template(
        organization_id=user.organization_id,
        name=payload.name,
        stage=payload.stage,
        specialty=payload.specialty,
        procurement_type=payload.procurement_type,
        contract_type=payload.contract_type,
        source_kind=payload.source_kind,
        issuing_authority=payload.issuing_authority,
        document_number=payload.document_number,
        publish_year=payload.publish_year,
        source_url=payload.source_url,
        applicability=payload.applicability,
        is_builtin=False,
        generation_enabled=True,
        status="draft",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(template)
    db.flush()
    db.add(
        TemplateVersion(
            organization_id=user.organization_id,
            template_id=template.id,
            version=1,
            status="draft",
            format_profile=payload.format_profile,
            created_by=user.id,
            updated_by=user.id,
        )
    )
    record_audit(db, request, user, "template.create", "template", template.id)
    db.commit()
    return template


@template_router.post("/{template_id}/versions", response_model=TemplateView)
def create_template_version(
    template_id: str,
    payload: TemplateVersionCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> Template:
    template = db.get(Template, template_id)
    if template is None or template.organization_id != user.organization_id:
        raise APIError(404, "template_not_found", "模板不存在")
    if template.is_builtin:
        raise APIError(409, "builtin_template_immutable", "内置模板不能直接修订，请创建新模板")
    template.current_version += 1
    template.status = "draft"
    template.revision += 1
    db.add(
        TemplateVersion(
            organization_id=user.organization_id,
            template_id=template.id,
            version=template.current_version,
            status="draft",
            effective_date=payload.effective_date,
            expiry_date=payload.expiry_date,
            format_profile=payload.format_profile,
            created_by=user.id,
            updated_by=user.id,
        )
    )
    record_audit(db, request, user, "template.version.create", "template", template.id)
    db.commit()
    return template


@template_router.post("/{template_id}/publish", response_model=TemplateView)
def publish_template(
    template_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.publish"))],
) -> TemplateView:
    template = db.get(Template, template_id)
    if template is None or template.organization_id != user.organization_id:
        raise APIError(404, "template_not_found", "模板不存在")
    if template.is_builtin:
        raise APIError(409, "builtin_template_immutable", "内置模板由平台版本维护，不能手工发布")
    _validate_template_source_metadata(
        template.source_kind,
        template.issuing_authority,
        template.source_url,
    )
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template.id,
            TemplateVersion.version == template.current_version,
        )
    )
    if version is None:
        raise APIError(422, "template_version_missing", "模板版本不存在")
    if not version.storage_key:
        raise APIError(422, "template_source_missing", "发布前必须上传 DOCX 模板正式源")
    content = get_storage().get(version.storage_key)
    preflight = preflight_docx_template(content)
    if not preflight.valid:
        raise APIError(
            422,
            "template_preflight_failed",
            "模板预检未通过，不能发布",
            details={"warnings": preflight.warnings},
        )
    if version.sha256 and version.sha256 != sha256_bytes(content):
        raise APIError(409, "template_integrity_error", "模板源文件完整性校验失败")
    if version.expiry_date and version.effective_date and version.expiry_date < version.effective_date:
        raise APIError(422, "template_date_invalid", "模板失效日期不能早于生效日期")
    version.status = "published"
    version.published_at = utc_now()
    template.status = "published"
    template.revision += 1
    record_audit(db, request, user, "template.publish", "template", template.id)
    db.commit()
    return _template_view(template, has_docx_source=True)


@format_profile_router.get("", response_model=list[FormatProfileView])
def list_format_profiles(db: DbSession, user: CurrentUser) -> list[DocumentFormatProfile]:
    return list(
        db.scalars(
            select(DocumentFormatProfile)
            .where(DocumentFormatProfile.organization_id == user.organization_id)
            .order_by(DocumentFormatProfile.key, DocumentFormatProfile.version.desc())
        )
    )


@format_profile_router.post("", response_model=FormatProfileView, status_code=201)
def create_format_profile(
    payload: FormatProfileCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> DocumentFormatProfile:
    latest = db.scalar(
        select(func.max(DocumentFormatProfile.version)).where(
            DocumentFormatProfile.organization_id == user.organization_id,
            DocumentFormatProfile.key == payload.key,
        )
    )
    profile = DocumentFormatProfile(
        organization_id=user.organization_id,
        key=payload.key,
        name=payload.name,
        version=(latest or 0) + 1,
        status="published",
        rules=payload.rules,
        required_fonts=payload.required_fonts,
        strict_compliance=payload.strict_compliance,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(profile)
    db.flush()
    record_audit(db, request, user, "format_profile.create", "format_profile", profile.id)
    db.commit()
    return profile


@generation_router.post("", response_model=GenerationJobView, status_code=202)
def start_generation(
    project_id: str,
    stage: str,
    payload: GenerationRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> GenerationJob:
    _validate_stage(stage)
    project = require_project_access(db, user, project_id)
    template = db.get(Template, payload.template_id)
    template_version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == payload.template_id,
            TemplateVersion.version == payload.template_version,
        )
    )
    today = date.today()
    if (
        template is None
        or template.organization_id != user.organization_id
        or template.stage != stage
        or template.status != "published"
        or template.current_version != payload.template_version
        or not template.generation_enabled
        or template_version is None
        or template_version.status != "published"
        or (template_version.effective_date is not None and template_version.effective_date > today)
        or (template_version.expiry_date is not None and template_version.expiry_date < today)
    ):
        raise APIError(
            422,
            "template_not_applicable",
            "模板未发布、版本不符、不可用于生成或不适用当前阶段",
        )
    procurement_snapshot: dict[str, object] | None = None
    procurement_plan: ProcurementPlan | None = None
    procurement_group: TenderDocumentGroup | None = None
    if (
        payload.procurement_plan_id
        or payload.procurement_document_group_id
        or payload.procurement_package_ids
    ):
        if not payload.procurement_plan_id or not payload.procurement_document_group_id:
            raise APIError(
                422,
                "procurement_binding_incomplete",
                "采购方案生成必须同时绑定方案版本和主文件组",
            )
        procurement_plan = db.get(ProcurementPlan, payload.procurement_plan_id)
        procurement_group = db.get(TenderDocumentGroup, payload.procurement_document_group_id)
        if (
            procurement_plan is None
            or procurement_plan.project_id != project.id
            or procurement_plan.organization_id != user.organization_id
            or procurement_group is None
            or procurement_group.plan_id != procurement_plan.id
        ):
            raise APIError(404, "procurement_plan_not_found", "采购方案或主文件组不存在")
        recalculate_plan(db, procurement_plan)
        if procurement_plan.status != "confirmed":
            raise APIError(422, "procurement_plan_not_confirmed", "请先确认采购方案")
        if not procurement_plan.draft_generation_allowed:
            raise APIError(422, "procurement_generation_blocked", "采购范围、归属或模板仍有阻断项")
        if stage == "tender" and (
            procurement_group.template_id != template.id
            or procurement_group.template_version != payload.template_version
        ):
            raise APIError(422, "procurement_template_mismatch", "生成模板与主文件组确认模板不一致")
        procurement_snapshot = group_snapshot(
            db,
            procurement_plan,
            procurement_group,
            payload.procurement_package_ids,
        )
    job = build_generation_job(
        db,
        project=project,
        stage=stage,
        template=template,
        template_version=payload.template_version,
        idempotency_key=payload.idempotency_key,
        user_id=user.id,
        selected_section_keys=payload.selected_section_keys,
        include_descendants=payload.include_descendants,
        procurement_plan_id=procurement_plan.id if procurement_plan else None,
        procurement_document_group_id=procurement_group.id if procurement_group else None,
        procurement_snapshot=procurement_snapshot,
        template_applicability_confirmed=payload.template_applicability_confirmed,
    )
    record_audit(db, request, user, "generation.start", "generation_job", job.id)
    db.commit()
    result = generate_document_task.delay(job.id)
    db.expire_all()
    refreshed_job = db.get(GenerationJob, job.id)
    if refreshed_job and refreshed_job.task_id is None:
        refreshed_job.task_id = result.id
        db.commit()
    if refreshed_job is None:
        raise APIError(500, "generation_job_lost", "生成任务创建失败")
    return refreshed_job


@generation_router.get("/{job_id}", response_model=GenerationJobView)
def get_generation_job(job_id: str, db: DbSession, user: CurrentUser) -> GenerationJob:
    job = db.get(GenerationJob, job_id)
    if job is None or job.organization_id != user.organization_id:
        raise APIError(404, "generation_job_not_found", "生成任务不存在")
    require_project_access(db, user, job.project_id)
    return job


@generation_router.get("/{job_id}/steps", response_model=list[dict[str, Any]])
def list_generation_steps(job_id: str, db: DbSession, user: CurrentUser) -> list[dict[str, Any]]:
    job = get_generation_job(job_id, db, user)
    steps = list(
        db.scalars(
            select(GenerationJobStep)
            .where(GenerationJobStep.generation_job_id == job.id)
            .order_by(GenerationJobStep.sequence)
        )
    )
    return [
        {
            "id": step.id,
            "step_key": step.step_key,
            "sequence": step.sequence,
            "status": step.status,
            "output": step.output,
            "error": step.error,
            "revision": step.revision,
        }
        for step in steps
    ]


@generation_router.get("/{job_id}/events", response_model=list[dict[str, Any]])
def list_generation_events(
    job_id: str,
    db: DbSession,
    user: CurrentUser,
    after_sequence: int = Query(0, ge=0),
) -> list[dict[str, Any]]:
    job = get_generation_job(job_id, db, user)
    events = list(
        db.scalars(
            select(GenerationEvent)
            .where(
                GenerationEvent.generation_job_id == job.id,
                GenerationEvent.sequence > after_sequence,
            )
            .order_by(GenerationEvent.sequence)
        )
    )
    return [
        {
            "id": event.id,
            "sequence": event.sequence,
            "event_type": event.event_type,
            "payload": event.payload,
            "created_at": event.created_at,
        }
        for event in events
    ]


@generation_router.post("/{job_id}/retry", response_model=GenerationJobView, status_code=202)
def retry_generation_job(job_id: str, request: Request, db: DbSession, user: CurrentUser) -> GenerationJob:
    if "document.edit" not in user_permission_codes(db, user):
        raise APIError(403, "forbidden", "缺少权限：document.edit")
    job = get_generation_job(job_id, db, user)
    if job.status not in {"failed", "retrying"}:
        raise APIError(409, "job_not_retryable", "当前生成任务不能重试")
    job.status = "queued"
    job.error = None
    job.revision += 1
    record_audit(db, request, user, "generation.retry", "generation_job", job.id)
    db.commit()
    task = generate_document_task.delay(job.id)
    job.task_id = task.id
    db.commit()
    return job


@generation_router.post("/{job_id}/cancel", response_model=GenerationJobView)
def cancel_generation_job(job_id: str, request: Request, db: DbSession, user: CurrentUser) -> GenerationJob:
    if "document.edit" not in user_permission_codes(db, user):
        raise APIError(403, "forbidden", "缺少权限：document.edit")
    job = get_generation_job(job_id, db, user)
    if job.status in {"succeeded", "failed", "cancelled"}:
        raise APIError(409, "job_terminal", "任务已结束，不能取消")
    job.cancelled_at = utc_now()
    job.status = "cancelled"
    job.revision += 1
    record_audit(db, request, user, "generation.cancel", "generation_job", job.id)
    db.commit()
    return job


@document_router.get("", response_model=list[dict[str, Any]])
def list_documents(project_id: str, db: DbSession, user: CurrentUser) -> list[dict[str, Any]]:
    require_project_access(db, user, project_id)
    documents = list(
        db.scalars(select(Document).where(Document.project_id == project_id).order_by(Document.stage))
    )
    return [
        {
            "id": document.id,
            "project_id": document.project_id,
            "stage": document.stage,
            "title": document.title,
            "status": document.status,
            "current_version": document.current_version,
            "procurement_plan_id": document.procurement_plan_id,
            "procurement_document_group_id": document.procurement_document_group_id,
            "procurement_package_ids": document.procurement_package_ids,
            "revision": document.revision,
        }
        for document in documents
    ]


def _get_document_version(db: Session, user: User, version_id: str) -> DocumentVersion:
    version = db.get(DocumentVersion, version_id)
    document = db.get(Document, version.document_id) if version else None
    if version is None or document is None or version.organization_id != user.organization_id:
        raise APIError(404, "document_version_not_found", "文档版本不存在")
    require_project_access(db, user, document.project_id)
    return version


@document_router.get("/{document_id}", response_model=dict[str, Any])
def get_document(document_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    document = db.get(Document, document_id)
    if document is None or document.organization_id != user.organization_id:
        raise APIError(404, "document_not_found", "文档不存在")
    require_project_access(db, user, document.project_id)
    versions = list(
        db.scalars(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document.id)
            .order_by(DocumentVersion.version.desc())
        )
    )
    return {
        "id": document.id,
        "project_id": document.project_id,
        "stage": document.stage,
        "title": document.title,
        "status": document.status,
        "current_version": document.current_version,
        "versions": [
            {
                "id": version.id,
                "version": version.version,
                "status": version.status,
                "immutable": version.immutable,
                "parent_version_id": version.parent_version_id,
                "provenance": version.provenance,
                "revision": version.revision,
            }
            for version in versions
        ],
    }


@document_router.get("/versions/{version_id}", response_model=dict[str, Any])
def get_document_version(version_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    version = _get_document_version(db, user, version_id)
    sections = list(
        db.scalars(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == version.id)
            .order_by(DocumentSection.sequence)
        )
    )
    output_sections = []
    for section in sections:
        blocks = list(
            db.scalars(
                select(DocumentContentBlock)
                .where(DocumentContentBlock.document_section_id == section.id)
                .order_by(DocumentContentBlock.sequence)
            )
        )
        output_sections.append(
            {
                "id": section.id,
                "key": section.key,
                "title": section.title,
                "sequence": section.sequence,
                "parent_id": section.parent_id,
                "level": section.level,
                "blocks": [
                    {
                        "id": block.id,
                        "sequence": block.sequence,
                        "block_type": block.block_type,
                        "content": block.content,
                        "source_kind": block.source_kind,
                        "field_refs": block.field_refs,
                        "evidence_refs": block.evidence_refs,
                        "reviewed": block.reviewed,
                        "revision": block.revision,
                    }
                    for block in blocks
                ],
            }
        )
    return {
        "id": version.id,
        "document_id": version.document_id,
        "version": version.version,
        "status": version.status,
        "immutable": version.immutable,
        "provenance": version.provenance,
        "revision": version.revision,
        "sections": output_sections,
    }


@document_router.get("/versions/{version_id}/comments", response_model=list[dict[str, Any]])
def list_document_comments(version_id: str, db: DbSession, user: CurrentUser) -> list[dict[str, Any]]:
    version = _get_document_version(db, user, version_id)
    comments = list(
        db.scalars(
            select(DocumentComment)
            .where(DocumentComment.document_version_id == version.id)
            .order_by(DocumentComment.created_at)
        )
    )
    return [
        {
            "id": comment.id,
            "content_block_id": comment.content_block_id,
            "author_user_id": comment.author_user_id,
            "body": comment.body,
            "status": comment.status,
            "revision": comment.revision,
            "created_at": comment.created_at,
        }
        for comment in comments
    ]


@document_router.post("/versions/{version_id}/comments", response_model=dict[str, Any], status_code=201)
def create_document_comment(
    version_id: str,
    payload: CommentCreate,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> dict[str, Any]:
    version = _get_document_version(db, user, version_id)
    if payload.content_block_id:
        block = db.get(DocumentContentBlock, payload.content_block_id)
        section = db.get(DocumentSection, block.document_section_id) if block else None
        if block is None or section is None or section.document_version_id != version.id:
            raise APIError(422, "invalid_comment_target", "评论内容块不属于当前文档版本")
    comment = DocumentComment(
        organization_id=user.organization_id,
        document_version_id=version.id,
        content_block_id=payload.content_block_id,
        author_user_id=user.id,
        body=payload.body,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(comment)
    db.flush()
    record_audit(db, request, user, "document.comment.create", "document_comment", comment.id)
    db.commit()
    return {
        "id": comment.id,
        "body": comment.body,
        "status": comment.status,
        "revision": comment.revision,
    }


@document_router.post("/comments/{comment_id}/resolve", response_model=dict[str, Any])
def resolve_document_comment(
    comment_id: str,
    payload: CommentResolve,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> dict[str, Any]:
    comment = db.get(DocumentComment, comment_id)
    if comment is None or comment.organization_id != user.organization_id:
        raise APIError(404, "comment_not_found", "评论不存在")
    _get_document_version(db, user, comment.document_version_id)
    if comment.revision != payload.revision:
        raise APIError(409, "revision_conflict", "评论已被其他用户修改")
    comment.status = "resolved"
    comment.revision += 1
    comment.updated_by = user.id
    record_audit(db, request, user, "document.comment.resolve", "document_comment", comment.id)
    db.commit()
    return {"id": comment.id, "status": comment.status, "revision": comment.revision}


@document_router.patch("/blocks/{block_id}", response_model=dict[str, Any])
def update_content_block(
    block_id: str,
    payload: ContentBlockPatch,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> dict[str, Any]:
    block = db.get(DocumentContentBlock, block_id)
    section = db.get(DocumentSection, block.document_section_id) if block else None
    version = db.get(DocumentVersion, section.document_version_id) if section else None
    if block is None or section is None or version is None:
        raise APIError(404, "content_block_not_found", "内容块不存在")
    _get_document_version(db, user, version.id)
    if version.immutable or version.status == "finalized":
        raise APIError(409, "immutable_version", "已定稿版本不可修改，请创建新修订草稿")
    if block.source_kind == "fixed_template":
        raise APIError(
            403,
            "fixed_template_block_forbidden",
            "固定模板条款受模板版本保护；如需调整，请创建并审批新的模板版本",
        )
    if block.revision != payload.revision:
        raise APIError(
            409,
            "revision_conflict",
            "内容块已被其他用户修改",
            details={"expected": payload.revision, "actual": block.revision},
        )
    before = {"content": block.content, "reviewed": block.reviewed}
    block.content = payload.content
    block.reviewed = payload.reviewed
    block.source_kind = "user_edited"
    block.revision += 1
    block.updated_by = user.id
    version.status = "reviewing"
    version.revision += 1
    version.updated_by = user.id
    record_audit(
        db,
        request,
        user,
        "document.block.update",
        "document_content_block",
        block.id,
        before=before,
        after={"content": block.content, "reviewed": block.reviewed},
    )
    db.commit()
    return {
        "id": block.id,
        "content": block.content,
        "source_kind": block.source_kind,
        "reviewed": block.reviewed,
        "revision": block.revision,
    }


@document_router.post(
    "/blocks/{block_id}/ai-optimize",
    response_model=AITextOptimizeResponse,
)
def optimize_content_block_text(
    block_id: str,
    payload: AITextOptimizeRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> AITextOptimizeResponse:
    block = db.get(DocumentContentBlock, block_id)
    section = db.get(DocumentSection, block.document_section_id) if block else None
    version = db.get(DocumentVersion, section.document_version_id) if section else None
    if block is None or section is None or version is None:
        raise APIError(404, "content_block_not_found", "内容块不存在")
    _get_document_version(db, user, version.id)
    if version.immutable or version.status == "finalized":
        raise APIError(409, "immutable_version", "已定稿版本不可修改，请创建新修订草稿")
    if block.source_kind == "fixed_template":
        raise APIError(403, "fixed_template_block_forbidden", "固定模板条款不允许使用 AI 改写")
    if isinstance(block.content, str):
        block_text = block.content
    elif isinstance(block.content, dict):
        content_text = block.content.get("text", "")
        block_text = content_text if isinstance(content_text, str) else str(content_text)
    else:
        block_text = str(block.content or "")
    if payload.selected_text not in block_text:
        raise APIError(409, "selection_stale", "选取内容已发生变化，请重新选择后再优化")
    provider = get_provider()
    try:
        result = provider.optimize_text(
            selected_text=payload.selected_text,
            prompt=payload.prompt,
            action=payload.action,
        )
    except Exception as exc:
        logger.exception("Document text optimization failed for block %s", block.id)
        raise APIError(502, "ai_optimization_failed", "AI 优化暂时失败，请稍后重试") from exc
    record_audit(
        db,
        request,
        user,
        "document.block.ai_optimize",
        "document_content_block",
        block.id,
        metadata={
            "provider": provider.name,
            "model": provider.model,
            "prompt_version": TEXT_OPTIMIZATION_PROMPT_VERSION,
            "action": payload.action,
            "selected_text_length": len(payload.selected_text),
        },
    )
    db.commit()
    return AITextOptimizeResponse(
        optimized_prompt=result.optimized_prompt,
        suggestion=result.suggestion,
        provider=provider.name,
        model=provider.model,
        prompt_version=TEXT_OPTIMIZATION_PROMPT_VERSION,
    )


@document_router.post("/versions/{version_id}/validate", response_model=ValidationRunView)
def run_validation(version_id: str, request: Request, db: DbSession, user: CurrentUser) -> ValidationRunView:
    if "document.edit" not in user_permission_codes(db, user):
        raise APIError(403, "forbidden", "缺少权限：document.edit")
    version = _get_document_version(db, user, version_id)
    run = validate_document_version(db, version)
    record_audit(db, request, user, "validation.run", "document_version", version.id)
    db.commit()
    issues = list(db.scalars(select(ValidationIssue).where(ValidationIssue.validation_run_id == run.id)))
    return ValidationRunView.model_validate(run).model_copy(
        update={"issues": [ValidationIssueView.model_validate(issue) for issue in issues]}
    )


def _mark_downstream_stale(db: Session, document: Document, version: DocumentVersion) -> None:
    index = STAGE_INDEX[document.stage]
    for stage in STAGES[index + 1 :]:
        stage_record = db.scalar(
            select(ProjectStage).where(
                ProjectStage.project_id == document.project_id,
                ProjectStage.stage == stage,
            )
        )
        if stage_record and stage_record.status not in {"not_started", "stale"}:
            stage_record.status = "stale"
            stage_record.stale_reason = (
                f"上游 {document.stage} 已定稿为版本 {version.version}，请确认是否更新来源"
            )
            stage_record.revision += 1


@document_router.post("/versions/{version_id}/finalize", response_model=dict[str, Any])
def finalize_document_version(
    version_id: str,
    payload: FinalizeRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.finalize"))],
) -> dict[str, Any]:
    version = _get_document_version(db, user, version_id)
    if version.revision != payload.revision:
        raise APIError(409, "revision_conflict", "文档版本已被修改")
    if version.immutable or version.status == "finalized":
        existing = db.scalar(
            select(FinalizationRecord).where(FinalizationRecord.document_version_id == version.id)
        )
        return {
            "version_id": version.id,
            "status": "finalized",
            "record_id": existing.id if existing else None,
        }
    run = validate_document_version(db, version)
    db.flush()
    if run.issue_counts.get("P0", 0) > 0 or run.issue_counts.get("P1", 0) > 0:
        db.commit()
        raise APIError(
            422,
            "finalization_blocked",
            "存在未解决的 P0 或 P1 问题，不能定稿",
            details={"validation_run_id": run.id, "issue_counts": run.issue_counts},
        )
    version.status = "finalized"
    version.immutable = True
    version.finalized_at = utc_now()
    version.finalized_by = user.id
    version.revision += 1
    document = db.get(Document, version.document_id)
    if document is None:
        raise APIError(404, "document_not_found", "文档不存在")
    document.status = "finalized"
    snapshot = str(version.provenance.get("field_snapshot_sha256", ""))
    record = FinalizationRecord(
        organization_id=user.organization_id,
        document_version_id=version.id,
        finalized_by=user.id,
        validation_run_id=run.id,
        field_snapshot_sha256=snapshot,
        declaration=payload.declaration,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(record)
    stage_record = db.scalar(
        select(ProjectStage).where(
            ProjectStage.project_id == document.project_id,
            ProjectStage.stage == document.stage,
        )
    )
    if stage_record:
        stage_record.status = "finalized"
        stage_record.finalized_document_version_id = version.id
        stage_record.revision += 1
    _mark_downstream_stale(db, document, version)
    record_audit(db, request, user, "document.finalize", "document_version", version.id)
    db.commit()
    return {"version_id": version.id, "status": "finalized", "record_id": record.id}


@document_router.post("/versions/{version_id}/revisions", response_model=dict[str, Any], status_code=201)
def create_document_revision(
    version_id: str, request: Request, db: DbSession, user: CurrentUser
) -> dict[str, Any]:
    if "document.edit" not in user_permission_codes(db, user):
        raise APIError(403, "forbidden", "缺少权限：document.edit")
    source = _get_document_version(db, user, version_id)
    document = db.get(Document, source.document_id)
    if document is None:
        raise APIError(404, "document_not_found", "文档不存在")
    next_number = document.current_version + 1
    revision = DocumentVersion(
        organization_id=user.organization_id,
        document_id=document.id,
        version=next_number,
        status="draft",
        immutable=False,
        parent_version_id=source.id,
        provenance={
            **source.provenance,
            "parent_version_id": source.id,
            "revision_reason": "user_created",
        },
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(revision)
    db.flush()
    source_sections = list(
        db.scalars(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == source.id)
            .order_by(DocumentSection.sequence)
        )
    )
    id_remap: dict[str, str] = {}
    for source_section in source_sections:
        section = DocumentSection(
            organization_id=user.organization_id,
            document_version_id=revision.id,
            sequence=source_section.sequence,
            key=source_section.key,
            title=source_section.title,
            parent_id=None,
            level=source_section.level,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(section)
        db.flush()
        id_remap[source_section.id] = section.id
        blocks = db.scalars(
            select(DocumentContentBlock).where(DocumentContentBlock.document_section_id == source_section.id)
        )
        for source_block in blocks:
            db.add(
                DocumentContentBlock(
                    organization_id=user.organization_id,
                    document_section_id=section.id,
                    sequence=source_block.sequence,
                    block_type=source_block.block_type,
                    content=source_block.content,
                    source_kind=source_block.source_kind,
                    field_refs=source_block.field_refs,
                    evidence_refs=source_block.evidence_refs,
                    reviewed=source_block.reviewed,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
    for source_section in source_sections:
        if not source_section.parent_id:
            continue
        new_id = id_remap.get(source_section.id)
        new_parent_id = id_remap.get(source_section.parent_id)
        if new_id and new_parent_id:
            cloned = db.get(DocumentSection, new_id)
            if cloned is not None:
                cloned.parent_id = new_parent_id
    document.current_version = next_number
    document.status = "draft"
    record_audit(db, request, user, "document.revision.create", "document_version", revision.id)
    db.commit()
    return {
        "id": revision.id,
        "document_id": revision.document_id,
        "version": revision.version,
        "status": revision.status,
        "parent_version_id": source.id,
    }


def _version_section_content(db: Session, version_id: str) -> dict[str, dict[str, object]]:
    sections = list(
        db.scalars(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == version_id)
            .order_by(DocumentSection.sequence)
        )
    )
    output: dict[str, dict[str, object]] = {}
    for section in sections:
        blocks = list(
            db.scalars(
                select(DocumentContentBlock)
                .where(DocumentContentBlock.document_section_id == section.id)
                .order_by(DocumentContentBlock.sequence)
            )
        )
        output[section.key] = {
            "title": section.title,
            "content": [block.content for block in blocks],
        }
    return output


@comparison_router.post("", response_model=dict[str, Any], status_code=201)
def create_comparison(
    payload: ComparisonRequest,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> dict[str, Any]:
    left = _get_document_version(db, user, payload.left_version_id)
    right = _get_document_version(db, user, payload.right_version_id)
    left_document = db.get(Document, left.document_id)
    right_document = db.get(Document, right.document_id)
    if (
        left_document is None
        or right_document is None
        or left_document.project_id != right_document.project_id
    ):
        raise APIError(422, "comparison_scope_invalid", "只能比较同一项目内的文档版本")
    run = ComparisonRun(
        organization_id=user.organization_id,
        project_id=left_document.project_id,
        left_version_id=left.id,
        right_version_id=right.id,
        comparison_type=payload.comparison_type,
        status="running",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(run)
    db.flush()
    left_sections = _version_section_content(db, left.id)
    right_sections = _version_section_content(db, right.id)
    counts = {"added": 0, "removed": 0, "changed": 0, "unchanged": 0}
    for sequence, key in enumerate(sorted(set(left_sections) | set(right_sections)), 1):
        before = left_sections.get(key)
        after = right_sections.get(key)
        if before is None:
            change_type = "added"
        elif after is None:
            change_type = "removed"
        elif json.dumps(before, ensure_ascii=False, sort_keys=True) != json.dumps(
            after, ensure_ascii=False, sort_keys=True
        ):
            change_type = "changed"
        else:
            change_type = "unchanged"
        counts[change_type] += 1
        db.add(
            ComparisonItem(
                organization_id=user.organization_id,
                comparison_run_id=run.id,
                sequence=sequence,
                change_type=change_type,
                location={"section_key": key},
                before=before,
                after=after,
                created_by=user.id,
                updated_by=user.id,
            )
        )
    summary: dict[str, object] = {key: value for key, value in counts.items()}
    run.status = "succeeded"
    run.summary = summary
    record_audit(db, request, user, "comparison.create", "comparison_run", run.id)
    db.commit()
    return {
        "id": run.id,
        "status": run.status,
        "comparison_type": run.comparison_type,
        "summary": run.summary,
    }


@comparison_router.get("/{run_id}", response_model=dict[str, Any])
def get_comparison(run_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    run = db.get(ComparisonRun, run_id)
    if run is None or run.organization_id != user.organization_id:
        raise APIError(404, "comparison_not_found", "对比记录不存在")
    require_project_access(db, user, run.project_id)
    items = list(
        db.scalars(
            select(ComparisonItem)
            .where(ComparisonItem.comparison_run_id == run.id)
            .order_by(ComparisonItem.sequence)
        )
    )
    return {
        "id": run.id,
        "status": run.status,
        "comparison_type": run.comparison_type,
        "summary": run.summary,
        "items": [
            {
                "id": item.id,
                "sequence": item.sequence,
                "change_type": item.change_type,
                "location": item.location,
                "before": item.before,
                "after": item.after,
            }
            for item in items
        ],
    }


@validation_router.get("/{run_id}", response_model=ValidationRunView)
def get_validation_run(run_id: str, db: DbSession, user: CurrentUser) -> ValidationRunView:
    run = db.get(ValidationRun, run_id)
    if run is None or run.organization_id != user.organization_id:
        raise APIError(404, "validation_run_not_found", "校验任务不存在")
    _get_document_version(db, user, run.document_version_id)
    issues = list(db.scalars(select(ValidationIssue).where(ValidationIssue.validation_run_id == run.id)))
    return ValidationRunView.model_validate(run).model_copy(
        update={"issues": [ValidationIssueView.model_validate(issue) for issue in issues]}
    )


@validation_router.post("/issues/{issue_id}/resolve", response_model=ValidationIssueView)
def resolve_validation_issue(
    issue_id: str,
    payload: ValidationIssueResolve,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> ValidationIssue:
    issue = db.get(ValidationIssue, issue_id)
    run = db.get(ValidationRun, issue.validation_run_id) if issue else None
    if issue is None or run is None or issue.organization_id != user.organization_id:
        raise APIError(404, "validation_issue_not_found", "校验问题不存在")
    _get_document_version(db, user, run.document_version_id)
    if issue.revision != payload.revision:
        raise APIError(409, "revision_conflict", "校验问题已被其他用户修改")
    if issue.severity == "P0":
        raise APIError(422, "p0_issue_not_waivable", "P0 问题必须修复根因后重新校验，不能直接关闭")
    issue.status = "resolved"
    issue.resolution = payload.resolution
    issue.revision += 1
    issue.updated_by = user.id
    record_audit(db, request, user, "validation.issue.resolve", "validation_issue", issue.id)
    db.commit()
    return issue


@export_router.post("", response_model=dict[str, Any], status_code=202)
def start_export(
    version_id: str,
    payload: ExportRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("export.create"))],
) -> dict[str, Any]:
    version = _get_document_version(db, user, version_id)
    existing = db.scalar(select(ExportJob).where(ExportJob.idempotency_key == payload.idempotency_key))
    if existing:
        if existing.document_version_id != version.id or existing.output_format != payload.output_format:
            raise APIError(409, "idempotency_conflict", "幂等键已用于其他导出请求")
        job = existing
    else:
        job = ExportJob(
            organization_id=user.organization_id,
            document_version_id=version.id,
            document_revision=version.revision,
            output_format=payload.output_format,
            status="queued",
            idempotency_key=payload.idempotency_key,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(job)
        db.flush()
        record_audit(db, request, user, "export.start", "export_job", job.id)
        db.commit()
        export_document_task.delay(job.id)
        db.expire_all()
        refreshed_job = db.get(ExportJob, job.id)
        if refreshed_job is None:
            raise APIError(500, "export_job_lost", "导出任务创建失败")
        job = refreshed_job
    if job is None:
        raise APIError(500, "export_job_lost", "导出任务创建失败")
    return {
        "id": job.id,
        "document_version_id": job.document_version_id,
        "output_format": job.output_format,
        "status": job.status,
        "sha256": job.sha256,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "version": version.version,
        "version_revision": job.document_revision,
    }


@export_router.get("/{job_id}", response_model=dict[str, Any])
def get_export_job(job_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    job = db.get(ExportJob, job_id)
    if job is None or job.organization_id != user.organization_id:
        raise APIError(404, "export_job_not_found", "导出任务不存在")
    _get_document_version(db, user, job.document_version_id)
    return {
        "id": job.id,
        "document_version_id": job.document_version_id,
        "output_format": job.output_format,
        "status": job.status,
        "sha256": job.sha256,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "version": _get_document_version(db, user, job.document_version_id).version,
        "version_revision": job.document_revision,
    }


@export_router.get("/{job_id}/artifacts", response_model=list[dict[str, Any]])
def list_export_artifacts(job_id: str, db: DbSession, user: CurrentUser) -> list[dict[str, Any]]:
    job = db.get(ExportJob, job_id)
    if job is None or job.organization_id != user.organization_id:
        raise APIError(404, "export_job_not_found", "导出任务不存在")
    _get_document_version(db, user, job.document_version_id)
    artifacts = list(
        db.scalars(
            select(ExportArtifact)
            .where(ExportArtifact.export_job_id == job.id)
            .order_by(ExportArtifact.created_at)
        )
    )
    return [
        {
            "id": artifact.id,
            "filename": artifact.filename,
            "mime_type": artifact.mime_type,
            "size_bytes": artifact.size_bytes,
            "sha256": artifact.sha256,
            "metadata": artifact.metadata_json,
            "revision": artifact.revision,
        }
        for artifact in artifacts
    ]


@export_router.get("/{job_id}/download")
def download_export(
    job_id: str,
    db: DbSession,
    user: CurrentUser,
    preview: bool = False,
) -> StreamingResponse:
    job = db.get(ExportJob, job_id)
    if job is None or job.organization_id != user.organization_id:
        raise APIError(404, "export_job_not_found", "导出任务不存在")
    version = _get_document_version(db, user, job.document_version_id)
    if job.status != "succeeded" or not job.storage_key:
        raise APIError(409, "export_not_ready", "导出文件尚未生成完成")
    content = get_storage().get(job.storage_key)
    actual = hashlib.sha256(content).hexdigest()
    if actual != job.sha256:
        raise APIError(500, "export_integrity_error", "导出文件完整性校验失败")
    mime = {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pdf": "application/pdf",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[job.output_format]
    filename = export_filename(db, version, job.output_format)
    disposition = "inline" if preview else "attachment"
    return StreamingResponse(
        iter([content]),
        media_type=mime,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "no-store",
        },
    )


@system_router.get("/users", response_model=Page)
def list_users(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("user.manage"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> Page:
    stmt = select(User).where(User.organization_id == user.organization_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = list(db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)))
    return Page(
        items=[UserView.model_validate(item).model_dump() for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@system_router.post("/users", response_model=UserView, status_code=201)
def create_user(
    payload: UserCreate,
    request: Request,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission("user.manage"))],
) -> User:
    from .security import hash_password

    if db.scalar(select(User.id).where(func.lower(User.email) == payload.email.lower())):
        raise APIError(409, "user_exists", "邮箱已存在")
    roles = list(
        db.scalars(
            select(Role).where(
                Role.organization_id == actor.organization_id,
                Role.key.in_(payload.role_keys),
            )
        )
    )
    if {role.key for role in roles} != set(payload.role_keys):
        raise APIError(422, "role_not_found", "包含不存在的角色")
    user = User(
        organization_id=actor.organization_id,
        email=payload.email.lower(),
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(user)
    db.flush()
    for role in roles:
        db.add(
            UserRole(
                organization_id=actor.organization_id,
                user_id=user.id,
                role_id=role.id,
                created_by=actor.id,
                updated_by=actor.id,
            )
        )
    record_audit(db, request, actor, "user.create", "user", user.id)
    db.commit()
    return user


@system_router.get("/organizations", response_model=list[OrganizationView])
def list_organizations(db: DbSession, user: CurrentUser) -> list[Any]:
    from .models import Organization

    organization = db.get(Organization, user.organization_id)
    return [organization] if organization else []


@system_router.post("/users/{user_id}/deactivate", response_model=UserView)
def deactivate_user(
    user_id: str,
    request: Request,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission("user.manage"))],
) -> User:
    target = db.get(User, user_id)
    if target is None or target.organization_id != actor.organization_id:
        raise APIError(404, "user_not_found", "用户不存在")
    if target.id == actor.id:
        raise APIError(422, "self_deactivation_forbidden", "不能停用当前登录账号")
    target.is_active = False
    target.session_version += 1
    target.revision += 1
    record_audit(db, request, actor, "user.deactivate", "user", target.id)
    db.commit()
    return target


@system_router.get("/roles", response_model=list[dict[str, Any]])
def list_roles(db: DbSession, user: CurrentUser) -> list[dict[str, Any]]:
    roles = list(db.scalars(select(Role).where(Role.organization_id == user.organization_id)))
    return [{"id": role.id, "key": role.key, "name": role.name} for role in roles]


@system_router.get("/permissions", response_model=list[dict[str, Any]])
def list_permissions(db: DbSession, user: CurrentUser) -> list[dict[str, Any]]:
    del user
    permissions = list(db.scalars(select(Permission).order_by(Permission.code)))
    return [
        {"id": permission.id, "code": permission.code, "name": permission.name} for permission in permissions
    ]


@system_router.get("/audit-logs", response_model=Page)
def list_audit_logs(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("audit.read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> Page:
    stmt = select(AuditLog).where(AuditLog.organization_id == user.organization_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    logs = list(
        db.scalars(stmt.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    )
    return Page(
        items=[
            {
                "id": log.id,
                "action": log.action,
                "object_type": log.object_type,
                "object_id": log.object_id,
                "actor_user_id": log.actor_user_id,
                "request_id": log.request_id,
                "created_at": log.created_at.isoformat(),
                "metadata": log.metadata_json,
            }
            for log in logs
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@system_router.post("/contract-payment-check", response_model=dict[str, Any])
def contract_payment_check(payload: ContractPaymentCheck, user: CurrentUser) -> dict[str, Any]:
    del user
    errors = validate_contract_payments(
        Decimal(str(payload.final_contract_amount)),
        [item.model_dump() for item in payload.items],
    )
    return {"valid": not errors, "errors": errors}


@system_router.get("/features", response_model=dict[str, bool])
def feature_flags(user: CurrentUser) -> dict[str, bool]:
    del user
    return {"procurement_planning": get_settings().procurement_planning_enabled}


@procurement_router.get("/procurement-rule-sets", response_model=list[ProcurementRuleSetView])
def list_procurement_rule_sets(
    db: DbSession,
    user: CurrentUser,
    status: str | None = Query(default=None, max_length=30),
) -> list[ProcurementRuleSet]:
    statement = select(ProcurementRuleSet).where(ProcurementRuleSet.organization_id == user.organization_id)
    if status:
        statement = statement.where(ProcurementRuleSet.status == status)
    return list(db.scalars(statement.order_by(ProcurementRuleSet.key, ProcurementRuleSet.version.desc())))


@procurement_router.post(
    "/procurement-rule-sets",
    response_model=ProcurementRuleSetView,
    status_code=201,
)
def create_procurement_rule_set(
    payload: ProcurementRuleSetCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> ProcurementRuleSet:
    if payload.effective_date and payload.expiry_date and payload.expiry_date < payload.effective_date:
        raise APIError(422, "procurement_rule_date_invalid", "规则失效日期不能早于生效日期")
    from .services.feasibility_rules import validate_rules_document

    rule_errors = validate_rules_document(payload.rules_json or {})
    if rule_errors:
        raise APIError(
            422,
            "procurement_rule_schema_invalid",
            "采购规则 DSL 不合法",
            details={"errors": rule_errors},
        )
    latest = db.scalar(
        select(func.max(ProcurementRuleSet.version)).where(
            ProcurementRuleSet.organization_id == user.organization_id,
            ProcurementRuleSet.key == payload.key,
        )
    )
    rule_set = ProcurementRuleSet(
        organization_id=user.organization_id,
        key=payload.key,
        name=payload.name,
        version=(latest or 0) + 1,
        status="draft",
        applicable_subject=payload.applicable_subject,
        region=payload.region,
        funding_nature=payload.funding_nature,
        source_name=payload.source_name,
        source_url=payload.source_url,
        effective_date=payload.effective_date,
        expiry_date=payload.expiry_date,
        rules_json=payload.rules_json,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(rule_set)
    db.flush()
    record_audit(db, request, user, "procurement_rule_set.create", "procurement_rule_set", rule_set.id)
    db.commit()
    return rule_set


@procurement_router.post(
    "/procurement-rule-sets/{rule_set_id}/publish",
    response_model=ProcurementRuleSetView,
)
def publish_procurement_rule_set(
    rule_set_id: str,
    payload: ProcurementRuleSetPublishRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.publish"))],
) -> ProcurementRuleSet:
    rule_set = db.get(ProcurementRuleSet, rule_set_id)
    if rule_set is None or rule_set.organization_id != user.organization_id:
        raise APIError(404, "procurement_rule_set_not_found", "采购规则集不存在")
    if rule_set.revision != payload.revision:
        raise APIError(409, "revision_conflict", "采购规则集已被修改")
    if rule_set.status == "published":
        return rule_set
    previous_versions = list(
        db.scalars(
            select(ProcurementRuleSet).where(
                ProcurementRuleSet.organization_id == user.organization_id,
                ProcurementRuleSet.key == rule_set.key,
                ProcurementRuleSet.status == "published",
                ProcurementRuleSet.id != rule_set.id,
            )
        )
    )
    for previous in previous_versions:
        previous.status = "superseded"
        previous.revision += 1
        previous.updated_by = user.id
    rule_set.status = "published"
    rule_set.revision += 1
    rule_set.updated_by = user.id
    record_audit(
        db,
        request,
        user,
        "procurement_rule_set.publish",
        "procurement_rule_set",
        rule_set.id,
        after={"key": rule_set.key, "version": rule_set.version, "source": rule_set.source_name},
    )
    db.commit()
    return rule_set


def _get_procurement_run(db: Session, user: User, run_id: str) -> ProcurementAnalysisRun:
    run = db.get(ProcurementAnalysisRun, run_id)
    if run is None or run.organization_id != user.organization_id:
        raise APIError(404, "procurement_analysis_not_found", "采购分析记录不存在")
    require_project_access(db, user, run.project_id)
    return run


def _get_procurement_plan(db: Session, user: User, plan_id: str) -> ProcurementPlan:
    plan = db.get(ProcurementPlan, plan_id)
    if plan is None or plan.organization_id != user.organization_id:
        raise APIError(404, "procurement_plan_not_found", "采购方案不存在")
    require_project_access(db, user, plan.project_id)
    return plan


@procurement_router.post(
    "/projects/{project_id}/procurement-analyses",
    response_model=ProcurementAnalysisRunView,
    status_code=202,
)
def start_procurement_analysis(
    project_id: str,
    payload: ProcurementAnalysisRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> ProcurementAnalysisRun:
    if not get_settings().procurement_planning_enabled:
        raise APIError(404, "feature_disabled", "采购方案分析功能当前已关闭")
    project = require_project_access(db, user, project_id)
    run = build_analysis_run(
        db,
        project=project,
        source_kind=payload.source_kind,
        source_version_id=payload.source_version_id,
        user_id=user.id,
    )
    record_audit(
        db,
        request,
        user,
        "procurement_analysis.start",
        "procurement_analysis_run",
        run.id,
        after={"source_kind": run.source_kind, "source_version_id": run.source_version_id},
    )
    enqueue_procurement_analysis(db, run)
    db.expire_all()
    refreshed = db.get(ProcurementAnalysisRun, run.id)
    if refreshed is None:
        raise APIError(500, "procurement_analysis_lost", "采购分析任务创建失败")
    return refreshed


@procurement_router.get(
    "/projects/{project_id}/procurement-analyses",
    response_model=list[ProcurementAnalysisRunView],
)
def list_procurement_analyses(
    project_id: str, db: DbSession, user: CurrentUser
) -> list[ProcurementAnalysisRun]:
    require_project_access(db, user, project_id)
    return list(
        db.scalars(
            select(ProcurementAnalysisRun)
            .where(ProcurementAnalysisRun.project_id == project_id)
            .order_by(ProcurementAnalysisRun.created_at.desc())
        )
    )


@procurement_router.get("/procurement-analyses/{run_id}", response_model=ProcurementAnalysisRunView)
def get_procurement_analysis(run_id: str, db: DbSession, user: CurrentUser) -> ProcurementAnalysisRun:
    return _get_procurement_run(db, user, run_id)


@procurement_router.post(
    "/procurement-analyses/{run_id}/retry",
    response_model=ProcurementAnalysisRunView,
    status_code=202,
)
def retry_procurement_analysis(
    run_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> ProcurementAnalysisRun:
    run = _get_procurement_run(db, user, run_id)
    if run.status in {"succeeded", "succeeded_demo"}:
        raise APIError(409, "procurement_analysis_already_succeeded", "采购分析已经完成，无需重试")
    record_audit(
        db,
        request,
        user,
        "procurement_analysis.retry",
        "procurement_analysis_run",
        run.id,
        before={"status": run.status, "task_id": run.task_id, "error": run.error},
    )
    enqueue_procurement_analysis(db, run)
    db.expire_all()
    refreshed = db.get(ProcurementAnalysisRun, run.id)
    if refreshed is None:
        raise APIError(500, "procurement_analysis_lost", "采购分析任务重试失败")
    return refreshed


@procurement_router.get("/projects/{project_id}/procurement-plans", response_model=list[ProcurementPlanView])
def list_procurement_plans(project_id: str, db: DbSession, user: CurrentUser) -> list[dict[str, Any]]:
    require_project_access(db, user, project_id)
    plans = list(
        db.scalars(
            select(ProcurementPlan)
            .where(ProcurementPlan.project_id == project_id)
            .order_by(ProcurementPlan.version.desc(), ProcurementPlan.is_recommended.desc())
        )
    )
    return [plan_view(db, plan) for plan in plans]


@procurement_router.get("/procurement-plans/{plan_id}", response_model=ProcurementPlanView)
def get_procurement_plan(plan_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    return plan_view(db, _get_procurement_plan(db, user, plan_id))


@procurement_router.put("/procurement-plans/{plan_id}/structure", response_model=ProcurementPlanView)
def update_procurement_plan_structure(
    plan_id: str,
    payload: ProcurementPlanStructureUpdate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> dict[str, Any]:
    plan = _get_procurement_plan(db, user, plan_id)
    if plan.revision != payload.revision:
        raise APIError(409, "revision_conflict", "采购方案已被其他用户修改，请刷新后重试")
    before = plan_view(db, plan)
    replace_plan_structure(
        db,
        plan,
        packages_payload=[item.model_dump(mode="python") for item in payload.packages],
        groups_payload=[item.model_dump(mode="python") for item in payload.document_groups],
        name=payload.name,
        user_id=user.id,
    )
    refresh_summary = _refresh_tender_field_candidates(
        db,
        project_id=plan.project_id,
        organization_id=plan.organization_id,
        actor_id=user.id,
        reason="procurement_plan_structure_update",
    )
    record_audit(
        db,
        request,
        user,
        "procurement_plan.structure.update",
        "procurement_plan",
        plan.id,
        before={"revision": before["revision"], "document_count": before["recommended_document_count"]},
        after={
            "revision": plan.revision,
            "document_count": plan.recommended_document_count,
            "field_refresh": {
                "created": refresh_summary.get("created"),
                "revised": refresh_summary.get("revised"),
                "files_processed": refresh_summary.get("files_processed"),
            },
        },
    )
    db.commit()
    return plan_view(db, plan)


@procurement_router.post(
    "/procurement-plans/{plan_id}/ensure-default-grouping",
    response_model=ProcurementPlanView,
)
def ensure_procurement_plan_default_grouping(
    plan_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
    payload: EnsureDefaultGroupingRequest | None = Body(default=None),
) -> dict[str, Any]:
    """按用户显式策略补齐待编制清单；无 strategy 时不改动方案（不再静默一包一套）。"""
    plan = _get_procurement_plan(db, user, plan_id)
    before = plan_view(db, plan)
    strategy = payload.strategy if payload is not None else None
    applied = ensure_default_document_groups(
        db, plan, user_id=user.id, strategy=strategy
    )
    recalculate_plan(db, plan)
    refresh_summary: dict[str, Any] | None = None
    if applied:
        refresh_summary = _refresh_tender_field_candidates(
            db,
            project_id=plan.project_id,
            organization_id=plan.organization_id,
            actor_id=user.id,
            reason="ensure_default_grouping",
        )
        record_audit(
            db,
            request,
            user,
            "procurement_plan.ensure_default_grouping",
            "procurement_plan",
            plan.id,
            before={
                "revision": before["revision"],
                "document_count": before["recommended_document_count"],
                "package_count": before["procurement_package_count"],
            },
            after={
                "revision": plan.revision,
                "document_count": plan.recommended_document_count,
                "package_count": plan.procurement_package_count,
                "strategy": strategy,
                "field_refresh": {
                    "created": refresh_summary.get("created"),
                    "revised": refresh_summary.get("revised"),
                    "files_processed": refresh_summary.get("files_processed"),
                },
            },
        )
    db.commit()
    return plan_view(db, plan)


@procurement_router.post("/procurement-plans/{plan_id}/confirm", response_model=ProcurementPlanView)
def confirm_procurement_plan(
    plan_id: str,
    payload: ProcurementPlanConfirmRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.finalize"))],
) -> dict[str, Any]:
    plan = _get_procurement_plan(db, user, plan_id)
    if plan.revision != payload.revision:
        raise APIError(409, "revision_conflict", "采购方案已被其他用户修改，请刷新后重试")
    confirmation = confirm_plan(db, plan, user_id=user.id, note=payload.decision_note)
    refresh_summary = _refresh_tender_field_candidates(
        db,
        project_id=plan.project_id,
        organization_id=plan.organization_id,
        actor_id=user.id,
        reason="procurement_plan_confirm",
    )
    record_audit(
        db,
        request,
        user,
        "procurement_plan.confirm",
        "procurement_plan",
        plan.id,
        after={
            "plan_version": plan.version,
            "confirmed_document_count": plan.confirmed_document_count,
            "snapshot_sha256": confirmation.snapshot_sha256,
            "field_refresh": {
                "created": refresh_summary.get("created"),
                "revised": refresh_summary.get("revised"),
                "files_processed": refresh_summary.get("files_processed"),
            },
        },
    )
    db.commit()
    return plan_view(db, plan)


@procurement_router.post("/procurement-issues/{issue_id}/resolve", response_model=ProcurementPlanView)
def resolve_procurement_issue(
    issue_id: str,
    payload: ProcurementIssueResolveRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> dict[str, Any]:
    issue = db.get(ProcurementIssue, issue_id)
    if issue is None or issue.organization_id != user.organization_id:
        raise APIError(404, "procurement_issue_not_found", "待确认项不存在")
    plan = _get_procurement_plan(db, user, issue.plan_id)
    if issue.revision != payload.revision:
        raise APIError(409, "revision_conflict", "待确认项已更新，请刷新后重试")
    if issue.category == "rule_check":
        raise APIError(422, "rule_issue_requires_data_change", "该问题需修改范围、归属或预算数据后自动复核")
    if plan.status == "confirmed":
        raise APIError(409, "confirmed_plan_immutable", "已确认采购方案不可直接修改")
    issue.status = "resolved"
    issue.resolution = payload.resolution
    issue.updated_by = user.id
    issue.revision += 1
    plan.revision += 1
    recalculate_plan(db, plan)
    record_audit(
        db,
        request,
        user,
        "procurement_issue.resolve",
        "procurement_issue",
        issue.id,
        after={"resolution": issue.resolution},
    )
    db.commit()
    return plan_view(db, plan)


def _refresh_batch(db: Session, batch: ProcurementGenerationBatch) -> list[GenerationJob]:
    jobs = list(
        db.scalars(
            select(GenerationJob)
            .where(GenerationJob.procurement_batch_id == batch.id)
            .order_by(GenerationJob.created_at)
        )
    )
    batch.succeeded_count = sum(job.status == "succeeded" for job in jobs)
    batch.failed_count = sum(job.status in {"failed", "stale"} for job in jobs)
    if batch.succeeded_count == batch.total_count:
        batch.status = "succeeded"
    elif batch.succeeded_count + batch.failed_count == batch.total_count:
        batch.status = "partial_failed" if batch.succeeded_count else "failed"
    elif any(job.status in {"running", "retrying"} for job in jobs):
        batch.status = "running"
    else:
        batch.status = "queued"
    return jobs


def _batch_view(db: Session, batch: ProcurementGenerationBatch) -> dict[str, Any]:
    jobs = _refresh_batch(db, batch)
    return {
        "id": batch.id,
        "project_id": batch.project_id,
        "plan_id": batch.plan_id,
        "status": batch.status,
        "idempotency_key": batch.idempotency_key,
        "total_count": batch.total_count,
        "succeeded_count": batch.succeeded_count,
        "failed_count": batch.failed_count,
        "jobs": jobs,
        "revision": batch.revision,
    }


@procurement_router.post(
    "/procurement-plans/{plan_id}/generate-batch",
    response_model=ProcurementGenerationBatchView,
    status_code=202,
)
def generate_procurement_plan_batch(
    plan_id: str,
    payload: ProcurementBatchGenerationRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> dict[str, Any]:
    plan = _get_procurement_plan(db, user, plan_id)
    recalculate_plan(db, plan)
    if plan.status != "confirmed" or not plan.draft_generation_allowed:
        raise APIError(422, "procurement_generation_blocked", "采购方案尚未确认或仍有范围、归属、模板阻断项")
    existing = db.scalar(
        select(ProcurementGenerationBatch).where(
            ProcurementGenerationBatch.idempotency_key == payload.idempotency_key
        )
    )
    if existing:
        if existing.plan_id != plan.id:
            raise APIError(409, "idempotency_conflict", "幂等键已用于其他采购方案")
        return _batch_view(db, existing)
    group_ids = list(dict.fromkeys(payload.group_ids))
    groups = list(
        db.scalars(
            select(TenderDocumentGroup).where(
                TenderDocumentGroup.plan_id == plan.id,
                TenderDocumentGroup.id.in_(group_ids),
                TenderDocumentGroup.status == "active",
            )
        )
    )
    if {item.id for item in groups} != set(group_ids):
        raise APIError(422, "invalid_document_group_selection", "包含不存在或不可生成的主文件组")
    if any(item.procurement_method not in {"public_tender", "invited_tender", "tender"} for item in groups):
        raise APIError(422, "unsupported_procurement_method", "非招标采购文件当前不支持生成，已单独统计")
    batch = ProcurementGenerationBatch(
        organization_id=plan.organization_id,
        project_id=plan.project_id,
        plan_id=plan.id,
        status="queued",
        idempotency_key=payload.idempotency_key,
        total_count=len(groups),
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(batch)
    db.flush()
    jobs: list[GenerationJob] = []
    for group in groups:
        if not group.template_id or not group.template_version:
            raise APIError(422, "procurement_template_missing", f"{group.name} 尚未匹配模板")
        template = db.get(Template, group.template_id)
        if template is None:
            raise APIError(422, "procurement_template_missing", f"{group.name} 的模板不存在")
        snapshot = group_snapshot(db, plan, group)
        job_key = (
            "proc-batch-" + hashlib.sha256(f"{payload.idempotency_key}:{group.id}".encode()).hexdigest()[:40]
        )
        jobs.append(
            build_generation_job(
                db,
                project=require_project_access(db, user, plan.project_id),
                stage="tender",
                template=template,
                template_version=group.template_version,
                idempotency_key=job_key,
                user_id=user.id,
                procurement_plan_id=plan.id,
                procurement_document_group_id=group.id,
                procurement_batch_id=batch.id,
                procurement_snapshot=snapshot,
                template_applicability_confirmed=True,
            )
        )
    record_audit(
        db,
        request,
        user,
        "procurement_plan.generate_batch",
        "procurement_generation_batch",
        batch.id,
        after={"plan_id": plan.id, "group_ids": group_ids},
    )
    db.commit()
    for job in jobs:
        try:
            result = generate_document_task.delay(job.id)
            db.expire_all()
            refreshed = db.get(GenerationJob, job.id)
            if refreshed and refreshed.task_id is None:
                refreshed.task_id = result.id
                db.commit()
        except Exception as exc:  # noqa: BLE001 - one failed document must not discard successful siblings
            failed_job = db.get(GenerationJob, job.id)
            if failed_job is not None:
                failed_job.status = "failed"
                failed_job.error = f"任务调度失败：{type(exc).__name__}"
                db.commit()
            logger.exception("procurement_batch_item_failed batch_id=%s job_id=%s", batch.id, job.id)
    db.expire_all()
    refreshed_batch = db.get(ProcurementGenerationBatch, batch.id)
    if refreshed_batch is None:
        raise APIError(500, "procurement_batch_lost", "批量生成任务创建失败")
    response = _batch_view(db, refreshed_batch)
    db.commit()
    return response


@procurement_router.get(
    "/procurement-generation-batches/{batch_id}", response_model=ProcurementGenerationBatchView
)
def get_procurement_generation_batch(batch_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    batch = db.get(ProcurementGenerationBatch, batch_id)
    if batch is None or batch.organization_id != user.organization_id:
        raise APIError(404, "procurement_batch_not_found", "批量生成任务不存在")
    require_project_access(db, user, batch.project_id)
    return _batch_view(db, batch)


@procurement_router.post(
    "/procurement-generation-batches/{batch_id}/retry-failed",
    response_model=ProcurementGenerationBatchView,
    status_code=202,
)
def retry_procurement_generation_batch(
    batch_id: str,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("document.edit"))],
) -> dict[str, Any]:
    batch = db.get(ProcurementGenerationBatch, batch_id)
    if batch is None or batch.organization_id != user.organization_id:
        raise APIError(404, "procurement_batch_not_found", "批量生成任务不存在")
    require_project_access(db, user, batch.project_id)
    jobs = _refresh_batch(db, batch)
    retryable = [job for job in jobs if job.status in {"failed", "retrying", "stale"}]
    if not retryable:
        raise APIError(409, "no_failed_batch_items", "当前没有可重试的失败项")
    for job in retryable:
        job.status = "queued"
        job.error = None
    record_audit(
        db,
        request,
        user,
        "procurement_batch.retry_failed",
        "procurement_generation_batch",
        batch.id,
        after={"job_ids": [job.id for job in retryable]},
    )
    db.commit()
    for job in retryable:
        try:
            generate_document_task.delay(job.id)
        except Exception as exc:  # noqa: BLE001
            failed_job = db.get(GenerationJob, job.id)
            if failed_job is not None:
                failed_job.status = "failed"
                failed_job.error = f"重试调度失败：{type(exc).__name__}"
                db.commit()
            logger.exception("procurement_batch_retry_failed batch_id=%s job_id=%s", batch.id, job.id)
    db.expire_all()
    refreshed = db.get(ProcurementGenerationBatch, batch.id)
    if refreshed is None:
        raise APIError(500, "procurement_batch_lost", "批量生成任务不存在")
    response = _batch_view(db, refreshed)
    db.commit()
    return response


router.include_router(auth_router)
router.include_router(project_router)
router.include_router(file_router)
router.include_router(field_router)
router.include_router(template_router)
router.include_router(template_extraction_router)
router.include_router(generation_router)
router.include_router(document_router)
router.include_router(validation_router)
router.include_router(export_router)
router.include_router(comparison_router)
router.include_router(format_profile_router)
router.include_router(procurement_router)
router.include_router(system_router)
