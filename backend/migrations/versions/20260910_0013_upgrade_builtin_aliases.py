"""Upgrade organization field_definition aliases to builtin version 2.

Revision ID: 20260910_0013
Revises: 20260908_0012
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260910_0013"
down_revision: str | None = "20260908_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _as_dict(value: object) -> dict:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def upgrade() -> None:
    from backend.app.field_catalog import merge_missing_aliases, needs_alias_upgrade

    connection = op.get_bind()
    field_definitions = sa.table(
        "field_definitions",
        sa.column("id", sa.String),
        sa.column("field_key", sa.String),
        sa.column("field_label", sa.String),
        sa.column("rules", sa.JSON),
    )
    rows = connection.execute(
        sa.select(
            field_definitions.c.id,
            field_definitions.c.field_key,
            field_definitions.c.field_label,
            field_definitions.c.rules,
        )
    ).mappings()
    for row in rows:
        rules = _as_dict(row["rules"])
        if not needs_alias_upgrade(rules):
            continue
        merged = merge_missing_aliases(
            rules, row["field_key"], row["field_label"] or row["field_key"]
        )
        connection.execute(
            sa.update(field_definitions)
            .where(field_definitions.c.id == row["id"])
            .values(rules=merged)
        )


def downgrade() -> None:
    connection = op.get_bind()
    field_definitions = sa.table(
        "field_definitions",
        sa.column("id", sa.String),
        sa.column("rules", sa.JSON),
    )
    rows = connection.execute(
        sa.select(field_definitions.c.id, field_definitions.c.rules)
    ).mappings()
    for row in rows:
        rules = _as_dict(row["rules"])
        if "builtin_aliases_version" not in rules:
            continue
        rules.pop("builtin_aliases_version", None)
        connection.execute(
            sa.update(field_definitions)
            .where(field_definitions.c.id == row["id"])
            .values(rules=rules)
        )
