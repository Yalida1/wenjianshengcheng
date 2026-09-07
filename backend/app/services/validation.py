from __future__ import annotations

import re
from collections import Counter
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    DocumentContentBlock,
    DocumentSection,
    DocumentVersion,
    FieldConfirmation,
    FieldDefinition,
    FieldEvidence,
    FieldValue,
    ValidationIssue,
    ValidationRun,
    utc_now,
)

BLOCKING_FIELD_STATUSES = {
    "missing",
    "conflict",
    "invalid",
    "ai_suggested",
    "reference_only",
    "extracted",
}
PLACEHOLDER_PATTERN = re.compile(r"\{\{[^{}]+\}\}|\[\[[^\[\]]+\]\]|__+[A-Za-z0-9_]+__+")


def _issue(
    db: Session,
    run: ValidationRun,
    *,
    rule_key: str,
    severity: str,
    message: str,
    location: dict[str, object],
) -> None:
    db.add(
        ValidationIssue(
            organization_id=run.organization_id,
            validation_run_id=run.id,
            rule_key=rule_key,
            severity=severity,
            message=message,
            location=location,
            created_by=run.created_by,
            updated_by=run.updated_by,
        )
    )


def validate_document_version(db: Session, version: DocumentVersion) -> ValidationRun:
    document = version.document_id
    from ..models import Document

    doc = db.get(Document, document)
    if doc is None:
        raise ValueError("Document not found")
    run = ValidationRun(
        organization_id=version.organization_id,
        document_version_id=version.id,
        status="running",
        created_by=version.updated_by,
        updated_by=version.updated_by,
    )
    db.add(run)
    db.flush()

    fields = list(
        db.scalars(
            select(FieldValue).where(
                FieldValue.project_id == doc.project_id,
                FieldValue.stage == doc.stage,
                FieldValue.is_current.is_(True),
            )
        )
    )
    current_by_key = {field.field_key: field for field in fields}
    required_definitions = list(
        db.scalars(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == version.organization_id,
                FieldDefinition.stage == doc.stage,
                FieldDefinition.required.is_(True),
            )
        )
    )
    for definition in required_definitions:
        if definition.field_key not in current_by_key:
            _issue(
                db,
                run,
                rule_key="required_field_missing",
                severity="P0" if definition.criticality == "P0" else "P1",
                message=f"必需字段“{definition.field_label}”尚未建立",
                location={"field_key": definition.field_key},
            )
    for field in fields:
        if field.criticality != "P0":
            continue
        if field.status in BLOCKING_FIELD_STATUSES:
            _issue(
                db,
                run,
                rule_key="p0_status",
                severity="P0",
                message=f"P0 字段“{field.field_label}”状态为 {field.status}，不能定稿",
                location={"field_value_id": field.id, "field_key": field.field_key},
            )
        has_evidence = db.scalar(
            select(FieldEvidence.id).where(FieldEvidence.field_value_id == field.id).limit(1)
        )
        has_confirmation = db.scalar(
            select(FieldConfirmation.id).where(FieldConfirmation.field_value_id == field.id).limit(1)
        )
        if field.status not in {"system_authoritative", "not_applicable"} and not (
            has_evidence or has_confirmation
        ):
            _issue(
                db,
                run,
                rule_key="p0_traceability",
                severity="P0",
                message=f"P0 字段“{field.field_label}”缺少来源证据或人工确认",
                location={"field_value_id": field.id, "field_key": field.field_key},
            )

    if doc.stage == "contract":
        amount_field = current_by_key.get("final_contract_amount")
        payment_field = current_by_key.get("payment_plan")
        if amount_field and payment_field:
            amount_value = (
                amount_field.normalized_value
                if amount_field.normalized_value is not None
                else amount_field.value
            )
            payment_value = (
                payment_field.normalized_value
                if payment_field.normalized_value is not None
                else payment_field.value
            )
            if isinstance(payment_value, list):
                try:
                    payment_errors = validate_contract_payments(
                        Decimal(str(amount_value)), payment_value
                    )
                except (KeyError, TypeError, ValueError, ArithmeticError):
                    payment_errors = ["付款计划结构无效"]
                for message in payment_errors:
                    _issue(
                        db,
                        run,
                        rule_key="contract_payment_consistency",
                        severity="P0",
                        message=message,
                        location={"field_key": "payment_plan"},
                    )
            else:
                _issue(
                    db,
                    run,
                    rule_key="contract_payment_structure",
                    severity="P0",
                    message="付款计划必须是结构化付款节点列表",
                    location={"field_key": "payment_plan"},
                )
    sections = list(
        db.scalars(select(DocumentSection).where(DocumentSection.document_version_id == version.id))
    )
    if not sections:
        _issue(
            db,
            run,
            rule_key="required_sections",
            severity="P0",
            message="文档没有任何章节",
            location={"document_version_id": version.id},
        )
    section_ids = [section.id for section in sections]
    blocks = (
        list(
            db.scalars(
                select(DocumentContentBlock).where(DocumentContentBlock.document_section_id.in_(section_ids))
            )
        )
        if section_ids
        else []
    )
    for block in blocks:
        text = str(block.content)
        if PLACEHOLDER_PATTERN.search(text):
            _issue(
                db,
                run,
                rule_key="unresolved_placeholder",
                severity="P0",
                message="内容中仍有未替换变量",
                location={"content_block_id": block.id},
            )
        if block.source_kind == "ai_generated" and not block.reviewed:
            _issue(
                db,
                run,
                rule_key="ai_review",
                severity="P0",
                message="AI 生成内容尚未人工审阅",
                location={"content_block_id": block.id},
            )

    db.flush()
    severities = list(
        db.scalars(select(ValidationIssue.severity).where(ValidationIssue.validation_run_id == run.id))
    )
    counts = Counter(severities)
    run.issue_counts = {key: counts.get(key, 0) for key in ("P0", "P1", "P2")}
    run.status = "failed" if counts.get("P0", 0) else "passed"
    run.finished_at = utc_now()
    return run


def validate_contract_payments(final_amount: Decimal, items: list[dict[str, object]]) -> list[str]:
    errors: list[str] = []
    ratio_total = sum(Decimal(str(item["ratio"])) for item in items)
    amount_total = sum(Decimal(str(item["amount"])) for item in items)
    if ratio_total != Decimal("100"):
        errors.append(f"付款比例合计为 {ratio_total}%，必须等于 100%")
    if amount_total != final_amount:
        errors.append(f"付款金额合计为 {amount_total}，必须等于最终合同金额 {final_amount}")
    for index, item in enumerate(items, 1):
        if not str(item.get("trigger", "")).strip():
            errors.append(f"第 {index} 个付款节点缺少触发条件")
    return errors
