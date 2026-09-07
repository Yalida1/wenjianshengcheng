"""Complete document-chain domain model and immutable source locks.

Revision ID: 20260906_0003
Revises: 20260906_0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from backend.app.db import Base

revision: str = "20260906_0003"
down_revision: str | None = "20260906_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_TABLES = (
    "user_sessions",
    "parsed_documents",
    "parsed_tables",
    "field_conflicts",
    "field_snapshots",
    "document_format_profiles",
    "generation_events",
    "document_comments",
    "comparison_runs",
    "comparison_items",
    "export_artifacts",
)


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Create newly introduced tables using the authoritative SQLAlchemy metadata.
    # The initial migration also uses this metadata, so this remains safe for both
    # an empty database and an existing revision-0002 database.
    Base.metadata.create_all(op.get_bind())

    template_columns = _columns("template_versions")
    if "sha256" not in template_columns:
        op.add_column("template_versions", sa.Column("sha256", sa.String(length=64), nullable=True))
        op.create_index("ix_template_versions_sha256", "template_versions", ["sha256"])

    generation_columns = _columns("generation_jobs")
    additions = {
        "source_kind": sa.Column("source_kind", sa.String(length=40), nullable=True),
        "source_version_id": sa.Column("source_version_id", sa.String(length=36), nullable=True),
        "template_sha256": sa.Column("template_sha256", sa.String(length=64), nullable=True),
    }
    for name, column in additions.items():
        if name not in generation_columns:
            op.add_column("generation_jobs", column)


def downgrade() -> None:
    generation_columns = _columns("generation_jobs")
    with op.batch_alter_table("generation_jobs") as batch:
        for name in ("template_sha256", "source_version_id", "source_kind"):
            if name in generation_columns:
                batch.drop_column(name)
    template_columns = _columns("template_versions")
    if "sha256" in template_columns:
        indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes("template_versions")}
        if "ix_template_versions_sha256" in indexes:
            op.drop_index("ix_template_versions_sha256", table_name="template_versions")
        with op.batch_alter_table("template_versions") as batch:
            batch.drop_column("sha256")
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in reversed(NEW_TABLES):
        if table in existing:
            op.drop_table(table)
