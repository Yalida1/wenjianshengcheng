from __future__ import annotations

from backend.app.services.providers import (
    PENDING_MARKER,
    PROMPT_VERSION,
    DemoProvider,
    DraftResponse,
    ProviderContext,
    SectionDraft,
    field_text,
    finalize_draft_response,
    strip_spurious_pending_markers,
)
from backend.app.services.section_tree import SectionPlanItem


def test_prompt_version_is_v3() -> None:
    assert PROMPT_VERSION == "document-section-v3"


def test_field_text_marks_missing_values() -> None:
    assert field_text({}, "maximum_price") == f"{PENDING_MARKER}：最高限价"
    assert field_text({"maximum_price": 9_500_000}, "maximum_price") == "9,500,000 元"
    assert field_text({"tax_rate": 13}, "tax_rate") == "13%"


def test_strip_spurious_pending_before_confirmed_project_name() -> None:
    text = f"一、招标条件。本次招标项目为{PENDING_MARKER}北京地铁智能制度审查项目，"
    cleaned = strip_spurious_pending_markers(
        text,
        {"project_name": "北京地铁智能制度审查项目"},
        "北京地铁智能制度审查项目",
    )
    assert PENDING_MARKER not in cleaned
    assert "本次招标项目为北京地铁智能制度审查项目" in cleaned


def test_strip_keeps_candidate_prefixed_field_values() -> None:
    candidate = f"{PENDING_MARKER}北京地铁智能制度审查项目"
    text = f"项目名称：{candidate}。"
    cleaned = strip_spurious_pending_markers(
        text,
        {"project_name": candidate},
        "北京地铁智能制度审查项目",
    )
    assert candidate in cleaned


def test_strip_uses_project_name_when_field_absent() -> None:
    text = f"本次招标项目为{PENDING_MARKER}北京地铁智能制度审查项目，"
    cleaned = strip_spurious_pending_markers(text, {}, "北京地铁智能制度审查项目")
    assert "本次招标项目为北京地铁智能制度审查项目" in cleaned
    assert PENDING_MARKER not in cleaned


def test_finalize_draft_removes_marker_before_confirmed_name() -> None:
    draft = DraftResponse(
        sections=[
            SectionDraft(
                key="announcement",
                title="招标公告",
                level=1,
                parent_key=None,
                paragraphs=[
                    f"本次招标项目为{PENDING_MARKER}北京地铁智能制度审查项目，已具备招标条件。"
                ],
                field_refs=["project_name"],
            )
        ]
    )
    cleaned = finalize_draft_response(
        ProviderContext(
            stage="tender",
            project_name="北京地铁智能制度审查项目",
            fields={"project_name": "北京地铁智能制度审查项目"},
            section_plan=[SectionPlanItem("announcement", "招标公告", 1, None, 1)],
            source_context=[],
        ),
        draft,
    )
    assert PENDING_MARKER not in cleaned.sections[0].paragraphs[0]


def test_demo_tender_announcement_has_formal_structure() -> None:
    draft = DemoProvider().generate(
        ProviderContext(
            stage="tender",
            project_name="宁夏数字政务协同平台建设项目",
            fields={
                "project_name": "宁夏数字政务协同平台建设项目",
                "procurement_budget": 9_800_000,
                "maximum_price": 9_500_000,
                "procurement_scope": "采购事项管理、协同办理、数据治理软件及实施服务",
            },
            section_plan=[
                SectionPlanItem("announcement", "招标公告或投标邀请书", 1, None, 1),
                SectionPlanItem("instructions", "投标人须知", 1, None, 2),
            ],
            source_context=[],
        )
    )
    announcement = draft.sections[0]
    assert len(announcement.paragraphs) >= 4
    joined = "".join(announcement.paragraphs)
    assert len(joined) >= 400
    assert "招标条件" in joined
    assert "最高投标限价" in joined or "最高限价" in joined
    assert PENDING_MARKER in joined
    assert "9,500,000 元" in joined
    assert "不得" in joined
    assert f"{PENDING_MARKER}宁夏数字政务协同平台建设项目" not in joined


def test_demo_does_not_invent_contract_amount_from_tender_budget() -> None:
    draft = DemoProvider().generate(
        ProviderContext(
            stage="contract",
            project_name="示例项目",
            fields={"party_a": "甲方示例单位"},
            section_plan=[SectionPlanItem("parties", "合同主体", 1, None, 1)],
            source_context=[],
        )
    )
    joined = "".join(draft.sections[0].paragraphs)
    assert f"{PENDING_MARKER}：最终合同金额" in joined or f"{PENDING_MARKER}：乙方完整主体" in joined
    assert "自动带入" in joined or PENDING_MARKER in joined


def test_demo_parent_section_uses_short_intro() -> None:
    draft = DemoProvider().generate(
        ProviderContext(
            stage="feasibility",
            project_name="示例可研项目",
            fields={"project_name": "示例可研项目"},
            section_plan=[
                SectionPlanItem("overview", "概述", 1, None, 1, has_children=True),
                SectionPlanItem("overview_summary", "项目概况", 2, "overview", 2),
            ],
            source_context=[],
        )
    )
    assert len(draft.sections[0].paragraphs) == 2
    assert "章导语" in "".join(draft.sections[0].paragraphs)
    assert draft.sections[0].level == 1
    assert draft.sections[1].level == 2
    assert draft.sections[1].parent_key == "overview"


def test_demo_tender_draft_marks_feasibility_context_as_reference_only() -> None:
    draft = DemoProvider().generate(
        ProviderContext(
            stage="tender",
            project_name="制度审查项目",
            fields={"project_name": f"{PENDING_MARKER}制度审查项目"},
            section_plan=[SectionPlanItem("requirements", "采购需求", 1, None, 1)],
            source_context=["建设内容包括知识底座、规则审查和人工复核能力"],
        )
    )
    joined = "".join(draft.sections[0].paragraphs)
    assert "来源可研要点（草稿参考）" in joined
    assert "不等同于已确认采购范围" in joined
    assert "知识底座" in joined


def test_openai_compatible_generate_calls_llm_once_per_section(monkeypatch) -> None:
    from typing import Any

    from backend.app.services.providers import OpenAICompatibleProvider

    calls: list[list[str]] = []

    def fake_request(
        self: OpenAICompatibleProvider,
        model_type: type[Any],
        *,
        schema_name: str,
        system: str,
        user_payload: dict[str, Any],
    ) -> Any:
        del self, schema_name, system
        assert model_type is DraftResponse
        keys = [item["key"] for item in user_payload["section_plan"]]
        calls.append(keys)
        assert len(keys) == 1
        assert "document_outline" in user_payload
        assert len(user_payload["document_outline"]) == 2
        key = keys[0]
        title = next(item["title"] for item in user_payload["section_plan"])
        return DraftResponse(
            sections=[
                SectionDraft(
                    key=key,
                    title=title,
                    level=1,
                    parent_key=None,
                    paragraphs=["段落一。", "段落二。", "段落三。", "段落四。"],
                    field_refs=["project_name"],
                )
            ]
        )

    monkeypatch.setattr(OpenAICompatibleProvider, "_request_model", fake_request)
    provider = object.__new__(OpenAICompatibleProvider)
    provider.base_url = "https://api.deepseek.com"
    provider.api_key = "test-only-key"
    provider.model = "deepseek-v4-flash"
    provider.timeout_seconds = 180
    draft = provider.generate(
        ProviderContext(
            stage="tender",
            project_name="示例项目",
            fields={"project_name": "示例项目"},
            section_plan=[
                SectionPlanItem("announcement", "招标公告", 1, None, 1),
                SectionPlanItem("instructions", "投标人须知", 1, None, 2),
            ],
            source_context=[],
        )
    )
    assert calls == [["announcement"], ["instructions"]]
    assert [section.key for section in draft.sections] == ["announcement", "instructions"]
