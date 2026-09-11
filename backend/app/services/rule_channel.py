"""Channel A: rule and structure analysis for external feasibility reports."""

from __future__ import annotations

import re
from collections.abc import Sequence
from decimal import Decimal
from typing import Any, Protocol

from .document_ir import normalize_text, parse_amount_expression
from .procurement_candidates import (
    BudgetCandidate,
    ContentCandidate,
    GroupCandidate,
    PackageCandidate,
    PlanCandidate,
    ProcurementAnalysisCandidate,
)
from .procurement_planning import (
    KNOWN_NON_TENDER_METHODS,
    _infer_procurement_category,
)

RULE_CHANNEL_VERSION = "rule-channel-v2"

PROCUREMENT_SECTION_HINTS = (
    "\u62db\u6807\u65b9\u6848",
    "\u62db\u6807\u7ec4\u7ec7",
    "\u91c7\u8d2d\u7ec4\u7ec7",
    "\u91c7\u8d2d\u5b89\u6392",
    "\u91c7\u8d2d\u65b9\u6848",
    "\u9879\u76ee\u5b9e\u65bd",
    "\u5408\u540c\u5212\u5206",
    "\u6807\u6bb5\u5212\u5206",
    "\u5305\u4ef6\u5212\u5206",
    "\u5efa\u8bbe\u7ba1\u7406",
    "\u5b9e\u65bd\u8ba1\u5212",
    "\u62db\u6807\u91c7\u8d2d",
    "\u91c7\u8d2d\u8ba1\u5212",
)

HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "package_code": (
        "\u5305\u53f7",
        "\u5305\u4ef6\u53f7",
        "\u6807\u6bb5\u53f7",
        "\u5408\u540c\u5305",
        "\u6807\u5305\u53f7",
        "\u7f16\u53f7",
        "\u5e8f\u53f7",
        "\u5305\u4ef6",
        "\u6807\u6bb5",
    ),
    "package_name": (
        "\u91c7\u8d2d\u5185\u5bb9",
        "\u6807\u7684",
        "\u5de5\u4f5c\u8303\u56f4",
        "\u9879\u76ee\u540d\u79f0",
        "\u5305\u540d\u79f0",
        "\u6807\u6bb5\u540d\u79f0",
        "\u91c7\u8d2d\u5305\u540d\u79f0",
        "\u5efa\u8bbe\u5185\u5bb9",
    ),
    "amount": (
        "\u53ef\u7814\u91c7\u8d2d\u4f30\u7b97",
        "\u91c7\u8d2d\u4f30\u7b97",
        "\u91c7\u8d2d\u9884\u7b97",
        "\u4f30\u7b97\u4ef7",
        "\u63a7\u5236\u4ef7",
        "\u9884\u7b97\u91d1\u989d",
        "\u91d1\u989d",
        "\u6982\u7b97",
        "\u6295\u8d44\u4f30\u7b97",
        "\u9650\u4ef7",
    ),
    "method": (
        "\u91c7\u8d2d\u65b9\u5f0f",
        "\u62db\u6807\u65b9\u5f0f",
        "\u7ec4\u7ec7\u65b9\u5f0f",
        "\u91c7\u8d2d\u7ec4\u7ec7\u5f62\u5f0f",
    ),
    "scope": (
        "\u8303\u56f4",
        "\u5de5\u4f5c\u5185\u5bb9",
        "\u4e3b\u8981\u5185\u5bb9",
        "\u91c7\u8d2d\u8303\u56f4",
    ),
    "pending_document": (
        "\u5f85\u7f16\u5236\u6587\u4ef6",
        "\u7f16\u5236\u6587\u4ef6",
        "\u62db\u6807\u6587\u4ef6\u540d\u79f0",
        "\u91c7\u8d2d\u6587\u4ef6\u540d\u79f0",
    ),
    "procurement_attribute": ("\u91c7\u8d2d\u5c5e\u6027",),
    "quantity": ("\u6570\u91cf",),
}

FIELD_MAPPING_HEADER_MARKERS = (
    "\u5b57\u6bb5",
    "\u6b63\u5f0f\u6765\u6e90",
    "\u91c7\u96c6\u72b6\u6001",
    "\u5904\u7406\u539f\u5219",
)

METHOD_PATTERNS: list[tuple[str, str]] = [
    ("\u516c\u5f00\u62db\u6807", "public_tender"),
    ("\u9080\u8bf7\u62db\u6807", "invited_tender"),
    ("\u7ade\u4e89\u6027\u78b0\u5546", "competitive_consultation"),
    ("\u7ade\u4e89\u6027\u8c08\u5224", "competitive_negotiation"),
    ("\u8be2\u6bd4", "inquiry"),
    ("\u6bd4\u9009", "inquiry"),
    ("\u8be2\u4ef7", "inquiry"),
    ("\u5355\u4e00\u6765\u6e90", "single_source"),
    ("\u76f4\u63a5\u91c7\u8d2d", "direct_purchase"),
]

AMBIGUOUS_METHOD_MARKERS = (
    "\u516c\u5f00\u7ade\u4e89\u6027\u91c7\u8d2d",
    "\u516c\u5f00\u5f81\u96c6",
    "\u7ade\u4e89\u6027\u91c7\u8d2d",
)

NEGATION_MARKERS = (
    "\u4e0d\u5355\u72ec\u91c7\u8d2d",
    "\u6682\u4e0d",
    "\u53e6\u884c\u786e\u5b9a",
    "\u4e0d\u7eb3\u5165",
    "\u4e0d\u5c5e\u4e8e\u672c\u6b21",
    "\u53d6\u6d88",
    "\u5907\u9009",
    "\u5386\u53f2\u6848\u4f8b",
)

NON_PACKAGE_ROW_MARKERS = (
    "\u9884\u5907\u8d39",
    "\u7a0e\u8d39",
    "\u5efa\u8bbe\u671f\u5229\u606f",
    "\u6d41\u52a8\u8d44\u91d1",
    "\u5185\u90e8",
    "\u4eba\u5458\u6210\u672c",
    "\u5408\u8ba1",
    "\u5c0f\u8ba1",
    "\u603b\u8ba1",
    "\u8fd0\u7ef4\u8d39",
    "\u8fd0\u8425\u6210\u672c",
    "\u4e0d\u53ef\u9884\u89c1\u8d39",
)


class SourceBlockLike(Protocol):
    id: str
    sequence: int
    kind: str
    text: str
    page_number: int | None
    section_path: str | None
    locator: dict[str, object]
    confidence: Any


def _method_from_text(text: str) -> tuple[str | None, str | None]:
    for ambiguous in AMBIGUOUS_METHOD_MARKERS:
        if ambiguous in text:
            return None, ambiguous
    for label, code in METHOD_PATTERNS:
        if label in text:
            return code, label
    return None, None


def _header_map(headers: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for idx, header in enumerate(headers):
        normalized = normalize_text(header).replace(" ", "")
        for field, aliases in HEADER_ALIASES.items():
            if field in mapping:
                continue
            if any(alias in normalized for alias in aliases):
                mapping[field] = idx
    return mapping


def _looks_like_field_mapping_table(headers: list[str]) -> bool:
    """Skip field-mapping reference tables; do not filter whole appendix sections."""
    normalized = [normalize_text(header).replace(" ", "") for header in headers]
    hits = sum(
        1 for marker in FIELD_MAPPING_HEADER_MARKERS if any(marker in header for header in normalized)
    )
    has_field_col = any("\u5b57\u6bb5" in header for header in normalized)
    return has_field_col and hits >= 2


def _looks_like_file_inventory_table(mapping: dict[str, int]) -> bool:
    """待编制文件清单：包号 + 文件名（可带数量/采购属性），产出文档组而非普通采购包。"""
    return "package_code" in mapping and "pending_document" in mapping


def _looks_like_procurement_table(headers: list[str], section_path: str | None, role: str | None) -> bool:
    if _looks_like_field_mapping_table(headers):
        return False
    mapping = _header_map(headers)
    if _looks_like_file_inventory_table(mapping):
        return False
    if role == "procurement_package":
        return True
    if role in {"investment", "equipment"}:
        return "method" in mapping or ("package_code" in mapping and "package_name" in mapping)
    if "method" in mapping and ("package_name" in mapping or "scope" in mapping):
        return True
    if "package_code" in mapping and "package_name" in mapping:
        return True
    section = section_path or ""
    if any(hint in section for hint in PROCUREMENT_SECTION_HINTS):
        return "package_name" in mapping or "amount" in mapping
    return False


def _is_non_package_row(name: str, scope: str) -> bool:
    blob = f"{name} {scope}"
    return any(marker in blob for marker in NON_PACKAGE_ROW_MARKERS)


def _cell(row: list[str], index: int | None) -> str:
    if index is None or index < 0 or index >= len(row):
        return ""
    return normalize_text(row[index])


def _parse_table_rows(block: SourceBlockLike) -> list[list[str]]:
    locator = block.locator or {}
    table_rows = locator.get("table_rows")
    if isinstance(table_rows, list):
        parsed_rows: list[list[str]] = []
        for row in table_rows:
            if isinstance(row, (list, tuple)):
                parsed_rows.append([str(cell) for cell in row])
        return parsed_rows
    rows: list[list[str]] = []
    for line in block.text.splitlines():
        if " | " in line:
            rows.append([part.strip() for part in line.split(" | ")])
        elif "\t" in line:
            rows.append([part.strip() for part in line.split("\t")])
    return rows


def _amount_from_cell(text: str) -> tuple[Decimal | None, str | None, bool | None, bool]:
    parsed = parse_amount_expression(text)
    if not parsed:
        matched = re.search(r"([0-9][0-9,]*(?:\.[0-9]+)?)", text)
        if not matched:
            return None, None, None, False
        return Decimal(matched.group(1).replace(",", "")), None, None, False
    amount = Decimal(parsed["amount_yuan"])
    return amount, parsed["unit"], parsed["tax_included"], bool(parsed["approximate"])


def _parse_quantity_cell(text: str) -> int | None:
    if not text:
        return None
    matched = re.search(r"([0-9]+)", text.replace(",", ""))
    if not matched:
        return None
    try:
        return int(matched.group(1))
    except ValueError:
        return None


def _method_token_from_pipe(raw: str | None) -> str:
    """Pipe-line method segment: keep known codes/labels; missing → unknown (never invent public_tender)."""
    if not raw or not str(raw).strip():
        return "unknown"
    token = str(raw).strip()
    known_codes = {
        "public_tender",
        "invited_tender",
        "competitive_consultation",
        "competitive_negotiation",
        "inquiry",
        "single_source",
        "direct_purchase",
        "tender",
        "framework",
        "unknown",
    }
    if token in known_codes:
        return token
    method_norm, _ = _method_from_text(token)
    return method_norm or "unknown"


def _package_dedupe_key(pkg: PackageCandidate) -> str:
    code = (pkg.original_code or "").strip()
    if not code and pkg.code and not str(pkg.code).startswith("SYS-"):
        code = str(pkg.code).strip()
    if code:
        return f"code:{normalize_text(code).casefold()}"
    return f"name:{normalize_text(pkg.name).casefold()}"


def _group_dedupe_key(group: GroupCandidate) -> str:
    if group.code and not str(group.code).startswith("SYS-"):
        return f"code:{normalize_text(group.code).casefold()}"
    return f"name:{normalize_text(group.name).casefold()}"


def _merge_evidence_ids(target: list[str], incoming: list[str]) -> None:
    for eid in incoming:
        if eid not in target:
            target.append(eid)


def _dedupe_packages(packages: list[PackageCandidate]) -> list[PackageCandidate]:
    by_key: dict[str, PackageCandidate] = {}
    order: list[str] = []
    for pkg in packages:
        key = _package_dedupe_key(pkg)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = pkg
            order.append(key)
            continue
        _merge_evidence_ids(existing.evidence_block_ids, pkg.evidence_block_ids)
        for content_key in pkg.content_keys:
            if content_key not in existing.content_keys:
                existing.content_keys.append(content_key)
        if existing.estimated_amount is None and pkg.estimated_amount is not None:
            existing.estimated_amount = pkg.estimated_amount
            existing.original_unit = pkg.original_unit
            existing.tax_included = pkg.tax_included
        if (existing.procurement_method in {None, "", "unknown"}) and pkg.procurement_method not in {
            None,
            "",
            "unknown",
        }:
            existing.procurement_method = pkg.procurement_method
        if not existing.original_code and pkg.original_code:
            existing.original_code = pkg.original_code
            existing.code = pkg.code
    return [by_key[key] for key in order]


def _dedupe_groups(groups: list[GroupCandidate]) -> list[GroupCandidate]:
    by_key: dict[str, GroupCandidate] = {}
    order: list[str] = []
    for group in groups:
        key = _group_dedupe_key(group)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = group
            order.append(key)
            continue
        _merge_evidence_ids(existing.evidence_block_ids, group.evidence_block_ids)
        for code in group.package_codes:
            if code not in existing.package_codes:
                existing.package_codes.append(code)
        if (existing.procurement_method in {None, "", "unknown"}) and group.procurement_method not in {
            None,
            "",
            "unknown",
        }:
            existing.procurement_method = group.procurement_method
    return [by_key[key] for key in order]


def _extract_file_inventory(
    block: SourceBlockLike,
    rows: list[list[str]],
    mapping: dict[str, int],
) -> tuple[list[PackageCandidate], list[GroupCandidate], dict[str, Any]]:
    """Build document groups from 待编制文件清单; packages are code stubs for linking only."""
    packages: list[PackageCandidate] = []
    entries: list[dict[str, Any]] = []
    for row in rows[1:]:
        code_raw = _cell(row, mapping.get("package_code"))
        doc_name = _cell(row, mapping.get("pending_document"))
        attr = _cell(row, mapping.get("procurement_attribute"))
        qty = _parse_quantity_cell(_cell(row, mapping.get("quantity")))
        if not code_raw and not doc_name:
            continue
        # Do not split internal chapters just because a cell mentions 招标文件.
        if not doc_name:
            continue
        code = code_raw if code_raw else f"PKG-{len(entries) + 1:02d}"
        method_norm, _ = _method_from_text(attr or "")
        entries.append(
            {
                "code": code,
                "original_code": code_raw or None,
                "doc_name": doc_name,
                "attr": attr,
                "qty": qty if qty is not None else 1,
                "method": method_norm or "unknown",
            }
        )
        packages.append(
            PackageCandidate(
                code=code,
                name=attr or code,
                procurement_category=_infer_procurement_category(attr or "", doc_name),
                procurement_method=method_norm or "unknown",
                scope=attr or doc_name or code,
                budget_basis="\u5f85\u7f16\u5236\u6587\u4ef6\u6e05\u5355\uff1b\u975e\u91c7\u8d2d\u5206\u5305\u660e\u7ec6\u8868",  # noqa: E501
                evidence_block_ids=[block.id],
                original_code=code_raw or None,
            )
        )

    meta: dict[str, Any] = {}
    if not entries:
        return packages, [], meta

    by_doc: dict[str, list[dict[str, Any]]] = {}
    shared_signal = False
    for entry in entries:
        key = normalize_text(entry["doc_name"]).casefold()
        by_doc.setdefault(key, []).append(entry)
        if int(entry["qty"]) > 1:
            shared_signal = True
    if shared_signal or any(len(items) > 1 for items in by_doc.values()):
        meta["file_organization"] = "shared"
    else:
        meta["file_organization"] = "separate"

    groups: list[GroupCandidate] = []
    if meta["file_organization"] == "shared":
        for idx, items in enumerate(by_doc.values(), start=1):
            doc_name = str(items[0]["doc_name"])
            methods = {str(item["method"]) for item in items}
            method = next(iter(methods)) if len(methods) == 1 else "unknown"
            groups.append(
                GroupCandidate(
                    code=f"DOC-{idx:02d}",
                    name=doc_name,
                    procurement_category=_infer_procurement_category(
                        *(str(item.get("attr") or "") for item in items), doc_name
                    ),
                    scope="\uff1b".join(
                        dict.fromkeys(str(item.get("attr") or item["code"]) for item in items)
                    ),
                    rationale="\u5f85\u7f16\u5236\u6587\u4ef6\u6e05\u5355\uff1a\u540c\u4e00\u6587\u4ef6\u540d\u8de8\u591a\u5305\u6216\u6570\u91cf>1",  # noqa: E501
                    procurement_method=method,
                    package_codes=[str(item["code"]) for item in items],
                    evidence_block_ids=[block.id],
                    document_kind=(
                        "tender"
                        if "\u62db\u6807\u6587\u4ef6" in doc_name
                        else "other_procurement"
                        if "\u91c7\u8d2d\u6587\u4ef6" in doc_name
                        else None
                    ),
                )
            )
    else:
        for idx, entry in enumerate(entries, start=1):
            doc_name = str(entry["doc_name"])
            groups.append(
                GroupCandidate(
                    code=f"DOC-{idx:02d}",
                    name=doc_name,
                    procurement_category=_infer_procurement_category(
                        str(entry.get("attr") or ""), doc_name
                    ),
                    scope=str(entry.get("attr") or entry["code"]),
                    rationale="\u5f85\u7f16\u5236\u6587\u4ef6\u6e05\u5355\uff1a\u4e00\u5305\u4e00\u4efd\u6587\u4ef6",
                    procurement_method=str(entry["method"]),
                    package_codes=[str(entry["code"])],
                    evidence_block_ids=[block.id],
                    document_kind=(
                        "tender"
                        if "\u62db\u6807\u6587\u4ef6" in doc_name
                        else "other_procurement"
                        if "\u91c7\u8d2d\u6587\u4ef6" in doc_name
                        else None
                    ),
                )
            )
    return packages, groups, meta


def _extract_from_tables(
    blocks: Sequence[SourceBlockLike],
) -> tuple[
    list[PackageCandidate],
    list[ContentCandidate],
    list[GroupCandidate],
    list[dict[str, str]],
    list[BudgetCandidate],
    dict[str, Any],
]:
    packages: list[PackageCandidate] = []
    contents: list[ContentCandidate] = []
    groups: list[GroupCandidate] = []
    unresolved: list[dict[str, str]] = []
    budgets: list[BudgetCandidate] = []
    meta: dict[str, Any] = {}
    seen_keys: set[str] = set()

    for block in blocks:
        if block.kind != "table":
            continue
        rows = _parse_table_rows(block)
        if len(rows) < 2:
            continue
        headers = rows[0]
        role = str((block.locator or {}).get("semantic_role") or "")
        mapping = _header_map(headers)

        if _looks_like_field_mapping_table(headers):
            continue

        if _looks_like_file_inventory_table(mapping):
            inv_packages, inv_groups, inv_meta = _extract_file_inventory(block, rows, mapping)
            packages.extend(inv_packages)
            groups.extend(inv_groups)
            if inv_meta.get("file_organization"):
                meta["file_organization"] = inv_meta["file_organization"]
            continue

        if role == "investment" and not _looks_like_procurement_table(headers, block.section_path, role):
            for row in rows[1:]:
                row_text = " ".join(row)
                if any(marker in row_text for marker in ("\u603b\u6295\u8d44", "\u5efa\u8bbe\u6295\u8d44")):
                    amount, unit, tax, approx = _amount_from_cell(row_text)
                    if amount is not None and not approx:
                        budgets.append(
                            BudgetCandidate(
                                key="TOTAL-INVESTMENT",
                                name="\u53ef\u7814\u6295\u8d44\u4f30\u7b97",
                                cost_type="project_total_investment",
                                amount=amount,
                                original_value=row_text[:80],
                                original_unit=unit,
                                tax_included=tax,
                                evidence_block_ids=[block.id],
                            )
                        )
            continue
        if not _looks_like_procurement_table(headers, block.section_path, role or None):
            continue
        if not mapping:
            continue
        for row_index, row in enumerate(rows[1:], start=1):
            name = _cell(row, mapping.get("package_name")) or _cell(row, mapping.get("scope"))
            code_raw = _cell(row, mapping.get("package_code"))
            amount_text = _cell(row, mapping.get("amount"))
            method_text = _cell(row, mapping.get("method"))
            scope = _cell(row, mapping.get("scope")) or name
            if not name and not code_raw:
                continue
            if _is_non_package_row(name or code_raw, scope):
                continue
            if any(marker in f"{name}{scope}{method_text}" for marker in NEGATION_MARKERS):
                contents.append(
                    ContentCandidate(
                        key=f"CONTENT-EXCL-{len(contents) + 1:02d}",
                        name=name or code_raw,
                        description=scope,
                        scope_status="excluded",
                        evidence_block_ids=[block.id],
                    )
                )
                continue
            method_norm, method_raw = _method_from_text(method_text or scope or name)
            if code_raw and re.search(r"[A-Za-z0-9\u4e00-\u9fff]", code_raw):
                code = code_raw if len(code_raw) <= 40 else f"PKG-{len(packages) + 1:02d}"
                original_code = code_raw
            else:
                code = f"SYS-PKG-{len(packages) + 1:02d}"
                original_code = None
            dedupe = f"{code}|{name}|{scope}"
            if dedupe in seen_keys:
                continue
            seen_keys.add(dedupe)
            amount, unit, tax, approx = (
                _amount_from_cell(amount_text) if amount_text else (None, None, None, False)
            )
            content_key = f"CONTENT-{len(contents) + 1:02d}"
            scope_status = "other_method" if method_norm in KNOWN_NON_TENDER_METHODS else "in_scope"
            if method_norm is None and method_raw:
                unresolved.append(
                    {
                        "code": "analysis.method_ambiguous",
                        "severity": "P1",
                        "title": "\u91c7\u8d2d\u65b9\u5f0f\u8868\u8ff0\u4e0d\u5145\u5206",
                        "detail": f"\u539f\u6587\u8868\u8ff0\u4e3a\u300c{method_raw}\u300d\uff0c\u4e0d\u80fd\u81ea\u52a8\u5f52\u7c7b\u4e3a\u516c\u5f00\u62db\u6807\u3002",  # noqa: E501
                        "impact": "\u6587\u4ef6\u7c7b\u578b\u5206\u7c7b\u5f85\u786e\u8ba4\u3002",
                    }
                )
            contents.append(
                ContentCandidate(
                    key=content_key,
                    name=name or code,
                    description=scope,
                    scope_status=scope_status if method_norm else "unknown",
                    procurement_method=method_norm,
                    evidence_block_ids=[block.id],
                )
            )
            basis = f"\u8868\u683c\u7b2c{row_index + 1}\u884c"
            basis += f"\uff1b\u539f\u6587\u5305\u53f7={original_code}" if original_code else "\uff1b\u7cfb\u7edf\u5185\u90e8\u7f16\u53f7\uff0c\u975e\u539f\u6587\u5305\u53f7"  # noqa: E501
            if approx:
                basis += "\uff1b\u91d1\u989d\u542b\u7ea6\u7b49\u9650\u5b9a\uff0c\u672a\u91c7\u4fe1\u4e3a\u7cbe\u786e\u503c"  # noqa: E501
            packages.append(
                PackageCandidate(
                    code=code,
                    name=name or code,
                    procurement_category=_infer_procurement_category(name, scope, method_text or ""),
                    procurement_method=method_norm or "unknown",
                    scope=scope or name or code,
                    estimated_amount=None if approx else amount,
                    currency="CNY",
                    original_unit=unit,
                    tax_included=tax,
                    budget_basis=basis,
                    content_keys=[content_key],
                    evidence_block_ids=[block.id],
                    original_code=original_code,
                )
            )
    return packages, contents, groups, unresolved, budgets, meta


_PROSE_PACKAGE = re.compile(
    r"(?:"
    r"\u7b2c(?P<ord>[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f60-9]+)"
    r"(?:\u6807\u6bb5|\u5305\u4ef6|\u5305)"
    r"|"
    r"(?P<label>"
    # 包件 + code (包件01 / 包件A)
    r"(?<![A-Za-z])\u5305\u4ef6[A-Za-z0-9\u7532\u4e59\u4e19\u4e01]+(?![A-Za-z])"
    r"|"
    # 包 + 单拉丁字母（禁止 profile 这类后续拉丁字母续接）
    r"(?<![A-Za-z])\u5305[A-Za-z](?![A-Za-z])"
    r"|"
    # 包 + 拉丁字母开头的短编码（P01），不允许整段英文词
    r"(?<![A-Za-z])\u5305[A-Za-z][0-9]+(?![A-Za-z])"
    r"|"
    # 包 + 数字/甲乙丙丁
    r"(?<![A-Za-z])\u5305[0-9\u7532\u4e59\u4e19\u4e01]+(?![A-Za-z])"
    r"|"
    r"(?<![A-Za-z])[A-Za-z]\u5305(?![A-Za-z])"
    r"|"
    r"\u5408\u540c\u5305\s*[0-9]+"
    r"|"
    r"\u6807\u6bb5\s*[0-9]+"
    r")"
    r")"
    r"[\uff1a:\s]*(?P<body>.{2,120}?)"
    r"(?="
    r"\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f60-9]+(?:\u6807\u6bb5|\u5305)"
    r"|(?<![A-Za-z])\u5305\u4ef6?(?=[A-Za-z0-9\u7532\u4e59\u4e19\u4e01])"
    r"|(?<![A-Za-z])[A-Za-z]\u5305"
    r"|\uff1b|;|\u3002|$"
    r")"
)

_SEPARATE_DOCS = re.compile(
    r"(\u5206\u522b\u7f16\u5236|\u5206\u522b\u7ec4\u7ec7|\u5404\u81ea\u7f16\u5236|\u72ec\u7acb\u7f16\u5236|\u5355\u72ec\u7f16\u5236).{0,20}(\u62db\u6807\u6587\u4ef6|\u91c7\u8d2d\u6587\u4ef6|\u78b0\u5546\u6587\u4ef6|\u8c08\u5224\u6587\u4ef6)"  # noqa: E501
)
_SHARED_DOCS = re.compile(
    r"(\u5171\u7528|\u5408\u5e76\u7f16\u5236|\u7edf\u4e00\u7f16\u5236|\u540c\u4e00\u4efd|\u4e00\u5957).{0,20}(\u62db\u6807\u6587\u4ef6|\u91c7\u8d2d\u6587\u4ef6)"  # noqa: E501
)
_SEGMENT_COUNT_ONLY = re.compile(
    r"(?:\u5206\u4e3a|\u5212\u5206[\u4e3a\u6210]?)\s*(?P<count>[0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+)\s*(?:\u4e2a)?(?:\u6807\u6bb5|\u5305\u4ef6|\u91c7\u8d2d\u5305)"  # noqa: E501
)


def _chinese_int(value: str) -> int | None:
    mapping = {
        "\u4e00": 1,
        "\u4e8c": 2,
        "\u4e24": 2,
        "\u4e09": 3,
        "\u56db": 4,
        "\u4e94": 5,
        "\u516d": 6,
        "\u4e03": 7,
        "\u516b": 8,
        "\u4e5d": 9,
        "\u5341": 10,
    }
    if value.isdigit():
        return int(value)
    if value in mapping:
        return mapping[value]
    if value.startswith("\u5341") and len(value) <= 2:
        return 10 + (mapping.get(value[1], 0) if len(value) == 2 else 0)
    return None


def _prose_label_code_keys(label: str) -> set[str]:
    """Map prose labels like 包A / A包 / 包件01 to comparable package codes."""
    text = normalize_text(label).replace(" ", "")
    keys = {text.casefold()}
    matched = re.fullmatch(r"\u5305\u4ef6?(.+)", text)
    if matched:
        keys.add(matched.group(1).casefold())
    matched = re.fullmatch(r"(.+)\u5305", text)
    if matched and len(matched.group(1)) <= 8:
        keys.add(matched.group(1).casefold())
    matched = re.fullmatch(
        r"\u7b2c([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f60-9]+)(?:\u6807\u6bb5|\u5305\u4ef6|\u5305)",
        text,
    )
    if matched:
        keys.add(text.casefold())
    return {key for key in keys if key}


def _extract_from_prose(
    blocks: Sequence[SourceBlockLike],
    existing_packages: list[PackageCandidate],
) -> tuple[list[PackageCandidate], list[ContentCandidate], list[GroupCandidate], list[dict[str, str]], dict[str, Any]]:  # noqa: E501
    packages = list(existing_packages)
    contents: list[ContentCandidate] = []
    groups: list[GroupCandidate] = []
    unresolved: list[dict[str, str]] = []
    meta: dict[str, Any] = {"declared_package_count": None, "file_organization": None}
    existing_names = {pkg.name for pkg in packages}

    for block in blocks:
        text = block.text
        section = block.section_path or ""
        in_procurement_section = any(hint in section for hint in PROCUREMENT_SECTION_HINTS) or any(
            hint in text[:40] for hint in PROCUREMENT_SECTION_HINTS
        )

        if _SEPARATE_DOCS.search(text):
            meta["file_organization"] = "separate"
        elif _SHARED_DOCS.search(text):
            meta["file_organization"] = "shared"

        count_match = _SEGMENT_COUNT_ONLY.search(text)
        if count_match:
            declared = _chinese_int(count_match.group("count"))
            if declared is not None:
                meta["declared_package_count"] = declared

        for raw_line in text.splitlines() or [text]:
            line = raw_line.strip()
            matched = re.search(
                r"(?:\u72ec\u7acb\u4e3b\u62db\u6807\u6587\u4ef6|\u4e3b\u62db\u6807\u6587\u4ef6|\u72ec\u7acb\u62db\u6807\u6587\u4ef6)\s*[\uff1a:]\s*(.+)",  # noqa: E501
                line,
            )
            if matched:
                parts = [item.strip() for item in matched.group(1).split("|")]
                name = parts[0]
                code = f"DOC-{len(groups) + 1:02d}"
                groups.append(
                    GroupCandidate(
                        code=code,
                        name=name
                        if ("\u62db\u6807\u6587\u4ef6" in name or "\u91c7\u8d2d\u6587\u4ef6" in name)
                        else f"{name}\u62db\u6807\u6587\u4ef6",
                        procurement_category=_infer_procurement_category(*parts),
                        scope=parts[1] if len(parts) > 1 and parts[1] else name,
                        rationale=parts[2]
                        if len(parts) > 2 and parts[2]
                        else "\u539f\u6587\u660e\u786e\u8981\u6c42\u72ec\u7acb\u7f16\u5236",
                        procurement_method=(parts[3] if len(parts) > 3 and parts[3] else "public_tender"),
                        package_codes=[],
                        evidence_block_ids=[block.id],
                    )
                )
                # Only "independent/separate" labels imply multi-document organization.
                if line.startswith(("\u72ec\u7acb\u4e3b\u62db\u6807\u6587\u4ef6", "\u72ec\u7acb\u62db\u6807\u6587\u4ef6")):  # noqa: E501
                    meta["file_organization"] = "separate"
                elif meta.get("file_organization") is None:
                    meta["file_organization"] = "shared"
                continue
            matched = re.search(r"\u91c7\u8d2d\u5305(?:/\u6807\u6bb5)?\s*[\uff1a:]\s*(.+)", line)
            if matched:
                body = matched.group(1).strip()
                prefix = line[: matched.start()]
                count_in_prefix = re.search(
                    r"([0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24]+)\s*\u4e2a\s*$",
                    prefix,
                )
                has_pipe = "|" in body
                has_enumeration = (not has_pipe) and bool(
                    re.search(r"[\u3001\uff0c,]", body)
                )
                # Summary / count / range without pipe → do not invent packages.
                if not has_pipe or count_in_prefix or has_enumeration:
                    if count_in_prefix:
                        declared = _chinese_int(count_in_prefix.group(1))
                        if declared is not None:
                            meta["declared_package_count"] = declared
                    elif has_enumeration:
                        items = [
                            item.strip(" \uff0c\u3001,;?\u3002")
                            for item in re.split(r"[\u3001\uff0c,]", body)
                            if item.strip(" \uff0c\u3001,;?\u3002")
                        ]
                        if items and meta.get("declared_package_count") is None:
                            meta["declared_package_count"] = len(items)
                    # Evidence-only: do not create a package from summary lines.
                    continue
                parts = [item.strip() for item in body.split("|")]
                code = parts[0] if len(parts) > 1 else f"PKG-{len(packages) + 1:02d}"
                name = parts[1] if len(parts) > 1 else parts[0]
                scope = parts[2] if len(parts) > 2 and parts[2] else name
                method = _method_token_from_pipe(parts[3] if len(parts) > 3 else None)
                content_key = f"CONTENT-P-{len(contents) + 1:02d}"
                contents.append(
                    ContentCandidate(
                        key=content_key,
                        name=name,
                        description=scope,
                        scope_status="other_method" if method in KNOWN_NON_TENDER_METHODS else "in_scope",
                        procurement_method=method,
                        evidence_block_ids=[block.id],
                    )
                )
                packages.append(
                    PackageCandidate(
                        code=code,
                        name=name,
                        procurement_category=_infer_procurement_category(*parts),
                        procurement_method=method,
                        scope=scope,
                        content_keys=[content_key],
                        evidence_block_ids=[block.id],
                        original_code=code if len(parts) > 1 else None,
                    )
                )
                if groups:
                    groups[-1].package_codes.append(code)
                continue
            matched = re.search(
                r"(?:\u4e0d\u5c5e\u4e8e\u672c\u6b21\u91c7\u8d2d|\u4e0d\u7eb3\u5165\u672c\u6b21\u91c7\u8d2d|"
                r"\u5df2\u91c7\u8d2d|\u590d\u7528\u5185\u5bb9|\u8fdc\u671f\u89c4\u5212)\s*[\uff1a:]\s*(.+)",
                line,
            )
            if matched:
                label = line.split("\uff1a", 1)[0].split(":", 1)[0]
                status = (
                    "already_procured"
                    if "\u5df2\u91c7\u8d2d" in label
                    else "future"
                    if "\u8fdc\u671f" in label
                    else "excluded"
                )
                for value in [
                    item.strip(" \uff0c\u3001;?")
                    for item in re.split(r"[\u3001\uff1b;]", matched.group(1))
                    if item.strip(" \uff0c\u3001;?")
                ]:
                    contents.append(
                        ContentCandidate(
                            key=f"CONTENT-{len(contents) + 1:02d}",
                            name=value,
                            description=value,
                            scope_status=status,
                            evidence_block_ids=[block.id],
                        )
                    )
                continue
            matched = re.search(r"(?:\u6765\u6e90\u51b2\u7a81|\u91c7\u8d2d\u5b89\u6392\u51b2\u7a81)\s*[\uff1a:]\s*(.+)", line)  # noqa: E501
            if matched:
                unresolved.append(
                    {
                        "code": "source.conflict",
                        "severity": "P0",
                        "title": "\u91c7\u8d2d\u5b89\u6392\u6765\u6e90\u51b2\u7a81",
                        "detail": matched.group(1),
                        "impact": "\u5f71\u54cd\u91c7\u8d2d\u8303\u56f4\u6216\u4e3b\u62db\u6807\u6587\u4ef6\u4efd\u6570\uff0c\u5904\u7406\u524d\u4e0d\u80fd\u786e\u8ba4\u65b9\u6848\u3002",  # noqa: E501
                    }
                )
                continue

        if in_procurement_section or "\u6807\u6bb5" in text or "\u91c7\u8d2d\u5305" in text or "\u5305\u4ef6" in text:  # noqa: E501
            for match in _PROSE_PACKAGE.finditer(text):
                body = (match.group("body") or "").strip(" \uff0c\u3001\uff1b;")
                label = match.group("label") or f"\u7b2c{match.group('ord')}\u6807\u6bb5"
                # 包+单字母且正文以拉丁字母续接 → English 词中部误切（如 profile），跳过
                if re.fullmatch(r"\u5305[A-Za-z]", label or "") and body and re.match(r"[A-Za-z]", body):
                    continue
                if not body or len(body) < 2:
                    body = label
                # Deduplicate by name or code-like label; merge evidence only.
                label_keys = _prose_label_code_keys(label or "")
                matched_existing = False
                for pkg in packages:
                    pkg_keys = {
                        normalize_text(pkg.code).casefold(),
                        normalize_text(pkg.original_code or "").casefold(),
                        normalize_text(pkg.name).casefold(),
                    }
                    same_name = pkg.name == body or pkg.name == body[:80]
                    same_label = bool(label_keys & {key for key in pkg_keys if key})
                    if same_name or same_label:
                        _merge_evidence_ids(pkg.evidence_block_ids, [block.id])
                        if method_norm := _method_from_text(body)[0]:
                            if pkg.procurement_method in {None, "", "unknown"}:
                                pkg.procurement_method = method_norm
                        matched_existing = True
                        break
                if matched_existing or body in existing_names:
                    continue
                if any(marker in body for marker in NEGATION_MARKERS):
                    continue
                method_norm, _ = _method_from_text(body)
                code = f"SYS-PKG-{len(packages) + 1:02d}"
                content_key = f"CONTENT-P-{len(contents) + 1:02d}"
                contents.append(
                    ContentCandidate(
                        key=content_key,
                        name=body[:80],
                        description=body,
                        scope_status="in_scope" if method_norm not in KNOWN_NON_TENDER_METHODS else "other_method",  # noqa: E501
                        procurement_method=method_norm,
                        evidence_block_ids=[block.id],
                    )
                )
                packages.append(
                    PackageCandidate(
                        code=code,
                        name=body[:80],
                        procurement_category=_infer_procurement_category(body),
                        procurement_method=method_norm or "unknown",
                        scope=body,
                        budget_basis=f"\u6b63\u6587\u8bc6\u522b\uff1b\u539f\u6587\u6807\u8bb0={label}\uff1b\u7cfb\u7edf\u5185\u90e8\u7f16\u53f7",  # noqa: E501
                        content_keys=[content_key],
                        evidence_block_ids=[block.id],
                    )
                )
                existing_names.add(body[:80])

    return packages, contents, groups, unresolved, meta


def _append_declared_count_mismatch(
    *,
    meta: dict[str, Any],
    packages: list[PackageCandidate],
    unresolved: list[dict[str, str]],
    count_summary: dict[str, Any],
) -> None:
    declared = meta.get("declared_package_count")
    if declared is None or declared == len(packages):
        return
    if any(item.get("code") == "analysis.declared_count_mismatch" for item in unresolved):
        count_summary["package_count_complete"] = False
        count_summary["package_count_total"] = None
        return
    unresolved.append(
        {
            "code": "analysis.declared_count_mismatch",
            "severity": "P1",
            "title": "\u539f\u6587\u58f0\u660e\u6570\u91cf\u4e0e\u5df2\u8bc6\u522b\u660e\u7ec6\u4e0d\u4e00\u81f4",  # noqa: E501
            "detail": (
                f"\u539f\u6587\u58f0\u660e\u7ea6 {declared} \u4e2a\u6807\u6bb5/\u5305\u4ef6\uff0c"  # noqa: E501
                f"\u89c4\u5219\u901a\u9053\u5df2\u8bc6\u522b {len(packages)} \u4e2a\u660e\u7ec6\uff0c\u4e0d\u7f16\u9020\u7f3a\u5931\u9879\u3002"  # noqa: E501
            ),
            "impact": "\u9700\u4eba\u5de5\u6838\u5bf9\u7f3a\u9879\u6216\u51b2\u7a81\u3002",
        }
    )
    count_summary["package_count_complete"] = False
    count_summary["package_count_total"] = None


def _build_groups(
    packages: list[PackageCandidate],
    groups: list[GroupCandidate],
    meta: dict[str, Any],
    project_name: str,
) -> tuple[list[GroupCandidate], list[dict[str, str]], dict[str, Any]]:
    unresolved: list[dict[str, str]] = []
    count_summary: dict[str, Any] = {
        "package_count_identified": len(packages),
        "package_count_total": meta.get("declared_package_count"),
        "package_count_complete": (
            meta.get("declared_package_count") is not None
            and meta.get("declared_package_count") == len(packages)
        ),
        "document_group_count_identified": None,
        "document_group_count_total": None,
        "document_group_complete": False,
        "tender_document_count": None,
        "other_procurement_document_count": None,
        "basis": "rule_channel",
    }

    if groups:
        assigned = {code for group in groups for code in group.package_codes}
        for pkg in packages:
            if pkg.code not in assigned and groups:
                groups[0].package_codes.append(pkg.code)
        tender_groups = [
            g for g in groups if g.procurement_method in {"public_tender", "invited_tender", "tender"}
        ]
        other_groups = [g for g in groups if g not in tender_groups]
        count_summary["document_group_count_identified"] = len(groups)
        count_summary["document_group_count_total"] = len(groups)
        count_summary["document_group_complete"] = True
        count_summary["tender_document_count"] = len(tender_groups)
        count_summary["other_procurement_document_count"] = len(other_groups)
        _append_declared_count_mismatch(
            meta=meta, packages=packages, unresolved=unresolved, count_summary=count_summary
        )
        return groups, unresolved, count_summary

    if not packages:
        count_summary["document_group_count_identified"] = 0
        _append_declared_count_mismatch(
            meta=meta, packages=packages, unresolved=unresolved, count_summary=count_summary
        )
        return [], unresolved, count_summary

    org = meta.get("file_organization")
    if org == "shared":
        methods = {pkg.procurement_method for pkg in packages}
        primary_method = next(iter(methods)) if len(methods) == 1 else "unknown"
        group = GroupCandidate(
            code="DOC-01",
            name=f"{project_name}\u91c7\u8d2d\u6587\u4ef6",
            procurement_category=(
                next(iter({p.procurement_category for p in packages}))
                if len({p.procurement_category for p in packages}) == 1
                else "\u6df7\u5408\u91c7\u8d2d"
            ),
            scope="\uff1b".join(p.scope for p in packages),
            rationale="\u539f\u6587\u660e\u786e\u5171\u7528/\u5408\u5e76\u7f16\u5236\u4e00\u5957\u4e3b\u6587\u4ef6",  # noqa: E501
            procurement_method=primary_method if primary_method != "unknown" else "unknown",
            package_codes=[p.code for p in packages],
            evidence_block_ids=sorted({eid for p in packages for eid in p.evidence_block_ids}),
        )
        groups = [group]
        count_summary["document_group_count_identified"] = 1
        count_summary["document_group_count_total"] = 1
        count_summary["document_group_complete"] = True
        if primary_method in {"public_tender", "invited_tender", "tender"}:
            count_summary["tender_document_count"] = 1
            count_summary["other_procurement_document_count"] = 0
        else:
            count_summary["tender_document_count"] = 0
            count_summary["other_procurement_document_count"] = 1
        _append_declared_count_mismatch(
            meta=meta, packages=packages, unresolved=unresolved, count_summary=count_summary
        )
        return groups, unresolved, count_summary

    if org == "separate":
        for idx, pkg in enumerate(packages, 1):
            method = pkg.procurement_method if pkg.procurement_method != "unknown" else "unknown"
            file_label = (
                "\u62db\u6807\u6587\u4ef6"
                if method in {"public_tender", "invited_tender", "tender"}
                else "\u91c7\u8d2d\u6587\u4ef6"
            )
            groups.append(
                GroupCandidate(
                    code=f"DOC-{idx:02d}",
                    name=f"{project_name}{pkg.name}{file_label}",
                    procurement_category=pkg.procurement_category,
                    scope=pkg.scope,
                    rationale="\u539f\u6587\u660e\u786e\u5206\u522b\u7f16\u5236/\u72ec\u7acb\u7f16\u5236",
                    procurement_method=method,
                    package_codes=[pkg.code],
                    evidence_block_ids=list(pkg.evidence_block_ids),
                )
            )
        tender_n = sum(
            1 for g in groups if g.procurement_method in {"public_tender", "invited_tender", "tender"}
        )
        count_summary["document_group_count_identified"] = len(groups)
        count_summary["document_group_count_total"] = len(groups)
        count_summary["document_group_complete"] = True
        count_summary["tender_document_count"] = tender_n
        count_summary["other_procurement_document_count"] = len(groups) - tender_n
        _append_declared_count_mismatch(
            meta=meta, packages=packages, unresolved=unresolved, count_summary=count_summary
        )
        return groups, unresolved, count_summary

    unresolved.append(
        {
            "code": "analysis.grouping_needs_confirmation",
            "severity": "P1",
            "title": "\u4e3b\u6587\u4ef6\u7ec4\u7ec7\u65b9\u5f0f\u9700\u786e\u8ba4",
            "detail": (
                f"\u5df2\u8bc6\u522b {len(packages)} \u4e2a\u91c7\u8d2d\u5305/\u6807\u6bb5\uff0c"
                "\u4f46\u539f\u6587\u672a\u8bf4\u660e\u5404\u5305\u662f\u5171\u7528\u4e00\u5957\u8fd8\u662f\u5206\u522b\u7f16\u5236\u4e3b\u6587\u4ef6\u3002"  # noqa: E501
                "\u4e0d\u80fd\u9ed8\u8ba4\u4e00\u6807\u6bb5\u4e00\u5957\uff0c\u4e5f\u4e0d\u80fd\u9ed8\u8ba4\u5168\u90e8\u5171\u7528\u4e00\u5957\u3002"  # noqa: E501
            ),
            "impact": "\u91c7\u8d2d\u5305\u6570\u91cf\u53ef\u5c55\u793a\uff1b\u4e3b\u6587\u4ef6\u5957\u6570\u4fdd\u6301\u5f85\u786e\u5b9a\uff0c\u786e\u8ba4\u524d\u8c28\u614e\u751f\u6210\u3002",  # noqa: E501
        }
    )
    count_summary["document_group_count_identified"] = 0
    count_summary["document_group_count_total"] = None
    count_summary["document_group_complete"] = False
    count_summary["tender_document_count"] = None
    _append_declared_count_mismatch(
        meta=meta, packages=packages, unresolved=unresolved, count_summary=count_summary
    )
    return groups, unresolved, count_summary


def run_rule_channel(
    blocks: Sequence[SourceBlockLike],
    project_name: str,
    *,
    coverage: dict[str, Any] | None = None,
) -> tuple[ProcurementAnalysisCandidate, dict[str, Any]]:
    (
        table_packages,
        table_contents,
        table_groups,
        table_unresolved,
        budgets,
        table_meta,
    ) = _extract_from_tables(blocks)
    packages, prose_contents, prose_groups, prose_unresolved, meta = _extract_from_prose(
        blocks, table_packages
    )
    # File inventory table is stronger evidence than prose shared/separate phrases.
    if table_meta.get("file_organization"):
        meta["file_organization"] = table_meta["file_organization"]
    groups = _dedupe_groups(table_groups + prose_groups)
    packages = _dedupe_packages(packages)
    contents = table_contents + prose_contents
    unresolved = table_unresolved + prose_unresolved

    for block in blocks:
        matched = re.search(
            r"(?:\u53ef\u7814\u6295\u8d44\u4f30\u7b97|\u9879\u76ee\u603b\u6295\u8d44|\u603b\u6295\u8d44)\s*[\uff1a:\u4e3a\u662f]?\s*([0-9,.]+)\s*(\u4e07\u5143|\u4ebf\u5143|\u5143)?",  # noqa: E501
            block.text,
        )
        if matched and not any(b.key == "TOTAL-INVESTMENT" for b in budgets):
            raw = matched.group(1).replace(",", "")
            unit = matched.group(2) or "\u5143"
            amount = Decimal(raw) * (
                Decimal("100000000")
                if unit == "\u4ebf\u5143"
                else Decimal("10000")
                if unit == "\u4e07\u5143"
                else Decimal("1")
            )
            budgets.append(
                BudgetCandidate(
                    key="TOTAL-INVESTMENT",
                    name="\u53ef\u7814\u6295\u8d44\u4f30\u7b97",
                    cost_type="project_total_investment",
                    amount=amount,
                    original_value=matched.group(1),
                    original_unit=unit,
                    evidence_block_ids=[block.id],
                )
            )

    groups, group_unresolved, count_summary = _build_groups(packages, groups, meta, project_name)
    unresolved.extend(group_unresolved)

    if coverage and (coverage.get("incomplete") or coverage.get("needs_ocr") or coverage.get("pages_ocr")):
        unresolved.append(
            {
                "code": "source.incomplete_parse",
                "severity": "P0",
                "title": "\u6765\u6e90\u672a\u5b8c\u6574\u89e3\u6790",
                "detail": "\u5b58\u5728\u626b\u63cf\u9875\u3001OCR \u5f85\u5904\u7406\u6216\u65e0\u6cd5\u89e3\u6790\u7684\u91cd\u8981\u9875\u9762\uff0c\u91c7\u8d2d\u5b89\u6392\u53ef\u80fd\u4f4d\u4e8e\u672a\u8bfb\u8303\u56f4\u3002",  # noqa: E501
                "impact": "\u6570\u91cf\u7ed3\u8bba\u53ef\u80fd\u4e0d\u5b8c\u6574\uff1b\u603b\u6570\u4e0d\u5f97\u89c6\u4e3a\u5df2\u786e\u5b9a\u3002",  # noqa: E501
            }
        )
        count_summary["package_count_complete"] = False
        count_summary["document_group_complete"] = False
        if count_summary.get("document_group_count_total") is not None:
            count_summary["document_group_count_total"] = None

    if not packages and not groups:
        unresolved.append(
            {
                "code": "analysis.no_explicit_arrangement",
                "severity": "P0",
                "title": "\u7f3a\u5c11\u53ef\u6838\u5bf9\u7684\u91c7\u8d2d\u5212\u5206",
                "detail": "\u89c4\u5219\u901a\u9053\u5df2\u904d\u5386\u5168\u6587\u5757\u4e0e\u8868\u683c\uff0c\u672a\u8bc6\u522b\u5230\u660e\u786e\u7684\u91c7\u8d2d\u5305/\u6807\u6bb5\u5b89\u6392\u6216\u4e3b\u6587\u4ef6\u7ec4\u7ec7\u5173\u7cfb\u3002",  # noqa: E501
                "impact": "\u65e0\u6cd5\u7ed9\u51fa\u786e\u5b9a\u7684\u62db\u6807\u6587\u4ef6\u4efd\u6570\uff1b\u53ef\u7b49\u5f85 AI \u901a\u9053\u7ed3\u679c\u6216\u7531\u4e1a\u52a1\u4eba\u5458\u8865\u5145\u3002",  # noqa: E501
            }
        )
        if not contents:
            contents.append(
                ContentCandidate(
                    key="CONTENT-UNKNOWN",
                    name="\u5f85\u8bc6\u522b\u5efa\u8bbe\u5185\u5bb9",
                    description="\u89c4\u5219\u901a\u9053\u672a\u627e\u5230\u53ef\u5f52\u5c5e\u7684\u91c7\u8d2d\u5212\u5206\u3002",  # noqa: E501
                    scope_status="unknown",
                    evidence_block_ids=[blocks[0].id] if blocks else [],
                )
            )

    for group in groups:
        if group.procurement_category == "\u6df7\u5408\u91c7\u8d2d":
            unresolved.append(
                {
                    "code": "analysis.mixed_procurement_scope",
                    "severity": "P0",
                    "title": "\u91c7\u8d2d\u5c5e\u6027\u548c\u6a21\u677f\u9002\u7528\u8303\u56f4\u5f85\u786e\u8ba4",  # noqa: E501
                    "detail": "\u540c\u4e00\u4e3b\u6587\u4ef6\u5019\u9009\u4e0b\u51fa\u73b0\u4e0d\u540c\u91c7\u8d2d\u5bf9\u8c61\u7c7b\u522b\u3002",  # noqa: E501
                    "impact": "\u786e\u8ba4\u91c7\u8d2d\u5c5e\u6027\u4e0e\u6a21\u677f\u524d\u4e0d\u5f97\u5b9a\u7a3f\u3002",  # noqa: E501
                }
            )

    summary_parts = [
        f"\u89c4\u5219\u901a\u9053\u8bc6\u522b\u91c7\u8d2d\u5305 {len(packages)} \u4e2a",
        (
            f"\u4e3b\u6587\u4ef6\u7ec4 {count_summary['document_group_count_total']} \u5957"
            if count_summary.get("document_group_count_total") is not None
            else "\u4e3b\u6587\u4ef6\u5957\u6570\u5f85\u786e\u5b9a"
        ),
    ]
    if unresolved:
        summary_parts.append(f"\u5f85\u786e\u8ba4\u4e8b\u9879 {len(unresolved)} \u9879")

    candidate = ProcurementAnalysisCandidate(
        plans=[
            PlanCandidate(
                option_key="recommended",
                name="\u63a8\u8350\u91c7\u8d2d\u65b9\u6848\uff08\u89c4\u5219\u901a\u9053\uff09",
                is_recommended=True,
                summary="\uff1b".join(summary_parts),
                contents=contents,
                packages=packages,
                groups=groups,
                budget_items=budgets,
                unresolved=unresolved,
                count_summary=count_summary,
            )
        ]
    )
    channel_meta = {
        "channel": "rule",
        "version": RULE_CHANNEL_VERSION,
        "status": "succeeded",
        "package_count": len(packages),
        "group_count": len(groups),
        "unresolved_count": len(unresolved),
        "count_summary": count_summary,
        "file_organization": meta.get("file_organization"),
        "declared_package_count": meta.get("declared_package_count"),
        "blocks_examined": len(blocks),
    }
    return candidate, channel_meta
