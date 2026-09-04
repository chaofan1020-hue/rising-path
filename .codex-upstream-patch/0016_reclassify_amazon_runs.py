"""reclassify Amazon runs created before the provider-cap detector was deployed"""

from alembic import op


revision = "0016_reclassify_amazon_runs"
down_revision = "0015_fix_amazon_legacy_cap"
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
            official_count_observed_at = COALESCE(runs.completed_at, runs.started_at)
        FROM companies AS companies
        WHERE runs.company_id = companies.id
          AND lower(companies.name) = 'amazon'
          AND runs.expected_count = 10000
          AND runs.discovered_count >= 10000
          AND runs.status IN ('success', 'partial')
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE crawl_runs AS runs
        SET official_count = 10000,
            official_count_status = 'legacy_expected',
            official_count_source = 'amazon',
            official_count_lower_bound = NULL
        FROM companies AS companies
        WHERE runs.company_id = companies.id
          AND lower(companies.name) = 'amazon'
          AND runs.official_count_status = 'capped_unavailable'
        """
    )
