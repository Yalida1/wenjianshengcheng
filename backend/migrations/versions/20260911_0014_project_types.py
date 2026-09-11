"""Add organization-scoped project type catalog.

Revision ID: 20260911_0014
Revises: 20260910_0013
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0014"
down_revision: str | None = "20260910_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_TYPES = (
    ("government_investment", "政府投资项目", 10),
    ("enterprise_investment", "企业投资项目", 20),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "project_types" not in inspector.get_table_names():
        op.create_table(
            "project_types",
            sa.Column("code", sa.String(length=80), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("is_system", sa.Boolean(), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(length=36), nullable=True),
            sa.Column("updated_by", sa.String(length=36), nullable=True),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("organization_id", "code"),
        )
        op.create_index(
            op.f("ix_project_types_organization_id"),
            "project_types",
            ["organization_id"],
            unique=False,
        )

    connection = op.get_bind()
    organizations = connection.execute(sa.text("SELECT id FROM organizations")).fetchall()
    for (organization_id,) in organizations:
        for code, name, sort_order in DEFAULT_TYPES:
            exists = connection.execute(
                sa.text(
                    "SELECT id FROM project_types "
                    "WHERE organization_id = :organization_id AND code = :code"
                ),
                {"organization_id": organization_id, "code": code},
            ).fetchone()
            if exists:
                continue
            connection.execute(
                sa.text(
                    """
                    INSERT INTO project_types (
                        id, organization_id, code, name, description, sort_order,
                        is_active, is_system, created_at, updated_at, created_by, updated_by, revision
                    ) VALUES (
                        :id, :organization_id, :code, :name, NULL, :sort_order,
                        1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, 1
                    )
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "organization_id": organization_id,
                    "code": code,
                    "name": name,
                    "sort_order": sort_order,
                },
            )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "project_types" in inspector.get_table_names():
        op.drop_index(op.f("ix_project_types_organization_id"), table_name="project_types")
        op.drop_table("project_types")
