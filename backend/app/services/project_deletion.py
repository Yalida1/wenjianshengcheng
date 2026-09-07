from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..errors import APIError
from ..models import (
    ComparisonItem,
    ComparisonRun,
    Document,
    DocumentBlock,
    DocumentComment,
    DocumentContentBlock,
    DocumentSection,
    DocumentVersion,
    ExportArtifact,
    ExportJob,
    FieldConfirmation,
    FieldConflict,
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
    Project,
    ProjectMember,
    ProjectStage,
    TemplateExtractionJob,
    ValidationIssue,
    ValidationRun,
)

ACTIVE_JOB_STATUSES = {"queued", "running", "retrying"}


def _ids(db: Session, model: Any, *conditions: ColumnElement[bool]) -> list[str]:
    return list(db.scalars(select(model.id).where(*conditions)))


def _delete_by_ids(db: Session, model: Any, ids: Iterable[str]) -> None:
    values = list(ids)
    if values:
        db.execute(delete(model).where(model.id.in_(values)))


def _ensure_no_active_jobs(
    db: Session,
    generation_job_ids: list[str],
    parse_job_ids: list[str],
    extraction_job_ids: list[str],
    export_job_ids: list[str],
) -> None:
    active: list[str] = []
    for label, model, ids in (
        ("文档生成", GenerationJob, generation_job_ids),
        ("文件解析", FileParseJob, parse_job_ids),
        ("模板提取", TemplateExtractionJob, extraction_job_ids),
        ("文件导出", ExportJob, export_job_ids),
    ):
        if ids and db.scalar(
            select(model.id).where(model.id.in_(ids), model.status.in_(ACTIVE_JOB_STATUSES)).limit(1)
        ):
            active.append(label)
    if active:
        raise APIError(
            409,
            "project_jobs_active",
            "项目仍有后台任务运行，暂不能删除",
            details={"active_job_types": active},
        )


def delete_project_graph(db: Session, project: Project) -> list[str]:
    """Delete one project's complete record graph and return stored object keys."""

    file_ids = _ids(db, File, File.project_id == project.id)
    file_version_ids = (
        _ids(db, FileVersion, FileVersion.file_id.in_(file_ids)) if file_ids else []
    )
    parse_job_ids = (
        _ids(db, FileParseJob, FileParseJob.file_version_id.in_(file_version_ids))
        if file_version_ids
        else []
    )
    document_block_ids = (
        _ids(db, DocumentBlock, DocumentBlock.file_version_id.in_(file_version_ids))
        if file_version_ids
        else []
    )
    parsed_document_ids = (
        _ids(db, ParsedDocument, ParsedDocument.file_version_id.in_(file_version_ids))
        if file_version_ids
        else []
    )
    extraction_job_ids = (
        _ids(
            db,
            TemplateExtractionJob,
            TemplateExtractionJob.file_version_id.in_(file_version_ids),
        )
        if file_version_ids
        else []
    )

    field_value_ids = _ids(db, FieldValue, FieldValue.project_id == project.id)
    generation_job_ids = _ids(db, GenerationJob, GenerationJob.project_id == project.id)
    document_ids = _ids(db, Document, Document.project_id == project.id)
    document_version_ids = (
        _ids(db, DocumentVersion, DocumentVersion.document_id.in_(document_ids))
        if document_ids
        else []
    )
    document_section_ids = (
        _ids(db, DocumentSection, DocumentSection.document_version_id.in_(document_version_ids))
        if document_version_ids
        else []
    )
    content_block_ids = (
        _ids(
            db,
            DocumentContentBlock,
            DocumentContentBlock.document_section_id.in_(document_section_ids),
        )
        if document_section_ids
        else []
    )
    validation_run_ids = (
        _ids(db, ValidationRun, ValidationRun.document_version_id.in_(document_version_ids))
        if document_version_ids
        else []
    )
    export_job_ids = (
        _ids(db, ExportJob, ExportJob.document_version_id.in_(document_version_ids))
        if document_version_ids
        else []
    )
    comparison_run_ids = _ids(db, ComparisonRun, ComparisonRun.project_id == project.id)

    _ensure_no_active_jobs(
        db,
        generation_job_ids,
        parse_job_ids,
        extraction_job_ids,
        export_job_ids,
    )

    storage_keys = (
        list(
            db.scalars(
                select(FileVersion.storage_key).where(FileVersion.id.in_(file_version_ids))
            )
        )
        if file_version_ids
        else []
    )
    if export_job_ids:
        storage_keys.extend(
            key
            for key in db.scalars(
                select(ExportJob.storage_key).where(
                    ExportJob.id.in_(export_job_ids), ExportJob.storage_key.is_not(None)
                )
            )
            if key
        )
        storage_keys.extend(
            db.scalars(
                select(ExportArtifact.storage_key).where(
                    ExportArtifact.export_job_id.in_(export_job_ids)
                )
            )
        )

    if comparison_run_ids:
        db.execute(
            delete(ComparisonItem).where(
                ComparisonItem.comparison_run_id.in_(comparison_run_ids)
            )
        )
    _delete_by_ids(db, ComparisonRun, comparison_run_ids)

    if export_job_ids:
        db.execute(
            delete(ExportArtifact).where(ExportArtifact.export_job_id.in_(export_job_ids))
        )
    _delete_by_ids(db, ExportJob, export_job_ids)

    if validation_run_ids:
        db.execute(
            delete(FinalizationRecord).where(
                FinalizationRecord.validation_run_id.in_(validation_run_ids)
            )
        )
        db.execute(
            delete(ValidationIssue).where(ValidationIssue.validation_run_id.in_(validation_run_ids))
        )
    _delete_by_ids(db, ValidationRun, validation_run_ids)

    if document_version_ids:
        db.execute(
            delete(DocumentComment).where(
                DocumentComment.document_version_id.in_(document_version_ids)
            )
        )
    if content_block_ids:
        db.execute(
            delete(DocumentComment).where(DocumentComment.content_block_id.in_(content_block_ids))
        )
    _delete_by_ids(db, DocumentContentBlock, content_block_ids)
    _delete_by_ids(db, DocumentSection, document_section_ids)
    _delete_by_ids(db, DocumentVersion, document_version_ids)
    _delete_by_ids(db, Document, document_ids)

    if generation_job_ids:
        db.execute(
            delete(GenerationEvent).where(
                GenerationEvent.generation_job_id.in_(generation_job_ids)
            )
        )
        db.execute(
            delete(GenerationJobStep).where(
                GenerationJobStep.generation_job_id.in_(generation_job_ids)
            )
        )
    _delete_by_ids(db, GenerationJob, generation_job_ids)

    if field_value_ids:
        db.execute(
            delete(FieldConfirmation).where(
                FieldConfirmation.field_value_id.in_(field_value_ids)
            )
        )
        db.execute(delete(FieldEvidence).where(FieldEvidence.field_value_id.in_(field_value_ids)))
    if file_ids:
        db.execute(delete(FieldEvidence).where(FieldEvidence.source_file_id.in_(file_ids)))
    if file_version_ids:
        db.execute(
            delete(FieldEvidence).where(FieldEvidence.source_file_version_id.in_(file_version_ids))
        )
    if document_block_ids:
        db.execute(
            delete(FieldEvidence).where(FieldEvidence.document_block_id.in_(document_block_ids))
        )
    _delete_by_ids(db, FieldValue, field_value_ids)
    db.execute(delete(FieldConflict).where(FieldConflict.project_id == project.id))
    db.execute(delete(FieldSnapshot).where(FieldSnapshot.project_id == project.id))

    if parsed_document_ids:
        db.execute(
            delete(ParsedTable).where(ParsedTable.parsed_document_id.in_(parsed_document_ids))
        )
    if document_block_ids:
        db.execute(
            delete(ParsedTable).where(ParsedTable.document_block_id.in_(document_block_ids))
        )
    _delete_by_ids(db, ParsedDocument, parsed_document_ids)
    _delete_by_ids(db, TemplateExtractionJob, extraction_job_ids)
    _delete_by_ids(db, FileParseJob, parse_job_ids)
    _delete_by_ids(db, DocumentBlock, document_block_ids)
    _delete_by_ids(db, FileVersion, file_version_ids)
    _delete_by_ids(db, File, file_ids)

    db.execute(delete(ProjectStage).where(ProjectStage.project_id == project.id))
    db.execute(delete(ProjectMember).where(ProjectMember.project_id == project.id))
    db.delete(project)
    db.flush()
    return list(dict.fromkeys(storage_keys))
