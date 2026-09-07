from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import APIError
from ..models import (
    Document,
    DocumentContentBlock,
    DocumentSection,
    DocumentVersion,
    FieldSnapshot,
    FieldValue,
    FileVersion,
    GenerationEvent,
    GenerationJob,
    GenerationJobStep,
    Project,
    ProjectStage,
    Template,
    TemplateSection,
    TemplateVersion,
)
from .providers import PROMPT_VERSION, SECTION_PLANS, ProviderContext, get_provider
from .storage import get_storage

FORMAL_FIELD_STATUSES = {"user_confirmed", "system_authoritative", "template_default"}


def _template_section_plan(
    db: Session, template_version_id: str, stage: str
) -> list[tuple[str, str]]:
    sections = list(
        db.scalars(
            select(TemplateSection)
            .where(TemplateSection.template_version_id == template_version_id)
            .order_by(TemplateSection.sequence)
        )
    )
    if not sections:
        return SECTION_PLANS[stage]
    return [(section.key, section.title) for section in sections]


def field_snapshot(fields: list[FieldValue]) -> tuple[str, dict[str, object]]:
    values = {
        field.field_key: field.normalized_value if field.normalized_value is not None else field.value
        for field in fields
        if field.status in FORMAL_FIELD_STATUSES
    }
    encoded = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest(), values


def document_version_sha256(db: Session, version: DocumentVersion) -> str:
    sections = list(
        db.scalars(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == version.id)
            .order_by(DocumentSection.sequence)
        )
    )
    content: list[dict[str, object]] = []
    for section in sections:
        blocks = list(
            db.scalars(
                select(DocumentContentBlock)
                .where(DocumentContentBlock.document_section_id == section.id)
                .order_by(DocumentContentBlock.sequence)
            )
        )
        content.append(
            {
                "key": section.key,
                "title": section.title,
                "blocks": [block.content for block in blocks],
            }
        )
    encoded = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _locked_source(
    db: Session, project: Project, stage: str
) -> tuple[str | None, str | None, int | None, str | None]:
    stage_record = db.scalar(
        select(ProjectStage).where(ProjectStage.project_id == project.id, ProjectStage.stage == stage)
    )
    if stage_record is None or not stage_record.source_type:
        if stage == "requirement":
            return "structured_requirement", None, None, None
        raise APIError(422, "stage_source_missing", "下游阶段必须先选择上一阶段定稿或上传文件")
    if not stage_record.source_file_version_id:
        return stage_record.source_type, None, None, None
    if stage_record.source_type == "uploaded_file":
        file_version = db.get(FileVersion, stage_record.source_file_version_id)
        if file_version is None:
            raise APIError(422, "stage_source_missing", "锁定的上传文件版本不存在")
        return stage_record.source_type, file_version.id, file_version.version, file_version.sha256
    upstream_version = db.get(DocumentVersion, stage_record.source_file_version_id)
    if upstream_version is None or not upstream_version.immutable or upstream_version.status != "finalized":
        raise APIError(422, "stage_source_missing", "锁定的上游定稿版本不存在或已失效")
    return (
        stage_record.source_type,
        upstream_version.id,
        upstream_version.version,
        document_version_sha256(db, upstream_version),
    )


def build_generation_job(
    db: Session,
    *,
    project: Project,
    stage: str,
    template: Template,
    template_version: int,
    idempotency_key: str,
    user_id: str,
) -> GenerationJob:
    existing = db.scalar(select(GenerationJob).where(GenerationJob.idempotency_key == idempotency_key))
    if existing:
        if existing.project_id != project.id or existing.stage != stage:
            raise APIError(409, "idempotency_conflict", "幂等键已用于其他生成请求")
        return existing
    fields = list(
        db.scalars(
            select(FieldValue).where(
                FieldValue.project_id == project.id,
                FieldValue.stage == stage,
                FieldValue.is_current.is_(True),
            )
        )
    )
    snapshot_sha256, snapshot_values = field_snapshot(fields)
    snapshot = FieldSnapshot(
        organization_id=project.organization_id,
        project_id=project.id,
        stage=stage,
        sha256=snapshot_sha256,
        values_json=snapshot_values,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(snapshot)
    db.flush()
    source_kind, source_version_id, source_version, source_sha256 = _locked_source(db, project, stage)
    locked_template = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template.id,
            TemplateVersion.version == template_version,
            TemplateVersion.status == "published",
        )
    )
    if locked_template is None or not locked_template.storage_key:
        raise APIError(422, "template_source_missing", "模板没有可用的 DOCX 正式源")
    section_plan = _template_section_plan(db, locked_template.id, stage)
    template_content = get_storage().get(locked_template.storage_key)
    template_sha256 = hashlib.sha256(template_content).hexdigest()
    if locked_template.sha256 and locked_template.sha256 != template_sha256:
        raise APIError(409, "template_integrity_error", "模板源文件 SHA-256 与锁定值不一致")
    provider = get_provider()
    job = GenerationJob(
        organization_id=project.organization_id,
        project_id=project.id,
        stage=stage,
        status="queued",
        idempotency_key=idempotency_key,
        field_snapshot_id=snapshot.id,
        source_kind=source_kind,
        source_version_id=source_version_id,
        source_file_version=source_version,
        source_sha256=source_sha256,
        template_id=template.id,
        template_version=template_version,
        template_sha256=template_sha256,
        prompt_version=PROMPT_VERSION,
        generation_provider=provider.name,
        generation_model=provider.model,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(job)
    db.flush()
    db.add(
        GenerationEvent(
            organization_id=project.organization_id,
            generation_job_id=job.id,
            sequence=1,
            event_type="queued",
            payload={"field_snapshot_sha256": snapshot_sha256},
            created_by=user_id,
            updated_by=user_id,
        )
    )
    for sequence, (key, _title) in enumerate(section_plan, 1):
        db.add(
            GenerationJobStep(
                organization_id=project.organization_id,
                generation_job_id=job.id,
                step_key=key,
                sequence=sequence,
                status="pending",
                created_by=user_id,
                updated_by=user_id,
            )
        )
    return job


def execute_generation_job(db: Session, job_id: str) -> DocumentVersion:
    job = db.get(GenerationJob, job_id)
    if job is None:
        raise ValueError("Generation job not found")
    if job.status == "succeeded":
        candidates = db.scalars(
            select(DocumentVersion).where(DocumentVersion.organization_id == job.organization_id)
        )
        for existing in candidates:
            if existing.provenance.get("generation_job_id") == job.id:
                return existing
    if job.cancelled_at is not None:
        job.status = "cancelled"
        raise RuntimeError("Generation job was cancelled")
    project = db.get(Project, job.project_id)
    if project is None:
        raise ValueError("Project not found")
    fields = list(
        db.scalars(
            select(FieldValue).where(
                FieldValue.project_id == project.id,
                FieldValue.stage == job.stage,
                FieldValue.is_current.is_(True),
            )
        )
    )
    snapshot_sha256, values = field_snapshot(fields)
    snapshot = db.get(FieldSnapshot, job.field_snapshot_id)
    if snapshot is None or snapshot.sha256 != snapshot_sha256:
        job.status = "stale"
        raise RuntimeError("Field snapshot changed after job creation")
    project_stage = db.scalar(
        select(ProjectStage).where(
            ProjectStage.project_id == project.id,
            ProjectStage.stage == job.stage,
        )
    )
    current_source_kind = (
        project_stage.source_type
        if project_stage and project_stage.source_type
        else ("structured_requirement" if job.stage == "requirement" else None)
    )
    if project_stage is None or current_source_kind != job.source_kind:
        job.status = "stale"
        raise RuntimeError("Stage source changed after job creation")
    if job.source_version_id:
        if job.source_kind == "uploaded_file":
            source_version = db.get(FileVersion, job.source_version_id)
            current_source_sha = source_version.sha256 if source_version else None
        else:
            upstream_version = db.get(DocumentVersion, job.source_version_id)
            current_source_sha = document_version_sha256(db, upstream_version) if upstream_version else None
        if current_source_sha != job.source_sha256:
            job.status = "stale"
            raise RuntimeError("Locked source changed after job creation")
    locked_template = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == job.template_id,
            TemplateVersion.version == job.template_version,
        )
    )
    if locked_template is None or not locked_template.storage_key:
        job.status = "failed"
        raise RuntimeError("Locked template source is missing")
    section_plan = _template_section_plan(db, locked_template.id, job.stage)
    current_template_sha = hashlib.sha256(get_storage().get(locked_template.storage_key)).hexdigest()
    if current_template_sha != job.template_sha256:
        job.status = "stale"
        raise RuntimeError("Locked template changed after job creation")
    job.status = "running"
    job.attempt += 1
    db.add(
        GenerationEvent(
            organization_id=project.organization_id,
            generation_job_id=job.id,
            sequence=2,
            event_type="running",
            payload={"attempt": job.attempt},
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
    )
    db.flush()
    provider = get_provider()
    draft = provider.generate(
        ProviderContext(
            stage=job.stage,
            project_name=project.name,
            fields=values,
            section_plan=section_plan,
        )
    )
    document = db.scalar(
        select(Document).where(Document.project_id == project.id, Document.stage == job.stage)
    )
    if document is None:
        document = Document(
            organization_id=project.organization_id,
            project_id=project.id,
            stage=job.stage,
            title=f"{project.name} {stage_label(job.stage)}",
            status="draft",
            current_version=1,
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
        db.add(document)
        db.flush()
        version_number = 1
        parent_id = None
    else:
        version_number = document.current_version + 1
        parent = db.scalar(
            select(DocumentVersion).where(
                DocumentVersion.document_id == document.id,
                DocumentVersion.version == document.current_version,
            )
        )
        parent_id = parent.id if parent else None
        document.current_version = version_number
    version = DocumentVersion(
        organization_id=project.organization_id,
        document_id=document.id,
        version=version_number,
        status="draft",
        immutable=False,
        parent_version_id=parent_id,
        provenance={
            "generation_job_id": job.id,
            "field_snapshot_id": snapshot.id,
            "field_snapshot_sha256": snapshot_sha256,
            "source_kind": job.source_kind,
            "source_version_id": job.source_version_id,
            "source_version": job.source_file_version,
            "source_sha256": job.source_sha256,
            "template_id": job.template_id,
            "template_version": job.template_version,
            "template_sha256": job.template_sha256,
            "prompt_version": job.prompt_version,
            "generation_provider": job.generation_provider,
            "generation_model": job.generation_model,
        },
        created_by=job.created_by,
        updated_by=job.updated_by,
    )
    db.add(version)
    db.flush()
    steps = {
        step.step_key: step
        for step in db.scalars(select(GenerationJobStep).where(GenerationJobStep.generation_job_id == job.id))
    }
    for sequence, section_draft in enumerate(draft.sections, 1):
        section = DocumentSection(
            organization_id=project.organization_id,
            document_version_id=version.id,
            sequence=sequence,
            key=section_draft.key,
            title=section_draft.title,
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
        db.add(section)
        db.flush()
        for block_sequence, paragraph in enumerate(section_draft.paragraphs, 1):
            db.add(
                DocumentContentBlock(
                    organization_id=project.organization_id,
                    document_section_id=section.id,
                    sequence=block_sequence,
                    block_type="paragraph",
                    content={"text": paragraph},
                    source_kind="ai_generated",
                    field_refs=section_draft.field_refs,
                    evidence_refs=[],
                    reviewed=False,
                    created_by=job.created_by,
                    updated_by=job.updated_by,
                )
            )
        if section_draft.key in steps:
            steps[section_draft.key].status = "succeeded"
            steps[section_draft.key].output = {"document_section_id": section.id}
    job.status = "succeeded"
    db.add(
        GenerationEvent(
            organization_id=project.organization_id,
            generation_job_id=job.id,
            sequence=3,
            event_type="succeeded",
            payload={"document_version_id": version.id},
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
    )
    return version


def stage_label(stage: str) -> str:
    return {
        "requirement": "项目建议书",
        "feasibility": "可行性研究报告",
        "tender": "招标文件",
        "contract": "合同",
    }[stage]
