"""Add organization branding fields for product name and logo.

Revision ID: 20260911_0016
Revises: 20260911_0015
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0016"
down_revision: str | None = "20260911_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("brand_name", sa.Column("brand_name", sa.String(length=120), nullable=True)),
    ("brand_subtitle", sa.Column("brand_subtitle", sa.String(length=200), nullable=True)),
    ("brand_mark", sa.Column("brand_mark", sa.String(length=8), nullable=True)),
    ("brand_logo_key", sa.Column("brand_logo_key", sa.String(length=500), nullable=True)),
    (
        "brand_logo_content_type",
        sa.Column("brand_logo_content_type", sa.String(length=120), nullable=True),
    ),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {column["name"] for column in inspector.get_columns("organizations")}
    for name, column in COLUMNS:
        if name not in existing:
            op.add_column("organizations", column)
    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            UPDATE organizations
            SET brand_name = COALESCE(brand_name, '智能招标管理'),
                brand_subtitle = COALESCE(brand_subtitle, '受控生成与定稿平台'),
                brand_mark = COALESCE(brand_mark, '智')
            WHERE brand_name IS NULL
               OR brand_subtitle IS NULL
               OR brand_mark IS NULL
            """
        )
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {column["name"] for column in inspector.get_columns("organizations")}
    for name, _column in reversed(COLUMNS):
        if name in existing:
            op.drop_column("organizations", name)
