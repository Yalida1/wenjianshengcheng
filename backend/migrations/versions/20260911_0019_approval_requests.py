"""Add approval_requests for project deletion workflow.

Revision ID: 20260911_0019
Revises: 20260911_0018
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0019"
down_revision: str | None = "20260911_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "approval_requests",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False, index=True),
        sa.Column("request_type", sa.String(length=80), nullable=False, index=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending", index=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("target_type", sa.String(length=80), nullable=False, index=True),
        sa.Column("target_id", sa.String(length=36), nullable=False, index=True),
        sa.Column("target_code", sa.String(length=80), nullable=True),
        sa.Column("target_name", sa.String(length=300), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("requester_id", sa.String(length=36), nullable=False, index=True),
        sa.Column("reviewer_id", sa.String(length=36), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
    )


def downgrade() -> None:
    op.drop_table("approval_requests")
