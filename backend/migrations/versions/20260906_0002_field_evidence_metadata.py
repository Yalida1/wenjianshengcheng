"""Add structured source mapping metadata to field evidence.

Revision ID: 20260906_0002
Revises: 20260906_0001
Create Date: 2026-09-06
"""

import sqlalchemy as sa
from alembic import op

revision = "20260906_0002"
down_revision = "20260906_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("field_evidence")}
    if "metadata_json" not in columns:
        op.add_column(
            "field_evidence",
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("field_evidence")}
    if "metadata_json" in columns:
        op.drop_column("field_evidence", "metadata_json")
