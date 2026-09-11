"""Unit tests for ensure_default_document_groups (no shared SQLite fixture races)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend.app.errors import APIError
from backend.app.services.procurement_planning import (
    confirm_plan,
    ensure_default_document_groups,
)


def test_ensure_default_without_strategy_is_noop() -> None:
    db = MagicMock()
    plan = SimpleNamespace(id="plan-1", organization_id="org-1", name="方案", revision=1)
    assert ensure_default_document_groups(db, plan, user_id="u1", strategy=None) is False
    db.add.assert_not_called()
    db.scalars.assert_not_called()


def test_ensure_default_rejects_unknown_strategy() -> None:
    db = MagicMock()
    plan = SimpleNamespace(id="plan-1", organization_id="org-1", name="方案", revision=1)
    with pytest.raises(APIError) as exc:
        ensure_default_document_groups(db, plan, user_id="u1", strategy="invented")
    assert exc.value.code == "invalid_grouping_strategy"


def test_ensure_default_one_package_one_document_preserves_methods() -> None:
    db = MagicMock()
    plan = SimpleNamespace(
        id="plan-1",
        organization_id="org-1",
        name="方案",
        revision=3,
        updated_by=None,
    )
    packages = [
        SimpleNamespace(
            id="pkg-inquiry",
            code="P1",
            name="询价包",
            procurement_category="goods",
            business_subcategory=None,
            procurement_method="inquiry",
            scope="询价范围",
            exclusions=None,
            deliverables=[],
            implementation_period=None,
        ),
        SimpleNamespace(
            id="pkg-tender",
            code="P2",
            name="招标包",
            procurement_category="goods",
            business_subcategory=None,
            procurement_method="public_tender",
            scope="招标范围",
            exclusions=None,
            deliverables=[],
            implementation_period=None,
        ),
    ]

    # Call order: packages, groups, (no linked/inactive queries when groups empty), issues
    db.scalars.side_effect = [
        packages,
        [],  # groups
        [],  # open grouping issues to resolve
    ]
    created_groups: list[object] = []

    def add(obj: object) -> None:
        created_groups.append(obj)
        if getattr(obj, "code", None) and not getattr(obj, "id", None):
            obj.id = f"group-{obj.code}"  # type: ignore[attr-defined]

    db.add.side_effect = add

    assert (
        ensure_default_document_groups(
            db, plan, user_id="u1", strategy="one_package_one_document"
        )
        is True
    )
    group_rows = [
        item
        for item in created_groups
        if getattr(item, "organization_method", None) == "user_confirmed_one_package_one_document"
    ]
    assert len(group_rows) == 2
    methods = {item.procurement_method for item in group_rows}  # type: ignore[attr-defined]
    assert methods == {"inquiry", "public_tender"}
    assert plan.revision == 4


def test_ensure_default_skips_packages_already_linked_including_excluded() -> None:
    db = MagicMock()
    plan = SimpleNamespace(
        id="plan-1",
        organization_id="org-1",
        name="方案",
        revision=1,
        updated_by=None,
    )
    packages = [
        SimpleNamespace(
            id="pkg-excluded",
            code="P1",
            name="已归档包",
            procurement_category="goods",
            business_subcategory=None,
            procurement_method="public_tender",
            scope="范围1",
            exclusions=None,
            deliverables=[],
            implementation_period=None,
        ),
        SimpleNamespace(
            id="pkg-free",
            code="P2",
            name="未归档包",
            procurement_category="goods",
            business_subcategory=None,
            procurement_method="public_tender",
            scope="范围2",
            exclusions=None,
            deliverables=[],
            implementation_period=None,
        ),
    ]
    groups = [SimpleNamespace(id="g-excluded", code="DOC-01", status="excluded")]

    # packages, groups, linked_package_ids, covered_by_inactive, inactive pkg rows, issues
    db.scalars.side_effect = [
        packages,
        groups,
        ["pkg-excluded"],  # linked to any group
        ["pkg-excluded"],  # covered by inactive
        [packages[0]],  # inactive package rows (for code skip)
        [],  # issues
    ]
    created: list[object] = []

    def add(obj: object) -> None:
        created.append(obj)
        if getattr(obj, "code", None) and not getattr(obj, "id", None):
            obj.id = f"id-{obj.code}"  # type: ignore[attr-defined]

    db.add.side_effect = add

    assert (
        ensure_default_document_groups(
            db, plan, user_id="u1", strategy="one_package_one_document"
        )
        is True
    )
    group_rows = [
        item
        for item in created
        if getattr(item, "organization_method", None) == "user_confirmed_one_package_one_document"
    ]
    assert len(group_rows) == 1
    assert group_rows[0].name.startswith("未归档包")  # type: ignore[attr-defined]


def test_confirm_plan_requires_active_groups(monkeypatch: pytest.MonkeyPatch) -> None:
    db = MagicMock()
    plan = SimpleNamespace(
        id="plan-1",
        organization_id="org-1",
        confirmation_blocked=False,
        revision=1,
        status="draft",
        recommended_document_count=None,
    )

    monkeypatch.setattr(
        "backend.app.services.procurement_planning.recalculate_plan",
        lambda *_a, **_k: None,
    )
    db.scalars.return_value = []

    with pytest.raises(APIError) as exc:
        confirm_plan(db, plan, user_id="u1", note="无组确认")
    assert exc.value.code == "grouping_not_confirmed"
