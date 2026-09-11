"""Add explicit tender-template applicability confirmation.

Revision ID: 20260908_0010
Revises: 20260908_0009
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260908_0010"
down_revision: str | None = "20260908_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    if "template_applicability_confirmed" not in _columns("generation_jobs"):
        with op.batch_alter_table("generation_jobs") as batch:
            batch.add_column(
                sa.Column(
                    "template_applicability_confirmed",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )


def downgrade() -> None:
    if "template_applicability_confirmed" in _columns("generation_jobs"):
        with op.batch_alter_table("generation_jobs") as batch:
            batch.drop_column("template_applicability_confirmed")
