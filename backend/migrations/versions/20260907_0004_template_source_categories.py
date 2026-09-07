"""Add authoritative template source categories and provenance metadata.

Revision ID: 20260907_0004
Revises: 20260906_0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0004"
down_revision: str | None = "20260906_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _columns("templates")
    additions = {
        "issuing_authority": sa.Column("issuing_authority", sa.String(length=300), nullable=True),
        "document_number": sa.Column("document_number", sa.String(length=120), nullable=True),
        "publish_year": sa.Column("publish_year", sa.Integer(), nullable=True),
        "source_url": sa.Column("source_url", sa.String(length=1000), nullable=True),
        "applicability": sa.Column("applicability", sa.Text(), nullable=True),
        "is_builtin": sa.Column(
            "is_builtin", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        "generation_enabled": sa.Column(
            "generation_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("templates", column)

    op.execute(
        sa.text(
            "UPDATE templates SET source_kind = 'platform_reference_template' "
            "WHERE source_kind = 'demo_general'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE templates SET source_kind = 'other_official_template' "
            "WHERE source_kind = 'customer_template'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE templates SET source_kind = 'demo_general' "
            "WHERE source_kind = 'platform_reference_template'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE templates SET source_kind = 'customer_template' "
            "WHERE source_kind IN ("
            "'national_official_text', 'adapted_from_official_outline', "
            "'other_official_template')"
        )
    )
    columns = _columns("templates")
    with op.batch_alter_table("templates") as batch:
        for name in (
            "generation_enabled",
            "is_builtin",
            "applicability",
            "source_url",
            "publish_year",
            "document_number",
            "issuing_authority",
        ):
            if name in columns:
                batch.drop_column(name)
