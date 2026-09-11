"""Feasibility procurement business rules (feasibility-procurement-v1).

Rules are deterministic and auditable. LLM / demo extraction only supplies
candidate facts; this engine emits issues and count-blocking decisions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

FEASIBILITY_RULES_VERSION = "feasibility-procurement-v1"


@dataclass(frozen=True)
class RuleEffect:
    code: str
    severity: str
    title: str
    detail: str
    impact: str
    action: str
    guidance: str | None = None
    rule_id: str | None = None
    rule_set_key: str | None = None


@dataclass
class RuleEvaluation:
    effects: list[RuleEffect] = field(default_factory=list)
    matched_rule_ids: list[str] = field(default_factory=list)
    facts: dict[str, Any] = field(default_factory=dict)


BUILTIN_FEASIBILITY_RULES: dict[str, Any] = {
    "version": FEASIBILITY_RULES_VERSION,
    "name": "可研采购划分核心规则",
    "rules": [
        {
            "id": "block.no_arrangement",
            "when": {
                "all": [
                    {"fact": "group.count", "eq": 0},
                    {"fact": "package.count", "eq": 0},
                ]
            },
            "then": {
                "action": "block_count",
                "issue_code": "analysis.no_explicit_arrangement",
                "severity": "P0",
                "title": "缺少可核对的采购划分",
                "detail": "未识别到主招标文件或采购包安排，无法可靠计算招标文件份数。",
                "impact": "不能确认方案份数；需补充材料、使用显式标注或完成模型分析后人工确认。",
                "resolution_guidance": "在材料中补充独立主招标文件/采购包安排，或人工确认待编制文件清单。",
            },
        },
        {
            "id": "block.unknown_scope",
            "when": {"fact": "content.unknown_scope_count", "gt": 0},
            "then": {
                "action": "block_count",
                "issue_code": "rule.unknown_scope",
                "severity": "P0",
                "title": "存在范围未知的建设内容",
                "detail": "有建设内容尚未判定为本次采购、已采购、复用、远期或其他方式。",
                "impact": "影响采购范围和主文件份数判断。",
                "resolution_guidance": "逐项确认建设内容的范围状态。",
            },
        },
        {
            "id": "block.source_conflict",
            "when": {"fact": "source.conflict", "eq": True},
            "then": {
                "action": "block_count",
                "issue_code": "rule.source_conflict",
                "severity": "P0",
                "title": "采购安排来源冲突",
                "detail": "材料中存在互相冲突的采购划分表述。",
                "impact": "处理前不能确认主招标文件份数。",
                "resolution_guidance": "由业务人员裁定冲突项并保留证据。",
            },
        },
        {
            "id": "block.incomplete_parse",
            "when": {"fact": "source.incomplete_parse", "eq": True},
            "then": {
                "action": "block_count",
                "issue_code": "rule.source_incomplete_parse",
                "severity": "P0",
                "title": "来源未完整解析",
                "detail": "存在扫描页、OCR 待处理或无法解析的重要页面。",
                "impact": "可能遗漏后半部分采购安排。",
                "resolution_guidance": "完成 OCR/重新解析后再分析。",
            },
        },
        {
            "id": "block.unassigned_in_scope",
            "when": {"fact": "content.in_scope_unassigned_count", "gt": 0},
            "then": {
                "action": "block_count",
                "issue_code": "rule.unassigned_content",
                "severity": "P0",
                "title": "本次采购内容未完全归属",
                "detail": "存在已纳入本次采购但未分配到采购包的建设内容。",
                "impact": "会造成采购范围遗漏，影响主文件份数。",
                "resolution_guidance": "将内容分配到唯一采购包。",
            },
        },
        {
            "id": "warn.grouping_needs_confirmation",
            "when": {"fact": "grouping.needs_confirmation", "eq": True},
            "then": {
                "action": "require_confirmation",
                "issue_code": "rule.grouping_needs_confirmation",
                "severity": "P1",
                "title": "主文件组织方式需确认",
                "detail": "材料明确了采购包，但未明确应合并为一份还是拆成多份主招标文件。",
                "impact": "不阻止保存候选，确认前谨慎批量生成。",
                "resolution_guidance": "由业务确认拆分/合并策略。",
            },
        },
        {
            "id": "warn.non_tender_present",
            "when": {"fact": "package.non_tender_count", "gt": 0},
            "then": {
                "action": "require_confirmation",
                "issue_code": "rule.non_tender_excluded_from_count",
                "severity": "P1",
                "title": "存在非招标采购包",
                "detail": "非招标方式采购包不计入招标文件份数，但仍需确认是否另有文件安排。",
                "impact": "不影响已明确的招标主文件计数口径。",
                "resolution_guidance": "确认非招标包是否需要其他采购文件，且不混入招标份数。",
            },
        },
        {
            "id": "forbid.copy_total_investment",
            "when": {
                "all": [
                    {"fact": "budget.total_investment_present", "eq": True},
                    {"fact": "budget.package_equals_total_count", "gt": 0},
                ]
            },
            "then": {
                "action": "emit_issue",
                "issue_code": "rule.forbid_copy_total_investment",
                "severity": "P0",
                "title": "禁止将总投资直接作为采购包预算",
                "detail": "检测到采购包金额与可研总投资相同，疑似跨口径复制。",
                "impact": "总投资不等于招标预算或最高限价，不得直接带入。",
                "resolution_guidance": "清空自动带入值，按采购包单独提供预算/限价依据。",
            },
        },
        {
            "id": "info.explicit_labels_used",
            "when": {"fact": "extract.mode", "eq": "explicit_labels"},
            "then": {
                "action": "emit_issue",
                "issue_code": "rule.explicit_labels_used",
                "severity": "P2",
                "title": "已使用显式标注确定性解析",
                "detail": "材料含独立主招标文件/采购包等显式标注，未调用大模型语义推断。",
                "impact": "结果可快速复核；若标注不完整请改用模型分析或人工补全。",
                "resolution_guidance": "核对标注是否覆盖全部采购安排。",
            },
        },
        {
            "id": "info.llm_candidates_only",
            "when": {"fact": "extract.mode", "eq": "llm"},
            "then": {
                "action": "emit_issue",
                "issue_code": "rule.llm_candidates_only",
                "severity": "P2",
                "title": "大模型结果仅为候选",
                "detail": "当前方案来自模型抽取，须经结构校验与人工确认后才能作为正式划分。",
                "impact": "未确认前不得视为制度结论或正式份数依据。",
                "resolution_guidance": "在字段确认与方案确认中逐项核对证据。",
            },
        },
    ],
}


def validate_rules_document(doc: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(doc, dict):
        return ["rules_json must be an object"]
    version = doc.get("version")
    if version not in {None, FEASIBILITY_RULES_VERSION}:
        # allow empty/legacy descriptive JSON without executable version
        if "rules" in doc:
            errors.append(f"unsupported rules version: {version}")
    rules = doc.get("rules")
    if rules is None:
        return errors
    if not isinstance(rules, list):
        errors.append("rules must be a list")
        return errors
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            errors.append(f"rules[{index}] must be an object")
            continue
        if not rule.get("id"):
            errors.append(f"rules[{index}].id is required")
        if "when" not in rule or "then" not in rule:
            errors.append(f"rules[{index}] requires when/then")
            continue
        then = rule.get("then") or {}
        if then.get("action") not in {
            "block_count",
            "require_confirmation",
            "emit_issue",
            "suggest_document_group",
        }:
            errors.append(f"rules[{index}].then.action is invalid")
    return errors


def _fact_value(facts: dict[str, Any], name: str) -> Any:
    return facts.get(name)


def _compare(left: Any, op: str, right: Any) -> bool:
    if op == "eq":
        return bool(left == right)
    if op == "ne":
        return bool(left != right)
    if op == "gt":
        return left is not None and right is not None and left > right
    if op == "gte":
        return left is not None and right is not None and left >= right
    if op == "lt":
        return left is not None and right is not None and left < right
    if op == "lte":
        return left is not None and right is not None and left <= right
    if op == "truthy":
        return bool(left)
    if op == "exists":
        return left is not None
    return False


def eval_condition(condition: dict[str, Any], facts: dict[str, Any]) -> bool:
    if "all" in condition:
        items = condition["all"]
        return isinstance(items, list) and all(
            isinstance(item, dict) and eval_condition(item, facts) for item in items
        )
    if "any" in condition:
        items = condition["any"]
        return isinstance(items, list) and any(
            isinstance(item, dict) and eval_condition(item, facts) for item in items
        )
    if "not" in condition:
        nested = condition["not"]
        return isinstance(nested, dict) and not eval_condition(nested, facts)
    fact_name = condition.get("fact")
    if not isinstance(fact_name, str):
        return False
    value = _fact_value(facts, fact_name)
    for op in ("eq", "ne", "gt", "gte", "lt", "lte"):
        if op in condition:
            return _compare(value, op, condition[op])
    if condition.get("truthy") is True:
        return _compare(value, "truthy", None)
    if condition.get("exists") is True:
        return _compare(value, "exists", None)
    return False


def evaluate_rules_document(
    doc: dict[str, Any],
    facts: dict[str, Any],
    *,
    rule_set_key: str | None = None,
) -> RuleEvaluation:
    result = RuleEvaluation(facts=dict(facts))
    if not isinstance(doc, dict):
        return result
    if doc.get("version") not in {None, FEASIBILITY_RULES_VERSION}:
        return result
    rules = doc.get("rules")
    if not isinstance(rules, list):
        return result
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        when = rule.get("when")
        then = rule.get("then")
        if not isinstance(when, dict) or not isinstance(then, dict):
            continue
        if not eval_condition(when, facts):
            continue
        rule_id = str(rule.get("id") or "")
        result.matched_rule_ids.append(rule_id)
        result.effects.append(
            RuleEffect(
                code=str(then.get("issue_code") or f"rule.{rule_id or 'unknown'}"),
                severity=str(then.get("severity") or "P1"),
                title=str(then.get("title") or rule_id or "业务规则命中"),
                detail=str(then.get("detail") or ""),
                impact=str(then.get("impact") or ""),
                action=str(then.get("action") or "emit_issue"),
                guidance=(
                    str(then["resolution_guidance"])
                    if then.get("resolution_guidance") is not None
                    else None
                ),
                rule_id=rule_id or None,
                rule_set_key=rule_set_key,
            )
        )
    return result


def build_plan_facts(
    *,
    group_count: int,
    package_count: int,
    non_tender_package_count: int,
    unknown_scope_count: int,
    in_scope_unassigned_count: int,
    empty_group_count: int,
    unassigned_package_count: int,
    total_investment_present: bool,
    package_equals_total_count: int,
    source_conflict: bool,
    incomplete_parse: bool,
    grouping_needs_confirmation: bool,
    extract_mode: str,
) -> dict[str, Any]:
    return {
        "group.count": group_count,
        "package.count": package_count,
        "package.non_tender_count": non_tender_package_count,
        "content.unknown_scope_count": unknown_scope_count,
        "content.in_scope_unassigned_count": in_scope_unassigned_count,
        "group.empty_count": empty_group_count,
        "package.unassigned_count": unassigned_package_count,
        "budget.total_investment_present": total_investment_present,
        "budget.package_equals_total_count": package_equals_total_count,
        "source.conflict": source_conflict,
        "source.incomplete_parse": incomplete_parse,
        "grouping.needs_confirmation": grouping_needs_confirmation,
        "extract.mode": extract_mode,
    }


def merge_evaluations(*parts: RuleEvaluation) -> RuleEvaluation:
    merged = RuleEvaluation()
    seen_codes: set[str] = set()
    for part in parts:
        merged.facts.update(part.facts)
        for rule_id in part.matched_rule_ids:
            if rule_id not in merged.matched_rule_ids:
                merged.matched_rule_ids.append(rule_id)
        for effect in part.effects:
            # Prefer first hit for the same issue code to avoid duplicates.
            if effect.code in seen_codes:
                continue
            seen_codes.add(effect.code)
            merged.effects.append(effect)
    return merged
