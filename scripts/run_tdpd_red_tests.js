const { spawnSync } = require('child_process');

// NEVER fall back to DATABASE_URL to prevent corrupting development/production databases.
// TDPD_TEST_DATABASE_URL, TDPD_TEST_USER_ID, and TDPD_TEST_OTHER_USER_ID must be set explicitly for DB-backed tests.

const result = spawnSync('node', ['--test', 'tests/tdpd/work-queue-mcp.e2e.test.js'], {
    stdio: 'inherit',
    env: process.env
});

process.exit(result.status ?? 0);
