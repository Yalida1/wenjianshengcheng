from __future__ import annotations

from dataclasses import dataclass

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
    section_plan: tuple[tuple[str, str], ...] = ()
    procurement_type: str | None = None
    contract_type: str | None = None
    legacy_name: str | None = None


NDRC_FEASIBILITY_URL = (
    "https://www.ndrc.gov.cn/xxgk/zcfb/ghxwj/202304/t20230407_1353356.html"
)
NDRC_BIDDING_URL = (
    "https://www.ndrc.gov.cn/fzggw/jgsj/fgs/sjdt/201709/t20170912_1107057_ext.html"
)
MOF_GOODS_CONTRACT_URL = "https://www.mof.gov.cn/jrttts/202404/t20240429_3933786.htm"
SAMR_CONSTRUCTION_CONTRACT_URL = (
    "https://htsfwb.samr.gov.cn/View?id=082423f0-e9cb-41a2-b88c-bdc70b5619d8"
)
NDRC_PROJECT_PROPOSAL_URL = (
    "https://www.ndrc.gov.cn/hdjl/lyxd/202603/t20260320_1404253.html"
)

GOVERNMENT_FEASIBILITY_SECTIONS = (
    ("overview", "概述"),
    ("background", "项目建设背景和必要性"),
    ("demand", "项目需求分析与产出方案"),
    ("site", "项目选址与要素保障"),
    ("construction", "项目建设方案"),
    ("operation", "项目运营方案"),
    ("financing", "项目投融资与财务方案"),
    ("impact", "项目影响效果分析"),
    ("risk", "项目风险管控方案"),
    ("conclusion", "研究结论及建议"),
)

ENTERPRISE_FEASIBILITY_SECTIONS = (
    ("overview", "概述"),
    ("background", "项目建设背景和必要性"),
    ("market", "市场需求分析与产出方案"),
    ("site", "项目选址与要素保障"),
    ("construction", "项目建设方案"),
    ("operation", "项目运营方案"),
    ("financing", "项目投融资与财务方案"),
    ("impact", "项目影响效果分析"),
    ("risk", "项目风险管控方案"),
    ("conclusion", "研究结论及建议"),
)

BIDDING_SECTIONS = (
    ("announcement", "招标公告或投标邀请书"),
    ("instructions", "投标人须知"),
    ("evaluation", "评标办法"),
    ("contract_terms", "合同条款及格式"),
    ("requirements", "供货或服务要求"),
    ("bid_format", "投标文件格式"),
)

CONTRACT_SECTIONS = (
    ("agreement", "合同协议书"),
    ("general_terms", "通用合同条款"),
    ("special_terms", "专用合同条款"),
    ("attachments", "合同附件"),
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
    sections: tuple[tuple[str, str], ...],
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
        _adapted(
            f"adapted_{key}_bidding_2017",
            f"{title}招标文件适配模板（2017年版）",
            "tender",
            "国家发展和改革委员会等九部委",
            "发改法规〔2017〕1606号",
            2017,
            NDRC_BIDDING_URL,
            "平台依据官方标准文件目录结构适配，可用于生成初稿；法定引用内容须回到官方原文核对。",
            BIDDING_SECTIONS,
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
        name="通用采购招标文件参考模板",
        stage="tender",
        source_kind=PLATFORM_REFERENCE_TEMPLATE,
        issuing_authority=None,
        document_number=None,
        publish_year=None,
        source_url=None,
        applicability="平台通用参考结构，适用于非特定行业采购招标文件初稿。",
        generation_enabled=True,
        legacy_name="Demo 招标文件通用模板",
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
    spec: BuiltinTemplateSpec, fallback: list[tuple[str, str]]
) -> tuple[tuple[str, str], ...]:
    return spec.section_plan or tuple(fallback)
