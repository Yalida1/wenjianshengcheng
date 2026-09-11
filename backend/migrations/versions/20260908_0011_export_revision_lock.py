"""Lock export jobs to an exact editable document revision.

Revision ID: 20260908_0011
Revises: 20260908_0010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260908_0011"
down_revision: str | None = "20260908_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    if "document_revision" not in _columns("export_jobs"):
        with op.batch_alter_table("export_jobs") as batch:
            batch.add_column(sa.Column("document_revision", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    if "document_revision" in _columns("export_jobs"):
        with op.batch_alter_table("export_jobs") as batch:
            batch.drop_column("document_revision")
