"""Helpers for template/document section trees (DFS flat lists)."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

MAX_SECTION_LEVEL = 3


@dataclass(frozen=True)
class SectionNode:
    key: str
    title: str
    children: tuple[SectionNode, ...] = ()


@dataclass(frozen=True)
class SectionPlanItem:
    key: str
    title: str
    level: int
    parent_key: str | None
    sequence: int
    has_children: bool = False


def flatten_section_nodes(nodes: Sequence[SectionNode], *, start_level: int = 1) -> list[SectionPlanItem]:
    """DFS-preorder flatten of SectionNode trees into plan items."""
    items: list[SectionPlanItem] = []

    def walk(node: SectionNode, level: int, parent_key: str | None) -> None:
        if level < 1 or level > MAX_SECTION_LEVEL:
            raise ValueError(f"section level out of range: {level}")
        sequence = len(items) + 1
        items.append(
            SectionPlanItem(
                key=node.key,
                title=node.title,
                level=level,
                parent_key=parent_key,
                sequence=sequence,
                has_children=bool(node.children),
            )
        )
        for child in node.children:
            walk(child, level + 1, node.key)

    for node in nodes:
        walk(node, start_level, None)
    return items


def section_nodes_from_pairs(pairs: Iterable[tuple[str, str]]) -> tuple[SectionNode, ...]:
    """Compatibility: flat (key, title) pairs become level-1 nodes."""
    return tuple(SectionNode(key=key, title=title) for key, title in pairs)


def outline_numbers(items: Sequence[SectionPlanItem]) -> list[str]:
    """Sibling-based outline labels: 1, 1.1, 1.2, 2, ..."""
    counters: list[int] = []
    labels: list[str] = []
    for item in items:
        level = item.level
        while len(counters) < level:
            counters.append(0)
        counters = counters[:level]
        counters[level - 1] += 1
        labels.append(".".join(str(n) for n in counters[:level]))
    return labels


def validate_parent_selection(sections: Sequence[dict[str, object]], selected_ids: set[str]) -> None:
    """Raise ValueError if a selected child lacks its selected ancestor chain."""
    by_id = {str(item.get("id")): item for item in sections if item.get("id") is not None}
    for section_id in selected_ids:
        current = by_id.get(section_id)
        if current is None:
            raise ValueError(f"unknown section id: {section_id}")
        parent_key = current.get("parent_key")
        if not parent_key:
            continue
        # Walk via parent_key among selected set.
        parent = next(
            (item for item in sections if str(item.get("key")) == str(parent_key)),
            None,
        )
        if parent is None:
            continue
        parent_id = str(parent.get("id"))
        if parent_id not in selected_ids:
            raise ValueError(f"section {current.get('title')} requires parent {parent.get('title')}")


@dataclass
class _StackEntry:
    key: str
    level: int
    id: str | None = None


def build_heading_tree_candidates(
    headings: Sequence[dict[str, object]],
) -> list[dict[str, object]]:
    """
    Build flat DFS section candidates from ordered headings.

    Each heading dict needs: text/title, level (1..3), optional source block id.
    """
    stack: list[_StackEntry] = []
    seen_under_parent: set[tuple[str | None, str]] = set()
    candidates: list[dict[str, object]] = []

    for heading in headings:
        title = str(heading.get("title") or heading.get("text") or "").strip()
        if not title:
            continue
        try:
            raw_level = int(str(heading.get("level") or 1))
        except (TypeError, ValueError):
            raw_level = 1
        level = max(1, min(MAX_SECTION_LEVEL, raw_level))
        while stack and stack[-1].level >= level:
            stack.pop()
        parent_key = stack[-1].key if stack else None
        dedupe_key = (parent_key, title.casefold())
        if dedupe_key in seen_under_parent:
            continue
        seen_under_parent.add(dedupe_key)
        key = str(heading.get("key") or f"section_{len(candidates) + 1}")
        # Ensure unique keys
        base_key = key
        suffix = 2
        used = {str(item["key"]) for item in candidates}
        while key in used:
            key = f"{base_key}_{suffix}"
            suffix += 1
        raw_source_block_ids = heading.get("source_block_ids")
        source_block_ids = (
            [str(item) for item in raw_source_block_ids]
            if isinstance(raw_source_block_ids, (list, tuple))
            else []
        )
        if heading.get("id") and not source_block_ids:
            source_block_ids = [str(heading["id"])]
        try:
            confidence = float(str(heading.get("confidence") or 1.0))
        except (TypeError, ValueError):
            confidence = 1.0
        candidates.append(
            {
                "key": key,
                "title": title,
                "level": level,
                "parent_key": parent_key,
                "source_block_ids": source_block_ids,
                "confidence": confidence,
                "basis": str(heading.get("basis") or "program_style"),
            }
        )
        stack.append(_StackEntry(key=key, level=level))
    return candidates
