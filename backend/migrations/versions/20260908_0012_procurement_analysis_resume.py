"""Add resumable checkpoints for procurement analysis.

Revision ID: 20260908_0012
Revises: 20260908_0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260908_0012"
down_revision: str | None = "20260908_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "procurement_analysis_checkpoints" in inspector.get_table_names():
        return
    op.create_table(
        "procurement_analysis_checkpoints",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("phase", sa.String(length=30), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("input_sha256", sa.String(length=64), nullable=False),
        sa.Column("first_sequence", sa.Integer(), nullable=True),
        sa.Column("last_sequence", sa.Integer(), nullable=True),
        sa.Column("block_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("result_sha256", sa.String(length=64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"], ["procurement_analysis_runs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "phase", "chunk_index"),
    )
    op.create_index(
        "ix_procurement_analysis_checkpoints_run_id",
        "procurement_analysis_checkpoints",
        ["run_id"],
    )
    op.create_index(
        "ix_procurement_analysis_checkpoints_organization_id",
        "procurement_analysis_checkpoints",
        ["organization_id"],
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "procurement_analysis_checkpoints" in inspector.get_table_names():
        op.drop_table("procurement_analysis_checkpoints")
