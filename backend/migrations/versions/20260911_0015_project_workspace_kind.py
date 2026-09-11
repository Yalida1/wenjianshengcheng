"""Add project workspace_kind for managed vs adhoc tender workspaces.

Revision ID: 20260911_0015
Revises: 20260911_0014
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0015"
down_revision: str | None = "20260911_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("projects")}
    if "workspace_kind" not in columns:
        op.add_column(
            "projects",
            sa.Column("workspace_kind", sa.String(length=30), nullable=False, server_default="managed"),
        )
        op.create_index(op.f("ix_projects_workspace_kind"), "projects", ["workspace_kind"], unique=False)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("projects")}
    if "workspace_kind" in columns:
        op.drop_index(op.f("ix_projects_workspace_kind"), table_name="projects")
        op.drop_column("projects", "workspace_kind")
