from __future__ import annotations

import logging
import time
import uuid
from datetime import timedelta
from pathlib import Path

from celery import Task
from celery.signals import worker_ready
from redis import Redis
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .celery_app import celery_app
from .config import get_settings
from .db import SessionLocal
from .models import (
    DocumentBlock,
    DocumentVersion,
    ExportArtifact,
    ExportJob,
    File,
    FileParseJob,
    FileVersion,
    GenerationJob,
    GenerationJobStep,
    ParsedDocument,
    ParsedTable,
    ProcurementAnalysisRun,
    TemplateExtractionJob,
    utc_now,
)
from .services.auto_draft import build_file_auto_draft_job
from .services.exporting import export_filename, export_sha256, export_version
from .services.field_extraction import (
    backfill_project_metadata_from_blocks,
    extract_and_store_field_candidates,
)
from .services.generation import execute_generation_job
from .services.parsing import parse_file
from .services.procurement_planning import AnalysisTaskSuperseded, execute_analysis_run
from .services.providers import TEMPLATE_EXTRACTION_PROMPT_VERSION, get_provider
from .services.storage import get_storage
from .services.template_extraction import analyze_finished_document


class ExportVersionChangedError(RuntimeError):
    """The editable source changed after the export request was accepted."""


logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def parse_file_task(self: Task, parse_job_id: str) -> str:
    with SessionLocal() as db:
        job = db.get(FileParseJob, parse_job_id)
        if job is None:
            return "missing"
        version = db.get(FileVersion, job.file_version_id)
        if version is None:
            job.status = "failed"
            job.error = "File version not found"
            db.commit()
            return "failed"
        file_record = db.get(File, version.file_id)
        auto_generation_job: GenerationJob | None = None
        try:
            job.status = "running"
            job.attempt += 1
            job.started_at = utc_now()
            db.commit()
            content = get_storage().get(version.storage_key)
            result = parse_file(Path(version.storage_key).name, content)
            db.execute(delete(DocumentBlock).where(DocumentBlock.file_version_id == version.id))
            stored_blocks: list[DocumentBlock] = []
            for block in result.blocks:
                locator = dict(block.locator or {})
                if block.table_rows:
                    locator["table_rows"] = [list(row) for row in block.table_rows]
                stored = DocumentBlock(
                    organization_id=job.organization_id,
                    file_version_id=version.id,
                    sequence=block.sequence,
                    kind=block.kind,
                    text=block.text,
                    page_number=block.page_number,
                    section_path=block.section_path,
                    locator=locator,
                    confidence=block.confidence,
                    created_by=job.created_by,
                    updated_by=job.updated_by,
                )
                db.add(stored)
                stored_blocks.append(stored)
            db.flush()
            parsed_document = db.scalar(
                select(ParsedDocument).where(ParsedDocument.file_version_id == version.id)
            )
            if parsed_document is None:
                parsed_document = ParsedDocument(
                    organization_id=job.organization_id,
                    file_version_id=version.id,
                    parse_job_id=job.id,
                    created_by=job.created_by,
                    updated_by=job.updated_by,
                )
                db.add(parsed_document)
                db.flush()
            else:
                db.execute(delete(ParsedTable).where(ParsedTable.parsed_document_id == parsed_document.id))
            parsed_document.status = "needs_ocr" if result.needs_ocr else "parsed"
            unsupported = (result.coverage or {}).get("unsupported_reason")
            if unsupported and not result.blocks:
                parsed_document.status = "parse_failed"
                job.needs_ocr = False
                job.status = "failed"
                job.error = f"文档无法读取：{unsupported}"
                if file_record:
                    file_record.status = "failed"
                parsed_document.metadata_json = {
                    "block_count": 0,
                    "coverage": result.coverage,
                    "document_ir": result.document_ir.to_dict() if result.document_ir else None,
                    "unsupported_reason": unsupported,
                }
                job.finished_at = utc_now()
                db.commit()
                return "failed"
            parsed_document.metadata_json = {"block_count": len(stored_blocks)}
            for stored in stored_blocks:
                if stored.kind == "table":
                    locator = stored.locator or {}
                    structured_rows = locator.get("table_rows")
                    if isinstance(structured_rows, list) and structured_rows:
                        rows_payload = structured_rows
                    else:
                        rows_payload = [line.split(" | ") for line in stored.text.splitlines()]
                    db.add(
                        ParsedTable(
                            organization_id=job.organization_id,
                            parsed_document_id=parsed_document.id,
                            document_block_id=stored.id,
                            sequence=stored.sequence,
                            rows=rows_payload,
                            locator=locator,
                            created_by=job.created_by,
                            updated_by=job.updated_by,
                        )
                    )
            # Persist DocumentIR snapshot for dual-channel consumers.
            ir_payload = result.document_ir.to_dict() if result.document_ir else None
            actor_id = job.created_by
            if file_record:
                if not actor_id:
                    raise ValueError("字段提取任务缺少发起用户")
                extraction_summary = extract_and_store_field_candidates(
                    db,
                    file_record=file_record,
                    version=version,
                    blocks=stored_blocks,
                    actor_id=actor_id,
                )
                if file_record.project_id:
                    project_backfill = backfill_project_metadata_from_blocks(
                        db,
                        project_id=file_record.project_id,
                        blocks=stored_blocks,
                        actor_id=actor_id,
                    )
                else:
                    project_backfill = {"updated": False, "code": False, "description": False}
            else:
                extraction_summary = {
                    "created": 0,
                    "existing": 0,
                    "skipped": 0,
                    "created_keys": [],
                    "existing_keys": [],
                    "skipped_keys": [],
                }
                project_backfill = {"updated": False, "code": False, "description": False}
            parsed_document.metadata_json = {
                "block_count": len(stored_blocks),
                "field_extraction": extraction_summary,
                "project_metadata_backfill": project_backfill,
                "reader_version": result.document_ir.reader_version if result.document_ir else None,
                "coverage": result.coverage,
                "document_ir": ir_payload,
            }
            job.needs_ocr = result.needs_ocr
            job.status = "needs_ocr" if result.needs_ocr else "succeeded"
            if file_record:
                file_record.status = "needs_ocr" if result.needs_ocr else "parsed"
                if file_record.auto_generate_draft and not result.needs_ocr:
                    try:
                        if not job.created_by:
                            raise ValueError("自动草稿任务缺少发起用户")
                        auto_generation_job = build_file_auto_draft_job(
                            db,
                            file_record=file_record,
                            version=version,
                            actor_id=job.created_by,
                        )
                        parsed_document.metadata_json = {
                            **parsed_document.metadata_json,
                            "auto_draft": {
                                "status": auto_generation_job.status,
                                "generation_job_id": auto_generation_job.id,
                            },
                        }
                    except Exception as auto_exc:
                        file_record.auto_generation_error = str(auto_exc)[:2_000]
                        parsed_document.metadata_json = {
                            **parsed_document.metadata_json,
                            "auto_draft": {
                                "status": "blocked",
                                "error": str(auto_exc)[:2_000],
                            },
                        }
            job.finished_at = utc_now()
            job.error = None
            db.commit()
            if auto_generation_job is not None:
                try:
                    task = generate_document_task.delay(auto_generation_job.id)
                    db.expire_all()
                    refreshed_generation_job = db.get(GenerationJob, auto_generation_job.id)
                    if refreshed_generation_job and refreshed_generation_job.task_id is None:
                        refreshed_generation_job.task_id = task.id
                    refreshed_file = db.get(File, version.file_id)
                    if (
                        refreshed_file
                        and refreshed_generation_job
                        and refreshed_generation_job.status == "failed"
                    ):
                        refreshed_file.auto_generation_error = refreshed_generation_job.error
                    db.commit()
                except Exception as auto_exc:
                    db.rollback()
                    refreshed_file = db.get(File, version.file_id)
                    if refreshed_file:
                        refreshed_file.auto_generation_error = str(auto_exc)[:2_000]
                        db.commit()
            return job.status
        except Exception as exc:
            db.rollback()
            job = db.get(FileParseJob, parse_job_id)
            if job:
                job.status = "retrying" if self.request.retries < self.max_retries else "failed"
                job.error = str(exc)[:2_000]
                failed_version = db.get(FileVersion, job.file_version_id)
                failed_file = db.get(File, failed_version.file_id) if failed_version else None
                if failed_file and self.request.retries >= self.max_retries:
                    failed_file.status = "parse_failed"
                db.commit()
            raise self.retry(exc=exc) from exc


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def extract_template_task(self: Task, extraction_job_id: str) -> str:
    with SessionLocal() as db:
        job = db.get(TemplateExtractionJob, extraction_job_id)
        if job is None:
            return "missing"
        version = db.get(FileVersion, job.file_version_id)
        file_record = db.get(File, version.file_id) if version else None
        try:
            if version is None or file_record is None:
                raise ValueError("Template extraction source file was not found")
            provider = get_provider(organization_id=job.organization_id, db=db)
            job.status = "running"
            job.attempt += 1
            job.provider_name = provider.name
            job.model_name = provider.model
            job.prompt_version = TEMPLATE_EXTRACTION_PROMPT_VERSION
            job.started_at = utc_now()
            job.error = None
            db.commit()
            content = get_storage().get(version.storage_key)
            job = db.get(TemplateExtractionJob, extraction_job_id)
            if job is None:
                return "missing"
            result = analyze_finished_document(
                content,
                filename=file_record.original_name,
                stage=job.stage,
                provider=provider,
            )
            job.result_json = result
            quality = result.get("quality") if isinstance(result, dict) else None
            quality_passed = isinstance(quality, dict) and bool(quality.get("passed"))
            if quality_passed:
                job.status = "review_required"
                job.error = None
                file_record.status = "template_review"
            else:
                reasons = []
                if isinstance(quality, dict):
                    raw_reasons = quality.get("reasons") or []
                    if isinstance(raw_reasons, list):
                        reasons = [str(item) for item in raw_reasons]
                job.status = "quality_rejected"
                job.error = ("；".join(reasons) or "提取结果未通过正式模板质量门禁")[:2_000]
                file_record.status = "template_quality_rejected"
            job.finished_at = utc_now()
            job.revision += 1
            db.commit()
            return job.status
        except Exception as exc:
            db.rollback()
            job = db.get(TemplateExtractionJob, extraction_job_id)
            if job:
                job.status = "retrying" if self.request.retries < self.max_retries else "failed"
                job.error = str(exc)[:2_000]
                job.finished_at = utc_now() if self.request.retries >= self.max_retries else None
                job.revision += 1
                if file_record and self.request.retries >= self.max_retries:
                    file_record.status = "template_extract_failed"
                db.commit()
            raise self.retry(exc=exc) from exc


def enqueue_procurement_analysis(db: Session, run: ProcurementAnalysisRun) -> str:
    task_id = str(uuid.uuid4())
    run.task_id = task_id
    run.status = "queued"
    run.error = None
    run.started_at = None
    run.finished_at = None
    run.revision += 1
    db.commit()
    try:
        analyze_procurement_task.apply_async(args=[run.id], task_id=task_id)
    except Exception as exc:
        db.rollback()
        refreshed = db.get(ProcurementAnalysisRun, run.id)
        if refreshed is not None and refreshed.task_id == task_id:
            refreshed.status = "failed"
            refreshed.error = f"Failed to enqueue procurement analysis: {exc}"[:2_000]
            refreshed.finished_at = utc_now()
            db.commit()
        raise
    return task_id


@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    soft_time_limit=settings.procurement_analysis_soft_time_limit_seconds,
    time_limit=settings.procurement_analysis_time_limit_seconds,
)
def analyze_procurement_task(self: Task, analysis_run_id: str) -> str:
    with SessionLocal() as db:
        run = db.get(ProcurementAnalysisRun, analysis_run_id)
        if run is None:
            return "missing"
        if run.task_id and run.task_id != self.request.id:
            return "superseded"
        try:
            plans = execute_analysis_run(db, analysis_run_id, expected_task_id=str(self.request.id))
            db.commit()
            return plans[0].id if plans else "no-plan"
        except AnalysisTaskSuperseded:
            db.rollback()
            return "superseded"
        except Exception as exc:
            db.rollback()
            run = db.get(ProcurementAnalysisRun, analysis_run_id)
            if run and run.task_id == self.request.id:
                run.status = "retrying" if self.request.retries < self.max_retries else "failed"
                run.error = str(exc)[:2_000]
                run.finished_at = utc_now() if self.request.retries >= self.max_retries else None
                run.revision += 1
                db.commit()
            raise self.retry(exc=exc) from exc


def recover_stale_procurement_analyses() -> int:
    cutoff = utc_now() - timedelta(seconds=settings.procurement_analysis_stale_after_seconds)
    recovered: list[str] = []
    with SessionLocal() as db:
        runs = list(
            db.scalars(
                select(ProcurementAnalysisRun)
                .where(
                    ProcurementAnalysisRun.status.in_({"queued", "running", "retrying"}),
                    ProcurementAnalysisRun.updated_at < cutoff,
                )
                .with_for_update(skip_locked=True)
            )
        )
        for run in runs:
            enqueue_procurement_analysis(db, run)
            recovered.append(run.id)
    if recovered:
        logger.warning("Recovered %d stale procurement analyses", len(recovered))
    return len(recovered)


@celery_app.task(ignore_result=True)
def procurement_analysis_watchdog_task() -> int:
    interval = max(15, settings.procurement_analysis_recovery_interval_seconds)
    bucket = int(time.time() // interval)
    client = Redis.from_url(settings.redis_url)
    try:
        acquired = bool(
            client.set(
                f"docchain:procurement-analysis-watchdog:{bucket}",
                str(uuid.uuid4()),
                nx=True,
                ex=interval * 3,
            )
        )
    finally:
        client.close()
    if not acquired:
        return 0
    try:
        return recover_stale_procurement_analyses()
    except Exception:
        logger.exception("Failed to recover stale procurement analyses")
        return 0
    finally:
        procurement_analysis_watchdog_task.apply_async(countdown=interval)


@worker_ready.connect
def start_procurement_analysis_watchdog(**_kwargs: object) -> None:
    if not settings.celery_task_always_eager:
        procurement_analysis_watchdog_task.apply_async(countdown=1)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def generate_document_task(self: Task, job_id: str) -> str:
    with SessionLocal() as db:
        try:
            version = execute_generation_job(db, job_id)
            db.commit()
            return version.id
        except Exception as exc:
            db.rollback()
            job = db.get(GenerationJob, job_id)
            if job:
                job.status = "retrying" if self.request.retries < self.max_retries else "failed"
                job.error = str(exc)[:2_000]
                step_status = "retrying" if self.request.retries < self.max_retries else "failed"
                for step in db.scalars(
                    select(GenerationJobStep).where(
                        GenerationJobStep.generation_job_id == job.id,
                        GenerationJobStep.status.in_({"running", "retrying"}),
                    )
                ):
                    step.status = step_status
                    step.error = job.error
                db.commit()
            raise self.retry(exc=exc) from exc


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def export_document_task(self: Task, export_job_id: str) -> str:
    with SessionLocal() as db:
        job = db.get(ExportJob, export_job_id)
        if job is None:
            return "missing"
        try:
            if job.status == "succeeded" and job.storage_key and get_storage().exists(job.storage_key):
                return job.storage_key
            version = db.get(DocumentVersion, job.document_version_id)
            if version is None:
                raise ValueError("Document version not found")
            if version.revision != job.document_revision:
                raise ExportVersionChangedError("文档在导出任务开始前已更新，请重新生成预览或导出文件")
            job.status = "running"
            db.commit()
            content = export_version(db, version, job.output_format)
            db.refresh(version)
            if version.revision != job.document_revision:
                raise ExportVersionChangedError("文档在导出过程中已更新，请重新生成预览或导出文件")
            key = (
                f"{job.organization_id}/exports/{version.document_id}/"
                f"v{version.version}/{job.id}.{job.output_format}"
            )
            mime = {
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "pdf": "application/pdf",
                "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }[job.output_format]
            get_storage().put(key, content, mime)
            job.storage_key = key
            job.sha256 = export_sha256(content)
            job.status = "succeeded"
            job.error = None
            existing_artifact = db.scalar(
                select(ExportArtifact).where(ExportArtifact.export_job_id == job.id)
            )
            if existing_artifact is None:
                db.add(
                    ExportArtifact(
                        organization_id=job.organization_id,
                        export_job_id=job.id,
                        storage_key=key,
                        filename=export_filename(db, version, job.output_format),
                        mime_type=mime,
                        size_bytes=len(content),
                        sha256=job.sha256,
                        metadata_json={
                            "document_version_id": version.id,
                            "format_profile": version.provenance.get("format_profile"),
                            "template_id": version.provenance.get("template_id"),
                            "template_version": version.provenance.get("template_version"),
                            "template_sha256": version.provenance.get("template_sha256"),
                            "document_status": version.status,
                            "generated_at": utc_now().isoformat(),
                        },
                        created_by=job.created_by,
                        updated_by=job.updated_by,
                    )
                )
            db.commit()
            return key
        except Exception as exc:
            db.rollback()
            job = db.get(ExportJob, export_job_id)
            if job:
                job.status = (
                    "failed"
                    if isinstance(exc, ExportVersionChangedError)
                    else ("retrying" if self.request.retries < self.max_retries else "failed")
                )
                job.error = str(exc)[:2_000]
                db.commit()
            if isinstance(exc, ExportVersionChangedError):
                return "stale"
            raise self.retry(exc=exc) from exc
