"""Add parent_id and level for template/document section trees.

Revision ID: 20260907_0006
Revises: 20260907_0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0006"
down_revision: str | None = "20260907_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {col["name"] for col in inspector.get_columns(table)}


def _has_unique(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return any(constraint["name"] == name for constraint in inspector.get_unique_constraints(table))


def upgrade() -> None:
    if not _has_column("template_sections", "parent_id"):
        op.add_column(
            "template_sections",
            sa.Column("parent_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_template_sections_parent_id",
            "template_sections",
            "template_sections",
            ["parent_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if not _has_column("template_sections", "level"):
        op.add_column(
            "template_sections",
            sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        )
        op.execute(sa.text("UPDATE template_sections SET level = 1 WHERE level IS NULL"))
    if not _has_unique("template_sections", "uq_template_sections_version_key"):
        op.create_unique_constraint(
            "uq_template_sections_version_key",
            "template_sections",
            ["template_version_id", "key"],
        )

    if not _has_column("document_sections", "parent_id"):
        op.add_column(
            "document_sections",
            sa.Column("parent_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_document_sections_parent_id",
            "document_sections",
            "document_sections",
            ["parent_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if not _has_column("document_sections", "level"):
        op.add_column(
            "document_sections",
            sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        )
        op.execute(sa.text("UPDATE document_sections SET level = 1 WHERE level IS NULL"))
    if not _has_unique("document_sections", "uq_document_sections_version_key"):
        op.create_unique_constraint(
            "uq_document_sections_version_key",
            "document_sections",
            ["document_version_id", "key"],
        )


def downgrade() -> None:
    if _has_unique("document_sections", "uq_document_sections_version_key"):
        op.drop_constraint(
            "uq_document_sections_version_key",
            "document_sections",
            type_="unique",
        )
    if _has_column("document_sections", "parent_id"):
        op.drop_constraint(
            "fk_document_sections_parent_id",
            "document_sections",
            type_="foreignkey",
        )
        op.drop_column("document_sections", "parent_id")
    if _has_column("document_sections", "level"):
        op.drop_column("document_sections", "level")

    if _has_unique("template_sections", "uq_template_sections_version_key"):
        op.drop_constraint(
            "uq_template_sections_version_key",
            "template_sections",
            type_="unique",
        )
    if _has_column("template_sections", "parent_id"):
        op.drop_constraint(
            "fk_template_sections_parent_id",
            "template_sections",
            type_="foreignkey",
        )
        op.drop_column("template_sections", "parent_id")
    if _has_column("template_sections", "level"):
        op.drop_column("template_sections", "level")
