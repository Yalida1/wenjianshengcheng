from backend.app.services.generation import _expanded_section_keys
from backend.app.services.section_tree import SectionPlanItem


def _section(
    key: str,
    *,
    level: int,
    parent_key: str | None,
    sequence: int,
    has_children: bool = False,
) -> SectionPlanItem:
    return SectionPlanItem(
        key=key,
        title=key,
        level=level,
        parent_key=parent_key,
        sequence=sequence,
        has_children=has_children,
    )


SECTION_PLAN = [
    _section("chapter-1", level=1, parent_key=None, sequence=1, has_children=True),
    _section("chapter-1-1", level=2, parent_key="chapter-1", sequence=2),
    _section("chapter-1-2", level=2, parent_key="chapter-1", sequence=3),
    _section("chapter-2", level=1, parent_key=None, sequence=4),
]


def test_small_section_selection_does_not_expand_to_siblings() -> None:
    assert _expanded_section_keys(SECTION_PLAN, ["chapter-1-1"]) == {"chapter-1-1"}


def test_parent_section_selection_includes_descendants() -> None:
    assert _expanded_section_keys(SECTION_PLAN, ["chapter-1"]) == {
        "chapter-1",
        "chapter-1-1",
        "chapter-1-2",
    }


def test_exact_selection_respects_a_deselected_child() -> None:
    assert _expanded_section_keys(SECTION_PLAN, ["chapter-1", "chapter-1-1"], include_descendants=False) == {
        "chapter-1",
        "chapter-1-1",
    }
