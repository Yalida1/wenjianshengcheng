from __future__ import annotations

from pathlib import Path

from celery import Task
from sqlalchemy import delete, select

from .celery_app import celery_app
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
    ParsedDocument,
    ParsedTable,
    utc_now,
)
from .services.exporting import export_sha256, export_version
from .services.generation import execute_generation_job
from .services.parsing import parse_file
from .services.storage import get_storage


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
                stored = DocumentBlock(
                    organization_id=job.organization_id,
                    file_version_id=version.id,
                    sequence=block.sequence,
                    kind=block.kind,
                    text=block.text,
                    page_number=block.page_number,
                    section_path=block.section_path,
                    locator=block.locator or {},
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
                db.execute(
                    delete(ParsedTable).where(ParsedTable.parsed_document_id == parsed_document.id)
                )
            parsed_document.status = "needs_ocr" if result.needs_ocr else "parsed"
            parsed_document.metadata_json = {"block_count": len(stored_blocks)}
            for stored in stored_blocks:
                if stored.kind == "table":
                    db.add(
                        ParsedTable(
                            organization_id=job.organization_id,
                            parsed_document_id=parsed_document.id,
                            document_block_id=stored.id,
                            sequence=stored.sequence,
                            rows=[line.split(" | ") for line in stored.text.splitlines()],
                            locator=stored.locator,
                            created_by=job.created_by,
                            updated_by=job.updated_by,
                        )
                    )
            job.needs_ocr = result.needs_ocr
            job.status = "needs_ocr" if result.needs_ocr else "succeeded"
            if file_record:
                file_record.status = "needs_ocr" if result.needs_ocr else "parsed"
            job.finished_at = utc_now()
            job.error = None
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
            job.status = "running"
            db.commit()
            content = export_version(db, version, job.output_format)
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
                        filename=f"document_V{version.version}.{job.output_format}",
                        mime_type=mime,
                        size_bytes=len(content),
                        sha256=job.sha256,
                        metadata_json={
                            "document_version_id": version.id,
                            "format_profile": version.provenance.get("format_profile"),
                            "template_id": version.provenance.get("template_id"),
                            "template_version": version.provenance.get("template_version"),
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
                job.status = "retrying" if self.request.retries < self.max_retries else "failed"
                job.error = str(exc)[:2_000]
                db.commit()
            raise self.retry(exc=exc) from exc
