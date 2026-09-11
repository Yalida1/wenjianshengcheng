"""Rule-channel package / document-group identification regressions."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.app.services.procurement_planning import SourceBlock
from backend.app.services.rule_channel import RULE_CHANNEL_VERSION, run_rule_channel


def _block(
    seq: int,
    text: str,
    *,
    kind: str = "paragraph",
    section: str | None = None,
    **locator: Any,
) -> SourceBlock:
    return SourceBlock(
        id=f"blk-{seq}",
        sequence=seq,
        kind=kind,
        text=text,
        page_number=None,
        section_path=section,
        locator=locator,
        confidence=Decimal("1"),
    )


def test_rule_channel_version_bumped():
    assert RULE_CHANNEL_VERSION == "rule-channel-v2"


def test_file_inventory_table_three_groups_no_summary_or_profile_package():
    rows = [
        ["包号", "待编制文件", "采购属性", "数量"],
        ["P01", "设备采购招标文件", "货物", "1"],
        ["P02", "安装工程招标文件", "工程", "1"],
        ["P03", "监理服务招标文件", "服务", "1"],
    ]
    blocks = [
        _block(
            0,
            "三个采购包：设备采购、安装工程、监理服务。本项目采购包profile为公开招标方式实施。",
            section="招标方案",
        ),
        _block(
            1,
            "\n".join(" | ".join(row) for row in rows),
            kind="table",
            section="招标方案",
            table_rows=rows,
        ),
    ]
    candidate, meta = run_rule_channel(blocks, "样本项目")
    plan = candidate.plans[0]

    assert len(plan.groups) == 3
    assert {g.package_codes[0] for g in plan.groups} == {"P01", "P02", "P03"}
    assert meta["file_organization"] == "separate"
    assert all(not pkg.name.startswith("包p") for pkg in plan.packages)
    assert all("设备采购、安装工程、监理服务" not in pkg.name for pkg in plan.packages)
    assert all("profile" not in pkg.name.lower() for pkg in plan.packages)
    assert all("rofile" not in pkg.name for pkg in plan.packages)


def test_column_order_change_and_english_midword_not_package():
    rows = [
        ["数量", "采购属性", "待编制文件", "包号"],
        ["1", "货物", "超长名称的区域绿色数据中心节能改造设备采购招标文件", "A"],
        ["1", "服务", "配套运维与培训采购文件", "B"],
    ]
    blocks = [
        _block(
            0,
            "采购安排见下表。Application profile 与 SupportPlan 不应被识别为包。",
            section="采购组织",
        ),
        _block(
            1,
            "\n".join(" | ".join(row) for row in rows),
            kind="table",
            section="采购组织",
            table_rows=rows,
        ),
        _block(2, "包A：设备供货及安装调试公开招标。", section="采购组织"),
        _block(3, "包A：设备供货及安装调试公开招标。", section="采购组织"),
    ]

    candidate, _ = run_rule_channel(blocks, "列序变更项目")
    plan = candidate.plans[0]
    assert len(plan.groups) == 2
    codes = {pkg.code for pkg in plan.packages}
    assert codes == {"A", "B"}
    assert not any("profile" in pkg.name.lower() for pkg in plan.packages)
    assert not any("rofile" in pkg.name for pkg in plan.packages)
    pkg_a = next(pkg for pkg in plan.packages if pkg.code == "A")
    assert {"blk-2", "blk-3"} & set(pkg_a.evidence_block_ids)


def test_unnumbered_real_packages_still_detected():
    blocks = [
        _block(
            0,
            "本项目采购安排如下：第一标段土建施工采用公开招标；第二标段设备供货采用询比。",
            section="采购组织",
        )
    ]
    candidate, _ = run_rule_channel(blocks, "无编号项目")
    plan = candidate.plans[0]
    assert len(plan.packages) >= 2
    inquiry = [pkg for pkg in plan.packages if pkg.procurement_method == "inquiry"]
    assert inquiry, "询比 must remain inquiry, never coerced to public_tender"


def test_shared_vs_separate_from_inventory():
    separate_rows = [
        ["包号", "待编制文件", "数量"],
        ["P01", "甲招标文件", "1"],
        ["P02", "乙招标文件", "1"],
    ]
    shared_rows = [
        ["包号", "待编制文件", "数量"],
        ["P01", "共用招标文件", "1"],
        ["P02", "共用招标文件", "1"],
    ]
    qty_shared_rows = [
        ["包号", "待编制文件", "数量"],
        ["P01", "统一采购文件", "2"],
    ]

    separate, sep_meta = run_rule_channel(
        [
            _block(
                0,
                "\n".join(" | ".join(r) for r in separate_rows),
                kind="table",
                section="招标方案",
                table_rows=separate_rows,
            )
        ],
        "分别项目",
    )
    assert sep_meta["file_organization"] == "separate"
    assert len(separate.plans[0].groups) == 2

    shared, shared_meta = run_rule_channel(
        [
            _block(
                0,
                "\n".join(" | ".join(r) for r in shared_rows),
                kind="table",
                section="招标方案",
                table_rows=shared_rows,
            )
        ],
        "共用项目",
    )
    assert shared_meta["file_organization"] == "shared"
    assert len(shared.plans[0].groups) == 1
    assert set(shared.plans[0].groups[0].package_codes) == {"P01", "P02"}

    qty_shared, qty_meta = run_rule_channel(
        [
            _block(
                0,
                "\n".join(" | ".join(r) for r in qty_shared_rows),
                kind="table",
                section="招标方案",
                table_rows=qty_shared_rows,
            )
        ],
        "数量共用项目",
    )
    assert qty_meta["file_organization"] == "shared"
    assert len(qty_shared.plans[0].groups) == 1


def test_inquiry_method_preserved_in_procurement_table():
    rows = [
        ["包号", "采购内容", "采购方式"],
        ["Q1", "办公耗材", "询比"],
        ["Q2", "直接订购配件", "直接采购"],
    ]
    candidate, _ = run_rule_channel(
        [
            _block(
                0,
                "\n".join(" | ".join(r) for r in rows),
                kind="table",
                section="采购安排",
                semantic_role="procurement_package",
                table_rows=rows,
            )
        ],
        "询比项目",
    )
    methods = {pkg.procurement_method for pkg in candidate.plans[0].packages}
    assert "inquiry" in methods
    assert "direct_purchase" in methods
    assert "public_tender" not in methods


def test_pipe_package_missing_method_is_unknown_not_public_tender():
    blocks = [_block(0, "采购包：P09|仅名称|仅范围", section="招标方案")]
    candidate, _ = run_rule_channel(blocks, "缺方式项目")
    pkg = candidate.plans[0].packages[0]
    assert pkg.code == "P09"
    assert pkg.procurement_method == "unknown"


def test_summary_line_sets_declared_count_without_package():
    blocks = [_block(0, "三个采购包：设备采购、安装工程、监理服务。", section="招标方案")]
    candidate, meta = run_rule_channel(blocks, "摘要项目")
    plan = candidate.plans[0]
    assert plan.packages == []
    assert meta["declared_package_count"] == 3


def test_field_mapping_table_does_not_create_packages():
    rows = [
        ["字段", "正式来源", "采集状态", "处理原则"],
        ["package_number", "采购包名称", "可提取", "人工确认"],
        ["tender_number", "招标阶段生成", "可研通常不存在", "不映射"],
    ]
    candidate, _ = run_rule_channel(
        [
            _block(
                0,
                "\n".join(" | ".join(r) for r in rows),
                kind="table",
                section="附录/字段映射",
                table_rows=rows,
            )
        ],
        "映射表项目",
    )
    assert candidate.plans[0].packages == []
    assert candidate.plans[0].groups == []


def test_declared_count_mismatch_not_autocompleted():
    rows = [
        ["包号", "待编制文件", "数量"],
        ["P01", "唯一招标文件", "1"],
    ]
    blocks = [
        _block(0, "本项目划分为三个采购包。", section="招标方案"),
        _block(
            1,
            "\n".join(" | ".join(r) for r in rows),
            kind="table",
            section="招标方案",
            table_rows=rows,
        ),
    ]
    candidate, meta = run_rule_channel(blocks, "数量不一致项目")
    plan = candidate.plans[0]
    assert meta["declared_package_count"] == 3
    assert len(plan.packages) == 1
    assert meta["count_summary"]["package_count_complete"] is False
    assert any(item.get("code") == "analysis.declared_count_mismatch" for item in plan.unresolved)


def test_estimated_amount_from_feasibility_estimate_column():
    rows = [
        ["包号", "采购内容", "可研采购估算", "采购方式"],
        ["E1", "网络设备", "120万元", "公开招标"],
    ]
    candidate, _ = run_rule_channel(
        [
            _block(
                0,
                "\n".join(" | ".join(r) for r in rows),
                kind="table",
                section="采购安排",
                semantic_role="procurement_package",
                table_rows=rows,
            )
        ],
        "估算列项目",
    )
    pkg = candidate.plans[0].packages[0]
    assert pkg.estimated_amount == Decimal("1200000")
    assert pkg.confirmed_budget is None
