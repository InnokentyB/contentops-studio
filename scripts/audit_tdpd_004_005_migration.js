const { Client } = require('pg');

const connectionString = process.env.TDPD_AUDIT_DATABASE_URL || '';
if (!connectionString) {
  console.error('TDPD_AUDIT_DATABASE_URL is required. No DATABASE_URL fallback is allowed.');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const duplicateCycles = await client.query(`
      SELECT project_id, week_start, week_end, array_agg(id ORDER BY id) AS package_ids
      FROM planner.week_packages
      GROUP BY project_id, week_start, week_end
      HAVING count(*) > 1
      ORDER BY project_id, week_start
    `);
    const candidates = await client.query(`
      SELECT
        count(*) FILTER (WHERE status = 'published' AND nullif(published_link, '') IS NOT NULL) AS published_with_link,
        count(*) FILTER (WHERE status = 'published' AND nullif(published_link, '') IS NULL) AS missing_identity,
        count(*) FILTER (
          WHERE coalesce(metrics->>'publication_outcome', '') <> ''
            AND coalesce(quality_report->>'publication_outcome', '') <> ''
            AND metrics->>'publication_outcome' <> quality_report->>'publication_outcome'
        ) AS outcome_conflicts,
        count(*) FILTER (WHERE status = 'published' AND channel_id IS NULL) AS missing_channel
      FROM planner.content_items
    `);
    const existingFacts = await client.query(`
      SELECT confirmed_by, count(*)::int AS count
      FROM planner.publication_facts
      GROUP BY confirmed_by
      ORDER BY confirmed_by
    `).catch(() => ({ rows: [] }));
    console.log(JSON.stringify({
      duplicate_week_cycles: duplicateCycles.rows,
      publication_candidates: candidates.rows[0],
      existing_facts_by_actor: existingFacts.rows,
      safe_to_add_week_unique_index: duplicateCycles.rowCount === 0
    }, null, 2));
    if (duplicateCycles.rowCount) process.exitCode = 2;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
