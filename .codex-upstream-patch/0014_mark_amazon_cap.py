"""do not expose Amazon's legacy 10,000-result provider ceiling as exact"""

from alembic import op
import sqlalchemy as sa


revision = "0014_mark_amazon_cap"
down_revision = "0013_official_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("crawl_runs", sa.Column("official_count_lower_bound", sa.Integer(), nullable=True))
    op.create_index("ix_crawl_runs_official_count_lower_bound", "crawl_runs", ["official_count_lower_bound"])
    op.execute(
        """
        UPDATE crawl_runs
        SET official_count = NULL,
            official_count_status = 'capped_unavailable',
            official_count_source = 'amazon',
            official_count_lower_bound = 10000,
            official_count_observed_at = COALESCE(completed_at, started_at)
        WHERE connector_type = 'amazon'
          AND official_count = 10000
          AND status IN ('success', 'partial')
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE crawl_runs
        SET official_count = 10000,
            official_count_status = 'legacy_expected',
            official_count_lower_bound = NULL
        WHERE connector_type = 'amazon'
          AND official_count_status = 'capped_unavailable'
        """
    )
    op.drop_index("ix_crawl_runs_official_count_lower_bound", table_name="crawl_runs")
    op.drop_column("crawl_runs", "official_count_lower_bound")
