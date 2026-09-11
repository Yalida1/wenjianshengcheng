"""Idempotent incremental field re-extraction from already-parsed blocks.

First parse_file_task may run before document groups exist. Later analysis /
template / profile changes only refresh the applicable list — callers use this
service to backfill new applicable fields without re-reading files or calling LLM.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DocumentBlock, File, FileVersion, ParsedDocument
from .field_extraction import extract_and_store_field_candidates, resolve_package_group_map


def list_parsed_stage_files(
    db: Session,
    *,
    project_id: str,
    organization_id: str,
    stage: str = "tender",
) -> list[tuple[File, FileVersion, list[DocumentBlock]]]:
    files = list(
        db.scalars(
            select(File).where(
                File.project_id == project_id,
                File.organization_id == organization_id,
                File.stage == stage,
                File.status == "parsed",
            )
        )
    )
    results: list[tuple[File, FileVersion, list[DocumentBlock]]] = []
    for file_record in files:
        version = db.scalar(
            select(FileVersion).where(
                FileVersion.file_id == file_record.id,
                FileVersion.version == file_record.latest_version,
            )
        )
        if version is None:
            continue
        blocks = list(
            db.scalars(
                select(DocumentBlock)
                .where(DocumentBlock.file_version_id == version.id)
                .order_by(DocumentBlock.sequence)
            )
        )
        if not blocks:
            continue
        results.append((file_record, version, blocks))
    return results


def refresh_field_candidates_from_parsed_blocks(
    db: Session,
    *,
    project_id: str,
    organization_id: str,
    actor_id: str,
    stage: str = "tender",
    reason: str = "applicable_fields_changed",
    document_group_id: str | None = None,
    file_id: str | None = None,
) -> dict[str, Any]:
    """Re-run rule extraction on stored blocks; never re-read storage or call LLM.

    Protected statuses (confirmed / user-modified / finalized) are never overwritten —
    delegated to extract_and_store_field_candidates.
    """

    package_group_map = resolve_package_group_map(
        db, project_id=project_id, organization_id=organization_id
    )
    targets = list_parsed_stage_files(
        db, project_id=project_id, organization_id=organization_id, stage=stage
    )
    if file_id:
        targets = [item for item in targets if item[0].id == file_id]

    aggregate = {
        "reason": reason,
        "files_processed": 0,
        "created": 0,
        "existing": 0,
        "skipped": 0,
        "revised": 0,
        "conflicts": 0,
        "created_keys": [],
        "existing_keys": [],
        "skipped_keys": [],
        "revised_keys": [],
        "file_summaries": [],
    }
    for file_record, version, blocks in targets:
        summary = extract_and_store_field_candidates(
            db,
            file_record=file_record,
            version=version,
            blocks=blocks,
            actor_id=actor_id,
            package_group_map=package_group_map,
            document_group_id=document_group_id,
        )
        parsed_document = db.scalar(
            select(ParsedDocument).where(ParsedDocument.file_version_id == version.id)
        )
        if parsed_document:
            parsed_document.metadata_json = {
                **(parsed_document.metadata_json or {}),
                "field_extraction": summary,
                "field_extraction_refresh_reason": reason,
            }
        aggregate["files_processed"] += 1
        for key in ("created", "existing", "skipped", "revised", "conflicts"):
            aggregate[key] = int(aggregate[key]) + int(summary.get(key, 0))
        for key in ("created_keys", "existing_keys", "skipped_keys", "revised_keys"):
            aggregate[key].extend(summary.get(key, []))
        aggregate["file_summaries"].append(
            {"file_id": file_record.id, "file_version_id": version.id, **summary}
        )
    return aggregate


def extract_file_field_candidates_idempotent(
    db: Session,
    *,
    file_record: File,
    version: FileVersion,
    blocks: list[DocumentBlock],
    actor_id: str,
    document_group_id: str | None = None,
) -> dict[str, Any]:
    """Single-file entry used by /field-candidates and parse_file_task."""

    package_group_map = None
    if file_record.project_id:
        package_group_map = resolve_package_group_map(
            db,
            project_id=file_record.project_id,
            organization_id=file_record.organization_id,
        )
    return extract_and_store_field_candidates(
        db,
        file_record=file_record,
        version=version,
        blocks=blocks,
        actor_id=actor_id,
        package_group_map=package_group_map,
        document_group_id=document_group_id,
    )
