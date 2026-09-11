from __future__ import annotations

import json
from collections.abc import Sequence
from decimal import Decimal
from types import SimpleNamespace

from backend.app.services.generation import field_snapshot, field_values_by_key
from backend.app.services.procurement_planning import (
    SourceBlock,
    _demo_analysis,
    _template_match_priority,
)
from backend.app.services.section_tree import SectionNode, flatten_section_nodes
from backend.app.services.tender_document import (
    scoring_total,
    tender_blocks_for_section,
    tender_notice_title,
)
from backend.app.template_catalog import (
    CONSTRUCTION_BIDDING_SECTIONS,
    EQUIPMENT_BIDDING_SECTIONS,
    GOVERNMENT_PROCUREMENT_SECTIONS,
    MATERIAL_BIDDING_SECTIONS,
    PLATFORM_REFERENCE_TEMPLATES,
    SERVICE_BIDDING_SECTIONS,
)
from backend.scripts.golden_case import FIELD_VALUES


def _root_titles(tree: Sequence[SectionNode]) -> list[str]:
    return [node.title for node in tree]


def test_tender_template_catalog_distinguishes_procurement_objects() -> None:
    assert _root_titles(EQUIPMENT_BIDDING_SECTIONS) == [
        "招标公告或投标邀请书",
        "投标人须知",
        "评标办法",
        "合同条款及格式",
        "供货或服务要求",
        "投标文件格式",
    ]
    assert _root_titles(MATERIAL_BIDDING_SECTIONS)[4] == "材料采购要求"
    assert _root_titles(SERVICE_BIDDING_SECTIONS)[4] == "委托人要求"
    assert _root_titles(CONSTRUCTION_BIDDING_SECTIONS)[4:7] == [
        "工程量清单",
        "图纸",
        "技术标准和要求",
    ]
    assert _root_titles(GOVERNMENT_PROCUREMENT_SECTIONS)[0] == "采购公告或投标邀请书"
    tender_types = {item.procurement_type for item in PLATFORM_REFERENCE_TEMPLATES if item.stage == "tender"}
    assert {"设备采购", "施工招标", "服务采购", "政府采购货物", "政府采购服务"} <= tender_types


def test_complete_equipment_case_builds_formal_blocks_without_internal_markers() -> None:
    fields = FIELD_VALUES["tender"]
    blocks = [
        block
        for section in flatten_section_nodes(EQUIPMENT_BIDDING_SECTIONS)
        for block in tender_blocks_for_section(section.key, fields)
    ]
    text = json.dumps([block.content for block in blocks], ensure_ascii=False)
    assert "【待确认】" not in text
    assert "ai_generated" not in text
    assert tender_notice_title(fields["tender_method"]) == "招标公告"
    captions = {str(block.content.get("caption")) for block in blocks if block.block_type == "table"}
    assert {
        "投标人须知前附表",
        "评标办法前附表",
        "资格审查表",
        "符合性审查表",
        "商务、技术和报价评审因素表",
        "采购清单",
        "技术规格和性能指标",
        "开标一览表",
        "分项报价表",
        "商务偏离表",
        "技术偏离表",
        "业绩表",
        "项目团队表",
    } <= captions
    scoring = next(
        block.content for block in blocks if block.content.get("caption") == "商务、技术和报价评审因素表"
    )
    assert scoring_total(scoring) == Decimal("100")


def test_confirmed_sentence_fields_are_joined_without_duplicate_punctuation() -> None:
    fields = {
        **FIELD_VALUES["tender"],
        "qualification_requirements": "依法设立并具备履约能力。",
        "bid_deadline": "2026-09-29 09:30，电子投标文件应在截止时间前上传。",
        "bid_opening": "2026-09-29 09:30，在第一开标室组织线上开标。",
        "payment_terms": "到货初验后支付40%，最终验收后支付60%。",
    }
    text = "\n".join(
        str(block.content.get("text", ""))
        for key in (
            "announcement_qualification",
            "announcement_deadline",
            "instructions_opening",
            "special_terms",
        )
        for block in tender_blocks_for_section(key, fields)
    )
    assert "。。" not in text
    assert "。；" not in text
    assert "。前递交" not in text
    assert "。组织" not in text


def test_notice_title_requires_confirmed_tender_method() -> None:
    assert tender_notice_title(None) == "招标公告或投标邀请书"
    assert tender_notice_title("公开招标") == "招标公告"
    assert tender_notice_title("邀请招标") == "投标邀请书"


def test_goods_profile_fields_omit_unapplicable_optional_pending_markers() -> None:
    """Equipment/goods applicable set must not inject service-only 【待确认】 clauses."""
    goods_keys = {
        "project_name",
        "package_number",
        "procurement_scope",
        "procurement_budget",
        "maximum_price",
        "procurement_list",
        "technical_specifications",
        "delivery_period",
        "delivery_location",
        "installation_requirements",
        "acceptance_criteria",
        "warranty_requirements",
        "bid_bond",
        "tender_number",
        "tenderer",
        "tender_agency",
        "tender_method",
        "issue_date",
        "qualification_requirements",
        "joint_venture_policy",
        "document_acquisition",
        "bid_deadline",
        "bid_opening",
        "announcement_media",
        "contact_information",
        "bid_validity",
        "clarification_rules",
        "rejection_rules",
        "evaluation_method",
        "evaluation_criteria",
        "tie_break_rule",
        "general_contract_terms_source",
        "payment_terms",
    }
    fields = {key: value for key, value in FIELD_VALUES["tender"].items() if key in goods_keys}
    assert "training_requirements" not in fields
    assert "operations_requirements" not in fields
    assert "data_security_requirements" not in fields
    assert "interface_requirements" not in fields
    text = "\n".join(
        str(block.content.get("text", ""))
        for key in (
            "requirements_delivery",
            "requirements_warranty",
            "requirements_security",
        )
        for block in tender_blocks_for_section(key, fields)
    )
    assert "【待确认】" not in text
    assert "培训要求：" not in text
    assert "运维服务要求：" not in text
    assert "数据与安全要求：" not in text
    assert "接口要求：" not in text
    assert "安装调试要求：" in text
    assert "质保及售后服务：" in text
    assert "技术规格书及合同约定" in text


def test_scoped_tender_fields_override_unscoped_extraction_for_generation_and_gate() -> None:
    group_id = "group-equipment"
    fields = [
        SimpleNamespace(
            field_key="project_name",
            normalized_value="来源抽取候选",
            value="来源抽取候选",
            status="extracted",
        ),
        SimpleNamespace(
            field_key=f"doc::{group_id}::project_name",
            normalized_value="人工确认项目",
            value="人工确认项目",
            status="user_confirmed",
        ),
        SimpleNamespace(
            field_key=f"doc::{group_id}::maximum_price",
            normalized_value=9_500_000,
            value=9_500_000,
            status="user_confirmed",
        ),
        SimpleNamespace(
            field_key="doc::other-group::project_name",
            normalized_value="其他招标文件",
            value="其他招标文件",
            status="user_confirmed",
        ),
    ]
    resolved = field_values_by_key(fields, group_id)  # type: ignore[arg-type]
    assert resolved["project_name"].value == "人工确认项目"
    assert "doc::other-group::project_name" not in resolved
    _sha256, values = field_snapshot(
        fields,  # type: ignore[arg-type]
        procurement_document_group_id=group_id,
    )
    assert values == {"project_name": "人工确认项目", "maximum_price": 9_500_000}


def test_explicit_equipment_source_selects_equipment_category() -> None:
    candidate = _demo_analysis(
        [
            SourceBlock(
                id="block-1",
                sequence=1,
                kind="paragraph",
                text=(
                    "独立主招标文件：设备采购招标文件|网络设备供货范围|"
                    "设备可独立供货、安装调试与验收\n"
                    "采购包：PKG-01|网络设备包|服务器、交换机供货及安装调试|public_tender"
                ),
                page_number=1,
                section_path="采购安排",
                locator={"paragraph": 1},
                confidence=Decimal("1"),
            )
        ],
        "网络建设项目",
    )
    plan = candidate.plans[0]
    assert plan.groups[0].procurement_category == "设备采购"
    assert plan.packages[0].procurement_category == "设备采购"
    assert not any(item["code"] == "analysis.mixed_procurement_scope" for item in plan.unresolved)


def test_mixed_equipment_software_construction_and_operations_scope_requires_confirmation() -> None:
    candidate = _demo_analysis(
        [
            SourceBlock(
                id="block-mixed",
                sequence=1,
                kind="paragraph",
                text=(
                    "独立主招标文件：综合建设招标文件|设备采购、软件开发、改造施工及多年运维服务|"
                    "拟合并采购，属性尚未确认"
                ),
                page_number=1,
                section_path="采购安排",
                locator={"paragraph": 1},
                confidence=Decimal("1"),
            )
        ],
        "综合建设项目",
    )
    plan = candidate.plans[0]
    assert plan.groups[0].procurement_category == "混合采购"
    assert any(item["code"] == "analysis.mixed_procurement_scope" for item in plan.unresolved)


def test_customer_official_template_has_priority_over_platform_reference() -> None:
    customer = SimpleNamespace(
        name="客户正式设备采购模板",
        procurement_type="设备采购",
        source_kind="other_official_template",
        is_builtin=False,
    )
    platform = SimpleNamespace(
        name="设备采购招标文件平台参考模板",
        procurement_type="设备采购",
        source_kind="platform_reference_template",
        is_builtin=True,
    )
    assert _template_match_priority(customer, "设备采购") < _template_match_priority(  # type: ignore[arg-type,operator]
        platform,
        "设备采购",  # type: ignore[arg-type]
    )
