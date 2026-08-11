const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const SERVER_PATH = path.join(process.cwd(), 'dist', 'mcp', 'server.js');
const TEST_DATABASE_URL = process.env.TDPD_TEST_DATABASE_URL || '';
const TEST_USER_ID = Number(process.env.TDPD_TEST_USER_ID || 1);
const ACTOR_ID = `user:${TEST_USER_ID}`;

const pool = TEST_DATABASE_URL ? new Pool({ connectionString: TEST_DATABASE_URL }) : null;
const adapter = pool ? new PrismaPg(pool) : null;
const prisma = adapter ? new PrismaClient({ adapter }) : null;

let client;
let transport;
let toolNames = new Set();

function idempotencyKey(label) {
  return `tdpd-t-${label}-${randomUUID()}`;
}

function requireTools(...names) {
  for (const name of names) {
    assert.ok(
      toolNames.has(name),
      `[TDPD RED-T] ${name} is required by 002-task-tracker-decision-ru.md but is not registered by the MCP server`,
    );
  }
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to execute DB-backed Suite T scenarios');
    return false;
  }
  return true;
}

function resultPayload(result) {
  if (result?.isError) {
    const message = (result.content || [])
      .filter((item) => item?.type === 'text')
      .map((item) => item.text)
      .join('\n');
    assert.fail(`MCP tool returned an error: ${message || 'unknown error'}`);
  }
  return result?.structuredContent || {};
}

async function callTool(name, args) {
  return resultPayload(await client.callTool({ name, arguments: args }));
}

test.before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  client = new Client({ name: 'tdpd-t-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const toolsRes = await client.listTools();
  toolNames = new Set((toolsRes.tools || []).map((t) => t.name));
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('E2E-T01 / SC-T01: one projection maps to exactly one external task card without duplicate projections', async (t) => {
  requireTools('ba_sync_task_tracker');
  if (!requireDatabase(t)) return;

  const sync1 = await callTool('ba_sync_task_tracker', {
    projectId: 1,
    actorId: ACTOR_ID,
    workItemId: 1,
    idempotencyKey: idempotencyKey('sync-t01-1'),
  });

  const sync2 = await callTool('ba_sync_task_tracker', {
    projectId: 1,
    actorId: ACTOR_ID,
    workItemId: 1,
    idempotencyKey: idempotencyKey('sync-t01-2'),
  });

  assert.ok(sync1.tracker_item_id);
  assert.equal(sync1.tracker_item_id, sync2.tracker_item_id, 'Second sync must return the exact same tracker card ID');
});

test('E2E-T02 / SC-T02: command retry with identical idempotency key does not create duplicate outbox entries or cards', async (t) => {
  requireTools('ba_sync_task_tracker', 'ba_process_outbox');
  if (!requireDatabase(t)) return;

  const sharedKey = idempotencyKey('retry-t02');
  const res1 = await callTool('ba_sync_task_tracker', {
    projectId: 1,
    actorId: ACTOR_ID,
    workItemId: 1,
    idempotencyKey: sharedKey,
  });

  const res2 = await callTool('ba_sync_task_tracker', {
    projectId: 1,
    actorId: ACTOR_ID,
    workItemId: 1,
    idempotencyKey: sharedKey,
  });

  assert.deepEqual(res1, res2, 'Retried sync command payload must match cached idempotent result');
});

test('E2E-T03 / SC-T03: Plane API unavailability preserves domain transaction and stores pending outbox item', async (t) => {
  requireTools('ba_process_outbox');
  if (!requireDatabase(t)) return;

  // Domain operation must succeed even if Plane mock returns error/unreachable
  const outboxRes = await callTool('ba_process_outbox', {
    projectId: 1,
    actorId: ACTOR_ID,
    simulateUnreachable: true,
  });

  assert.equal(outboxRes.failed_deliveries_stored_in_outbox, true);
  assert.ok(outboxRes.pending_outbox_count > 0, 'Outbox must keep failed deliveries in pending state for retry');
});

test('E2E-T04 / SC-T04: incoming webhook payload is validated and deduplicated in webhook inbox', async (t) => {
  requireTools('ba_receive_webhook');
  if (!requireDatabase(t)) return;

  const eventId = `wh-evt-${randomUUID()}`;
  const payload = {
    event_id: eventId,
    action: 'issue.updated',
    issue_id: 'plane-issue-123',
    state: 'In Progress',
  };

  const rec1 = await callTool('ba_receive_webhook', {
    projectId: 1,
    actorId: ACTOR_ID,
    payload,
  });

  const rec2 = await callTool('ba_receive_webhook', {
    projectId: 1,
    actorId: ACTOR_ID,
    payload,
  });

  assert.equal(rec1.status, 'processed');
  assert.equal(rec2.status, 'duplicate', 'Duplicate webhook payload must be safely marked as duplicate');
});

test('E2E-T05 / SC-T05: reconciliation job detects and repairs state drift between Planner and Plane', async (t) => {
  requireTools('ba_reconcile_task_tracker');
  if (!requireDatabase(t)) return;

  const recon = await callTool('ba_reconcile_task_tracker', {
    projectId: 1,
    actorId: ACTOR_ID,
    autoRepair: true,
  });

  assert.ok(Array.isArray(recon.reconciled_items));
  assert.equal(recon.drift_count_before, recon.repaired_count, 'All detected state drifts must be repaired');
});

test('E2E-T06 / SC-T06: stale outbox payload with lower sync_version than last_synced_version is rejected', async (t) => {
  requireTools('ba_process_outbox');
  if (!requireDatabase(t)) return;

  const res = await client.callTool({
    name: 'ba_process_outbox',
    arguments: {
      projectId: 1,
      actorId: ACTOR_ID,
      staleOutboxItem: {
        workItemId: 1,
        syncVersion: 1,
        lastSyncedVersion: 2,
      },
    },
  });

  assert.equal(res.isError, true, 'Stale outbox payload must be rejected');
  const text = (res.content || []).map((i) => i.text || '').join('\n');
  assert.match(text, /STALE_SYNC_VERSION/);
});
