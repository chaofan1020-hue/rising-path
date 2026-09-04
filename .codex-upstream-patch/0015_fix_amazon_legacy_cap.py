"""mark the legacy Amazon crawl by its source error, not company connector"""

from alembic import op


revision = "0015_fix_amazon_legacy_cap"
down_revision = "0014_mark_amazon_cap"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE crawl_runs AS runs
        SET official_count = NULL,
            official_count_status = 'capped_unavailable',
            official_count_source = 'amazon',
            official_count_lower_bound = 10000,
            official_count_observed_at = COALESCE(completed_at, started_at)
        FROM companies AS companies
        WHERE runs.company_id = companies.id
          AND companies.name = 'Amazon'
          AND runs.expected_count = 10000
          AND runs.discovered_count = 10000
          AND runs.status IN ('success', 'partial')
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE crawl_runs AS runs
        SET official_count = 10000,
            official_count_status = 'legacy_expected',
            official_count_lower_bound = NULL
        FROM companies AS companies
        WHERE runs.company_id = companies.id
          AND companies.name = 'Amazon'
          AND runs.official_count_status = 'capped_unavailable'
        """
    )
