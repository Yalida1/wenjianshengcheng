"""Add organization-scoped project code allocation rules.

Revision ID: 20260911_0017
Revises: 20260911_0016
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0017"
down_revision: str | None = "20260911_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_PATTERN = "{project_type}_{date}_{seq}"
DEFAULT_DATE_FORMAT = "YYYYMMDD"
DEFAULT_SEQ_WIDTH = 4
DEFAULT_RESET_SCOPE = "type_day"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "project_code_rules" not in inspector.get_table_names():
        op.create_table(
            "project_code_rules",
            sa.Column("pattern", sa.String(length=120), nullable=False),
            sa.Column("date_format", sa.String(length=20), nullable=False),
            sa.Column("seq_width", sa.Integer(), nullable=False),
            sa.Column("reset_scope", sa.String(length=30), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(length=36), nullable=True),
            sa.Column("updated_by", sa.String(length=36), nullable=True),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("organization_id"),
        )
        op.create_index(
            op.f("ix_project_code_rules_organization_id"),
            "project_code_rules",
            ["organization_id"],
            unique=False,
        )

    connection = op.get_bind()
    now = datetime.now(UTC)
    organizations = connection.execute(sa.text("SELECT id FROM organizations")).fetchall()
    existing = {
        row[0]
        for row in connection.execute(
            sa.text("SELECT organization_id FROM project_code_rules")
        ).fetchall()
    }
    for (organization_id,) in organizations:
        if organization_id in existing:
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO project_code_rules (
                    id, organization_id, pattern, date_format, seq_width, reset_scope,
                    created_at, updated_at, created_by, updated_by, revision
                ) VALUES (
                    :id, :organization_id, :pattern, :date_format, :seq_width, :reset_scope,
                    :created_at, :updated_at, NULL, NULL, 1
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "organization_id": organization_id,
                "pattern": DEFAULT_PATTERN,
                "date_format": DEFAULT_DATE_FORMAT,
                "seq_width": DEFAULT_SEQ_WIDTH,
                "reset_scope": DEFAULT_RESET_SCOPE,
                "created_at": now,
                "updated_at": now,
            },
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "project_code_rules" in inspector.get_table_names():
        op.drop_index(op.f("ix_project_code_rules_organization_id"), table_name="project_code_rules")
        op.drop_table("project_code_rules")
