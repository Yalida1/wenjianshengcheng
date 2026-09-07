"""Add reviewable template extraction jobs.

Revision ID: 20260907_0005
Revises: 20260907_0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0005"
down_revision: str | None = "20260907_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "template_extraction_jobs" in inspector.get_table_names():
        return
    op.create_table(
        "template_extraction_jobs",
        sa.Column("file_version_id", sa.String(length=36), nullable=False),
        sa.Column("stage", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("task_id", sa.String(length=80), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("provider_name", sa.String(length=80), nullable=True),
        sa.Column("model_name", sa.String(length=120), nullable=True),
        sa.Column("prompt_version", sa.String(length=80), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("confirmed_template_id", sa.String(length=36), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["confirmed_template_id"], ["templates.id"]),
        sa.ForeignKeyConstraint(["file_version_id"], ["file_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_template_extraction_jobs_file_version_id"),
        "template_extraction_jobs",
        ["file_version_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_template_extraction_jobs_organization_id"),
        "template_extraction_jobs",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_template_extraction_jobs_stage"),
        "template_extraction_jobs",
        ["stage"],
        unique=False,
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "template_extraction_jobs" in inspector.get_table_names():
        op.drop_index(
            op.f("ix_template_extraction_jobs_stage"),
            table_name="template_extraction_jobs",
        )
        op.drop_index(
            op.f("ix_template_extraction_jobs_organization_id"),
            table_name="template_extraction_jobs",
        )
        op.drop_index(
            op.f("ix_template_extraction_jobs_file_version_id"),
            table_name="template_extraction_jobs",
        )
        op.drop_table("template_extraction_jobs")
