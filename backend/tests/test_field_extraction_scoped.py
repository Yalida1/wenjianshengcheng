"""Tests for scoped field extraction, aliases, duration units, and table roles."""

from __future__ import annotations

from types import SimpleNamespace

from backend.app.field_catalog import (
    BUILTIN_ALIASES_VERSION,
    FALLBACK_ALIASES,
    merge_missing_aliases,
    needs_alias_upgrade,
)
from backend.app.services.field_extraction import (
    _aliases_for,
    extract_all_field_candidates,
    extract_field_candidates,
)
from backend.app.services.generation import field_values_by_key


def _def(field_key: str, field_label: str, data_type: str = "string", **rules: object) -> SimpleNamespace:
    return SimpleNamespace(
        field_key=field_key,
        field_label=field_label,
        data_type=data_type,
        unit=None,
        rules=dict(rules) if rules else {"aliases": [field_label]},
    )


def _block(
    text: str,
    *,
    sequence: int = 1,
    kind: str = "paragraph",
    locator: dict | None = None,
    block_id: str = "b1",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=block_id,
        sequence=sequence,
        kind=kind,
        text=text,
        page_number=1,
        section_path="正文",
        locator=locator or {},
    )


def test_aliases_for_merges_fallback_even_when_label_present() -> None:
    definition = _def(
        "delivery_period",
        "交付周期",
        "duration",
        aliases=["交付周期"],
    )
    aliases = _aliases_for(definition)  # type: ignore[arg-type]
    assert "交付周期" in aliases
    assert "交货期" in aliases
    assert "delivery_cycle" in aliases


def test_aliases_for_respects_disable_and_override() -> None:
    disabled = _def(
        "delivery_period",
        "交付周期",
        "duration",
        aliases=["仅此别名"],
        disable_fallback_aliases=True,
    )
    assert _aliases_for(disabled) == ("仅此别名", "交付周期")  # type: ignore[arg-type]

    override = _def(
        "delivery_period",
        "交付周期",
        "duration",
        aliases=["自定义周期"],
        aliases_override=True,
    )
    assert "交货期" not in _aliases_for(override)  # type: ignore[arg-type]


def test_merge_missing_aliases_incremental_keeps_custom() -> None:
    old = {
        "aliases": ["客户自定义别名", "交付周期"],
        "extract_mode": "label_value",
    }
    assert needs_alias_upgrade(old) is True
    merged = merge_missing_aliases(old, "delivery_period", "交付周期")
    assert "客户自定义别名" in merged["aliases"]
    assert "交货期" in merged["aliases"]
    assert merged["builtin_aliases_version"] == BUILTIN_ALIASES_VERSION
    # Custom retained at front; builtins appended.
    assert merged["aliases"].index("客户自定义别名") < merged["aliases"].index("交货期")


def test_merge_missing_aliases_skips_when_override() -> None:
    rules = {"aliases": ["只保留这个"], "aliases_override": True}
    merged = merge_missing_aliases(rules, "delivery_period", "交付周期")
    assert merged["aliases"] == ["只保留这个"]


def test_field_map_table_rejects_status_and_decision_as_values() -> None:
    definitions = [
        _def("tender_number", "招标编号"),
        _def("package_number", "标段或包号"),
        _def("acceptance_criteria", "验收标准及材料", "text"),
    ]
    rows = [
        ["字段", "正式值/候选值", "采集状态", "证据/来源"],
        ["tender_number", "", "招标阶段生成", "可研通常不存在"],
        ["package_number", "", "采购包名称 | 类别 | 可研采购估算 | 主要范围", "表头"],
        ["acceptance_criteria", "", "可提取", "验收指标"],
        ["acceptance_criteria", "系统可用率≥99.5%且演练通过", "可提取", "质量目标章节"],
    ]
    block = _block(
        "\n".join(" | ".join(row) for row in rows),
        kind="table",
        locator={"table_rows": rows, "semantic_role": "unknown"},
    )
    candidates = extract_field_candidates([block], definitions)  # type: ignore[arg-type]
    assert "tender_number" not in candidates
    assert "package_number" not in candidates
    assert candidates["acceptance_criteria"].value == "系统可用率≥99.5%且演练通过"
    assert "可提取" not in str(candidates["acceptance_criteria"].value)


def test_decision_table_emits_no_formal_values() -> None:
    definitions = [_def("tender_number", "招标编号"), _def("bid_bond", "投标保证金", "text")]
    rows = [
        ["字段", "正式来源", "处理原则", "待补齐材料"],
        ["tender_number", "招标阶段生成", "采购文件编制时确定", "招标办编号"],
        ["bid_bond", "采购决策", "按包确认", "保证金形式"],
    ]
    block = _block(
        "\n".join(" | ".join(row) for row in rows),
        kind="table",
        locator={"table_rows": rows},
    )
    candidates = extract_field_candidates([block], definitions)  # type: ignore[arg-type]
    assert candidates == {}
    all_items = extract_all_field_candidates([block], definitions)  # type: ignore[arg-type]
    assert all(item.empty_reason == "DECISION_REQUIRED" for item in all_items)
    assert all(item.value is None for item in all_items)


def test_package_list_estimated_amount_not_budget() -> None:
    definitions = [
        _def("package_number", "标段或包号"),
        _def("procurement_scope", "采购范围", "text"),
        _def("procurement_budget", "招标预算", "money"),
        _def("maximum_price", "最高限价", "money"),
        _def("estimated_amount", "可研采购估算", "money"),
    ]
    rows = [
        ["包号", "采购包名称", "主要范围", "可研采购估算"],
        ["P01", "平台开发实施", "平台建设与实施", "218万元"],
        ["P02", "评估服务", "第三方评估", "50万元"],
        ["P03", "设备采购", "服务器交换机", "20万元"],
    ]
    block = _block(
        "\n".join(" | ".join(row) for row in rows),
        kind="table",
        locator={"table_rows": rows, "semantic_role": "procurement_package"},
    )
    package_group_map = {"P01": "g1", "P02": "g2", "P03": "g3"}
    all_items = extract_all_field_candidates(
        [block], definitions, package_group_map=package_group_map  # type: ignore[arg-type]
    )
    budgets = [item for item in all_items if item.field_key == "procurement_budget"]
    ceilings = [item for item in all_items if item.field_key == "maximum_price"]
    estimated = [item for item in all_items if item.field_key == "estimated_amount"]
    scopes = [item for item in all_items if item.field_key == "procurement_scope"]
    assert budgets == []
    assert ceilings == []
    assert {item.package_code: item.value for item in estimated} == {
        "P01": 2_180_000,
        "P02": 500_000,
        "P03": 200_000,
    }
    assert {item.group_id: item.value for item in scopes} == {
        "g1": "平台建设与实施",
        "g2": "第三方评估",
        "g3": "服务器交换机",
    }


def test_no_cross_package_fallback_in_generation_resolver() -> None:
    fields = [
        SimpleNamespace(
            field_key="project_name",
            value="共享项目",
            normalized_value="共享项目",
            status="extracted",
        ),
        SimpleNamespace(
            field_key="procurement_budget",
            value=2_180_000,
            normalized_value=2_180_000,
            status="extracted",
        ),
        SimpleNamespace(
            field_key="doc::g1::procurement_scope",
            value="P01范围",
            normalized_value="P01范围",
            status="extracted",
        ),
        SimpleNamespace(
            field_key="doc::g2::procurement_scope",
            value="P02范围",
            normalized_value="P02范围",
            status="extracted",
        ),
    ]
    g1 = field_values_by_key(fields, "g1")  # type: ignore[arg-type]
    g2 = field_values_by_key(fields, "g2")  # type: ignore[arg-type]
    assert g1["project_name"].value == "共享项目"
    assert "procurement_budget" not in g1
    assert g1["procurement_scope"].value == "P01范围"
    assert g2["procurement_scope"].value == "P02范围"
    assert g1["procurement_scope"].value != g2["procurement_scope"].value


def test_duration_keeps_unit_and_qualifiers_not_project_period() -> None:
    delivery = _def(
        "delivery_period",
        "交付周期",
        "duration",
        aliases=["交付周期", "实施周期"],
    )
    project = _def(
        "project_period",
        "项目总建设周期",
        "duration",
        aliases=["项目总建设周期", "建设周期"],
    )
    block = _block(
        "建议8个月内完成实施，并配合总体9个月计划。项目总建设周期为9个月。",
        sequence=3,
    )
    candidates = extract_field_candidates([block], [delivery, project])  # type: ignore[arg-type]
    delivery_value = candidates["delivery_period"].value
    assert isinstance(delivery_value, dict)
    assert delivery_value["amount"] == 8
    assert delivery_value["unit"] == "个月"
    assert "建议" in delivery_value["qualifiers"] or "内" in delivery_value["qualifiers"]
    assert delivery_value["amount"] != 240
    project_value = candidates["project_period"].value
    assert isinstance(project_value, dict)
    assert project_value["amount"] == 9
    # Must not silently use project 9 months as package delivery.
    assert delivery_value["amount"] != project_value["amount"]


def test_weak_acceptance_keyword_does_not_override_semantic() -> None:
    definition = _def(
        "acceptance_criteria",
        "验收标准及材料",
        "text",
        aliases=[
            "验收标准及材料",
            "验收指标",
            "质量目标",
            "交付物",
            "接收证据",
            "恢复演练",
        ],
    )
    blocks = [
        _block("本章说明核心产出及质量目标，系统可用率不低于 99.5%。", sequence=1, block_id="1"),
        _block("验收指标及统计口径需单独建表，并在抽检中核对。", sequence=2, block_id="2"),
        _block("交付物与移交要求包括源代码、部署文档与培训记录。", sequence=3, block_id="3"),
        _block("联调结束后应保留接收证据以便复核。", sequence=4, block_id="4"),
        _block("恢复演练。", sequence=5, block_id="5"),
    ]
    # Contaminating low-quality label hit:
    bad = _block("验收标准：可提取|验收指标", sequence=0, block_id="0")
    candidates = extract_field_candidates([bad, *blocks], [definition])  # type: ignore[arg-type]
    assert "acceptance_criteria" in candidates
    value = str(candidates["acceptance_criteria"].value)
    assert "可提取" not in value
    assert candidates["acceptance_criteria"].extraction_method == "rule_based_semantic_sections"


def test_compat_alias_delivery_cycle_maps_via_fallback() -> None:
    definition = _def("delivery_period", "交付周期", "duration", aliases=["交付周期"])
    aliases = _aliases_for(definition)  # type: ignore[arg-type]
    assert "delivery_cycle" in aliases
    assert "technical_requirements" in FALLBACK_ALIASES["technical_specifications"]
    assert "operation_maintenance_requirements" in FALLBACK_ALIASES["operations_requirements"]


def test_old_org_rules_upgrade_path_adds_builtins() -> None:
    """Simulate pre-version org rules and ensure seed/migration merge upgrades them."""

    legacy = {
        "aliases": ["交付周期"],
        "extract_mode": "label_value",
        # no builtin_aliases_version → needs upgrade
    }
    assert needs_alias_upgrade(legacy) is True
    upgraded = merge_missing_aliases(legacy, "delivery_period", "交付周期")
    for required in FALLBACK_ALIASES["delivery_period"]:
        assert required in upgraded["aliases"]
    assert upgraded["builtin_aliases_version"] == BUILTIN_ALIASES_VERSION
    assert needs_alias_upgrade(upgraded) is False


def test_tech_acceptance_table_keeps_metric_threshold_unit_method() -> None:
    definitions = [
        _def("acceptance_criteria", "验收标准及材料", "text"),
        _def("technical_specifications", "技术规格和性能指标", "text"),
    ]
    rows = [
        ["指标", "阈值", "单位", "检验方法"],
        ["系统可用率", "≥99.5", "%", "月度统计"],
        ["恢复演练完成率", "100", "%", "演练记录"],
    ]
    block = _block(
        "\n".join(" | ".join(row) for row in rows),
        kind="table",
        locator={"table_rows": rows},
    )
    candidates = extract_field_candidates([block], definitions)  # type: ignore[arg-type]
    assert "acceptance_criteria" in candidates
    value = str(candidates["acceptance_criteria"].value)
    assert "系统可用率" in value
    assert "≥99.5" in value
    assert "月度统计" in value
    assert candidates["acceptance_criteria"].extraction_method == "table_tech_acceptance_multi"
    assert len(candidates["acceptance_criteria"].evidence_excerpts) == 2


def test_evidence_supports_amount_via_raw_cell_not_id_alone() -> None:
    from backend.app.services.field_extraction import FieldCandidate, _evidence_supports_value

    rows = [
        ["包号", "可研采购估算"],
        ["P01", "218万元"],
    ]
    block = _block(
        "\n".join(" | ".join(row) for row in rows),
        kind="table",
        locator={"table_rows": rows},
    )
    ok = FieldCandidate(
        field_key="estimated_amount",
        value=2_180_000,
        block=block,  # type: ignore[arg-type]
        extraction_method="table_package_estimated_amount",
        confidence=0.9,
        matched_label="可研采购估算",
        raw_text="218万元",
        locator_extra={"table_role": "package_list", "row": 1, "col": 1},
    )
    assert _evidence_supports_value(ok) is True

    bad = FieldCandidate(
        field_key="estimated_amount",
        value=2_180_000,
        block=block,  # type: ignore[arg-type]
        extraction_method="table_package_estimated_amount",
        confidence=0.9,
        matched_label="可研采购估算",
        raw_text="999万元",
        locator_extra={"table_role": "package_list", "row": 1, "col": 1},
    )
    # Claimed raw does not match cell, and numeric 2180000 is not substring of 218万元
    # without amount parse on the false raw — value alone still parses equal to cell.
    # Force mismatch by pointing at wrong column (package code).
    bad.locator_extra = {"table_role": "package_list", "row": 1, "col": 0}
    assert _evidence_supports_value(bad) is False


def test_scoped_storage_key_and_multi_package_no_bare_collapse() -> None:
    definitions = [
        _def("procurement_scope", "采购范围", "text"),
        _def("estimated_amount", "可研采购估算", "money"),
    ]
    rows = [
        ["包号", "主要范围", "可研采购估算"],
        ["P01", "平台建设", "100万元"],
        ["P02", "评估服务", "50万元"],
    ]
    block = _block(
        "\n".join(" | ".join(row) for row in rows),
        kind="table",
        locator={"table_rows": rows, "semantic_role": "procurement_package"},
    )
    items = extract_all_field_candidates(
        [block], definitions, package_group_map={"P01": "g1", "P02": "g2"}  # type: ignore[arg-type]
    )
    scopes = [item for item in items if item.field_key == "procurement_scope"]
    assert {item.storage_key for item in scopes} == {
        "doc::g1::procurement_scope",
        "doc::g2::procurement_scope",
    }
    # Two different package scopes without group map → do not collapse to one bare winner.
    unscoped = extract_all_field_candidates([block], definitions)  # type: ignore[arg-type]
    unscoped_scopes = [item for item in unscoped if item.field_key == "procurement_scope"]
    assert len(unscoped_scopes) == 2
    collapsed = extract_field_candidates([block], definitions)  # type: ignore[arg-type]
    assert "procurement_scope" not in collapsed

