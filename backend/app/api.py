from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict, deque
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response, UploadFile
from fastapi import File as UploadMarker
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .audit import record_audit
from .config import get_settings
from .dependencies import CurrentUser, DbSession, require_permission, require_project_access
from .errors import APIError
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
    Project,
    ProjectMember,
    ProjectStage,
    Role,
    Template,
    TemplateExtractionJob,
    TemplateSection,
    TemplateVariable,
    TemplateVersion,
    User,
    UserRole,
    ValidationIssue,
    ValidationRun,
    utc_now,
)
from .schemas import (
    CommentCreate,
    CommentResolve,
    ComparisonRequest,
    ContentBlockPatch,
    ContractPaymentCheck,
    ExportRequest,
    FieldConfirmationRequest,
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
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberView,
    ProjectPatch,
    ProjectView,
    SessionView,
    StageSourceOption,
    StageSourceRequest,
    StageView,
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
from .services.generation import build_generation_job, document_version_sha256
from .services.providers import TEMPLATE_EXTRACTION_PROMPT_VERSION
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
    export_document_task,
    extract_template_task,
    generate_document_task,
    parse_file_task,
)
from .template_catalog import NATIONAL_OFFICIAL_TEXT

router = APIRouter(prefix="/api/v1")
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
    ("requirement", "project_period", "contract", "contract_duration"),
    ("feasibility", "project_period", "contract", "contract_duration"),
    ("feasibility", "construction_scope", "tender", "procurement_scope"),
    ("feasibility", "construction_scope", "contract", "contract_scope"),
}
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


@project_router.post("", response_model=ProjectView, status_code=201)
def create_project(
    payload: ProjectCreate,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("project.create"))],
) -> Project:
    project = Project(
        organization_id=user.organization_id,
        **payload.model_dump(),
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
    before = {"name": project.name, "description": project.description, "status": project.status}
    for key, value in payload.model_dump(exclude={"revision"}, exclude_none=True).items():
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
        after={"name": project.name, "description": project.description, "status": project.status},
    )
    db.commit()
    db.refresh(project)
    return project


@project_router.get("/{project_id}/stages", response_model=list[StageView])
def list_stages(project_id: str, db: DbSession, user: CurrentUser) -> list[ProjectStage]:
    require_project_access(db, user, project_id)
    records = list(
        db.scalars(select(ProjectStage).where(ProjectStage.project_id == project_id))
    )
    return sorted(records, key=lambda item: STAGE_INDEX[item.stage])


@project_router.get("/{project_id}/members", response_model=list[ProjectMemberView])
def list_project_members(
    project_id: str, db: DbSession, user: CurrentUser
) -> list[ProjectMember]:
    require_project_access(db, user, project_id)
    return list(
        db.scalars(
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at)
        )
    )


@project_router.post(
    "/{project_id}/members", response_model=ProjectMemberView, status_code=201
)
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


@project_router.get(
    "/{project_id}/stages/{stage}/sources", response_model=list[StageSourceOption]
)
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
    user: CurrentUser,
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
    user: CurrentUser,
    upload: Annotated[UploadFile, UploadMarker()],
    project_id: Annotated[str, Query(...)],
    stage: Annotated[str, Query(...)],
) -> File:
    _validate_stage(stage)
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
        after={"name": file_record.original_name, "sha256": version.sha256, "stage": stage},
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
) -> list[FieldDefinition]:
    stmt = select(FieldDefinition).where(FieldDefinition.organization_id == user.organization_id)
    if stage:
        _validate_stage(stage)
        stmt = stmt.where(FieldDefinition.stage == stage)
    return list(db.scalars(stmt.order_by(FieldDefinition.stage, FieldDefinition.field_key)))


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


@field_router.post("", response_model=FieldValueView, status_code=201)
def create_field_value(
    project_id: str,
    stage: str,
    payload: FieldValueCreate,
    request: Request,
    db: DbSession,
    user: CurrentUser,
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
    user: CurrentUser,
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
    user: CurrentUser,
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
    if source_kind == "adapted_from_official_outline" and (
        not issuing_authority or not source_url
    ):
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


@template_extraction_router.get(
    "/{extraction_job_id}", response_model=TemplateExtractionJobView
)
def get_template_extraction(
    extraction_job_id: str,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> TemplateExtractionJob:
    return _get_template_extraction_job(extraction_job_id, db, user)


@template_extraction_router.post(
    "/{extraction_job_id}/retry", response_model=TemplateExtractionJobView
)
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


@template_extraction_router.post(
    "/{extraction_job_id}/confirm", response_model=TemplateView
)
def confirm_template_extraction(
    extraction_job_id: str,
    payload: TemplateExtractionConfirmRequest,
    request: Request,
    db: DbSession,
    user: Annotated[User, Depends(require_permission("template.manage"))],
) -> Template:
    job = _get_template_extraction_job(extraction_job_id, db, user)
    if job.confirmed_template_id:
        existing = db.get(Template, job.confirmed_template_id)
        if existing is not None:
            return existing
    if job.status != "review_required":
        raise APIError(409, "template_extraction_not_ready", "模板候选尚未进入人工确认阶段")
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
        item
        for item in raw_sections
        if isinstance(item, dict) and item.get("id") in selected_section_ids
    ]
    variables = [
        item
        for item in raw_variables
        if isinstance(item, dict) and item.get("id") in selected_variable_ids
    ]
    if len(sections) != len(selected_section_ids):
        raise APIError(422, "template_section_selection_invalid", "所选章节包含不存在的候选项")
    if len(variables) != len(selected_variable_ids):
        raise APIError(422, "template_variable_selection_invalid", "所选变量包含不存在的候选项")
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
    used_keys: set[str] = set()
    for sequence, section in enumerate(sections):
        key = str(section.get("key") or f"section_{sequence + 1}")[:120]
        if key in used_keys:
            key = f"{key[:110]}_{sequence + 1}"
        used_keys.add(key)
        db.add(
            TemplateSection(
                organization_id=user.organization_id,
                template_version_id=template_version.id,
                sequence=sequence,
                key=key,
                title=str(section.get("title") or f"章节 {sequence + 1}")[:300],
                section_type="editable",
                required=True,
                content=None,
                created_by=user.id,
                updated_by=user.id,
            )
        )
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
    }
    job.result_json = result_json
    job.confirmed_template_id = template.id
    job.status = "confirmed"
    job.revision += 1
    job.updated_by = user.id
    file_record.status = "template_candidate_confirmed"
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
        },
    )
    db.commit()
    return template


@template_router.get("", response_model=list[TemplateView])
def list_templates(
    db: DbSession,
    user: CurrentUser,
    stage: str | None = None,
    current_only: bool = True,
    generation_only: bool = False,
) -> list[Template]:
    stmt = select(Template).where(Template.organization_id == user.organization_id)
    if stage:
        _validate_stage(stage)
        stmt = stmt.where(Template.stage == stage)
    if current_only:
        stmt = stmt.where(Template.status == "published")
    if generation_only:
        stmt = stmt.where(Template.generation_enabled.is_(True))
    return list(db.scalars(stmt.order_by(Template.name)))


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


@template_router.get(
    "/{template_id}/versions", response_model=list[TemplateVersionView]
)
def list_template_versions(
    template_id: str, db: DbSession, user: CurrentUser
) -> list[TemplateVersion]:
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
        headers={
            "Content-Disposition": f'attachment; filename="template-v{version.version}.docx"'
        },
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
) -> Template:
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
    return template


@format_profile_router.get("", response_model=list[FormatProfileView])
def list_format_profiles(
    db: DbSession, user: CurrentUser
) -> list[DocumentFormatProfile]:
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
    user: CurrentUser,
) -> GenerationJob:
    _validate_stage(stage)
    project = require_project_access(db, user, project_id)
    template = db.get(Template, payload.template_id)
    if (
        template is None
        or template.organization_id != user.organization_id
        or template.stage != stage
        or template.status != "published"
        or template.current_version != payload.template_version
        or not template.generation_enabled
    ):
        raise APIError(
            422,
            "template_not_applicable",
            "模板未发布、版本不符、不可用于生成或不适用当前阶段",
        )
    job = build_generation_job(
        db,
        project=project,
        stage=stage,
        template=template,
        template_version=payload.template_version,
        idempotency_key=payload.idempotency_key,
        user_id=user.id,
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
def list_generation_steps(
    job_id: str, db: DbSession, user: CurrentUser
) -> list[dict[str, Any]]:
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
def retry_generation_job(
    job_id: str, request: Request, db: DbSession, user: CurrentUser
) -> GenerationJob:
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
def list_document_comments(
    version_id: str, db: DbSession, user: CurrentUser
) -> list[dict[str, Any]]:
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


@document_router.post(
    "/versions/{version_id}/comments", response_model=dict[str, Any], status_code=201
)
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
    user: CurrentUser,
) -> dict[str, Any]:
    block = db.get(DocumentContentBlock, block_id)
    section = db.get(DocumentSection, block.document_section_id) if block else None
    version = db.get(DocumentVersion, section.document_version_id) if section else None
    if block is None or section is None or version is None:
        raise APIError(404, "content_block_not_found", "内容块不存在")
    _get_document_version(db, user, version.id)
    if version.immutable or version.status == "finalized":
        raise APIError(409, "immutable_version", "已定稿版本不可修改，请创建新修订草稿")
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


@document_router.post("/versions/{version_id}/validate", response_model=ValidationRunView)
def run_validation(version_id: str, request: Request, db: DbSession, user: CurrentUser) -> ValidationRunView:
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
    if run.issue_counts.get("P0", 0) > 0:
        db.commit()
        raise APIError(
            422,
            "finalization_blocked",
            "存在 P0 问题，不能定稿",
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
    for source_section in source_sections:
        section = DocumentSection(
            organization_id=user.organization_id,
            document_version_id=revision.id,
            sequence=source_section.sequence,
            key=source_section.key,
            title=source_section.title,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(section)
        db.flush()
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
    user: CurrentUser,
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
    }


@export_router.get("/{job_id}/artifacts", response_model=list[dict[str, Any]])
def list_export_artifacts(
    job_id: str, db: DbSession, user: CurrentUser
) -> list[dict[str, Any]]:
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
def download_export(job_id: str, db: DbSession, user: CurrentUser) -> StreamingResponse:
    job = db.get(ExportJob, job_id)
    if job is None or job.organization_id != user.organization_id:
        raise APIError(404, "export_job_not_found", "导出任务不存在")
    _get_document_version(db, user, job.document_version_id)
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
    return StreamingResponse(
        iter([content]),
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="document.{job.output_format}"'},
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
        {"id": permission.id, "code": permission.code, "name": permission.name}
        for permission in permissions
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
router.include_router(system_router)
