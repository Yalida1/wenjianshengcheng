"""Organization-level stage field catalog: base definitions and extraction aliases."""

from __future__ import annotations

from typing import Any

# Bump when FALLBACK_ALIASES gain entries that must reach existing org definitions.
BUILTIN_ALIASES_VERSION = 2

# (field_key, field_label, data_type, unit, criticality, required)
BASE_FIELD_DEFINITIONS: dict[str, list[tuple[str, str, str, str | None, str, bool]]] = {
    "requirement": [
        ("project_name", "项目名称", "string", None, "P0", True),
        ("project_owner", "项目单位", "string", None, "P0", True),
        ("construction_scope", "建设范围", "text", None, "P0", True),
        ("project_period", "项目总建设周期", "duration", "月", "P0", True),
        ("project_location", "建设地点", "string", None, "P1", False),
    ],
    "feasibility": [
        ("project_name", "项目名称", "string", None, "P0", True),
        ("total_investment", "可研总投资", "money", "元", "P0", True),
        ("construction_scope", "项目全部建设范围", "text", None, "P0", True),
        ("project_period", "项目总建设周期", "duration", "月", "P0", True),
        ("project_location", "建设地点", "string", None, "P1", False),
    ],
    "tender": [
        ("project_name", "项目名称", "string", None, "P0", True),
        ("tender_number", "招标编号", "string", None, "P0", True),
        ("package_number", "标段或包号", "string", None, "P0", True),
        ("tenderer", "招标人", "string", None, "P0", True),
        ("tender_agency", "招标代理机构", "string", None, "P0", True),
        ("tender_method", "招标方式", "string", None, "P0", True),
        ("issue_date", "编制或发布日期", "date", None, "P0", True),
        ("procurement_budget", "招标预算", "money", "元", "P0", True),
        ("maximum_price", "最高限价", "money", "元", "P0", True),
        ("procurement_scope", "采购范围", "text", None, "P0", True),
        ("qualification_requirements", "资格要求", "text", None, "P0", True),
        ("joint_venture_policy", "联合体投标政策", "text", None, "P0", True),
        ("document_acquisition", "招标文件获取方式", "text", None, "P0", True),
        ("bid_deadline", "投标截止时间及递交安排", "text", None, "P0", True),
        ("bid_opening", "开标安排", "text", None, "P0", True),
        ("announcement_media", "公告媒介", "text", None, "P1", True),
        ("contact_information", "招标联系方式", "text", None, "P0", True),
        ("bid_bond", "投标保证金", "text", None, "P0", True),
        ("bid_validity", "投标有效期", "text", None, "P0", True),
        ("clarification_rules", "澄清和修改规则", "text", None, "P1", True),
        ("rejection_rules", "否决投标条件", "text", None, "P0", True),
        ("evaluation_method", "评标方法", "string", None, "P0", True),
        ("evaluation_criteria", "评审因素及量化标准", "text", None, "P0", True),
        ("tie_break_rule", "同分处理规则", "text", None, "P1", True),
        ("general_contract_terms_source", "通用合同条款来源", "text", None, "P0", True),
        ("payment_terms", "付款条件", "text", None, "P1", True),
        ("delivery_period", "交付周期", "duration", None, "P0", True),
        ("delivery_location", "交付地点", "string", None, "P0", True),
        ("acceptance_criteria", "验收标准及材料", "text", None, "P0", True),
        ("warranty_requirements", "质保和售后服务", "text", None, "P0", True),
        ("procurement_list", "采购清单", "text", None, "P0", True),
        ("technical_specifications", "技术规格和性能指标", "text", None, "P0", True),
        ("installation_requirements", "安装调试要求", "text", None, "P1", True),
        ("training_requirements", "培训要求", "text", None, "P1", True),
        ("data_security_requirements", "数据与安全要求", "text", None, "P1", True),
        ("interface_requirements", "接口要求", "text", None, "P1", True),
        ("operations_requirements", "运维要求", "text", None, "P1", True),
    ],
    "contract": [
        ("party_a", "甲方完整主体", "string", None, "P0", True),
        ("party_b", "乙方完整主体", "string", None, "P0", True),
        ("contract_subject", "合同标的", "text", None, "P0", True),
        ("contract_scope", "本合同范围", "text", None, "P0", True),
        ("final_contract_amount", "最终合同金额", "money", "元", "P0", True),
        ("tax_rate", "税率", "percentage", "%", "P0", True),
        ("tax_inclusion", "含税方式", "string", None, "P0", True),
        ("contract_duration", "履行期限", "duration", None, "P0", True),
        ("delivery_location", "交付地点", "string", None, "P0", True),
        ("payment_plan", "付款计划", "payment_plan", None, "P0", True),
        ("acceptance", "验收约定", "text", None, "P0", True),
        ("warranty", "质保约定", "text", None, "P0", True),
        ("breach", "违约责任", "text", None, "P0", True),
        ("effective_conditions", "生效条件", "text", None, "P0", True),
    ],
}

# Explicitly shared across document groups within a stage (safe to resolve unscoped).
SHARED_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "project_name",
        "project_owner",
        "project_location",
        "tenderer",
        "tender_agency",
        "tender_method",
        "announcement_media",
        "contact_information",
        "party_a",
    }
)

# Must not unconditionally fall back to stage-level values (cross-package contamination).
PACKAGE_SCOPED_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "package_number",
        "procurement_scope",
        "procurement_budget",
        "maximum_price",
        "delivery_period",
        "delivery_location",
        "acceptance_criteria",
        "procurement_list",
        "technical_specifications",
        "installation_requirements",
        "training_requirements",
        "data_security_requirements",
        "interface_requirements",
        "operations_requirements",
        "warranty_requirements",
        "payment_terms",
        "bid_bond",
        "contract_scope",
        "final_contract_amount",
        "contract_duration",
        "estimated_amount",
    }
)

# Controlled English / alternate key → canonical catalog key.
# project_period must NOT map to package-level delivery_period.
FIELD_KEY_COMPAT_ALIASES: dict[str, str] = {
    "delivery_cycle": "delivery_period",
    "technical_requirements": "technical_specifications",
    "operation_maintenance_requirements": "operations_requirements",
    "operations_requirement": "operations_requirements",
}

# Hardcoded fallback aliases keyed by field_key (used when rules.aliases missing).
FALLBACK_ALIASES: dict[str, tuple[str, ...]] = {
    "project_name": ("项目名称",),
    "total_investment": ("可研总投资", "项目总投资", "总投资", "建设投资"),
    "procurement_budget": ("招标预算", "采购预算"),
    "maximum_price": ("最高限价", "招标最高限价"),
    "tender_number": ("招标编号", "项目编号", "采购编号"),
    "package_number": ("标段号", "包号", "标段或包号", "采购包编号"),
    "tenderer": ("招标人", "采购人"),
    "tender_agency": ("招标代理机构", "采购代理机构"),
    "tender_method": ("招标方式", "采购方式"),
    "issue_date": ("发布日期", "编制日期", "发出日期"),
    "qualification_requirements": ("资格要求", "投标人资格条件"),
    "joint_venture_policy": ("联合体", "是否接受联合体"),
    "document_acquisition": ("招标文件获取", "采购文件获取"),
    "bid_deadline": ("投标截止时间", "响应文件递交截止时间"),
    "bid_opening": ("开标时间", "开标地点", "开标安排"),
    "announcement_media": ("公告媒介", "公告发布平台"),
    "contact_information": ("联系方式", "项目联系人"),
    "bid_bond": ("投标保证金",),
    "bid_validity": ("投标有效期",),
    "clarification_rules": ("澄清规则", "答疑安排"),
    "rejection_rules": ("否决投标条件", "废标条款"),
    "evaluation_method": ("评标方法", "评审方法"),
    "evaluation_criteria": ("评分标准", "评审因素", "评分表"),
    "tie_break_rule": ("同分处理规则",),
    "general_contract_terms_source": ("通用合同条款来源", "合同范本来源"),
    "payment_terms": ("付款条件", "支付条款"),
    "acceptance_criteria": (
        "验收标准",
        "验收材料",
        "验收标准及材料",
        "验收指标",
        "验收指标及统计口径",
        "核心产出及质量目标",
        "质量目标",
        "交付物与移交要求",
        "交付物",
        "接收证据",
        "性能指标",
        "恢复演练",
        "安全测试",
        "培训移交",
    ),
    "warranty_requirements": ("质保要求", "售后服务"),
    "procurement_list": ("采购清单", "货物清单"),
    "technical_specifications": (
        "技术规格",
        "性能指标",
        "技术参数",
        "技术要求",
        "technical_requirements",
    ),
    "installation_requirements": ("安装调试要求",),
    "training_requirements": ("培训要求",),
    "data_security_requirements": ("数据安全要求", "安全要求"),
    "interface_requirements": ("接口要求",),
    "operations_requirements": (
        "运维要求",
        "运行维护要求",
        "operation_maintenance_requirements",
    ),
    "final_contract_amount": ("最终合同金额", "合同总金额", "合同金额"),
    "project_owner": ("项目单位", "建设单位"),
    "construction_scope": ("项目全部建设范围", "建设范围", "建设内容"),
    "procurement_scope": ("本次采购范围", "招标范围", "采购范围", "主要范围"),
    "party_a": ("甲方完整主体", "甲方"),
    "party_b": ("乙方完整主体", "乙方"),
    "contract_subject": ("合同标的",),
    "contract_scope": ("本合同范围", "合同范围"),
    "tax_inclusion": ("含税方式", "是否含税"),
    "delivery_location": ("交付地点", "履行地点"),
    "acceptance": ("验收约定", "验收标准"),
    "warranty": ("质保约定", "质保期"),
    "breach": ("违约责任",),
    "effective_conditions": ("生效条件",),
    "project_period": ("项目总建设周期", "建设周期", "建设期", "总体计划"),
    "contract_duration": ("合同履行期限", "履行期限"),
    "delivery_period": (
        "交付周期",
        "交货期",
        "供货周期",
        "履约期限",
        "实施周期",
        "delivery_cycle",
    ),
    "project_location": ("建设地点", "项目地点", "项目所在地"),
    "tax_rate": ("税率",),
    "payment_plan": ("付款计划", "付款安排", "支付条款"),
    "estimated_amount": ("可研采购估算", "采购估算", "估算金额", "估算价"),
}


def canonicalize_field_key(field_key: str) -> str:
    return FIELD_KEY_COMPAT_ALIASES.get(field_key, field_key)


def default_rules_for_field(field_key: str, field_label: str) -> dict[str, Any]:
    aliases = list(FALLBACK_ALIASES.get(field_key, (field_label,)))
    if field_label and field_label not in aliases:
        aliases.insert(0, field_label)
    return {
        "aliases": aliases,
        "extract_mode": "label_value",
        "builtin_aliases_version": BUILTIN_ALIASES_VERSION,
    }


def merge_missing_aliases(
    rules: dict[str, Any] | None, field_key: str, field_label: str
) -> dict[str, Any]:
    """Incrementally merge builtin aliases without removing customer custom ones."""

    if not rules:
        return default_rules_for_field(field_key, field_label)

    merged = dict(rules)
    if merged.get("disable_fallback_aliases") is True or merged.get("aliases_override") is True:
        if "extract_mode" not in merged:
            merged["extract_mode"] = "label_value"
        merged["builtin_aliases_version"] = BUILTIN_ALIASES_VERSION
        return merged

    existing_raw = merged.get("aliases")
    existing: list[str] = []
    if isinstance(existing_raw, list):
        existing = [str(item).strip() for item in existing_raw if str(item).strip()]

    if not existing:
        return default_rules_for_field(field_key, field_label)

    seen = set(existing)
    ordered = list(existing)
    if field_label and field_label not in seen:
        ordered.append(field_label)
        seen.add(field_label)
    for alias in FALLBACK_ALIASES.get(field_key, ()):
        if alias not in seen:
            ordered.append(alias)
            seen.add(alias)
    merged["aliases"] = ordered
    merged.setdefault("extract_mode", "label_value")
    merged["builtin_aliases_version"] = BUILTIN_ALIASES_VERSION
    return merged


def needs_alias_upgrade(rules: dict[str, Any] | None) -> bool:
    if not isinstance(rules, dict):
        return True
    if rules.get("disable_fallback_aliases") is True or rules.get("aliases_override") is True:
        return False
    version = rules.get("builtin_aliases_version")
    try:
        return int(version) < BUILTIN_ALIASES_VERSION
    except (TypeError, ValueError):
        return True
