const { spawnSync } = require('child_process');

process.env.TDPD_TEST_DATABASE_URL = process.env.TDPD_TEST_DATABASE_URL || process.env.DATABASE_URL || '';
process.env.TDPD_TEST_USER_ID = process.env.TDPD_TEST_USER_ID || '1';
process.env.TDPD_TEST_OTHER_USER_ID = process.env.TDPD_TEST_OTHER_USER_ID || '2';

const result = spawnSync('node', ['--test', 'tests/tdpd/work-queue-mcp.e2e.test.js'], {
    stdio: 'inherit',
    env: process.env
});

process.exit(result.status ?? 0);
