from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..field_catalog import (
    BUILTIN_ALIASES_VERSION,
    FALLBACK_ALIASES,
    PACKAGE_SCOPED_FIELD_KEYS,
    SHARED_FIELD_KEYS,
    canonicalize_field_key,
)
from ..models import (
    DocumentBlock,
    FieldConflict,
    FieldDefinition,
    FieldEvidence,
    FieldValue,
    File,
    FileVersion,
    ProcurementPackage,
    ProcurementPlan,
    Project,
    TenderDocumentGroup,
    TenderDocumentGroupPackage,
)

EXTRACTION_RULE_VERSION = f"field-extraction-v{BUILTIN_ALIASES_VERSION}"

_QUOTES = "“”\"'「」『』"
_UNCERTAIN_MARKERS = ("待确认", "暂定", "拟定", "测算假设", "待核验")
_DURATION_QUALIFIER_MARKERS = ("建议", "约", "左右", "内", "不超过", "不少于", "预计")

_FIELD_COL_ALIASES = ("字段", "field_key", "field", "字段名", "标准字段", "字段键")
_VALUE_COL_ALIASES = ("值", "正式值", "候选值", "正式值/候选值", "提取值", "value")
_STATUS_COL_ALIASES = ("采集状态", "状态", "status", "提取状态")
_EVIDENCE_COL_ALIASES = ("证据", "来源", "证据/来源", "evidence", "出处")
_DECISION_COL_ALIASES = ("正式来源", "处理原则", "待补齐材料", "决策说明")

_PACKAGE_CODE_ALIASES = ("包号", "包件号", "标段号", "编号", "序号", "采购包编号", "标包号")
_PACKAGE_NAME_ALIASES = ("采购包名称", "包名称", "标段名称", "名称", "采购内容")
_PACKAGE_SCOPE_ALIASES = ("主要范围", "采购范围", "范围", "工作内容")
_ESTIMATED_ALIASES = ("可研采购估算", "采购估算", "估算金额", "估算价", "估算")

_METRIC_ALIASES = ("指标", "指标项", "验收指标", "技术指标", "性能指标", "metric")
_THRESHOLD_ALIASES = ("阈值", "指标值", "要求值", "标准值")
_UNIT_ALIASES = ("单位", "unit")
_METHOD_ALIASES = ("方法", "检验方法", "验收方法", "测定方法")

_LOW_QUALITY_VALUE_MARKERS = (
    "可提取",
    "招标阶段生成",
    "可研通常不存在",
    "待补齐",
    "正式来源",
    "处理原则",
    "采集状态",
    "field_key",
    "待确认",
)

_PROTECTED_STATUSES = frozenset(
    {
        "user_confirmed",
        "system_confirmed",
        "system_authoritative",
        "template_default",
        "finalized",
    }
)


@dataclass
class FieldCandidate:
    field_key: str
    value: object
    block: DocumentBlock
    extraction_method: str
    confidence: float
    matched_label: str
    raw_text: str | None = None
    unit: str | None = None
    qualifiers: tuple[str, ...] = ()
    group_id: str | None = None
    package_code: str | None = None
    empty_reason: str | None = None
    locator_extra: dict[str, Any] = field(default_factory=dict)
    rule_version: str = EXTRACTION_RULE_VERSION
    evidence_excerpts: tuple[str, ...] = ()

    @property
    def storage_key(self) -> str:
        if self.group_id:
            return f"doc::{self.group_id}::{self.field_key}"
        return self.field_key


def scoped_field_key(group_id: str, field_key: str) -> str:
    return f"doc::{group_id}::{field_key}"


def parse_scoped_field_key(field_key: str) -> tuple[str, str] | None:
    if not field_key.startswith("doc::"):
        return None
    parts = field_key.split("::", 2)
    if len(parts) != 3 or not parts[1] or not parts[2]:
        return None
    return parts[1], parts[2]


def is_shared_field_key(field_key: str) -> bool:
    bare = parse_scoped_field_key(field_key)
    key = bare[1] if bare else field_key
    return canonicalize_field_key(key) in SHARED_FIELD_KEYS


def is_package_scoped_field_key(field_key: str) -> bool:
    bare = parse_scoped_field_key(field_key)
    key = bare[1] if bare else field_key
    return canonicalize_field_key(key) in PACKAGE_SCOPED_FIELD_KEYS


def _confidence(text: str, base: float) -> float:
    if any(marker in text for marker in _UNCERTAIN_MARKERS):
        return max(0.5, base - 0.18)
    return base


def _clean_text(value: str) -> str:
    return value.strip().strip(_QUOTES).strip().rstrip("。；;").strip()


def _money_value(number: str, unit: str | None) -> int | float:
    value = Decimal(number.replace(",", ""))
    multiplier = {
        "亿元": Decimal("100000000"),
        "万元": Decimal("10000"),
        "万": Decimal("10000"),
        "元": Decimal("1"),
        None: Decimal("1"),
    }[unit]
    normalized = value * multiplier
    return int(normalized) if normalized == normalized.to_integral_value() else float(normalized)


def _aliases_for(definition: FieldDefinition) -> tuple[str, ...]:
    rules = definition.rules if isinstance(definition.rules, dict) else {}
    raw = rules.get("aliases") if isinstance(rules, dict) else None
    aliases: list[str] = []
    if isinstance(raw, list):
        aliases.extend(str(item).strip() for item in raw if str(item).strip())

    disable_fallback = bool(rules.get("disable_fallback_aliases") or rules.get("aliases_override"))

    if definition.field_label and definition.field_label not in aliases:
        aliases.append(definition.field_label)

    if not disable_fallback:
        for alias in FALLBACK_ALIASES.get(definition.field_key, ()):
            if alias not in aliases:
                aliases.append(alias)

    seen: set[str] = set()
    ordered: list[str] = []
    for alias in aliases:
        if alias not in seen:
            seen.add(alias)
            ordered.append(alias)
    return tuple(ordered)


def _block_kind(block: DocumentBlock) -> str:
    return str(getattr(block, "kind", None) or "paragraph")


def _table_rows(block: DocumentBlock) -> list[list[str]]:
    locator = getattr(block, "locator", None) or {}
    table_rows = locator.get("table_rows") if isinstance(locator, dict) else None
    if isinstance(table_rows, list) and table_rows:
        rows: list[list[str]] = []
        for row in table_rows:
            if isinstance(row, (list, tuple)):
                rows.append([str(cell or "").strip() for cell in row])
        if rows:
            return rows
    rows = []
    text = getattr(block, "text", "") or ""
    for line in text.splitlines():
        if " | " in line:
            rows.append([part.strip() for part in line.split(" | ")])
        elif "\t" in line:
            rows.append([part.strip() for part in line.split("\t")])
    return rows


def _header_index(headers: list[str], aliases: tuple[str, ...]) -> int | None:
    """Match header cells to aliases: exact first, then alias⊆header (not reverse)."""

    normalized_headers = [re.sub(r"\s+", "", str(header or "").lower()) for header in headers]
    alias_norms = [re.sub(r"\s+", "", alias.lower()) for alias in aliases if alias]
    if not alias_norms:
        return None
    for idx, normalized in enumerate(normalized_headers):
        if normalized in alias_norms:
            return idx
    for idx, normalized in enumerate(normalized_headers):
        for alias in alias_norms:
            if alias and alias in normalized:
                return idx
    return None


def _classify_table(headers: list[str], role: str | None) -> str:
    header_blob = " ".join(headers)
    if _header_index(headers, _FIELD_COL_ALIASES) is not None and (
        _header_index(headers, _VALUE_COL_ALIASES) is not None
        or _header_index(headers, _STATUS_COL_ALIASES) is not None
        or _header_index(headers, _DECISION_COL_ALIASES) is not None
    ):
        if _header_index(headers, _DECISION_COL_ALIASES) is not None and _header_index(
            headers, _VALUE_COL_ALIASES
        ) is None:
            return "decision_map"
        return "field_map"
    if any(token in header_blob for token in _DECISION_COL_ALIASES):
        return "decision_map"
    if (
        _header_index(headers, _PACKAGE_CODE_ALIASES) is not None
        or _header_index(headers, _PACKAGE_NAME_ALIASES) is not None
    ) and (
        _header_index(headers, _PACKAGE_SCOPE_ALIASES) is not None
        or _header_index(headers, _ESTIMATED_ALIASES) is not None
        or role == "procurement_package"
    ):
        return "package_list"
    if _header_index(headers, _METRIC_ALIASES) is not None and (
        _header_index(headers, _THRESHOLD_ALIASES) is not None
        or _header_index(headers, _METHOD_ALIASES) is not None
    ):
        return "tech_acceptance"
    return "generic"


def _is_low_quality_value(field_key: str, value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, dict):
        raw = str(value.get("raw") or value.get("amount") or "")
    else:
        raw = str(value).strip()
    if not raw:
        return True
    compact = raw.replace(" ", "")
    if "|" in raw:
        parts = [part.strip() for part in raw.split("|") if part.strip()]
        if parts and all(len(part) <= 12 for part in parts):
            if any(
                part in _LOW_QUALITY_VALUE_MARKERS or part in ("验收指标", "类别") for part in parts
            ):
                return True
    if any(marker in compact for marker in _LOW_QUALITY_VALUE_MARKERS):
        if field_key in {"tender_number", "package_number"}:
            return True
        if field_key == "acceptance_criteria":
            # Short metadata / status phrases only — long multi-section text may mention markers.
            if len(compact) <= 40:
                return True
        elif len(compact) <= 24:
            return True
    if field_key == "acceptance_criteria" and len(compact) < 8:
        return True
    if field_key == "package_number" and any(
        token in compact for token in ("采购包名称", "可研采购估算", "主要范围", "类别")
    ):
        return True
    return False


def _candidate_quality_score(candidate: FieldCandidate) -> tuple[float, int, int]:
    low = 1 if _is_low_quality_value(candidate.field_key, candidate.value) else 0
    return (0 if low else 1, candidate.confidence, -candidate.block.sequence)


def _extract_project_name(block: DocumentBlock, aliases: tuple[str, ...]) -> FieldCandidate | None:
    labels = aliases or ("项目名称",)
    label_pattern = "|".join(re.escape(label) for label in sorted(labels, key=len, reverse=True))
    explicit = re.search(
        rf"(?P<label>{label_pattern})\s*(?:为|是|[:：])\s*[“\"「『]?([^”\"」』，。；;\n]{{2,100}})",
        block.text,
    )
    if explicit:
        value = _clean_text(explicit.group(2))
        if value:
            return FieldCandidate(
                field_key="project_name",
                value=value,
                block=block,
                extraction_method="rule_based_label",
                confidence=_confidence(block.text, 0.97),
                matched_label=explicit.group("label"),
            )
    if (
        block.sequence <= 5
        and 4 <= len(block.text) <= 100
        and block.text.endswith("项目")
        and not any(separator in block.text for separator in ("：", ":", "，", "。"))
    ):
        return FieldCandidate(
            field_key="project_name",
            value=block.text,
            block=block,
            extraction_method="rule_based_cover_title",
            confidence=0.86,
            matched_label="封面标题",
        )
    return None


def _extract_money(
    field_key: str, block: DocumentBlock, aliases: tuple[str, ...]
) -> FieldCandidate | None:
    if not aliases:
        return None
    label_pattern = "|".join(re.escape(label) for label in sorted(aliases, key=len, reverse=True))
    matched = re.search(
        rf"(?P<label>{label_pattern})\s*(?:为|是|[:：])?\s*(?:人民币)?\s*"
        rf"(?P<number>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<unit>亿元|万元|万|元)?",
        block.text,
    )
    if not matched:
        return None
    return FieldCandidate(
        field_key=field_key,
        value=_money_value(matched.group("number"), matched.group("unit")),
        block=block,
        extraction_method="rule_based_money_label",
        confidence=_confidence(block.text, 0.94),
        matched_label=matched.group("label"),
        unit=matched.group("unit") or "元",
        raw_text=_clean_text(matched.group(0)),
    )


def _duration_qualifiers(text: str, span_start: int, span_end: int) -> tuple[str, ...]:
    window = text[max(0, span_start - 8) : min(len(text), span_end + 4)]
    found = [marker for marker in _DURATION_QUALIFIER_MARKERS if marker in window]
    return tuple(dict.fromkeys(found))


def _extract_duration(
    field_key: str, block: DocumentBlock, aliases: tuple[str, ...]
) -> FieldCandidate | None:
    if not aliases:
        return None
    # project_period must not be filled from package delivery wording alone.
    if field_key == "delivery_period" and any(
        token in block.text for token in ("项目总建设周期", "总体", "总体计划")
    ):
        # Prefer package-local phrasing; still allow if explicit delivery alias is closer.
        pass
    label_pattern = "|".join(re.escape(label) for label in sorted(aliases, key=len, reverse=True))
    matched = re.search(
        rf"(?P<label>{label_pattern})\s*(?:为|是|[:：])?\s*"
        rf"(?P<prefix>建议|约|预计|不超过|不少于)?\s*"
        rf"(?P<number>[0-9]+(?:\.[0-9]+)?)\s*(?P<unit>个月|月|年|日历天|天)"
        rf"(?P<suffix>内|左右)?",
        block.text,
    )
    if not matched:
        # Free-form: 建议8个月内完成实施
        if field_key == "delivery_period":
            matched = re.search(
                r"(?P<prefix>建议|约|预计)?\s*"
                r"(?P<number>[0-9]+(?:\.[0-9]+)?)\s*(?P<unit>个月|月|日历天|天)(?P<suffix>内)?"
                r"[^。；\n]{0,20}(?:完成|实施|交付|供货)",
                block.text,
            )
            if matched:
                # Avoid treating project overall plan as package delivery when labeled as 总体.
                left = block.text[max(0, matched.start() - 12) : matched.start()]
                if "总体" in left or "项目总" in left:
                    matched = None
    if not matched:
        return None
    number = Decimal(matched.group("number"))
    amount: int | float = int(number) if number == number.to_integral_value() else float(number)
    unit = matched.group("unit")
    # Normalize display unit but never convert months → days.
    if unit == "年":
        months = number * Decimal("12")
        amount = int(months) if months == months.to_integral_value() else float(months)
        unit = "个月"
    elif unit == "月":
        unit = "个月"
    qualifiers = _duration_qualifiers(block.text, matched.start(), matched.end())
    prefix = matched.groupdict().get("prefix")
    suffix = matched.groupdict().get("suffix")
    extra = tuple(item for item in (prefix, suffix) if item)
    qualifiers = tuple(dict.fromkeys([*qualifiers, *extra]))
    raw = _clean_text(block.text[matched.start() : min(len(block.text), matched.end() + 40)])
    structured = {
        "amount": amount,
        "unit": unit,
        "raw": raw or matched.group(0),
        "qualifiers": list(qualifiers),
    }
    label = matched.groupdict().get("label") or "工期表达"
    return FieldCandidate(
        field_key=field_key,
        value=structured,
        block=block,
        extraction_method="rule_based_duration_label",
        confidence=_confidence(block.text, 0.93 if not qualifiers else 0.88),
        matched_label=str(label),
        raw_text=structured["raw"],
        unit=unit,
        qualifiers=qualifiers,
    )


def _extract_text(
    field_key: str, block: DocumentBlock, aliases: tuple[str, ...]
) -> FieldCandidate | None:
    if not aliases:
        return None
    # Skip whole-table blob extraction — handled by table extractors.
    if _block_kind(block) == "table" or (
        isinstance(getattr(block, "locator", None), dict)
        and (block.locator or {}).get("table_rows")
    ):
        return None
    label_pattern = "|".join(re.escape(label) for label in sorted(aliases, key=len, reverse=True))
    matched = re.search(
        rf"(?P<label>{label_pattern})\s*(?:为|是|包括|[:：|])\s*(?P<value>[^\n]{{2,600}})",
        block.text,
    )
    if not matched:
        return None
    value = _clean_text(matched.group("value"))
    if not value or _is_low_quality_value(field_key, value):
        return None
    return FieldCandidate(
        field_key=field_key,
        value=value,
        block=block,
        extraction_method="rule_based_text_label",
        confidence=_confidence(block.text, 0.9),
        matched_label=matched.group("label"),
        raw_text=value,
    )


def _extract_percentage(
    field_key: str, block: DocumentBlock, aliases: tuple[str, ...]
) -> FieldCandidate | None:
    labels = aliases or ("税率",)
    label_pattern = "|".join(re.escape(label) for label in sorted(labels, key=len, reverse=True))
    matched = re.search(
        rf"(?P<label>{label_pattern})\s*(?:为|是|[:：])?\s*(?P<number>[0-9]+(?:\.[0-9]+)?)\s*%",
        block.text,
    )
    if not matched:
        return None
    number = Decimal(matched.group("number"))
    value: int | float = int(number) if number == number.to_integral_value() else float(number)
    return FieldCandidate(
        field_key=field_key,
        value=value,
        block=block,
        extraction_method="rule_based_percentage_label",
        confidence=_confidence(block.text, 0.95),
        matched_label=matched.group("label"),
        unit="%",
    )


def _map_field_token(token: str, definitions_by_key: dict[str, FieldDefinition]) -> str | None:
    cleaned = _clean_text(token)
    if not cleaned:
        return None
    canon = canonicalize_field_key(cleaned)
    if canon in definitions_by_key:
        return canon
    lowered = cleaned.lower().replace(" ", "")
    for key, definition in definitions_by_key.items():
        if key.lower() == lowered or definition.field_label == cleaned:
            return key
        for alias in _aliases_for(definition):
            if alias.lower().replace(" ", "") == lowered or alias == cleaned:
                return key
    return None


def _extract_from_field_map_table(
    block: DocumentBlock,
    rows: list[list[str]],
    definitions_by_key: dict[str, FieldDefinition],
) -> list[FieldCandidate]:
    headers = rows[0]
    field_idx = _header_index(headers, _FIELD_COL_ALIASES)
    value_idx = _header_index(headers, _VALUE_COL_ALIASES)
    status_idx = _header_index(headers, _STATUS_COL_ALIASES)
    evidence_idx = _header_index(headers, _EVIDENCE_COL_ALIASES)
    decision_idx = _header_index(headers, _DECISION_COL_ALIASES)
    if field_idx is None:
        return []
    results: list[FieldCandidate] = []
    for row_idx, row in enumerate(rows[1:], start=1):
        if field_idx >= len(row):
            continue
        field_token = row[field_idx]
        field_key = _map_field_token(field_token, definitions_by_key)
        if not field_key:
            continue
        status = row[status_idx] if status_idx is not None and status_idx < len(row) else ""
        evidence = row[evidence_idx] if evidence_idx is not None and evidence_idx < len(row) else ""
        decision = row[decision_idx] if decision_idx is not None and decision_idx < len(row) else ""
        value = row[value_idx] if value_idx is not None and value_idx < len(row) else ""
        value = _clean_text(value)
        meta = {
            "table_role": "field_map",
            "row": row_idx,
            "col_field": field_idx,
            "col_value": value_idx,
            "status": status,
            "evidence_col": evidence,
            "decision": decision,
        }
        # Status / evidence / decision columns must never become the value.
        if decision or any(token in f"{status}{evidence}{decision}" for token in _DECISION_COL_ALIASES):
            results.append(
                FieldCandidate(
                    field_key=field_key,
                    value=None,
                    block=block,
                    extraction_method="table_field_map_decision",
                    confidence=0.4,
                    matched_label=field_token,
                    empty_reason="DECISION_REQUIRED",
                    locator_extra=meta,
                    raw_text=_clean_text(" | ".join(row)),
                )
            )
            continue
        if not value or _is_low_quality_value(field_key, value):
            # Explicitly reject status/evidence masquerading as values.
            continue
        if value_idx is None:
            continue
        # Evidence must support value: value must appear in claimed value cell.
        cell = row[value_idx]
        if value not in cell and cell not in value:
            continue
        results.append(
            FieldCandidate(
                field_key=field_key,
                value=value,
                block=block,
                extraction_method="table_field_map_value",
                confidence=_confidence(" ".join(row), 0.92),
                matched_label=field_token,
                locator_extra=meta,
                raw_text=value,
                evidence_excerpts=(evidence,) if evidence else (),
            )
        )
    return results


def _extract_from_decision_table(
    block: DocumentBlock,
    rows: list[list[str]],
    definitions_by_key: dict[str, FieldDefinition],
) -> list[FieldCandidate]:
    headers = rows[0]
    field_idx = _header_index(headers, _FIELD_COL_ALIASES)
    if field_idx is None:
        return []
    results: list[FieldCandidate] = []
    for row_idx, row in enumerate(rows[1:], start=1):
        if field_idx >= len(row):
            continue
        field_key = _map_field_token(row[field_idx], definitions_by_key)
        if not field_key:
            continue
        results.append(
            FieldCandidate(
                field_key=field_key,
                value=None,
                block=block,
                extraction_method="table_decision_required",
                confidence=0.35,
                matched_label=row[field_idx],
                empty_reason="DECISION_REQUIRED",
                locator_extra={"table_role": "decision_map", "row": row_idx},
                raw_text=_clean_text(" | ".join(row)),
            )
        )
    return results


def _parse_amount_cell(text: str) -> tuple[int | float | None, str | None]:
    matched = re.search(
        r"(?P<number>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<unit>亿元|万元|万|元)?",
        text,
    )
    if not matched:
        return None, None
    return _money_value(matched.group("number"), matched.group("unit")), matched.group("unit")


def _extract_from_package_list_table(
    block: DocumentBlock,
    rows: list[list[str]],
    definitions_by_key: dict[str, FieldDefinition],
    package_group_map: dict[str, str] | None,
) -> list[FieldCandidate]:
    headers = rows[0]
    # Headers themselves must never become values.
    code_idx = _header_index(headers, _PACKAGE_CODE_ALIASES)
    name_idx = _header_index(headers, _PACKAGE_NAME_ALIASES)
    scope_idx = _header_index(headers, _PACKAGE_SCOPE_ALIASES)
    estimated_idx = _header_index(headers, _ESTIMATED_ALIASES)
    results: list[FieldCandidate] = []
    for row_idx, row in enumerate(rows[1:], start=1):
        code = _clean_text(row[code_idx]) if code_idx is not None and code_idx < len(row) else ""
        name = _clean_text(row[name_idx]) if name_idx is not None and name_idx < len(row) else ""
        scope = _clean_text(row[scope_idx]) if scope_idx is not None and scope_idx < len(row) else ""
        estimated_text = (
            _clean_text(row[estimated_idx])
            if estimated_idx is not None and estimated_idx < len(row)
            else ""
        )
        if not code and not name:
            continue
        package_code = code or name
        group_id = None
        if package_group_map:
            group_id = (
                package_group_map.get(package_code)
                or package_group_map.get(code)
                or package_group_map.get(name)
            )
        base_meta = {
            "table_role": "package_list",
            "row": row_idx,
            "package_code": package_code,
            "package_name": name,
        }
        if "package_number" in definitions_by_key and code:
            results.append(
                FieldCandidate(
                    field_key="package_number",
                    value=code,
                    block=block,
                    extraction_method="table_package_list",
                    confidence=0.9,
                    matched_label=headers[code_idx] if code_idx is not None else "包号",
                    package_code=package_code,
                    group_id=group_id,
                    locator_extra={**base_meta, "col": code_idx},
                    raw_text=code,
                )
            )
        if "procurement_scope" in definitions_by_key and scope:
            results.append(
                FieldCandidate(
                    field_key="procurement_scope",
                    value=scope,
                    block=block,
                    extraction_method="table_package_list",
                    confidence=0.88,
                    matched_label=headers[scope_idx] if scope_idx is not None else "范围",
                    package_code=package_code,
                    group_id=group_id,
                    locator_extra={**base_meta, "col": scope_idx},
                    raw_text=scope,
                )
            )
        if estimated_text:
            amount, unit = _parse_amount_cell(estimated_text)
            if amount is not None:
                # estimated_amount only — never confirmed_budget / maximum_price / procurement_budget
                target_key = (
                    "estimated_amount"
                    if "estimated_amount" in definitions_by_key
                    else None
                )
                if target_key:
                    results.append(
                        FieldCandidate(
                            field_key=target_key,
                            value=amount,
                            block=block,
                            extraction_method="table_package_estimated_amount",
                            confidence=0.9,
                            matched_label=(
                                headers[estimated_idx] if estimated_idx is not None else "估算"
                            ),
                            package_code=package_code,
                            group_id=group_id,
                            unit=unit or "元",
                            locator_extra={**base_meta, "col": estimated_idx, "amount_role": "estimated"},
                            raw_text=estimated_text,
                        )
                    )
                # Still emit a non-value marker candidate for procurement_budget? No — leave empty.
    return results


def _extract_from_tech_acceptance_table(
    block: DocumentBlock,
    rows: list[list[str]],
    definitions_by_key: dict[str, FieldDefinition],
) -> list[FieldCandidate]:
    if (
        "acceptance_criteria" not in definitions_by_key
        and "technical_specifications" not in definitions_by_key
    ):
        return []
    headers = rows[0]
    metric_idx = _header_index(headers, _METRIC_ALIASES)
    threshold_idx = _header_index(headers, _THRESHOLD_ALIASES)
    unit_idx = _header_index(headers, _UNIT_ALIASES)
    method_idx = _header_index(headers, _METHOD_ALIASES)
    lines: list[str] = []
    excerpts: list[str] = []
    for row_idx, row in enumerate(rows[1:], start=1):
        metric = row[metric_idx] if metric_idx is not None and metric_idx < len(row) else ""
        threshold = (
            row[threshold_idx] if threshold_idx is not None and threshold_idx < len(row) else ""
        )
        unit = row[unit_idx] if unit_idx is not None and unit_idx < len(row) else ""
        method = row[method_idx] if method_idx is not None and method_idx < len(row) else ""
        if not any((metric, threshold, method)):
            continue
        parts = [p for p in (metric, threshold, unit, method) if p]
        line = " / ".join(parts)
        lines.append(line)
        excerpts.append(f"row={row_idx}:{line}")
    if not lines:
        return []
    value = "；".join(lines)
    if _is_low_quality_value("acceptance_criteria", value):
        return []
    field_key = (
        "acceptance_criteria"
        if "acceptance_criteria" in definitions_by_key
        else "technical_specifications"
    )
    return [
        FieldCandidate(
            field_key=field_key,
            value=value,
            block=block,
            extraction_method="table_tech_acceptance_multi",
            confidence=0.9,
            matched_label="验收/技术指标表",
            locator_extra={"table_role": "tech_acceptance", "row_count": len(lines)},
            raw_text=value,
            evidence_excerpts=tuple(excerpts),
        )
    ]


def _extract_table_candidates(
    block: DocumentBlock,
    definitions_by_key: dict[str, FieldDefinition],
    package_group_map: dict[str, str] | None,
) -> list[FieldCandidate]:
    rows = _table_rows(block)
    if len(rows) < 2:
        return []
    role = None
    locator = getattr(block, "locator", None) or {}
    if isinstance(locator, dict):
        role = str(locator.get("semantic_role") or "") or None
    table_kind = _classify_table(rows[0], role)
    if table_kind == "field_map":
        return _extract_from_field_map_table(block, rows, definitions_by_key)
    if table_kind == "decision_map":
        return _extract_from_decision_table(block, rows, definitions_by_key)
    if table_kind == "package_list":
        return _extract_from_package_list_table(block, rows, definitions_by_key, package_group_map)
    if table_kind == "tech_acceptance":
        return _extract_from_tech_acceptance_table(block, rows, definitions_by_key)
    return []


def _extract_for_definition(
    definition: FieldDefinition, block: DocumentBlock
) -> FieldCandidate | None:
    aliases = _aliases_for(definition)
    field_key = canonicalize_field_key(definition.field_key)
    if field_key == "project_name":
        return _extract_project_name(block, aliases)
    # Never fill package delivery from project_period aliases.
    if field_key == "delivery_period":
        blocked = {"项目总建设周期", "建设周期", "建设期", "总体计划"}
        aliases = tuple(item for item in aliases if item not in blocked)
    if field_key == "project_period":
        # Do not treat delivery/package wording as project period unconditionally.
        blocked = {"交付周期", "交货期", "供货周期", "履约期限", "delivery_cycle"}
        aliases = tuple(item for item in aliases if item not in blocked)
    data_type = definition.data_type
    if data_type == "money":
        return _extract_money(field_key, block, aliases)
    if data_type == "duration":
        return _extract_duration(field_key, block, aliases)
    if data_type == "percentage":
        return _extract_percentage(field_key, block, aliases)
    return _extract_text(field_key, block, aliases)


def _extract_semantic_sections(
    field_key: str, blocks: list[DocumentBlock], aliases: tuple[str, ...]
) -> FieldCandidate | None:
    """Aggregate related section evidence when exact label-value pairs are absent."""

    if field_key != "acceptance_criteria" or not aliases:
        return None
    hits: list[DocumentBlock] = []
    matched_labels: list[str] = []
    weak_only_aliases = {"恢复演练", "安全测试", "培训移交"}
    for block in blocks:
        if _block_kind(block) == "table":
            continue
        text = block.text or ""
        # Skip short metadata / mapping-status lines from semantic aggregation.
        if _is_low_quality_value(field_key, text):
            continue
        for alias in aliases:
            if not alias or alias not in text:
                continue
            # A lone weak keyword sentence is not a full acceptance conclusion.
            if alias in weak_only_aliases and not any(
                strong in text
                for strong in ("验收", "质量目标", "交付物", "接收证据", "指标", "标准")
            ):
                continue
            hits.append(block)
            matched_labels.append(alias)
            break
    if len(hits) < 2:
        if len(hits) == 1 and not re.search(r"[:：]", hits[0].text):
            pass
        else:
            return None
    if not hits:
        return None
    anchor = min(hits, key=lambda item: item.sequence)
    snippets = []
    excerpts: list[str] = []
    for block in sorted(hits, key=lambda item: item.sequence)[:6]:
        cleaned = _clean_text(block.text)[:240]
        if cleaned:
            snippets.append(cleaned)
            excerpts.append(cleaned)
    value = "；".join(item for item in snippets if item)
    if len(value) < 8 or _is_low_quality_value(field_key, value):
        return None
    return FieldCandidate(
        field_key=field_key,
        value=value,
        block=anchor,
        extraction_method="rule_based_semantic_sections",
        confidence=_confidence(anchor.text, 0.82),
        matched_label="、".join(list(dict.fromkeys(matched_labels))[:4]),
        raw_text=value,
        evidence_excerpts=tuple(excerpts),
    )


def _is_fragmentary_vs_semantic(label: FieldCandidate, semantic: FieldCandidate) -> bool:
    """Short single-label fragments must not override multi-section semantic results."""

    if semantic.extraction_method != "rule_based_semantic_sections":
        return False
    if len(semantic.evidence_excerpts) < 2:
        return False
    label_text = str(label.value or "")
    semantic_text = str(semantic.value or "")
    if len(label_text) < 60 and len(semantic_text) >= max(80, len(label_text) * 2):
        return True
    if (
        label_text
        and semantic_text
        and label_text in semantic_text
        and len(label_text) < len(semantic_text) * 0.6
    ):
        return True
    return False


def extract_all_field_candidates(
    blocks: list[DocumentBlock],
    definitions: list[FieldDefinition],
    *,
    package_group_map: dict[str, str] | None = None,
) -> list[FieldCandidate]:
    definitions_by_key = {
        canonicalize_field_key(definition.field_key): definition for definition in definitions
    }
    collected: list[FieldCandidate] = []

    for block in blocks:
        if _block_kind(block) == "table" or (
            isinstance(getattr(block, "locator", None), dict)
            and (block.locator or {}).get("table_rows")
        ):
            collected.extend(
                _extract_table_candidates(block, definitions_by_key, package_group_map)
            )

    for definition in definitions:
        field_key = canonicalize_field_key(definition.field_key)
        matches: list[FieldCandidate] = []
        for block in blocks:
            if _block_kind(block) == "table" or (
                isinstance(getattr(block, "locator", None), dict)
                and (block.locator or {}).get("table_rows")
            ):
                continue
            candidate = _extract_for_definition(definition, block)
            if candidate:
                if candidate.field_key != field_key:
                    candidate = FieldCandidate(
                        **{**candidate.__dict__, "field_key": field_key}
                    )
                matches.append(candidate)
        semantic = _extract_semantic_sections(field_key, blocks, _aliases_for(definition))
        label_matches = [item for item in matches if not _is_low_quality_value(field_key, item.value)]
        if semantic:
            usable_labels = [
                item for item in label_matches if not _is_fragmentary_vs_semantic(item, semantic)
            ]
            # Low-quality / fragmentary direct hits must not override good semantic results.
            if usable_labels:
                best_label = max(usable_labels, key=_candidate_quality_score)
                if _candidate_quality_score(best_label) > _candidate_quality_score(semantic):
                    collected.append(best_label)
                else:
                    collected.append(semantic)
            else:
                collected.append(semantic)
        elif label_matches:
            collected.append(max(label_matches, key=_candidate_quality_score))

    return collected


def extract_field_candidates(
    blocks: list[DocumentBlock], definitions: list[FieldDefinition]
) -> dict[str, FieldCandidate]:
    """Best formal candidate per field_key (unscoped). Decision-only / empty skipped."""

    all_candidates = extract_all_field_candidates(blocks, definitions)
    by_key: dict[str, list[FieldCandidate]] = {}
    for candidate in all_candidates:
        if candidate.value in (None, "", [], {}):
            continue
        if candidate.empty_reason:
            continue
        if _is_low_quality_value(candidate.field_key, candidate.value):
            continue
        # Prefer unscoped shared; for package-scoped keep first per storage key then collapse.
        storage = candidate.field_key if candidate.group_id is None else candidate.storage_key
        # Distinguish unscoped package rows so different packages do not collapse silently.
        if candidate.group_id is None and candidate.package_code:
            storage = f"{candidate.field_key}::pkg::{candidate.package_code}"
        by_key.setdefault(storage, []).append(candidate)

    result: dict[str, FieldCandidate] = {}
    # Collapse package-scoped entries under bare key only when unambiguous.
    bare_buckets: dict[str, list[FieldCandidate]] = {}
    for storage, items in by_key.items():
        best = max(items, key=_candidate_quality_score)
        scoped = parse_scoped_field_key(storage)
        if scoped:
            bare_buckets.setdefault(scoped[1], []).append(best)
            result[storage] = best
            continue
        if "::pkg::" in storage:
            bare = storage.split("::pkg::", 1)[0]
            bare_buckets.setdefault(bare, []).append(best)
            continue
        bare_buckets.setdefault(storage, []).append(best)
        result[storage] = best
    # Legacy API: also expose bare keys when unambiguous (single value / single package).
    for bare, items in bare_buckets.items():
        if bare in result:
            continue
        distinct = []
        for item in items:
            if any(_same_value(item.value, existing.value) for existing in distinct):
                continue
            distinct.append(item)
        if len(distinct) == 1:
            result[bare] = distinct[0]
        # Different package values → conflict, not highest-confidence wins.
    return result


def _same_value(left: object | None, right: object) -> bool:
    if isinstance(left, dict) and isinstance(right, dict):
        return left == right
    if isinstance(left, str) and isinstance(right, str):
        return left.strip() == right.strip()
    return left == right


def _text_supports_claim(claim: str, haystack: str) -> bool:
    if not claim or not haystack:
        return False
    if claim in haystack or haystack in claim:
        return True
    # Money: structured amount vs cell like "218万元"
    claim_amount, _ = _parse_amount_cell(claim)
    cell_amount, _ = _parse_amount_cell(haystack)
    if claim_amount is not None and cell_amount is not None and claim_amount == cell_amount:
        return True
    # Duration structured amount appears inside raw expression.
    digits = re.sub(r"[^\d.]", "", claim)
    if digits and digits in haystack.replace(",", ""):
        return True
    return False


def _evidence_supports_value(candidate: FieldCandidate) -> bool:
    """Evidence ID alone is insufficient — value must appear in claimed cell/text."""

    if candidate.value in (None, "", [], {}):
        return False
    claims: list[str] = []
    if candidate.raw_text:
        claims.append(str(candidate.raw_text))
    if isinstance(candidate.value, dict):
        for key in ("raw", "amount"):
            if candidate.value.get(key) is not None:
                claims.append(str(candidate.value[key]))
    else:
        claims.append(str(candidate.value))
    claims = [item for item in dict.fromkeys(claims) if item]
    if not claims:
        return False
    locator = candidate.locator_extra or {}
    rows = _table_rows(candidate.block)
    row_idx = locator.get("row")
    col_idx = locator.get("col_value", locator.get("col"))
    if isinstance(row_idx, int) and rows and 0 <= row_idx < len(rows):
        row = rows[row_idx]
        if isinstance(col_idx, int) and 0 <= col_idx < len(row):
            cell = row[col_idx]
            return any(_text_supports_claim(claim, cell) for claim in claims)
        return any(
            _text_supports_claim(claim, cell) for claim in claims for cell in row if cell
        )
    text = candidate.block.text or ""
    if any(_text_supports_claim(claim[:80], text) for claim in claims):
        return True
    return any(
        excerpt and any(_text_supports_claim(claim[:80], excerpt) for claim in claims)
        for excerpt in candidate.evidence_excerpts
    )


def resolve_package_group_map(
    db: Session, *, project_id: str, organization_id: str
) -> dict[str, str]:
    """Map package code/name → tender document group id for scoped extraction."""

    plans = list(
        db.scalars(
            select(ProcurementPlan).where(
                ProcurementPlan.project_id == project_id,
                ProcurementPlan.organization_id == organization_id,
            )
        )
    )
    if not plans:
        return {}

    def _plan_rank(plan: ProcurementPlan) -> tuple[int, int, int]:
        confirmed = 1 if plan.status == "confirmed" else 0
        recommended = 1 if plan.is_recommended else 0
        return (confirmed, recommended, int(plan.version or 0))

    plan = max(plans, key=_plan_rank)
    packages = list(
        db.scalars(select(ProcurementPackage).where(ProcurementPackage.plan_id == plan.id))
    )
    groups = list(
        db.scalars(
            select(TenderDocumentGroup).where(
                TenderDocumentGroup.plan_id == plan.id,
                TenderDocumentGroup.status == "active",
            )
        )
    )
    if not packages or not groups:
        return {}
    links = list(
        db.scalars(
            select(TenderDocumentGroupPackage).where(
                TenderDocumentGroupPackage.document_group_id.in_([item.id for item in groups])
            )
        )
    )
    package_by_id = {item.id: item for item in packages}
    mapping: dict[str, str] = {}
    for link in links:
        package = package_by_id.get(link.package_id)
        if package is None:
            continue
        mapping[package.code] = link.document_group_id
        if package.name:
            mapping[package.name] = link.document_group_id
    return mapping


def _add_candidate_evidence(
    db: Session,
    field_row: FieldValue,
    candidate: FieldCandidate,
    file_record: File,
    version: FileVersion,
    actor_id: str,
) -> None:
    if candidate.value not in (None, "", [], {}) and not _evidence_supports_value(candidate):
        # Evidence ID alone is insufficient — skip unsupported evidence links.
        return
    excerpts = candidate.evidence_excerpts or ((candidate.block.text or "")[:1_000],)
    for idx, excerpt in enumerate(excerpts):
        db.add(
            FieldEvidence(
                organization_id=file_record.organization_id,
                field_value_id=field_row.id,
                source_file_id=file_record.id,
                source_file_version_id=version.id,
                document_block_id=candidate.block.id,
                page_number=candidate.block.page_number,
                section_path=candidate.block.section_path,
                excerpt=(excerpt or "")[:1_000],
                extraction_method=candidate.extraction_method,
                confidence=candidate.confidence,
                metadata_json={
                    "source_locator": candidate.block.locator,
                    "matched_label": candidate.matched_label,
                    "raw_text": candidate.raw_text,
                    "unit": candidate.unit,
                    "qualifiers": list(candidate.qualifiers),
                    "package_code": candidate.package_code,
                    "group_id": candidate.group_id,
                    "locator_extra": candidate.locator_extra,
                    "rule_version": candidate.rule_version,
                    "evidence_index": idx,
                    "empty_reason": candidate.empty_reason,
                },
                created_by=actor_id,
                updated_by=actor_id,
            )
        )


def _store_value_payload(
    candidate: FieldCandidate, definition: FieldDefinition
) -> tuple[object, object | None, str | None]:
    value = candidate.value
    unit = candidate.unit or definition.unit
    if isinstance(value, dict) and "amount" in value:
        return value, value, value.get("unit") or unit
    return value, value, unit


def extract_and_store_field_candidates(
    db: Session,
    *,
    file_record: File,
    version: FileVersion,
    blocks: list[DocumentBlock],
    actor_id: str,
    package_group_map: dict[str, str] | None = None,
    document_group_id: str | None = None,
) -> dict[str, Any]:
    if not file_record.project_id or not file_record.stage:
        return {
            "created": 0,
            "existing": 0,
            "skipped": 0,
            "revised": 0,
            "conflicts": 0,
            "created_keys": [],
            "existing_keys": [],
            "skipped_keys": [],
            "revised_keys": [],
        }
    definitions = list(
        db.scalars(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == file_record.organization_id,
                FieldDefinition.stage == file_record.stage,
                FieldDefinition.is_active.is_(True),
            )
        )
    )
    if file_record.stage == "tender":
        from .applicable_fields import resolve_project_applicable_field_union

        applicable_keys = resolve_project_applicable_field_union(
            db,
            project_id=file_record.project_id,
            organization_id=file_record.organization_id,
        )
        # Always allow estimated_amount extraction when present in catalog; else synthetic.
        definitions = [
            item
            for item in definitions
            if item.field_key in applicable_keys or item.field_key == "estimated_amount"
        ]
    # Ensure estimated_amount can be stored even if not in org catalog yet.
    if not any(item.field_key == "estimated_amount" for item in definitions):
        definitions.append(
            SimpleNamespace(
                id=None,
                field_key="estimated_amount",
                field_label="可研采购估算",
                data_type="money",
                unit="元",
                criticality="P2",
                required=False,
                rules={"aliases": list(FALLBACK_ALIASES.get("estimated_amount", ()))},
            )  # type: ignore[arg-type]
        )

    if package_group_map is None and file_record.project_id:
        package_group_map = resolve_package_group_map(
            db,
            project_id=file_record.project_id,
            organization_id=file_record.organization_id,
        )

    all_candidates = extract_all_field_candidates(
        blocks, definitions, package_group_map=package_group_map
    )
    # Apply default document_group_id for package-scoped fields without group.
    normalized: list[FieldCandidate] = []
    for candidate in all_candidates:
        if candidate.empty_reason or candidate.value in (None, "", [], {}):
            continue
        if _is_low_quality_value(candidate.field_key, candidate.value):
            continue
        group_id = candidate.group_id
        if (
            group_id is None
            and document_group_id
            and is_package_scoped_field_key(candidate.field_key)
        ):
            group_id = document_group_id
        if group_id is None and candidate.package_code and package_group_map:
            group_id = package_group_map.get(candidate.package_code)
        if candidate.group_id != group_id:
            candidate = FieldCandidate(**{**candidate.__dict__, "group_id": group_id})
        # Shared fields stay unscoped; package-scoped without group stay unscoped but
        # callers must not fall back across packages for those keys.
        if is_shared_field_key(candidate.field_key):
            candidate = FieldCandidate(**{**candidate.__dict__, "group_id": None})
        normalized.append(candidate)

    # Compliance: never treat 建设投资/总投资 as procurement_budget or maximum_price.
    filtered: list[FieldCandidate] = []
    for candidate in normalized:
        if candidate.field_key in {"procurement_budget", "maximum_price"}:
            label = (candidate.matched_label or "").strip()
            if any(token in label for token in ("总投资", "建设投资", "项目投资", "可研总投资")):
                continue
            if candidate.locator_extra.get("amount_role") == "estimated":
                continue
        filtered.append(candidate)

    existing_by_key = {
        field_row.field_key: field_row
        for field_row in db.scalars(
            select(FieldValue).where(
                FieldValue.project_id == file_record.project_id,
                FieldValue.stage == file_record.stage,
                FieldValue.is_current.is_(True),
            )
        )
    }
    definitions_by_key = {
        canonicalize_field_key(definition.field_key): definition for definition in definitions
    }
    created_keys: list[str] = []
    existing_keys: list[str] = []
    skipped_keys: list[str] = []
    revised_keys: list[str] = []
    conflict_keys: list[str] = []

    # Group by storage key; different values → conflict, not highest-confidence wins.
    by_storage: dict[str, list[FieldCandidate]] = {}
    for candidate in filtered:
        by_storage.setdefault(candidate.storage_key, []).append(candidate)

    for storage_key, items in by_storage.items():
        # Deduplicate identical values by evidence locator + version.
        unique_values: list[FieldCandidate] = []
        seen_fingerprints: set[str] = set()
        for item in items:
            fingerprint = "|".join(
                [
                    str(version.id),
                    storage_key,
                    str(item.value),
                    str((item.locator_extra or {}).get("row")),
                    str((item.locator_extra or {}).get("col_value", (item.locator_extra or {}).get("col"))),
                    item.rule_version,
                ]
            )
            if fingerprint in seen_fingerprints:
                continue
            seen_fingerprints.add(fingerprint)
            unique_values.append(item)

        distinct_values: list[FieldCandidate] = []
        for item in unique_values:
            if any(_same_value(item.value, existing.value) for existing in distinct_values):
                continue
            distinct_values.append(item)

        if len(distinct_values) > 1:
            # Keep conflict record; do not auto-pick.
            ids_for_conflict: list[str] = []
            for item in distinct_values:
                definition = definitions_by_key.get(item.field_key)
                if definition is None:
                    continue
                # Create temporary extracted revisions for conflict candidates when unset.
                current = existing_by_key.get(storage_key)
                if current and current.status in _PROTECTED_STATUSES:
                    skipped_keys.append(storage_key)
                    continue
                value, normalized_value, unit = _store_value_payload(item, definition)
                revision = 1
                if current:
                    current.is_current = False
                    revision = current.revision + 1
                field_row = FieldValue(
                    organization_id=file_record.organization_id,
                    project_id=file_record.project_id,
                    stage=file_record.stage,
                    definition_id=getattr(definition, "id", None),
                    field_key=storage_key,
                    field_label=definition.field_label,
                    data_type=definition.data_type,
                    value=value,
                    normalized_value=normalized_value,
                    unit=unit,
                    criticality=definition.criticality,
                    status="conflict",
                    source_type="extracted",
                    confidence=item.confidence,
                    revision=revision,
                    created_by=actor_id,
                    updated_by=actor_id,
                )
                db.add(field_row)
                db.flush()
                _add_candidate_evidence(db, field_row, item, file_record, version, actor_id)
                existing_by_key[storage_key] = field_row
                ids_for_conflict.append(field_row.id)
            if ids_for_conflict:
                db.add(
                    FieldConflict(
                        organization_id=file_record.organization_id,
                        project_id=file_record.project_id,
                        stage=file_record.stage,
                        field_key=storage_key,
                        candidate_field_value_ids=ids_for_conflict,
                        status="open",
                        created_by=actor_id,
                        updated_by=actor_id,
                    )
                )
                conflict_keys.append(storage_key)
            continue

        candidate = distinct_values[0]
        definition = definitions_by_key.get(candidate.field_key)
        if definition is None:
            skipped_keys.append(storage_key)
            continue
        current = existing_by_key.get(storage_key)
        current_value = (
            current.normalized_value
            if current is not None and current.normalized_value is not None
            else current.value
            if current is not None
            else None
        )
        if current and _same_value(current_value, candidate.value):
            duplicate_evidence = db.scalar(
                select(FieldEvidence.id).where(
                    FieldEvidence.field_value_id == current.id,
                    FieldEvidence.source_file_version_id == version.id,
                    FieldEvidence.document_block_id == candidate.block.id,
                )
            )
            if current.source_type == "extracted" and not duplicate_evidence:
                _add_candidate_evidence(db, current, candidate, file_record, version, actor_id)
            existing_keys.append(storage_key)
            continue
        if current and current.value not in (None, "", [], {}):
            if current.status in _PROTECTED_STATUSES or current.source_type in {
                "user_input",
                "user_confirmed",
            }:
                skipped_keys.append(storage_key)
                continue
            if current.status == "extracted" and current.source_type == "extracted":
                # Unconfirmed extracted may create a new revision; keep old record.
                value, normalized_value, unit = _store_value_payload(candidate, definition)
                current.is_current = False
                field_row = FieldValue(
                    organization_id=file_record.organization_id,
                    project_id=file_record.project_id,
                    stage=file_record.stage,
                    definition_id=getattr(definition, "id", None),
                    field_key=storage_key,
                    field_label=definition.field_label,
                    data_type=definition.data_type,
                    value=value,
                    normalized_value=normalized_value,
                    unit=unit,
                    criticality=definition.criticality,
                    status="extracted",
                    source_type="extracted",
                    confidence=candidate.confidence,
                    revision=current.revision + 1,
                    created_by=actor_id,
                    updated_by=actor_id,
                )
                db.add(field_row)
                db.flush()
                _add_candidate_evidence(db, field_row, candidate, file_record, version, actor_id)
                existing_by_key[storage_key] = field_row
                revised_keys.append(storage_key)
                continue
            skipped_keys.append(storage_key)
            continue
        value, normalized_value, unit = _store_value_payload(candidate, definition)
        revision = 1
        if current:
            current.is_current = False
            revision = current.revision + 1
        field_row = FieldValue(
            organization_id=file_record.organization_id,
            project_id=file_record.project_id,
            stage=file_record.stage,
            definition_id=getattr(definition, "id", None),
            field_key=storage_key,
            field_label=definition.field_label,
            data_type=definition.data_type,
            value=value,
            normalized_value=normalized_value,
            unit=unit,
            criticality=definition.criticality,
            status="extracted",
            source_type="extracted",
            confidence=candidate.confidence,
            revision=revision,
            created_by=actor_id,
            updated_by=actor_id,
        )
        db.add(field_row)
        db.flush()
        _add_candidate_evidence(db, field_row, candidate, file_record, version, actor_id)
        existing_by_key[storage_key] = field_row
        created_keys.append(storage_key)
    return {
        "created": len(created_keys),
        "existing": len(existing_keys),
        "skipped": len(skipped_keys),
        "revised": len(revised_keys),
        "conflicts": len(conflict_keys),
        "created_keys": created_keys,
        "existing_keys": existing_keys,
        "skipped_keys": skipped_keys,
        "revised_keys": revised_keys,
        "conflict_keys": conflict_keys,
    }


_TEMP_PROJECT_CODE_RE = re.compile(r"^TMP-\d+(?:-\d+)?$")
_PROJECT_CODE_LABELS = ("项目编号", "工程编号", "立项编号")
_PROJECT_DESC_LABELS = ("项目说明", "项目概况", "项目简介", "建设目标", "项目背景")
_PROJECT_CODE_VALUE_RE = re.compile(
    r"^[A-Za-z0-9_\u4e00-\u9fff\-·.（）()〔〕【】\[\]/]{2,80}$"
)


def is_temporary_project_code(code: str | None) -> bool:
    return bool(code and _TEMP_PROJECT_CODE_RE.fullmatch(code.strip()))


def _labeled_value(text: str, labels: tuple[str, ...], max_len: int) -> str | None:
    label_pattern = "|".join(re.escape(label) for label in sorted(labels, key=len, reverse=True))
    matched = re.search(
        rf"(?:{label_pattern})\s*(?:为|是|[:：])\s*[“\"「『]?([^”\"」』\n]{{2,{max_len}}})",
        text,
    )
    if not matched:
        return None
    value = _clean_text(matched.group(1))
    return value or None


def extract_project_code_from_blocks(blocks: list[DocumentBlock]) -> str | None:
    for block in sorted(blocks, key=lambda item: item.sequence):
        value = _labeled_value(block.text, _PROJECT_CODE_LABELS, 80)
        if value and _PROJECT_CODE_VALUE_RE.fullmatch(value):
            return value
    return None


def extract_project_description_from_blocks(blocks: list[DocumentBlock]) -> str | None:
    for block in sorted(blocks, key=lambda item: item.sequence):
        value = _labeled_value(block.text, _PROJECT_DESC_LABELS, 800)
        if value:
            return value[:4_000]
    return None


def backfill_project_metadata_from_blocks(
    db: Session,
    *,
    project_id: str,
    blocks: list[DocumentBlock],
    actor_id: str,
) -> dict[str, Any]:
    """Fill project.code / description from parsed source materials when still empty/temporary."""
    project = db.get(Project, project_id)
    if project is None or not blocks:
        return {"updated": False, "code": False, "description": False}

    updated_code = False
    updated_description = False

    if is_temporary_project_code(project.code) or not (project.code or "").strip():
        extracted_code = extract_project_code_from_blocks(blocks)
        if extracted_code and extracted_code != project.code:
            conflict = db.scalar(
                select(Project.id).where(
                    Project.organization_id == project.organization_id,
                    Project.code == extracted_code,
                    Project.id != project.id,
                )
            )
            if conflict is None:
                project.code = extracted_code
                updated_code = True

    if not (project.description or "").strip():
        extracted_description = extract_project_description_from_blocks(blocks)
        if extracted_description:
            project.description = extracted_description
            updated_description = True

    if updated_code or updated_description:
        project.revision += 1
        project.updated_by = actor_id
        db.flush()

    return {
        "updated": updated_code or updated_description,
        "code": updated_code,
        "description": updated_description,
    }
