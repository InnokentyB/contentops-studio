const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

// NEVER fall back to DATABASE_URL to prevent corrupting development/production databases.
// TDPD_TEST_DATABASE_URL, TDPD_TEST_USER_ID, and TDPD_TEST_OTHER_USER_ID must be set explicitly for DB-backed tests.

const testsDirectory = path.join(process.cwd(), 'tests', 'tdpd');
const testFiles = readdirSync(testsDirectory)
    .filter((name) => name.endsWith('.e2e.test.js'))
    .sort()
    .map((name) => path.join('tests', 'tdpd', name));

if (testFiles.length === 0) {
    console.error('[TDPD] No acceptance test files were found.');
    process.exit(1);
}

if (process.env.TDPD_REQUIRE_DATABASE === '1' && !process.env.TDPD_TEST_DATABASE_URL) {
    console.error('[TDPD] TDPD_TEST_DATABASE_URL is required for a DB-backed acceptance run.');
    process.exit(1);
}

console.log(`[TDPD] Running ${testFiles.length} acceptance suites.`);

// DB-backed suites share one isolated database. Run them sequentially so one
// suite's interactive transactions cannot be starved by eight parallel MCP servers.
const result = spawnSync('node', ['--test', '--test-concurrency=1', ...testFiles], {
    stdio: 'inherit',
    env: process.env
});

process.exit(result.status ?? 0);
