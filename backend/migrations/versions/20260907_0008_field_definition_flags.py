"""Add is_base and is_active to field_definitions.

Revision ID: 20260907_0008
Revises: 20260907_0007
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0008"
down_revision: str | None = "20260907_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {item["name"] for item in inspector.get_columns(table)}


def upgrade() -> None:
    add_is_base = not _has_column("field_definitions", "is_base")
    add_is_active = not _has_column("field_definitions", "is_active")
    with op.batch_alter_table("field_definitions") as batch_op:
        if add_is_base:
            batch_op.add_column(
                sa.Column(
                    "is_base",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
        if add_is_active:
            batch_op.add_column(
                sa.Column(
                    "is_active",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                )
            )


def downgrade() -> None:
    drop_is_active = _has_column("field_definitions", "is_active")
    drop_is_base = _has_column("field_definitions", "is_base")
    with op.batch_alter_table("field_definitions") as batch_op:
        if drop_is_active:
            batch_op.drop_column("is_active")
        if drop_is_base:
            batch_op.drop_column("is_base")
