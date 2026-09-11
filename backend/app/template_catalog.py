from __future__ import annotations

from dataclasses import dataclass

from backend.app.services.section_tree import (
    SectionNode,
    SectionPlanItem,
    flatten_section_nodes,
    section_nodes_from_pairs,
)

NATIONAL_OFFICIAL_TEXT = "national_official_text"
ADAPTED_FROM_OFFICIAL_OUTLINE = "adapted_from_official_outline"
PLATFORM_REFERENCE_TEMPLATE = "platform_reference_template"
OTHER_OFFICIAL_TEMPLATE = "other_official_template"

TEMPLATE_SOURCE_KINDS = (
    NATIONAL_OFFICIAL_TEXT,
    ADAPTED_FROM_OFFICIAL_OUTLINE,
    PLATFORM_REFERENCE_TEMPLATE,
    OTHER_OFFICIAL_TEMPLATE,
)

TEMPLATE_SOURCE_LABELS = {
    NATIONAL_OFFICIAL_TEXT: "国家正式文本",
    ADAPTED_FROM_OFFICIAL_OUTLINE: "依据正式大纲适配",
    PLATFORM_REFERENCE_TEMPLATE: "平台参考模板",
    OTHER_OFFICIAL_TEMPLATE: "其他正式模板",
}


@dataclass(frozen=True)
class BuiltinTemplateSpec:
    key: str
    name: str
    stage: str
    source_kind: str
    issuing_authority: str | None
    document_number: str | None
    publish_year: int | None
    source_url: str | None
    applicability: str
    generation_enabled: bool
    section_plan: tuple[SectionNode, ...] = ()
    procurement_type: str | None = None
    contract_type: str | None = None
    legacy_name: str | None = None


NDRC_FEASIBILITY_URL = "https://www.ndrc.gov.cn/xxgk/zcfb/ghxwj/202304/t20230407_1353356.html"
NDRC_BIDDING_URL = "https://www.ndrc.gov.cn/fzggw/jgsj/fgs/sjdt/201709/t20170912_1107057_ext.html"
MOF_GOODS_CONTRACT_URL = "https://www.mof.gov.cn/jrttts/202404/t20240429_3933786.htm"
SAMR_CONSTRUCTION_CONTRACT_URL = "https://htsfwb.samr.gov.cn/View?id=082423f0-e9cb-41a2-b88c-bdc70b5619d8"
NDRC_PROJECT_PROPOSAL_URL = "https://www.ndrc.gov.cn/hdjl/lyxd/202603/t20260320_1404253.html"


def _node(key: str, title: str, *children: SectionNode) -> SectionNode:
    return SectionNode(key=key, title=title, children=children)


GOVERNMENT_FEASIBILITY_SECTIONS = (
    _node(
        "overview",
        "概述",
        _node("overview_summary", "项目概况"),
        _node("overview_basis", "编制依据"),
        _node("overview_conclusion", "主要结论和建议"),
    ),
    _node(
        "background",
        "项目建设背景和必要性",
        _node("background_policy", "政策与规划符合性"),
        _node("background_need", "建设必要性"),
        _node("background_status", "现状与问题"),
    ),
    _node(
        "demand",
        "项目需求分析与产出方案",
        _node("demand_analysis", "需求分析"),
        _node("demand_output", "产出方案"),
        _node("demand_scale", "建设规模与内容"),
    ),
    _node(
        "site",
        "项目选址与要素保障",
        _node("site_location", "选址方案"),
        _node("site_land", "用地与要素保障"),
        _node("site_conditions", "建设条件"),
    ),
    _node(
        "construction",
        "项目建设方案",
        _node("construction_tech", "技术方案"),
        _node("construction_plan", "工程方案"),
        _node("construction_schedule", "建设工期与进度"),
    ),
    _node(
        "operation",
        "项目运营方案",
        _node("operation_model", "运营模式"),
        _node("operation_org", "组织与人员"),
        _node("operation_service", "服务与保障"),
    ),
    _node(
        "financing",
        "项目投融资与财务方案",
        _node("financing_investment", "投资估算"),
        _node("financing_funding", "资金筹措"),
        _node("financing_financial", "财务评价"),
    ),
    _node(
        "impact",
        "项目影响效果分析",
        _node("impact_economic", "经济影响"),
        _node("impact_social", "社会影响"),
        _node("impact_environment", "环境影响"),
    ),
    _node(
        "risk",
        "项目风险管控方案",
        _node("risk_identification", "主要风险识别"),
        _node("risk_mitigation", "风险防控措施"),
    ),
    _node(
        "conclusion",
        "研究结论及建议",
        _node("conclusion_summary", "研究结论"),
        _node("conclusion_advice", "相关建议"),
    ),
)

ENTERPRISE_FEASIBILITY_SECTIONS = (
    _node(
        "overview",
        "概述",
        _node("overview_summary", "项目概况"),
        _node("overview_basis", "编制依据"),
        _node("overview_conclusion", "主要结论和建议"),
    ),
    _node(
        "background",
        "项目建设背景和必要性",
        _node("background_policy", "政策与规划符合性"),
        _node("background_need", "建设必要性"),
        _node("background_status", "现状与问题"),
    ),
    _node(
        "market",
        "市场需求分析与产出方案",
        _node("market_analysis", "市场分析"),
        _node("market_output", "产出方案"),
        _node("market_scale", "建设规模与内容"),
    ),
    _node(
        "site",
        "项目选址与要素保障",
        _node("site_location", "选址方案"),
        _node("site_land", "用地与要素保障"),
        _node("site_conditions", "建设条件"),
    ),
    _node(
        "construction",
        "项目建设方案",
        _node("construction_tech", "技术方案"),
        _node("construction_plan", "工程方案"),
        _node("construction_schedule", "建设工期与进度"),
    ),
    _node(
        "operation",
        "项目运营方案",
        _node("operation_model", "运营模式"),
        _node("operation_org", "组织与人员"),
        _node("operation_service", "服务与保障"),
    ),
    _node(
        "financing",
        "项目投融资与财务方案",
        _node("financing_investment", "投资估算"),
        _node("financing_funding", "资金筹措"),
        _node("financing_financial", "财务评价"),
    ),
    _node(
        "impact",
        "项目影响效果分析",
        _node("impact_economic", "经济影响"),
        _node("impact_social", "社会影响"),
        _node("impact_environment", "环境影响"),
    ),
    _node(
        "risk",
        "项目风险管控方案",
        _node("risk_identification", "主要风险识别"),
        _node("risk_mitigation", "风险防控措施"),
    ),
    _node(
        "conclusion",
        "研究结论及建议",
        _node("conclusion_summary", "研究结论"),
        _node("conclusion_advice", "相关建议"),
    ),
)

EQUIPMENT_BIDDING_SECTIONS = (
    _node(
        "announcement",
        "招标公告或投标邀请书",
        _node("announcement_conditions", "招标条件"),
        _node("announcement_overview", "项目概况"),
        _node("announcement_scope", "招标范围"),
        _node("announcement_budget", "预算及最高限价"),
        _node("announcement_qualification", "资格要求"),
        _node("announcement_joint_venture", "联合体投标"),
        _node("announcement_acquisition", "招标文件获取"),
        _node("announcement_deadline", "投标截止及开标安排"),
        _node("announcement_media", "公告媒介"),
        _node("announcement_contact", "联系方式"),
    ),
    _node(
        "instructions",
        "投标人须知",
        _node("instructions_schedule", "投标人须知前附表"),
        _node("instructions_general", "总则"),
        _node("instructions_documents", "招标文件及澄清"),
        _node("instructions_bid", "投标文件编制、有效期及保证金"),
        _node("instructions_opening", "投标、开标与评审程序"),
        _node("instructions_rejection", "否决投标"),
        _node("instructions_appendix", "投标人须知附表"),
    ),
    _node(
        "evaluation",
        "评标办法",
        _node("evaluation_schedule", "评标办法前附表"),
        _node("qualification_review", "资格审查表"),
        _node("compliance_review", "符合性审查表"),
        _node("scoring_factors", "商务、技术和报价评审因素"),
        _node("evaluation_procedure", "评标程序"),
        _node("evaluation_rejection", "否决投标条件"),
        _node("evaluation_tie_break", "同分处理规则"),
    ),
    _node(
        "contract_terms",
        "合同条款及格式",
        _node("agreement_form", "合同协议书"),
        _node("general_terms", "通用合同条款"),
        _node("special_terms", "专用合同条款"),
        _node("performance_guarantee", "履约担保"),
        _node("payment_delivery_acceptance", "付款、交付和验收"),
        _node("warranty_breach_dispute", "质保、违约和争议解决"),
        _node("contract_appendices", "合同附件格式"),
    ),
    _node(
        "requirements",
        "供货或服务要求",
        _node("requirements_scope", "采购范围"),
        _node("procurement_list", "采购清单"),
        _node("technical_specs", "技术规格和性能指标"),
        _node("requirements_delivery", "交付、安装、调试和培训"),
        _node("requirements_acceptance", "验收标准及验收材料"),
        _node("requirements_warranty", "质保和售后服务"),
        _node("requirements_security", "数据、安全、接口和运维要求"),
    ),
    _node(
        "bid_format",
        "投标文件格式",
        _node("bid_letter", "投标函"),
        _node("legal_representative", "法定代表人身份证明"),
        _node("authorization", "授权委托书"),
        _node("opening_schedule", "开标一览表"),
        _node("itemized_quote", "分项报价表"),
        _node("commercial_deviation", "商务偏离表"),
        _node("technical_deviation", "技术偏离表"),
        _node("qualification_index", "资格证明文件目录"),
        _node("performance_table", "业绩表"),
        _node("team_table", "项目团队表"),
        _node("service_plan", "服务方案"),
        _node("commitment", "承诺函"),
    ),
)

MATERIAL_BIDDING_SECTIONS = tuple(
    node if node.key != "requirements" else _node("requirements", "材料采购要求", *node.children)
    for node in EQUIPMENT_BIDDING_SECTIONS
)

SERVICE_BIDDING_SECTIONS = (
    EQUIPMENT_BIDDING_SECTIONS[0],
    EQUIPMENT_BIDDING_SECTIONS[1],
    EQUIPMENT_BIDDING_SECTIONS[2],
    EQUIPMENT_BIDDING_SECTIONS[3],
    _node(
        "requirements",
        "委托人要求",
        _node("requirements_scope", "服务范围及成果"),
        _node("technical_specs", "服务标准和技术要求"),
        _node("requirements_delivery", "服务期限和进度要求"),
        _node("requirements_acceptance", "成果验收要求"),
        _node("requirements_warranty", "后续服务要求"),
        _node("requirements_security", "数据、安全和接口要求"),
    ),
    EQUIPMENT_BIDDING_SECTIONS[5],
)

CONSTRUCTION_BIDDING_SECTIONS = (
    EQUIPMENT_BIDDING_SECTIONS[0],
    EQUIPMENT_BIDDING_SECTIONS[1],
    EQUIPMENT_BIDDING_SECTIONS[2],
    EQUIPMENT_BIDDING_SECTIONS[3],
    _node("bill_of_quantities", "工程量清单"),
    _node("drawings", "图纸"),
    _node("technical_standards", "技术标准和要求"),
    EQUIPMENT_BIDDING_SECTIONS[5],
)

GOVERNMENT_PROCUREMENT_SECTIONS = (
    _node(
        "procurement_announcement",
        "采购公告或投标邀请书",
        *EQUIPMENT_BIDDING_SECTIONS[0].children,
    ),
    EQUIPMENT_BIDDING_SECTIONS[1],
    _node("requirements", "采购需求", *EQUIPMENT_BIDDING_SECTIONS[4].children),
    _node("evaluation", "评标方法和标准", *EQUIPMENT_BIDDING_SECTIONS[2].children),
    _node("contract_terms", "政府采购合同文本", *EQUIPMENT_BIDDING_SECTIONS[3].children),
    EQUIPMENT_BIDDING_SECTIONS[5],
)

# Compatibility alias used by earlier code and tests.
BIDDING_SECTIONS = EQUIPMENT_BIDDING_SECTIONS

CONTRACT_SECTIONS = section_nodes_from_pairs(
    (
        ("agreement", "合同协议书"),
        ("general_terms", "通用合同条款"),
        ("special_terms", "专用合同条款"),
        ("attachments", "合同附件"),
    )
)


def _official(
    key: str,
    name: str,
    stage: str,
    authority: str,
    document_number: str | None,
    year: int,
    url: str,
    applicability: str,
    *,
    procurement_type: str | None = None,
    contract_type: str | None = None,
) -> BuiltinTemplateSpec:
    return BuiltinTemplateSpec(
        key=key,
        name=name,
        stage=stage,
        source_kind=NATIONAL_OFFICIAL_TEXT,
        issuing_authority=authority,
        document_number=document_number,
        publish_year=year,
        source_url=url,
        applicability=applicability,
        generation_enabled=False,
        procurement_type=procurement_type,
        contract_type=contract_type,
    )


def _adapted(
    key: str,
    name: str,
    stage: str,
    authority: str,
    document_number: str | None,
    year: int,
    url: str,
    applicability: str,
    sections: tuple[SectionNode, ...],
    *,
    procurement_type: str | None = None,
    contract_type: str | None = None,
) -> BuiltinTemplateSpec:
    return BuiltinTemplateSpec(
        key=key,
        name=name,
        stage=stage,
        source_kind=ADAPTED_FROM_OFFICIAL_OUTLINE,
        issuing_authority=authority,
        document_number=document_number,
        publish_year=year,
        source_url=url,
        applicability=applicability,
        generation_enabled=True,
        section_plan=sections,
        procurement_type=procurement_type,
        contract_type=contract_type,
    )


def _tender_reference(
    key: str,
    name: str,
    authority: str,
    document_number: str | None,
    year: int,
    url: str,
    applicability: str,
    sections: tuple[SectionNode, ...],
    *,
    procurement_type: str,
) -> BuiltinTemplateSpec:
    """A directory adaptation is a platform reference, never official full text."""
    return BuiltinTemplateSpec(
        key=key,
        name=name,
        stage="tender",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=authority,
        document_number=document_number,
        publish_year=year,
        source_url=url,
        applicability=applicability,
        generation_enabled=True,
        section_plan=sections,
        procurement_type=procurement_type,
    )


OFFICIAL_TEXTS = (
    _official(
        "gov_feasibility_outline_2023",
        "政府投资项目可行性研究报告编写通用大纲（2023年版）",
        "feasibility",
        "国家发展和改革委员会",
        "发改投资规〔2023〕304号",
        2023,
        NDRC_FEASIBILITY_URL,
        "政府投资项目可行性研究报告编写与审查参考；以官方现行文本和主管部门要求为准。",
    ),
    _official(
        "enterprise_feasibility_outline_2023",
        "企业投资项目可行性研究报告编写参考大纲（2023年版）",
        "feasibility",
        "国家发展和改革委员会",
        "发改投资规〔2023〕304号",
        2023,
        NDRC_FEASIBILITY_URL,
        "企业投资项目可行性研究报告编写参考；具体项目按行业和审批要求调整。",
    ),
    *(
        _official(
            f"standard_{key}_bidding_2017",
            f"标准{title}招标文件（2017年版）",
            "tender",
            "国家发展和改革委员会等九部委",
            "发改法规〔2017〕1606号",
            2017,
            NDRC_BIDDING_URL,
            f"依法必须招标项目的{title}招标文件编制；依法必须不加修改引用的内容须以官方原文为准。",
            procurement_type=title,
        )
        for key, title in (
            ("equipment", "设备采购"),
            ("materials", "材料采购"),
            ("survey", "勘察"),
            ("design", "设计"),
            ("supervision", "监理"),
        )
    ),
    _official(
        "government_goods_contract_2024",
        "政府采购货物买卖合同（试行）",
        "contract",
        "财政部办公厅",
        "财办库〔2024〕84号",
        2024,
        MOF_GOODS_CONTRACT_URL,
        "政府采购货物买卖合同签订参考；项目专用条款须结合采购结果和真实履约条件填写。",
        contract_type="政府采购货物买卖合同",
    ),
    _official(
        "construction_contract_gf_2017_0201",
        "建设工程施工合同（示范文本）GF-2017-0201",
        "contract",
        "住房城乡建设部、原国家工商行政管理总局",
        "GF-2017-0201",
        2017,
        SAMR_CONSTRUCTION_CONTRACT_URL,
        "建设工程施工合同订立参考；使用时应结合工程实际及最新监管要求。",
        contract_type="建设工程施工合同",
    ),
)

ADAPTED_TEMPLATES = (
    _adapted(
        "adapted_gov_feasibility_2023",
        "政府投资项目可研报告适配模板（2023年大纲）",
        "feasibility",
        "国家发展和改革委员会",
        "发改投资规〔2023〕304号",
        2023,
        NDRC_FEASIBILITY_URL,
        "平台依据官方通用大纲章节适配，可用于生成初稿；不是官方原文。",
        GOVERNMENT_FEASIBILITY_SECTIONS,
    ),
    _adapted(
        "adapted_enterprise_feasibility_2023",
        "企业投资项目可研报告适配模板（2023年大纲）",
        "feasibility",
        "国家发展和改革委员会",
        "发改投资规〔2023〕304号",
        2023,
        NDRC_FEASIBILITY_URL,
        "平台依据官方参考大纲章节适配，可用于生成初稿；不是官方原文。",
        ENTERPRISE_FEASIBILITY_SECTIONS,
    ),
    *(
        _tender_reference(
            f"adapted_{key}_bidding_2017",
            f"{title}招标文件适配模板（2017年版）",
            "国家发展和改革委员会等九部委",
            "发改法规〔2017〕1606号",
            2017,
            NDRC_BIDDING_URL,
            "平台依据官方标准文件目录结构适配，可用于生成初稿；法定引用内容须回到官方原文核对。",
            sections,
            procurement_type=title,
        )
        for key, title, sections in (
            ("equipment", "工程建设相关设备采购", EQUIPMENT_BIDDING_SECTIONS),
            ("materials", "材料采购", MATERIAL_BIDDING_SECTIONS),
            ("survey", "勘察", SERVICE_BIDDING_SECTIONS),
            ("design", "设计", SERVICE_BIDDING_SECTIONS),
            ("supervision", "监理", SERVICE_BIDDING_SECTIONS),
        )
    ),
    _adapted(
        "adapted_government_goods_contract_2024",
        "政府采购货物买卖合同填报模板（2024年试行文本适配）",
        "contract",
        "财政部办公厅",
        "财办库〔2024〕84号",
        2024,
        MOF_GOODS_CONTRACT_URL,
        "平台依据试行文本结构制作的填报版，可用于生成初稿；不是财政部发布的原始文件。",
        CONTRACT_SECTIONS,
        contract_type="政府采购货物买卖合同",
    ),
    _adapted(
        "adapted_construction_contract_gf_2017_0201",
        "建设工程施工合同填报模板（GF-2017-0201适配）",
        "contract",
        "住房城乡建设部、原国家工商行政管理总局",
        "GF-2017-0201",
        2017,
        SAMR_CONSTRUCTION_CONTRACT_URL,
        "平台依据示范文本结构制作的填报版，可用于生成初稿；不是主管部门发布的原始文件。",
        CONTRACT_SECTIONS,
        contract_type="建设工程施工合同",
    ),
)

PLATFORM_REFERENCE_TEMPLATES = (
    BuiltinTemplateSpec(
        key="platform_project_proposal",
        name="政府投资项目建议书通用参考模板",
        stage="requirement",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=NDRC_PROJECT_PROPOSAL_URL,
        applicability="平台通用参考结构，用于项目建议书初稿；不是国家统一制式文本。",
        generation_enabled=True,
        legacy_name="Demo 项目建议书通用模板",
    ),
    BuiltinTemplateSpec(
        key="platform_feasibility",
        name="一般投资项目可行性研究报告参考模板",
        stage="feasibility",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="平台通用参考结构，适用于不要求特定正式大纲的可研初稿。",
        generation_enabled=True,
        legacy_name="Demo 可行性研究报告通用模板",
    ),
    BuiltinTemplateSpec(
        key="platform_tender",
        name="设备采购招标文件平台参考模板",
        stage="tender",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="平台通用参考结构，适用于非特定行业采购招标文件初稿。",
        generation_enabled=True,
        section_plan=EQUIPMENT_BIDDING_SECTIONS,
        procurement_type="设备采购",
        legacy_name="Demo 招标文件通用模板",
    ),
    BuiltinTemplateSpec(
        key="platform_construction_tender",
        name="施工招标文件平台参考模板",
        stage="tender",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="平台施工招标参考结构，含工程量清单、图纸和技术标准章节；不是主管部门官方原文。",
        generation_enabled=True,
        section_plan=CONSTRUCTION_BIDDING_SECTIONS,
        procurement_type="施工招标",
    ),
    BuiltinTemplateSpec(
        key="platform_service_tender",
        name="服务采购招标文件平台参考模板",
        stage="tender",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="一般服务采购项目参考结构；使用前须结合采购制度和服务对象确认适用范围。",
        generation_enabled=True,
        section_plan=SERVICE_BIDDING_SECTIONS,
        procurement_type="服务采购",
    ),
    BuiltinTemplateSpec(
        key="platform_government_goods_tender",
        name="政府采购货物招标文件平台参考模板",
        stage="tender",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="政府采购货物项目参考结构；使用前须按适用地区和采购制度复核，不是官方全文模板。",
        generation_enabled=True,
        section_plan=GOVERNMENT_PROCUREMENT_SECTIONS,
        procurement_type="政府采购货物",
    ),
    BuiltinTemplateSpec(
        key="platform_government_service_tender",
        name="政府采购服务招标文件平台参考模板",
        stage="tender",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="政府采购服务项目参考结构；使用前须按适用地区和采购制度复核，不是官方全文模板。",
        generation_enabled=True,
        section_plan=GOVERNMENT_PROCUREMENT_SECTIONS,
        procurement_type="政府采购服务",
    ),
    BuiltinTemplateSpec(
        key="platform_contract",
        name="通用采购合同参考模板",
        stage="contract",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="平台通用参考结构，适用于非特定合同示范文本场景的合同初稿。",
        generation_enabled=True,
        legacy_name="Demo 合同通用模板",
    ),
)

BUILTIN_TEMPLATE_CATALOG = OFFICIAL_TEXTS + ADAPTED_TEMPLATES + PLATFORM_REFERENCE_TEMPLATES


def section_plan_for(
    spec: BuiltinTemplateSpec, fallback: list[tuple[str, str]] | tuple[SectionNode, ...]
) -> tuple[SectionNode, ...]:
    if spec.section_plan:
        return spec.section_plan
    if fallback and isinstance(fallback[0], SectionNode):
        return tuple(fallback)  # type: ignore[arg-type]
    return section_nodes_from_pairs(fallback)  # type: ignore[arg-type]


def section_plan_items_for(
    spec: BuiltinTemplateSpec, fallback: list[tuple[str, str]] | tuple[SectionNode, ...]
) -> list[SectionPlanItem]:
    return flatten_section_nodes(section_plan_for(spec, fallback))
