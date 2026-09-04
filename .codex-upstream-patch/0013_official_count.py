"""store the official source job total separately from crawl coverage"""

from alembic import op
import sqlalchemy as sa


revision = "0013_official_count"
down_revision = "0012_feed_revision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("crawl_runs", sa.Column("official_count", sa.Integer(), nullable=True))
    op.add_column("crawl_runs", sa.Column("official_count_status", sa.String(length=32), nullable=True))
    op.add_column("crawl_runs", sa.Column("official_count_source", sa.String(length=128), nullable=True))
    op.add_column("crawl_runs", sa.Column("official_count_observed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_crawl_runs_official_count", "crawl_runs", ["official_count"])

    # Preserve useful counts from the old schema. A legacy expected count is
    # already a source-reported/canonical count and is safe to expose as the
    # official number; runs with no such value are backfilled only when their
    # execution did not report an unverified boundary. Amazon's old 10,000
    # ceiling is deliberately left unavailable for a later partitioned crawl.
    op.execute(
        """
        UPDATE crawl_runs
        SET official_count = expected_count,
            official_count_status = 'legacy_expected',
            official_count_source = connector_type,
            official_count_observed_at = COALESCE(completed_at, started_at)
        WHERE status IN ('success', 'partial')
          AND expected_count IS NOT NULL
          AND expected_count NOT IN (9999, 99999)
        """
    )
    op.execute(
        """
        UPDATE crawl_runs
        SET official_count = discovered_count,
            official_count_status = 'complete_official_list',
            official_count_source = connector_type,
            official_count_observed_at = COALESCE(completed_at, started_at)
        WHERE official_count IS NULL
          AND status IN ('success', 'partial')
          AND discovered_count > 0
          AND connector_type <> 'amazon'
          AND COALESCE(error, '') NOT ILIKE '%coverage not verified%'
          AND COALESCE(error, '') NOT ILIKE '%incomplete source coverage%'
          AND COALESCE(error, '') NOT ILIKE '%source marked incomplete%'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_crawl_runs_official_count", table_name="crawl_runs")
    op.drop_column("crawl_runs", "official_count_observed_at")
    op.drop_column("crawl_runs", "official_count_source")
    op.drop_column("crawl_runs", "official_count_status")
    op.drop_column("crawl_runs", "official_count")
