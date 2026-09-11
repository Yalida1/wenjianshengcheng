"""Add evidence-based procurement planning and one-to-many tender generation.

Revision ID: 20260908_0009
Revises: 20260907_0008

Rollback removes only the additive procurement-planning tables and nullable
links. Existing projects, uploaded files, generated documents and exports are
left untouched by upgrade and remain compatible when the feature is disabled.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from backend.app import models  # noqa: F401
from backend.app.db import Base

revision: str = "20260908_0009"
down_revision: str | None = "20260907_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    Base.metadata.create_all(op.get_bind())

    generation_columns = _columns("generation_jobs")
    generation_additions = {
        "procurement_plan_id": sa.Column(
            "procurement_plan_id", sa.String(length=36), nullable=True
        ),
        "procurement_document_group_id": sa.Column(
            "procurement_document_group_id", sa.String(length=36), nullable=True
        ),
        "procurement_batch_id": sa.Column(
            "procurement_batch_id", sa.String(length=36), nullable=True
        ),
        "procurement_snapshot": sa.Column("procurement_snapshot", sa.JSON(), nullable=True),
    }
    with op.batch_alter_table("generation_jobs") as batch:
        for name, column in generation_additions.items():
            if name not in generation_columns:
                batch.add_column(column)
        if "procurement_plan_id" not in generation_columns:
            batch.create_foreign_key(
                "fk_generation_jobs_procurement_plan_id",
                "procurement_plans",
                ["procurement_plan_id"],
                ["id"],
            )
        if "procurement_document_group_id" not in generation_columns:
            batch.create_foreign_key(
                "fk_generation_jobs_procurement_document_group_id",
                "tender_document_groups",
                ["procurement_document_group_id"],
                ["id"],
            )
        if "procurement_batch_id" not in generation_columns:
            batch.create_foreign_key(
                "fk_generation_jobs_procurement_batch_id",
                "procurement_generation_batches",
                ["procurement_batch_id"],
                ["id"],
            )

    document_columns = _columns("documents")
    document_additions = {
        "procurement_plan_id": sa.Column(
            "procurement_plan_id", sa.String(length=36), nullable=True
        ),
        "procurement_document_group_id": sa.Column(
            "procurement_document_group_id", sa.String(length=36), nullable=True
        ),
        "procurement_package_ids": sa.Column(
            "procurement_package_ids", sa.JSON(), nullable=False, server_default="[]"
        ),
    }
    with op.batch_alter_table("documents") as batch:
        for name, column in document_additions.items():
            if name not in document_columns:
                batch.add_column(column)
        if "procurement_plan_id" not in document_columns:
            batch.create_foreign_key(
                "fk_documents_procurement_plan_id",
                "procurement_plans",
                ["procurement_plan_id"],
                ["id"],
            )
        if "procurement_document_group_id" not in document_columns:
            batch.create_foreign_key(
                "fk_documents_procurement_document_group_id",
                "tender_document_groups",
                ["procurement_document_group_id"],
                ["id"],
            )


def downgrade() -> None:
    document_columns = _columns("documents")
    with op.batch_alter_table("documents") as batch:
        for name in (
            "procurement_package_ids",
            "procurement_document_group_id",
            "procurement_plan_id",
        ):
            if name in document_columns:
                batch.drop_column(name)

    generation_columns = _columns("generation_jobs")
    with op.batch_alter_table("generation_jobs") as batch:
        for name in (
            "procurement_snapshot",
            "procurement_batch_id",
            "procurement_document_group_id",
            "procurement_plan_id",
        ):
            if name in generation_columns:
                batch.drop_column(name)

    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in (
        "procurement_generation_batches",
        "procurement_confirmations",
        "procurement_issues",
        "procurement_evidence",
        "tender_document_group_packages",
        "tender_document_groups",
        "procurement_budget_allocations",
        "procurement_budget_items",
        "procurement_package_contents",
        "procurement_packages",
        "procurement_content_items",
        "procurement_rule_sets",
        "procurement_plans",
        "procurement_analysis_runs",
    ):
        if table in existing:
            op.drop_table(table)
