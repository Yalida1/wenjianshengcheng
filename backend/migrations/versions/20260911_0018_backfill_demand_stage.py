"""Backfill demand stage for existing projects.

Revision ID: 20260911_0018
Revises: 20260911_0017
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0018"
down_revision: str | None = "20260911_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    projects = conn.execute(
        sa.text(
            """
            SELECT p.id AS project_id, p.organization_id
            FROM projects p
            WHERE NOT EXISTS (
              SELECT 1 FROM project_stages s
              WHERE s.project_id = p.id AND s.stage = 'demand'
            )
            """
        )
    ).mappings()
    now = datetime.now(UTC)
    rows = [
        {
            "id": str(uuid.uuid4()),
            "organization_id": row["organization_id"],
            "project_id": row["project_id"],
            "stage": "demand",
            "status": "not_started",
            "created_at": now,
            "updated_at": now,
            "revision": 1,
        }
        for row in projects
    ]
    if rows:
        op.bulk_insert(
            sa.table(
                "project_stages",
                sa.column("id", sa.String),
                sa.column("organization_id", sa.String),
                sa.column("project_id", sa.String),
                sa.column("stage", sa.String),
                sa.column("status", sa.String),
                sa.column("created_at", sa.DateTime(timezone=True)),
                sa.column("updated_at", sa.DateTime(timezone=True)),
                sa.column("revision", sa.Integer),
            ),
            rows,
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM project_stages WHERE stage = 'demand'"))
