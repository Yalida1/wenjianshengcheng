from __future__ import annotations

from backend.app.services.section_tree import (
    SectionNode,
    build_heading_tree_candidates,
    flatten_section_nodes,
    outline_numbers,
    validate_parent_selection,
)


def test_flatten_and_outline_numbers() -> None:
    nodes = (
        SectionNode(
            "overview",
            "概述",
            (
                SectionNode("overview_summary", "项目概况"),
                SectionNode("overview_basis", "编制依据"),
            ),
        ),
        SectionNode("background", "背景"),
    )
    items = flatten_section_nodes(nodes)
    assert [item.key for item in items] == [
        "overview",
        "overview_summary",
        "overview_basis",
        "background",
    ]
    assert outline_numbers(items) == ["1", "1.1", "1.2", "2"]
    assert items[1].parent_key == "overview"
    assert items[0].has_children is True
    assert items[3].has_children is False


def test_build_heading_tree_candidates_dedupes_under_parent() -> None:
    candidates = build_heading_tree_candidates(
        [
            {"title": "概述", "level": 1, "id": "b1"},
            {"title": "项目概况", "level": 2, "id": "b2"},
            {"title": "项目概况", "level": 2, "id": "b3"},
            {"title": "背景", "level": 1, "id": "b4"},
        ]
    )
    assert [item["title"] for item in candidates] == ["概述", "项目概况", "背景"]
    assert candidates[1]["parent_key"] == candidates[0]["key"]
    assert candidates[1]["level"] == 2


def test_validate_parent_selection_rejects_orphan_child() -> None:
    sections = [
        {"id": "s1", "key": "overview", "title": "概述", "parent_key": None},
        {"id": "s2", "key": "child", "title": "子节", "parent_key": "overview"},
    ]
    try:
        validate_parent_selection(sections, {"s2"})
        raised = False
    except ValueError:
        raised = True
    assert raised
    validate_parent_selection(sections, {"s1", "s2"})
