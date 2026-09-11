from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import APIError
from ..models import (
    AuditLog,
    File,
    FileVersion,
    GenerationJob,
    Project,
    ProjectStage,
    Template,
    TemplateVersion,
)
from .generation import build_generation_job

SUPPORTED_AUTO_DRAFT_STAGES = {"tender"}


def _template_priority(template: Template) -> tuple[int, int, str]:
    """Prefer a customer template, otherwise use a generic procurement template.

    An adapted specialty template such as surveying must not be selected merely
    because it sorts before the generic platform template.
    """
    if template.source_kind == "other_official_template" and not template.is_builtin:
        rank = 0
    elif template.source_kind == "platform_reference_template" and template.procurement_type == "设备采购":
        rank = 1
    elif template.source_kind == "other_official_template":
        rank = 2
    elif template.source_kind == "platform_reference_template":
        rank = 3
    elif template.source_kind == "adapted_from_official_outline":
        rank = 4
    else:
        rank = 9
    return rank, 0 if not template.is_builtin else 1, template.name


def _default_template(db: Session, file_record: File) -> Template:
    today = date.today()
    candidates = list(
        db.scalars(
            select(Template).where(
                Template.organization_id == file_record.organization_id,
                Template.stage == file_record.stage,
                Template.status == "published",
                Template.generation_enabled.is_(True),
            )
        )
    )
    candidates.sort(key=_template_priority)
    for template in candidates:
        version = db.scalar(
            select(TemplateVersion).where(
                TemplateVersion.template_id == template.id,
                TemplateVersion.version == template.current_version,
                TemplateVersion.status == "published",
            )
        )
        if (
            version is not None
            and version.storage_key
            and (version.effective_date is None or version.effective_date <= today)
            and (version.expiry_date is None or version.expiry_date >= today)
        ):
            return template
    raise APIError(422, "auto_draft_template_missing", "没有可用于自动生成的已发布招标文件模板")


def build_file_auto_draft_job(
    db: Session,
    *,
    file_record: File,
    version: FileVersion,
    actor_id: str,
) -> GenerationJob:
    if not file_record.project_id or not file_record.stage:
        raise APIError(422, "file_not_bound_to_stage", "文件未关联项目阶段")
    if file_record.stage not in SUPPORTED_AUTO_DRAFT_STAGES:
        raise APIError(422, "auto_draft_stage_unsupported", "当前仅支持从可研材料自动生成招标文件草稿")
    if file_record.status != "parsed":
        raise APIError(409, "file_not_parsed", "文件解析完成后才能自动生成草稿")
    project = db.get(Project, file_record.project_id)
    if project is None:
        raise APIError(404, "project_not_found", "项目不存在")

    stage_record = db.scalar(
        select(ProjectStage).where(
            ProjectStage.project_id == project.id,
            ProjectStage.stage == file_record.stage,
        )
    )
    if stage_record is None:
        stage_record = ProjectStage(
            organization_id=file_record.organization_id,
            project_id=project.id,
            stage=file_record.stage,
            created_by=actor_id,
            updated_by=actor_id,
        )
        db.add(stage_record)
        db.flush()
    if stage_record.source_type != "uploaded_file" or stage_record.source_file_version_id != version.id:
        stage_record.source_type = "uploaded_file"
        stage_record.source_file_version_id = version.id
        stage_record.status = "source_ready"
        stage_record.stale_reason = None
        stage_record.revision += 1
        stage_record.updated_by = actor_id

    template = _default_template(db, file_record)
    job = build_generation_job(
        db,
        project=project,
        stage=file_record.stage,
        template=template,
        template_version=template.current_version,
        idempotency_key=(f"auto-draft-{version.id}-{template.id}-v{template.current_version}"),
        user_id=actor_id,
        include_candidates=True,
    )
    file_record.auto_generate_draft = True
    file_record.auto_generation_job_id = job.id
    file_record.auto_generation_error = None
    file_record.updated_by = actor_id
    db.add(
        AuditLog(
            organization_id=file_record.organization_id,
            actor_user_id=actor_id,
            action="file.auto_draft.queue",
            object_type="generation_job",
            object_id=job.id,
            request_id=None,
            ip_address=None,
            before=None,
            after={
                "file_id": file_record.id,
                "file_version_id": version.id,
                "template_id": template.id,
                "template_version": template.current_version,
                "mode": "candidate_draft",
            },
            metadata_json={"automatic": True},
            created_by=actor_id,
            updated_by=actor_id,
        )
    )
    return job
