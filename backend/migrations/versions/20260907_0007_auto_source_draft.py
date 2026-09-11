"""Add automatic source-to-draft tracking to uploaded files.

Revision ID: 20260907_0007
Revises: 20260907_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0007"
down_revision: str | None = "20260907_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {item["name"] for item in inspector.get_columns(table)}


def _has_foreign_key(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return any(item["name"] == name for item in inspector.get_foreign_keys(table))


def upgrade() -> None:
    add_auto_generate = not _has_column("files", "auto_generate_draft")
    add_job_id = not _has_column("files", "auto_generation_job_id")
    add_job_fk = not _has_foreign_key("files", "fk_files_auto_generation_job_id")
    add_error = not _has_column("files", "auto_generation_error")
    with op.batch_alter_table("files") as batch_op:
        if add_auto_generate:
            batch_op.add_column(
                sa.Column(
                    "auto_generate_draft",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
        if add_job_id:
            batch_op.add_column(sa.Column("auto_generation_job_id", sa.String(length=36), nullable=True))
        if add_job_fk:
            batch_op.create_foreign_key(
                "fk_files_auto_generation_job_id",
                "generation_jobs",
                ["auto_generation_job_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if add_error:
            batch_op.add_column(sa.Column("auto_generation_error", sa.Text(), nullable=True))


def downgrade() -> None:
    drop_error = _has_column("files", "auto_generation_error")
    drop_job_fk = _has_foreign_key("files", "fk_files_auto_generation_job_id")
    drop_job_id = _has_column("files", "auto_generation_job_id")
    drop_auto_generate = _has_column("files", "auto_generate_draft")
    with op.batch_alter_table("files") as batch_op:
        if drop_error:
            batch_op.drop_column("auto_generation_error")
        if drop_job_fk:
            batch_op.drop_constraint("fk_files_auto_generation_job_id", type_="foreignkey")
        if drop_job_id:
            batch_op.drop_column("auto_generation_job_id")
        if drop_auto_generate:
            batch_op.drop_column("auto_generate_draft")
