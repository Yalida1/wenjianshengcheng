from __future__ import annotations

from backend.app.services.feasibility_rules import (
    BUILTIN_FEASIBILITY_RULES,
    FEASIBILITY_RULES_VERSION,
    build_plan_facts,
    eval_condition,
    evaluate_rules_document,
    validate_rules_document,
)


def test_builtin_rules_document_is_valid() -> None:
    assert validate_rules_document(BUILTIN_FEASIBILITY_RULES) == []
    assert BUILTIN_FEASIBILITY_RULES["version"] == FEASIBILITY_RULES_VERSION
    assert len(BUILTIN_FEASIBILITY_RULES["rules"]) >= 10


def test_eval_condition_all_any_not() -> None:
    facts = {"group.count": 2, "package.count": 0}
    assert eval_condition({"fact": "group.count", "gt": 0}, facts)
    assert eval_condition(
        {"all": [{"fact": "group.count", "eq": 2}, {"fact": "package.count", "eq": 0}]},
        facts,
    )
    assert eval_condition(
        {"any": [{"fact": "package.count", "gt": 0}, {"fact": "group.count", "gt": 0}]},
        facts,
    )
    assert eval_condition({"not": {"fact": "package.count", "gt": 0}}, facts)


def test_explicit_labels_rule_emits_info() -> None:
    facts = build_plan_facts(
        group_count=1,
        package_count=1,
        non_tender_package_count=0,
        unknown_scope_count=0,
        in_scope_unassigned_count=0,
        empty_group_count=0,
        unassigned_package_count=0,
        total_investment_present=False,
        package_equals_total_count=0,
        source_conflict=False,
        incomplete_parse=False,
        grouping_needs_confirmation=False,
        extract_mode="explicit_labels",
    )
    result = evaluate_rules_document(BUILTIN_FEASIBILITY_RULES, facts, rule_set_key="builtin")
    assert "info.explicit_labels_used" in result.matched_rule_ids
    assert any(item.code == "rule.explicit_labels_used" for item in result.effects)


def test_no_arrangement_blocks_count() -> None:
    facts = build_plan_facts(
        group_count=0,
        package_count=0,
        non_tender_package_count=0,
        unknown_scope_count=0,
        in_scope_unassigned_count=0,
        empty_group_count=0,
        unassigned_package_count=0,
        total_investment_present=False,
        package_equals_total_count=0,
        source_conflict=False,
        incomplete_parse=False,
        grouping_needs_confirmation=False,
        extract_mode="llm",
    )
    result = evaluate_rules_document(BUILTIN_FEASIBILITY_RULES, facts)
    assert "block.no_arrangement" in result.matched_rule_ids
    effect = next(item for item in result.effects if item.rule_id == "block.no_arrangement")
    assert effect.action == "block_count"
    assert effect.severity == "P0"


def test_forbid_copy_total_investment() -> None:
    facts = build_plan_facts(
        group_count=1,
        package_count=1,
        non_tender_package_count=0,
        unknown_scope_count=0,
        in_scope_unassigned_count=0,
        empty_group_count=0,
        unassigned_package_count=0,
        total_investment_present=True,
        package_equals_total_count=1,
        source_conflict=False,
        incomplete_parse=False,
        grouping_needs_confirmation=False,
        extract_mode="llm",
    )
    result = evaluate_rules_document(BUILTIN_FEASIBILITY_RULES, facts)
    assert "forbid.copy_total_investment" in result.matched_rule_ids


def test_has_explicit_procurement_labels_detection() -> None:
    from decimal import Decimal

    from backend.app.services.procurement_planning import SourceBlock, _has_explicit_procurement_labels

    labeled = [
        SourceBlock(
            id="a",
            sequence=1,
            kind="paragraph",
            text="独立主招标文件：网络设备采购招标文件",
            page_number=None,
            section_path=None,
            locator={},
            confidence=Decimal("1"),
        )
    ]
    prose = [
        SourceBlock(
            id="b",
            sequence=1,
            kind="paragraph",
            text="本项目拟采购网络设备、应用软件及测评服务，建议分阶段实施。",
            page_number=None,
            section_path=None,
            locator={},
            confidence=Decimal("1"),
        )
    ]
    assert _has_explicit_procurement_labels(labeled) is True
    assert _has_explicit_procurement_labels(prose) is False
