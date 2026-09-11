"""Per-document-group tender field profiles.

field_catalog defines legal field metadata for the organization.
Profiles define which fields apply to a given document group category,
and whether they are required for that file (not globally forever).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

FieldLevel = Literal["P0", "P1", "P2"]
ProfileName = Literal["service", "goods", "works", "evaluation", "generic"]


InputRole = Literal["material", "decision", "process"]
RequiredForPhase = Literal["material_collection", "formal_tender", "both"]
SourceStage = Literal[
    "upstream_or_material",
    "procurement_decision",
    "tender_process",
    "template",
]


@dataclass(frozen=True)
class ProfileFieldSpec:
    field_key: str
    required: bool
    level: FieldLevel = "P0"
    reason: str = ""


# Minimal material-collection set when template / category setup is incomplete.
# Decision and process clauses stay out of this set so empty 可研 values are not
# counted as extraction failure; formal tender still gated by setup_incomplete.
TENDER_MATERIAL_COLLECTION_FIELDS: tuple[ProfileFieldSpec, ...] = (
    ProfileFieldSpec("project_name", True, "P0", "材料采集：项目名称"),
    ProfileFieldSpec("package_number", True, "P0", "材料采集：包号/标段"),
    ProfileFieldSpec("procurement_scope", True, "P0", "材料采集：采购范围"),
    ProfileFieldSpec("acceptance_criteria", True, "P0", "材料采集：验收要求"),
    ProfileFieldSpec("technical_specifications", False, "P1", "材料采集：技术要求（可选）"),
    ProfileFieldSpec("delivery_period", False, "P1", "材料采集：交付周期（可选）"),
)

# Core identity / money / delivery — shared baseline (never the full catalog alone).
TENDER_CORE_FIELDS: tuple[ProfileFieldSpec, ...] = (
    ProfileFieldSpec("project_name", True, "P0", "文件标识所需"),
    ProfileFieldSpec("package_number", True, "P0", "采购包/标段标识"),
    ProfileFieldSpec("procurement_scope", True, "P0", "本文件采购边界"),
    ProfileFieldSpec("procurement_budget", True, "P0", "本采购包招标预算"),
    ProfileFieldSpec("maximum_price", True, "P0", "本采购包最高限价"),
    ProfileFieldSpec("bid_bond", True, "P0", "投标保证金决策"),
    ProfileFieldSpec("delivery_period", True, "P0", "交付/履约周期"),
    ProfileFieldSpec("acceptance_criteria", True, "P0", "验收要求"),
)

# Formal process envelope required to publish a tender document (公告/投标/评标程序).
# Category profiles add object-specific content on top of this set.
TENDER_PROCESS_PROFILE_FIELDS: tuple[ProfileFieldSpec, ...] = (
    ProfileFieldSpec("tender_number", True, "P0", "招标编号"),
    ProfileFieldSpec("tenderer", True, "P0", "招标人"),
    ProfileFieldSpec("tender_agency", True, "P0", "招标代理或自行招标说明"),
    ProfileFieldSpec("tender_method", True, "P0", "招标方式（决定公告/邀请书）"),
    ProfileFieldSpec("issue_date", True, "P0", "编制或发布日期"),
    ProfileFieldSpec("qualification_requirements", True, "P0", "资格要求"),
    ProfileFieldSpec("joint_venture_policy", True, "P0", "联合体政策"),
    ProfileFieldSpec("document_acquisition", True, "P0", "文件获取方式"),
    ProfileFieldSpec("bid_deadline", True, "P0", "投标截止安排"),
    ProfileFieldSpec("bid_opening", True, "P0", "开标安排"),
    ProfileFieldSpec("announcement_media", True, "P1", "公告媒介"),
    ProfileFieldSpec("contact_information", True, "P0", "联系方式"),
    ProfileFieldSpec("bid_validity", True, "P0", "投标有效期"),
    ProfileFieldSpec("clarification_rules", True, "P1", "澄清修改规则"),
    ProfileFieldSpec("rejection_rules", True, "P0", "否决条件"),
    ProfileFieldSpec("evaluation_method", True, "P0", "评标方法"),
    ProfileFieldSpec("evaluation_criteria", True, "P0", "评审因素"),
    ProfileFieldSpec("tie_break_rule", True, "P1", "同分处理"),
    ProfileFieldSpec("general_contract_terms_source", True, "P0", "合同条款来源"),
    ProfileFieldSpec("payment_terms", True, "P1", "付款条件"),
)


def _merge_profile(*groups: tuple[ProfileFieldSpec, ...]) -> tuple[ProfileFieldSpec, ...]:
    merged: dict[str, ProfileFieldSpec] = {}
    for group in groups:
        for item in group:
            existing = merged.get(item.field_key)
            if existing is None:
                merged[item.field_key] = item
                continue
            # Prefer required / higher severity when the same key appears twice.
            level = existing.level
            if item.level == "P0" or (item.level == "P1" and level == "P2"):
                level = item.level
            merged[item.field_key] = ProfileFieldSpec(
                item.field_key,
                required=existing.required or item.required,
                level=level,
                reason=item.reason or existing.reason,
            )
    return tuple(merged.values())


TENDER_FIELD_PROFILES: dict[ProfileName, tuple[ProfileFieldSpec, ...]] = {
    "generic": _merge_profile(TENDER_CORE_FIELDS, TENDER_PROCESS_PROFILE_FIELDS),
    "service": _merge_profile(
        TENDER_PROCESS_PROFILE_FIELDS,
        (
            ProfileFieldSpec("project_name", True, "P0", "服务类文件标识"),
            ProfileFieldSpec("package_number", True, "P0", "服务包标识"),
            ProfileFieldSpec("procurement_scope", True, "P0", "服务范围"),
            ProfileFieldSpec("procurement_budget", True, "P0", "服务包预算"),
            ProfileFieldSpec("maximum_price", True, "P0", "服务包限价"),
            ProfileFieldSpec("technical_specifications", True, "P0", "技术/服务要求"),
            ProfileFieldSpec("delivery_period", True, "P0", "服务交付周期"),
            ProfileFieldSpec("delivery_location", True, "P0", "服务地点"),
            ProfileFieldSpec("acceptance_criteria", True, "P0", "验收标准"),
            ProfileFieldSpec("data_security_requirements", True, "P1", "数据与安全"),
            ProfileFieldSpec("interface_requirements", False, "P1", "接口要求（可选）"),
            ProfileFieldSpec("training_requirements", False, "P1", "培训要求（可选）"),
            ProfileFieldSpec("operations_requirements", False, "P1", "运维要求（可选）"),
            ProfileFieldSpec("bid_bond", False, "P1", "投标保证金（视采购方案）"),
        ),
    ),
    "goods": _merge_profile(
        TENDER_PROCESS_PROFILE_FIELDS,
        (
            ProfileFieldSpec("project_name", True, "P0", "货物类文件标识"),
            ProfileFieldSpec("package_number", True, "P0", "货物包标识"),
            ProfileFieldSpec("procurement_scope", True, "P0", "货物采购范围"),
            ProfileFieldSpec("procurement_budget", True, "P0", "货物包预算"),
            ProfileFieldSpec("maximum_price", True, "P0", "货物包限价"),
            ProfileFieldSpec("procurement_list", True, "P0", "采购清单"),
            ProfileFieldSpec("technical_specifications", True, "P0", "技术规格"),
            ProfileFieldSpec("delivery_period", True, "P0", "交货期"),
            ProfileFieldSpec("delivery_location", True, "P0", "交货地点"),
            ProfileFieldSpec("installation_requirements", False, "P1", "安装调试（可选）"),
            ProfileFieldSpec("acceptance_criteria", True, "P0", "验收标准"),
            ProfileFieldSpec("warranty_requirements", True, "P0", "质保要求"),
            ProfileFieldSpec("bid_bond", False, "P1", "投标保证金（视采购方案）"),
        ),
    ),
    "works": _merge_profile(
        TENDER_PROCESS_PROFILE_FIELDS,
        (
            ProfileFieldSpec("project_name", True, "P0", "工程类文件标识"),
            ProfileFieldSpec("package_number", True, "P0", "标段标识"),
            ProfileFieldSpec("procurement_scope", True, "P0", "工程范围"),
            ProfileFieldSpec("procurement_budget", True, "P0", "工程预算"),
            ProfileFieldSpec("maximum_price", True, "P0", "工程限价"),
            ProfileFieldSpec("technical_specifications", True, "P0", "技术标准"),
            ProfileFieldSpec("procurement_list", True, "P0", "工程量/清单要点"),
            ProfileFieldSpec("delivery_period", True, "P0", "工期"),
            ProfileFieldSpec("acceptance_criteria", True, "P0", "工程验收"),
            ProfileFieldSpec("data_security_requirements", False, "P1", "安全要求（可选）"),
            ProfileFieldSpec("bid_bond", True, "P0", "工程投标保证金"),
        ),
    ),
    "evaluation": _merge_profile(
        TENDER_PROCESS_PROFILE_FIELDS,
        (
            ProfileFieldSpec("project_name", True, "P0", "评估类文件标识"),
            ProfileFieldSpec("package_number", True, "P0", "评估包标识"),
            ProfileFieldSpec("procurement_scope", True, "P0", "评估范围"),
            ProfileFieldSpec("procurement_budget", True, "P0", "评估预算"),
            ProfileFieldSpec("maximum_price", True, "P0", "评估限价"),
            ProfileFieldSpec("technical_specifications", True, "P0", "评估任务与方法"),
            ProfileFieldSpec("delivery_period", True, "P0", "评估周期"),
            ProfileFieldSpec("acceptance_criteria", True, "P0", "成果与验收"),
            ProfileFieldSpec("bid_bond", False, "P1", "保证金（通常不强制）"),
        ),
    ),
}

# Category / subcategory → profile. Keep mapping centralized (not in frontend).
_CATEGORY_TO_PROFILE: dict[str, ProfileName] = {
    "服务采购": "service",
    "政府采购服务": "service",
    "勘察": "service",
    "设计": "service",
    "监理": "service",
    "软件开发": "service",
    "运维服务": "service",
    "设备采购": "goods",
    "材料采购": "goods",
    "政府采购货物": "goods",
    "货物": "goods",
    "设备": "goods",
    "施工招标": "works",
    "工程施工": "works",
    "施工": "works",
    "工程": "works",
    "独立评估": "evaluation",
    "评估服务": "evaluation",
    "评估": "evaluation",
}

# Field semantic roles for empty-reason classification (not for applicability).
UPSTREAM_FACT_FIELDS = frozenset(
    {
        "project_name",
        "procurement_scope",
        "technical_specifications",
        "acceptance_criteria",
        "data_security_requirements",
        "interface_requirements",
        "operations_requirements",
        "training_requirements",
        "procurement_list",
        "delivery_location",
        "warranty_requirements",
        "installation_requirements",
    }
)

PROCUREMENT_DECISION_FIELDS = frozenset(
    {
        "procurement_budget",
        "maximum_price",
        "qualification_requirements",
        "bid_bond",
        "joint_venture_policy",
        "payment_terms",
        "tender_method",
        "tenderer",
        "tender_agency",
    }
)

TENDER_PROCESS_FIELDS = frozenset(
    {
        "tender_number",
        "bid_deadline",
        "bid_opening",
        "document_acquisition",
        "announcement_media",
        "clarification_rules",
        "evaluation_method",
        "evaluation_criteria",
        "tie_break_rule",
        "rejection_rules",
        "contact_information",
        "bid_validity",
        "issue_date",
        "general_contract_terms_source",
    }
)

COMPLIANCE_PROTECTED_FIELDS = frozenset({"procurement_budget", "maximum_price"})

EMPTY_REASON_MESSAGES: dict[str, str] = {
    "MATERIAL_NOT_FOUND": "原文未发现可可靠提取的信息，需人工补充或确认。",
    "COMPLIANCE_NOT_AUTO_MAPPED": (
        "材料包含项目总投资，但项目总投资不等于本采购包招标预算/最高限价，系统未自动代入。"
    ),
    "DECISION_REQUIRED": "该字段属于采购/招标阶段决策事项，需根据采购方案确认。",
    "NOT_APPLICABLE": "本文件不适用该字段。",
}

EMPTY_REASON_MESSAGES_BY_FIELD: dict[str, dict[str, str]] = {
    "procurement_budget": {
        "COMPLIANCE_NOT_AUTO_MAPPED": (
            "材料包含项目总投资，但项目总投资不等于本采购包招标预算，系统未自动代入。"
        ),
    },
    "maximum_price": {
        "COMPLIANCE_NOT_AUTO_MAPPED": "材料中的投资测算不等于最高限价，系统未自动代入。",
    },
    "procurement_scope": {
        "COMPLIANCE_NOT_AUTO_MAPPED": (
            "材料中的项目全部建设范围不等于单份采购包范围，系统仅可生成候选，需人工确认。"
        ),
    },
    "delivery_period": {
        "COMPLIANCE_NOT_AUTO_MAPPED": (
            "材料中的项目建设周期不等于单份合同履约/交付周期，需确认是否适用于本采购包。"
        ),
    },
}


def resolve_profile_name(
    *,
    procurement_category: str | None = None,
    business_subcategory: str | None = None,
    group_name: str | None = None,
) -> ProfileName:
    """Map document-group attributes to a profile. Unknown → generic (not full catalog)."""

    hints = [
        (business_subcategory or "").strip(),
        (procurement_category or "").strip(),
        (group_name or "").strip(),
    ]
    for hint in hints:
        if not hint:
            continue
        mapped = _CATEGORY_TO_PROFILE.get(hint)
        if mapped:
            return mapped
        for profile_name in TENDER_FIELD_PROFILES:
            if hint == profile_name or hint.lower() == profile_name:
                return profile_name
        if any(token in hint for token in ("评估", "评价", "审计")):
            return "evaluation"
        if any(token in hint for token in ("服务", "软件", "运维", "勘察", "设计", "监理")):
            return "service"
        if any(token in hint for token in ("设备", "货物", "材料", "硬件")):
            return "goods"
        if any(token in hint for token in ("施工", "工程", "土建")):
            return "works"
    return "generic"


def profile_fields(profile: ProfileName) -> tuple[ProfileFieldSpec, ...]:
    return TENDER_FIELD_PROFILES.get(profile, TENDER_CORE_FIELDS)


def field_input_role(field_key: str) -> InputRole:
    if field_key in PROCUREMENT_DECISION_FIELDS:
        return "decision"
    if field_key in TENDER_PROCESS_FIELDS:
        return "process"
    return "material"


def field_source_stage(field_key: str) -> SourceStage:
    role = field_input_role(field_key)
    if role == "decision":
        return "procurement_decision"
    if role == "process":
        return "tender_process"
    return "upstream_or_material"


def field_required_for_phase(field_key: str, *, required: bool) -> RequiredForPhase:
    role = field_input_role(field_key)
    if role == "material":
        return "both" if required else "material_collection"
    return "formal_tender"


def empty_reason_message(code: str, field_key: str | None = None) -> str:
    if field_key and field_key in EMPTY_REASON_MESSAGES_BY_FIELD:
        override = EMPTY_REASON_MESSAGES_BY_FIELD[field_key].get(code)
        if override:
            return override
    return EMPTY_REASON_MESSAGES.get(code, EMPTY_REASON_MESSAGES["MATERIAL_NOT_FOUND"])


def classify_empty_reason(
    field_key: str,
    *,
    has_total_investment: bool = False,
    has_construction_scope: bool = False,
    has_project_period: bool = False,
) -> str:
    if field_key in COMPLIANCE_PROTECTED_FIELDS and has_total_investment:
        return "COMPLIANCE_NOT_AUTO_MAPPED"
    if field_key == "procurement_scope" and has_construction_scope:
        return "COMPLIANCE_NOT_AUTO_MAPPED"
    if field_key == "delivery_period" and has_project_period:
        return "COMPLIANCE_NOT_AUTO_MAPPED"
    if field_key in PROCUREMENT_DECISION_FIELDS or field_key in TENDER_PROCESS_FIELDS:
        return "DECISION_REQUIRED"
    return "MATERIAL_NOT_FOUND"
