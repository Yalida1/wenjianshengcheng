from __future__ import annotations

import re
from collections import Counter
from datetime import datetime
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
    ProcurementIssue,
    ProcurementPlan,
    TemplateSection,
    TemplateVersion,
    ValidationIssue,
    ValidationRun,
    utc_now,
)
from .tender_document import scoring_total

BLOCKING_FIELD_STATUSES = {
    "missing",
    "conflict",
    "invalid",
    "ai_suggested",
    "reference_only",
    "extracted",
}
CONFIRMED_FIELD_STATUSES = {
    "user_confirmed",
    "system_confirmed",
    "system_authoritative",
    "not_applicable",
}
PLACEHOLDER_PATTERN = re.compile(
    r"\{\{[^{}]+\}\}|\[\[[^\[\]]+\]\]|__+[A-Za-z0-9_]+__+|\bTBD\b|XXX|待填写|【待确认[^】]*】",
    re.IGNORECASE,
)
INTERNAL_MARKER_PATTERN = re.compile(
    r"\bai_generated\b|\bP[01]\b|人工录入|平台内部字段|请回到官方原文核对",
    re.IGNORECASE,
)


def _searchable_content_text(value: object) -> str:
    """Flatten actual text values without turning JSON arrays into ``[[...]]`` markers."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "\n".join(_searchable_content_text(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return "\n".join(_searchable_content_text(item) for item in value)
    return "" if value is None else str(value)


def _first_datetime(value: object) -> datetime | None:
    match = re.search(
        r"(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2}))?",
        str(value or ""),
    )
    if not match:
        return None
    try:
        return datetime(
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3)),
            int(match.group(4) or 0),
            int(match.group(5) or 0),
        )
    except ValueError:
        return None


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
    from .generation import field_snapshot, field_values_by_key, procurement_locked_values

    current_by_key = field_values_by_key(fields, doc.procurement_document_group_id)
    current_fields = list(current_by_key.values())

    current_snapshot_sha256, current_snapshot_values = field_snapshot(
        current_fields,
        include_candidates=version.provenance.get("field_snapshot_mode") == "candidate_draft",
        procurement_document_group_id=doc.procurement_document_group_id,
    )
    procurement_snapshot = version.provenance.get("procurement_snapshot")
    if not isinstance(procurement_snapshot, dict):
        procurement_snapshot = None
    current_snapshot_sha256, _current_snapshot_values = procurement_locked_values(
        current_snapshot_values,
        doc.stage,
        procurement_snapshot,
    )
    locked_snapshot_sha256 = version.provenance.get("field_snapshot_sha256")
    if (
        isinstance(locked_snapshot_sha256, str)
        and locked_snapshot_sha256
        and current_snapshot_sha256 != locked_snapshot_sha256
    ):
        _issue(
            db,
            run,
            rule_key="field_snapshot_stale",
            severity="P0",
            message="文档生成后字段已发生变化，请基于最新字段重新生成文档版本",
            location={
                "locked_sha256": locked_snapshot_sha256,
                "current_sha256": current_snapshot_sha256,
            },
        )
    required_definitions = list(
        db.scalars(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == version.organization_id,
                FieldDefinition.stage == doc.stage,
                FieldDefinition.required.is_(True),
                FieldDefinition.is_active.is_(True),
            )
        )
    )
    applicable_required_keys: set[str] | None = None
    applicable_blocking_keys: set[str] | None = None
    if doc.stage == "tender" and doc.procurement_document_group_id:
        from .applicable_fields import get_document_group_for_project, resolve_applicable_fields

        group = get_document_group_for_project(
            db,
            project_id=doc.project_id,
            group_id=doc.procurement_document_group_id,
        )
        if group is not None:
            applicable = resolve_applicable_fields(
                db,
                project_id=doc.project_id,
                document_group=group,
                organization_id=version.organization_id,
            )
            for issue in applicable.template_config_errors:
                _issue(
                    db,
                    run,
                    rule_key="template_variable_undefined",
                    severity="P0",
                    message=issue.message,
                    location={
                        "variable_key": issue.variable_key,
                        "document_group_id": group.id,
                        "template_id": group.template_id,
                    },
                )
            if applicable.setup_incomplete:
                _issue(
                    db,
                    run,
                    rule_key="tender_setup_incomplete",
                    severity="P0",
                    message=(
                        applicable.setup_incomplete_reason
                        or "模板/招标配置未完成，不得按材料采集完成度定稿"
                    ),
                    location={
                        "document_group_id": group.id,
                        "profile": applicable.profile,
                        "template_id": group.template_id,
                    },
                )
            applicable_required_keys = applicable.required_keys()
            applicable_blocking_keys = applicable.blocking_keys()
            # Rebuild required definitions from applicable required fields only.
            definitions_by_key = {
                item.field_key: item
                for item in db.scalars(
                    select(FieldDefinition).where(
                        FieldDefinition.organization_id == version.organization_id,
                        FieldDefinition.stage == doc.stage,
                        FieldDefinition.is_active.is_(True),
                    )
                )
            }
            required_definitions = []
            for field_key in sorted(applicable_required_keys):
                definition = definitions_by_key.get(field_key)
                if definition is not None:
                    required_definitions.append(definition)
                elif field_key not in current_by_key:
                    _issue(
                        db,
                        run,
                        rule_key="required_field_missing",
                        severity="P0",
                        message=f"必需字段“{field_key}”尚未建立",
                        location={"field_key": field_key},
                    )
    active_definition_keys = {
        key
        for key in db.scalars(
            select(FieldDefinition.field_key).where(
                FieldDefinition.organization_id == version.organization_id,
                FieldDefinition.stage == doc.stage,
                FieldDefinition.is_active.is_(True),
            )
        )
    }
    if applicable_required_keys is not None:
        active_definition_keys = set(applicable_required_keys) | set(
            applicable_blocking_keys or ()
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
    for field_key, field in current_by_key.items():
        if field_key not in active_definition_keys:
            continue
        if applicable_blocking_keys is not None and field_key not in applicable_blocking_keys:
            # Non-applicable / non-blocking fields do not gate finalization.
            continue
        if field.criticality not in {"P0", "P1"}:
            continue
        if field.status in BLOCKING_FIELD_STATUSES:
            _issue(
                db,
                run,
                rule_key=f"{field.criticality.lower()}_status",
                severity=field.criticality,
                message=f"{field.criticality} 字段“{field.field_label}”状态为 {field.status}，不能定稿",
                location={"field_value_id": field.id, "field_key": field_key},
            )
        if field.criticality != "P0":
            continue
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
                location={"field_value_id": field.id, "field_key": field_key},
            )

    procurement_plan_id = version.provenance.get("procurement_plan_id")
    if isinstance(procurement_plan_id, str) and procurement_plan_id:
        procurement_plan = db.get(ProcurementPlan, procurement_plan_id)
        if procurement_plan is None or procurement_plan.status != "confirmed":
            _issue(
                db,
                run,
                rule_key="procurement_plan_not_confirmed",
                severity="P0",
                message="文档绑定的采购方案不存在或尚未确认",
                location={"procurement_plan_id": procurement_plan_id},
            )
        else:
            locked = version.provenance.get("procurement_snapshot")
            locked_source_sha = (
                locked.get("plan", {}).get("source_sha256")
                if isinstance(locked, dict) and isinstance(locked.get("plan"), dict)
                else None
            )
            if locked_source_sha != procurement_plan.source_sha256:
                _issue(
                    db,
                    run,
                    rule_key="procurement_source_stale",
                    severity="P0",
                    message="采购方案来源版本已变化，请复核后重新生成",
                    location={"procurement_plan_id": procurement_plan_id},
                )
            if not procurement_plan.finalization_allowed:
                plan_issues = list(
                    db.scalars(
                        select(ProcurementIssue).where(
                            ProcurementIssue.plan_id == procurement_plan.id,
                            ProcurementIssue.status == "open",
                            ProcurementIssue.severity.in_(["P0", "P1"]),
                        )
                    )
                )
                resolved_by_document_fields: set[str] = set()
                procurement_budget = current_by_key.get("procurement_budget")
                maximum_price = current_by_key.get("maximum_price")
                if procurement_budget and procurement_budget.status in CONFIRMED_FIELD_STATUSES:
                    resolved_by_document_fields.add("budget.confirmed_missing")
                if maximum_price and maximum_price.status in CONFIRMED_FIELD_STATUSES:
                    resolved_by_document_fields.add("budget.maximum_price_missing")
                blocking_plan_issues = [
                    item for item in plan_issues if item.code not in resolved_by_document_fields
                ]
                if blocking_plan_issues:
                    _issue(
                        db,
                        run,
                        rule_key="procurement_plan_finalization_blocked",
                        severity="P0",
                        message="采购方案仍有预算、限价、范围或模板待确认项，当前版本只能作为草稿",
                        location={
                            "procurement_plan_id": procurement_plan_id,
                            "issue_codes": [item.code for item in blocking_plan_issues],
                        },
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
                    payment_errors = validate_contract_payments(Decimal(str(amount_value)), payment_value)
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
    if doc.stage == "tender":

        def current_value(key: str) -> object | None:
            item = current_by_key.get(key)
            if item is None:
                return None
            return item.normalized_value if item.normalized_value is not None else item.value

        budget_value = current_value("procurement_budget")
        ceiling_value = current_value("maximum_price")
        if budget_value not in (None, "") and ceiling_value not in (None, ""):
            try:
                if Decimal(str(ceiling_value)) > Decimal(str(budget_value)):
                    _issue(
                        db,
                        run,
                        rule_key="tender_amount_consistency",
                        severity="P0",
                        message="最高投标限价不得高于已确认招标预算",
                        location={"field_key": "maximum_price", "related_field_key": "procurement_budget"},
                    )
            except (ArithmeticError, TypeError, ValueError):
                _issue(
                    db,
                    run,
                    rule_key="tender_amount_invalid",
                    severity="P0",
                    message="招标预算或最高投标限价无法按金额校验",
                    location={"field_key": "maximum_price"},
                )
        deadline = _first_datetime(current_value("bid_deadline"))
        opening = _first_datetime(current_value("bid_opening"))
        if deadline and opening and opening < deadline:
            _issue(
                db,
                run,
                rule_key="tender_date_logic",
                severity="P0",
                message="开标时间不得早于投标截止时间",
                location={"field_key": "bid_opening", "related_field_key": "bid_deadline"},
            )
        scope_text = str(current_value("procurement_scope") or "")
        procurement_kinds = {
            "设备": any(token in scope_text for token in ("设备", "硬件", "服务器", "网络")),
            "软件": any(token in scope_text for token in ("软件", "平台", "系统开发")),
            "施工": any(token in scope_text for token in ("施工", "土建", "工程改造")),
            "运维服务": any(token in scope_text for token in ("运维", "维保", "多年服务")),
        }
        detected = [label for label, present in procurement_kinds.items() if present]
        if not version.provenance.get("template_applicability_confirmed"):
            detail = f"采购范围同时涉及{'、'.join(detected)}，" if len(detected) >= 2 else ""
            _issue(
                db,
                run,
                rule_key="tender_template_applicability_confirmation",
                severity="P0",
                message=f"{detail}须确认采购制度、采购属性和模板适用范围后再定稿",
                location={"field_key": "procurement_scope", "detected_categories": detected},
            )
    sections = list(
        db.scalars(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == version.id)
            .order_by(DocumentSection.sequence)
        )
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
    required_keys: list[str] = []
    template_id = version.provenance.get("template_id")
    template_version_number = version.provenance.get("template_version")
    if isinstance(template_id, str) and isinstance(template_version_number, int):
        template_version = db.scalar(
            select(TemplateVersion).where(
                TemplateVersion.template_id == template_id,
                TemplateVersion.version == template_version_number,
            )
        )
        if template_version is None:
            _issue(
                db,
                run,
                rule_key="template_version_missing",
                severity="P0",
                message="文档锁定的模板版本不存在",
                location={"template_id": template_id, "template_version": template_version_number},
            )
        else:
            template_sections = list(
                db.scalars(
                    select(TemplateSection)
                    .where(
                        TemplateSection.template_version_id == template_version.id,
                        TemplateSection.required.is_(True),
                    )
                    .order_by(TemplateSection.sequence)
                )
            )
            actual_keys = [section.key for section in sections]
            required_keys = [section.key for section in template_sections]
            missing_keys = [key for key in required_keys if key not in actual_keys]
            if missing_keys:
                _issue(
                    db,
                    run,
                    rule_key="required_sections_missing",
                    severity="P0",
                    message=f"缺少模板必需章节：{', '.join(missing_keys)}",
                    location={"section_keys": missing_keys},
                )
            duplicate_keys = sorted(key for key, count in Counter(actual_keys).items() if count > 1)
            if duplicate_keys:
                _issue(
                    db,
                    run,
                    rule_key="duplicate_sections",
                    severity="P0",
                    message=f"存在重复章节：{', '.join(duplicate_keys)}",
                    location={"section_keys": duplicate_keys},
                )
            actual_required_order = [key for key in actual_keys if key in required_keys]
            expected_present_order = [key for key in required_keys if key in actual_keys]
            if actual_required_order != expected_present_order:
                _issue(
                    db,
                    run,
                    rule_key="section_order",
                    severity="P0",
                    message="文档必需章节顺序与锁定模板不一致",
                    location={
                        "expected": expected_present_order,
                        "actual": actual_required_order,
                    },
                )
    section_ids = [section.id for section in sections]
    if doc.stage == "tender":
        announcement = next(
            (section for section in sections if section.key in {"announcement", "procurement_announcement"}),
            None,
        )
        if announcement is not None and "或" in announcement.title:
            _issue(
                db,
                run,
                rule_key="tender_notice_type_unconfirmed",
                severity="P0",
                message="正式文件必须根据招标方式确定“招标公告”或“投标邀请书”中的一种",
                location={"section_key": "announcement", "section_id": announcement.id},
            )
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
        text = _searchable_content_text(block.content)
        if PLACEHOLDER_PATTERN.search(text):
            _issue(
                db,
                run,
                rule_key="unresolved_placeholder",
                severity="P0",
                message="内容中仍有未替换变量",
                location={"content_block_id": block.id},
            )
        if INTERNAL_MARKER_PATTERN.search(text):
            _issue(
                db,
                run,
                rule_key="internal_marker_in_publication",
                severity="P0",
                message="正文中仍有平台内部审查标记，不能进入对外定稿",
                location={"content_block_id": block.id},
            )
        if doc.stage == "tender" and block.block_type == "table":
            total = scoring_total(block.content)
            if total is not None and total != Decimal("100"):
                _issue(
                    db,
                    run,
                    rule_key="evaluation_score_total",
                    severity="P0",
                    message=f"评审因素分值合计为 {total}，必须等于 100",
                    location={"content_block_id": block.id, "section_key": "scoring_factors"},
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
        elif block.source_kind != "fixed_template" and not block.reviewed:
            _issue(
                db,
                run,
                rule_key="content_review",
                severity="P1",
                message="项目化正文或表格尚未完成人工审阅",
                location={"content_block_id": block.id},
            )
    blocks_by_section = Counter(block.document_section_id for block in blocks if str(block.content).strip())
    empty_required_sections = [
        section.key
        for section in sections
        if section.key in required_keys and blocks_by_section.get(section.id, 0) == 0
    ]
    if empty_required_sections:
        _issue(
            db,
            run,
            rule_key="required_section_empty",
            severity="P0",
            message=f"模板必需章节为空：{', '.join(empty_required_sections)}",
            location={"section_keys": empty_required_sections},
        )
    db.flush()
    severities = list(
        db.scalars(select(ValidationIssue.severity).where(ValidationIssue.validation_run_id == run.id))
    )
    counts = Counter(severities)
    run.issue_counts = {key: counts.get(key, 0) for key in ("P0", "P1", "P2")}
    run.status = "failed" if counts.get("P0", 0) or counts.get("P1", 0) else "passed"
    if not version.immutable:
        version.status = (
            "validation_failed" if counts.get("P0", 0) or counts.get("P1", 0) else "ready_to_finalize"
        )
        version.revision += 1
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
