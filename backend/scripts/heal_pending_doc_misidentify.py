#!/usr/bin/env python3
"""Dry-run / controlled archive for historically misidentified tender groups & candidates.

Usage:
  python -m backend.scripts.heal_pending_doc_misidentify --dry-run
  python -m backend.scripts.heal_pending_doc_misidentify --apply --organization-id <uuid>

Safety:
- Default is dry-run (no writes).
- Apply mode soft-archives (status=archived) unprotected misIDs; never hard-deletes.
- Protected items (user confirmations / finalized downstream docs) go to review queue JSON.
- Alias upgrades reuse merge_missing_aliases and never overwrite aliases_override.
- Pair with ensure_default_document_groups heal so archived errors are not regenerated.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import get_settings
from backend.app.field_catalog import merge_missing_aliases, needs_alias_upgrade
from backend.app.models import (
    AuditLog,
    Document,
    FieldDefinition,
    FieldEvidence,
    FieldValue,
    ProcurementPackage,
    TenderDocumentGroup,
    TenderDocumentGroupPackage,
)
from backend.app.services.rule_channel import NON_PACKAGE_ROW_MARKERS

FALSE_POSITIVE_NAME_PATTERNS = (
    re.compile(r"采购包名称\s*[|｜]\s*类别"),
    re.compile(r"可研采购估算"),
    re.compile(r"主要范围"),
    re.compile(r"^汇总"),
    re.compile(r"合计行?$"),
    re.compile(r"字段映射"),
)

BAD_CANDIDATE_VALUE_MARKERS = (
    "招标阶段生成",
    "可研通常不存在",
    "可提取",
)

PLATFORM_DEFAULT_METHODS = (
    "platform_default_one_package_one_document",
    "platform_default",
    "platform_suggestion_one_package_one_document",
)


@dataclass
class Finding:
    kind: str
    object_type: str
    object_id: str
    project_id: str | None
    organization_id: str
    summary: str
    evidence: dict[str, Any] = field(default_factory=dict)
    protected: bool = False
    protection_reasons: list[str] = field(default_factory=list)
    action: str = "review"  # archive | revoke_candidate | review | skip


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _session() -> Session:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def _looks_like_false_positive_name(name: str) -> bool:
    text = (name or "").strip()
    if not text:
        return False
    if any(marker in text for marker in NON_PACKAGE_ROW_MARKERS):
        return True
    return any(pattern.search(text) for pattern in FALSE_POSITIVE_NAME_PATTERNS)


def _group_protection(db: Session, group: TenderDocumentGroup) -> list[str]:
    reasons: list[str] = []
    scoped_prefix = f"doc::{group.id}::"
    confirmed = list(
        db.scalars(
            select(FieldValue).where(
                FieldValue.organization_id == group.organization_id,
                FieldValue.field_key.startswith(scoped_prefix),
                FieldValue.is_current.is_(True),
                FieldValue.status.in_(
                    ("user_confirmed", "system_confirmed", "system_authoritative")
                ),
            )
        )
    )
    if confirmed:
        reasons.append(f"scoped_confirmed_fields={len(confirmed)}")
    docs = list(
        db.scalars(
            select(Document).where(
                Document.procurement_document_group_id == group.id,
                Document.status.in_(("finalized", "ready_to_finalize", "published")),
            )
        )
    )
    if docs:
        reasons.append(f"downstream_documents={len(docs)}")
    user_edits = list(
        db.scalars(
            select(AuditLog).where(
                AuditLog.object_type == "tender_document_group",
                AuditLog.object_id == group.id,
                AuditLog.action.in_(
                    (
                        "procurement_plan.structure.update",
                        "tender_document_group.update",
                    )
                ),
            ).limit(5)
        )
    )
    if user_edits:
        reasons.append("user_structure_edits")
    return reasons


def _candidate_protection(field: FieldValue) -> list[str]:
    reasons: list[str] = []
    if field.status in {"user_confirmed", "system_confirmed", "system_authoritative", "finalized"}:
        reasons.append(f"status={field.status}")
    if field.source_type in {"user_input", "user_confirmed"}:
        reasons.append(f"source_type={field.source_type}")
    return reasons


def scan_misidentified_groups(db: Session, *, organization_id: str | None) -> list[Finding]:
    stmt = select(TenderDocumentGroup).where(TenderDocumentGroup.status == "active")
    if organization_id:
        stmt = stmt.where(TenderDocumentGroup.organization_id == organization_id)
    findings: list[Finding] = []
    for group in db.scalars(stmt):
        reasons: list[str] = []
        method = (group.organization_method or "").strip()
        if method in PLATFORM_DEFAULT_METHODS or method.startswith("platform_default"):
            reasons.append(f"organization_method={method}")
        if _looks_like_false_positive_name(group.name):
            reasons.append(f"false_positive_name={group.name}")
        if "汇总" in (group.name or "") and "包" not in (group.code or ""):
            reasons.append("summary_as_package_suspect")
        if not reasons:
            continue
        from backend.app.models import ProcurementPlan

        plan = db.get(ProcurementPlan, group.plan_id)
        protection = _group_protection(db, group)
        findings.append(
            Finding(
                kind="misidentified_group",
                object_type="tender_document_group",
                object_id=group.id,
                project_id=plan.project_id if plan else None,
                organization_id=group.organization_id,
                summary="; ".join(reasons),
                evidence={
                    "code": group.code,
                    "name": group.name,
                    "organization_method": group.organization_method,
                    "plan_id": group.plan_id,
                    "procurement_category": group.procurement_category,
                },
                protected=bool(protection),
                protection_reasons=protection,
                action="review" if protection else "archive",
            )
        )
    return findings


def scan_misidentified_packages(db: Session, *, organization_id: str | None) -> list[Finding]:
    stmt = select(ProcurementPackage)
    if organization_id:
        stmt = stmt.where(ProcurementPackage.organization_id == organization_id)
    findings: list[Finding] = []
    for package in db.scalars(stmt):
        if not _looks_like_false_positive_name(package.name):
            continue
        linked = db.scalar(
            select(TenderDocumentGroupPackage).where(
                TenderDocumentGroupPackage.package_id == package.id
            )
        )
        from backend.app.models import ProcurementPlan

        plan = db.get(ProcurementPlan, package.plan_id)
        findings.append(
            Finding(
                kind="false_positive_package",
                object_type="procurement_package",
                object_id=package.id,
                project_id=plan.project_id if plan else None,
                organization_id=package.organization_id,
                summary=f"package_name={package.name}",
                evidence={
                    "code": package.code,
                    "name": package.name,
                    "linked_group_id": linked.document_group_id if linked else None,
                },
                protected=False,
                action="review",
            )
        )
    return findings


def scan_bad_candidates(db: Session, *, organization_id: str | None) -> list[Finding]:
    stmt = select(FieldValue).where(
        FieldValue.is_current.is_(True),
        FieldValue.stage == "tender",
        FieldValue.status.in_(("extracted", "ai_suggested", "conflict", "reference_only")),
    )
    if organization_id:
        stmt = stmt.where(FieldValue.organization_id == organization_id)
    findings: list[Finding] = []
    for row in db.scalars(stmt):
        value_text = str(row.normalized_value if row.normalized_value is not None else row.value or "")
        bare_key = row.field_key
        if "::" in bare_key:
            bare_key = bare_key.rsplit("::", 1)[-1]
        bad = False
        if bare_key == "tender_number" and any(m in value_text for m in BAD_CANDIDATE_VALUE_MARKERS):
            bad = True
        if bare_key == "package_number" and "|" in value_text and "类别" in value_text:
            bad = True
        if bare_key == "acceptance_criteria" and value_text.strip() in {"可提取", "验收指标"}:
            bad = True
        if not bad:
            continue
        evidence_rows = list(
            db.scalars(select(FieldEvidence).where(FieldEvidence.field_value_id == row.id))
        )
        protection = _candidate_protection(row)
        findings.append(
            Finding(
                kind="bad_candidate",
                object_type="field_value",
                object_id=row.id,
                project_id=row.project_id,
                organization_id=row.organization_id,
                summary=f"{row.field_key}={value_text[:120]}",
                evidence={
                    "field_key": row.field_key,
                    "status": row.status,
                    "source_type": row.source_type,
                    "revision": row.revision,
                    "evidence_count": len(evidence_rows),
                    "excerpts": [item.excerpt for item in evidence_rows[:3]],
                },
                protected=bool(protection),
                protection_reasons=protection,
                action="review" if protection else "revoke_candidate",
            )
        )
    return findings


def migrate_aliases(db: Session, *, organization_id: str | None, apply: bool) -> dict[str, Any]:
    stmt = select(FieldDefinition)
    if organization_id:
        stmt = stmt.where(FieldDefinition.organization_id == organization_id)
    upgraded = 0
    skipped_custom = 0
    for definition in db.scalars(stmt):
        rules = dict(definition.rules or {})
        if rules.get("aliases_override"):
            skipped_custom += 1
            continue
        if not needs_alias_upgrade(rules):
            continue
        merged = merge_missing_aliases(rules, definition.field_key, definition.field_label)
        if apply:
            definition.rules = merged
            definition.revision = int(definition.revision or 1) + 1
        upgraded += 1
    return {"upgraded": upgraded, "skipped_custom_override": skipped_custom}


def apply_findings(db: Session, findings: list[Finding], *, actor_id: str | None) -> dict[str, Any]:
    archived = 0
    revoked = 0
    reviewed = 0
    for item in findings:
        if item.action == "review" or item.protected:
            reviewed += 1
            db.add(
                AuditLog(
                    organization_id=item.organization_id,
                    actor_user_id=actor_id,
                    action="heal.pending_doc.review_queue",
                    object_type=item.object_type,
                    object_id=item.object_id,
                    before=None,
                    after=asdict(item),
                    metadata_json={"kind": item.kind},
                    created_by=actor_id,
                    updated_by=actor_id,
                )
            )
            continue
        if item.action == "archive" and item.object_type == "tender_document_group":
            group = db.get(TenderDocumentGroup, item.object_id)
            if group is None or group.status != "active":
                continue
            before = {"status": group.status, "revision_note": "pre-archive"}
            group.status = "archived"
            group.updated_by = actor_id
            db.add(
                AuditLog(
                    organization_id=item.organization_id,
                    actor_user_id=actor_id,
                    action="heal.pending_doc.archive_group",
                    object_type="tender_document_group",
                    object_id=group.id,
                    before=before,
                    after={"status": "archived", "finding": asdict(item)},
                    metadata_json={"idempotent_key": f"archive:{group.id}"},
                    created_by=actor_id,
                    updated_by=actor_id,
                )
            )
            archived += 1
        elif item.action == "revoke_candidate" and item.object_type == "field_value":
            row = db.get(FieldValue, item.object_id)
            if row is None or not row.is_current:
                continue
            if _candidate_protection(row):
                reviewed += 1
                continue
            row.is_current = False
            revoked_row = FieldValue(
                organization_id=row.organization_id,
                project_id=row.project_id,
                stage=row.stage,
                definition_id=row.definition_id,
                field_key=row.field_key,
                field_label=row.field_label,
                data_type=row.data_type,
                value=None,
                normalized_value=None,
                unit=row.unit,
                criticality=row.criticality,
                status="revoked",
                source_type="system_heal",
                confidence=None,
                revision=row.revision + 1,
                is_current=True,
                created_by=actor_id,
                updated_by=actor_id,
            )
            db.add(revoked_row)
            db.add(
                AuditLog(
                    organization_id=item.organization_id,
                    actor_user_id=actor_id,
                    action="heal.pending_doc.revoke_candidate",
                    object_type="field_value",
                    object_id=row.id,
                    before={"status": row.status, "value": row.value, "revision": row.revision},
                    after={"status": "revoked", "revision": row.revision + 1},
                    metadata_json={"finding": asdict(item)},
                    created_by=actor_id,
                    updated_by=actor_id,
                )
            )
            revoked += 1
    return {"archived_groups": archived, "revoked_candidates": revoked, "review_queued": reviewed}


def run(dry_run: bool, organization_id: str | None, output: Path) -> int:
    db = _session()
    try:
        findings = [
            *scan_misidentified_groups(db, organization_id=organization_id),
            *scan_misidentified_packages(db, organization_id=organization_id),
            *scan_bad_candidates(db, organization_id=organization_id),
        ]
        alias_report = migrate_aliases(db, organization_id=organization_id, apply=not dry_run)
        apply_report: dict[str, Any] = {
            "archived_groups": 0,
            "revoked_candidates": 0,
            "review_queued": 0,
        }
        if not dry_run:
            apply_report = apply_findings(db, findings, actor_id=None)
            db.commit()
        else:
            db.rollback()

        report = {
            "generated_at": _utcnow().isoformat(),
            "dry_run": dry_run,
            "organization_id": organization_id,
            "finding_count": len(findings),
            "findings": [asdict(item) for item in findings],
            "alias_migration": alias_report,
            "apply_report": apply_report,
            "notes": {
                "soft_archive_only": True,
                "hard_delete": False,
                "heal_pairing": (
                    "After archive, call ensure-default-grouping only with explicit strategy; "
                    "without strategy it is a no-op and will not recreate platform_default groups."
                ),
                "rollback": (
                    "Restore group.status from archived→active via audited update, "
                    "or restore DB backup taken before --apply."
                ),
            },
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {output} findings={len(findings)} dry_run={dry_run}")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"heal failed: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--apply", action="store_true", default=False)
    parser.add_argument("--organization-id", default=None)
    parser.add_argument(
        "--output",
        default=str(
            Path("artifacts")
            / f"heal-pending-doc-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}.json"
        ),
    )
    args = parser.parse_args(argv)
    if args.apply and args.dry_run:
        print("Use either --dry-run or --apply, not both", file=sys.stderr)
        return 2
    dry_run = not args.apply
    return run(dry_run=dry_run, organization_id=args.organization_id, output=Path(args.output))


if __name__ == "__main__":
    raise SystemExit(main())
