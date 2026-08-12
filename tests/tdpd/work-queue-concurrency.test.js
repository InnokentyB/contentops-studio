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
const OTHER_USER_ID = Number(process.env.TDPD_TEST_OTHER_USER_ID || 2);
const ACTOR_ID = `user:${TEST_USER_ID}`;

const pool = TEST_DATABASE_URL ? new Pool({ connectionString: TEST_DATABASE_URL }) : null;
const adapter = pool ? new PrismaPg(pool) : null;
const prisma = adapter ? new PrismaClient({ adapter }) : null;

let client;
let transport;
let fixturePromise;

function idempotencyKey(label) {
  return `tdpd-conc-${label}-${randomUUID()}`;
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to execute DB-backed concurrency scenarios');
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

function buildWeekPlan(planId) {
  return {
    meta: {
      plan_id: planId,
      plan_version: '1.0.0',
      cycle_start: '2026-08-10',
      cycle_end: '2026-08-16',
      timezone_default: 'Europe/Lisbon',
      week_theme: 'Concurrency & Security Test Plan',
      project_name: `TDPD Concurrency ${planId}`,
    },
    accounts: {
      primary_tg: { platform: 'telegram' },
    },
    assets: {
      inline_source: {
        type: 'source_context',
        content: 'Concurrency source context',
      },
    },
    actions: [
      {
        id: 'conc-post-1',
        item_key: 'conc-post-1',
        display_name: 'Material for concurrency test',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T10:00:00.000Z',
        scheduled_at: '2026-08-10T10:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'conc-post-2',
        item_key: 'conc-post-2',
        display_name: 'Material for lease test',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T12:00:00.000Z',
        scheduled_at: '2026-08-10T12:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
    ],
    ongoing_rules: [],
    measurement: {},
  };
}

async function ensureFixture() {
  if (!fixturePromise) {
    fixturePromise = (async () => {
      if (prisma && TEST_USER_ID) {
        await prisma.user.upsert({
          where: { id: TEST_USER_ID },
          update: {},
          create: {
            id: TEST_USER_ID,
            email: `testuser${TEST_USER_ID}@example.com`,
            password_hash: 'hash',
            name: 'Test User 1',
          },
        });
        if (OTHER_USER_ID) {
          await prisma.user.upsert({
            where: { id: OTHER_USER_ID },
            update: {},
            create: {
              id: OTHER_USER_ID,
              email: `testuser${OTHER_USER_ID}@example.com`,
              password_hash: 'hash',
              name: 'Test User 2',
            },
          });
        }
      }

      const planId = `tdpd-conc-${randomUUID()}`;
      const imported = await callTool('ba_import_publication_plan_json', {
        userId: TEST_USER_ID,
        planJson: JSON.stringify(buildWeekPlan(planId)),
      });

      assert.ok(imported.project?.id, 'import must return project.id');
      assert.ok(imported.week_package?.id, 'import must return week_package.id');

      await callTool('ba_decide_week_plan', {
        projectId: imported.project.id,
        actorId: ACTOR_ID,
        weekPackageId: imported.week_package.id,
        planVersion: '1.0.0',
        decision: 'approved',
        idempotencyKey: idempotencyKey('approve-plan'),
      });

      await prisma.serviceIdentityBinding.createMany({
        data: ['agent:content_writer', 'agent:content_reviewer', 'agent:plan_reviewer', 'system:planner']
          .map((actor_id) => ({ project_id: imported.project.id, actor_id })),
        skipDuplicates: true,
      });

      return {
        projectId: imported.project.id,
        weekPackageId: imported.week_package.id,
      };
    })();
  }
  return fixturePromise;
}

async function findWorkItem(projectId, predicate, filter = {}) {
  const response = await callTool('ba_list_work_items', {
    projectId,
    actorId: ACTOR_ID,
    asOf: '2026-08-09T12:00:00.000Z',
    filter,
  });
  const workItems = response.work_items || [];
  const workItem = workItems.find(predicate);
  assert.ok(workItem, `Expected work item not found in ${JSON.stringify(workItems)}`);
  return workItem;
}

test.before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  client = new Client({ name: 'tdpd-concurrency-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('CONC-001: two concurrent completions on the same lease produce exactly one success and version increment', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'conc-post-1' && w.kind === 'content_write',
    { state: 'available' },
  );

  const writerActor = 'agent:content_writer';
  const claimRes = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId: writerActor,
    workItemId: item.id,
    idempotencyKey: idempotencyKey('claim-conc-1'),
  });

  assert.ok(claimRes.lease_token);

  // Execute two concurrent completeWorkItem requests
  const req1 = client.callTool({
    name: 'ba_complete_work_item',
    arguments: {
      projectId: fixture.projectId,
      actorId: writerActor,
      workItemId: item.id,
      leaseToken: claimRes.lease_token,
      result: { body: 'Concurrent Result 1' },
      idempotencyKey: idempotencyKey('complete-req-1'),
    },
  });

  const req2 = client.callTool({
    name: 'ba_complete_work_item',
    arguments: {
      projectId: fixture.projectId,
      actorId: writerActor,
      workItemId: item.id,
      leaseToken: claimRes.lease_token,
      result: { body: 'Concurrent Result 2' },
      idempotencyKey: idempotencyKey('complete-req-2'),
    },
  });

  const [res1, res2] = await Promise.all([req1, req2]);
  const successCount = [res1, res2].filter((r) => !r.isError).length;
  const errorCount = [res1, res2].filter((r) => r.isError).length;

  assert.equal(successCount, 1, 'Exactly one concurrent completion must succeed');
  assert.equal(errorCount, 1, 'Exactly one concurrent completion must be rejected');

  // Verify DB state: result_version = 1
  const updatedItem = await prisma.workItem.findUnique({ where: { id: item.id } });
  assert.equal(updatedItem.result_version, 1, 'result_version must increment exactly once');
  assert.equal(updatedItem.state, 'completed');
});

test('SEC-001: unregistered service identity is rejected', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const res = await client.callTool({
    name: 'ba_list_work_items',
    arguments: {
      projectId: fixture.projectId,
      actorId: 'agent:unregistered_attacker',
    },
  });

  assert.equal(res.isError, true, 'Unregistered actor must be rejected');
  const text = (res.content || []).map((i) => i.text || '').join('\n');
  assert.match(text, /is not a registered service identity/);
});

test('SEC-002: foreign actor cannot complete or release lease owned by another actor', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'conc-post-2' && w.kind === 'content_write',
    { state: 'available' },
  );

  const writerActor = 'agent:content_writer';
  const reviewerActor = 'agent:plan_reviewer';

  const claimRes = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId: writerActor,
    workItemId: item.id,
    idempotencyKey: idempotencyKey('claim-sec-2'),
  });

  assert.ok(claimRes.lease_token);

  const completeRes = await client.callTool({
    name: 'ba_complete_work_item',
    arguments: {
      projectId: fixture.projectId,
      actorId: reviewerActor,
      workItemId: item.id,
      leaseToken: claimRes.lease_token,
      result: { body: 'Unauthorized text' },
      idempotencyKey: idempotencyKey('sec-foreign-complete'),
    },
  });

  assert.equal(completeRes.isError, true, 'Foreign actor must not complete another actor lease');
  const text = (completeRes.content || []).map((i) => i.text || '').join('\n');
  assert.match(text, /does not own active lease/);

  // Clean up lease
  await callTool('ba_release_work_item', {
    projectId: fixture.projectId,
    actorId: writerActor,
    workItemId: item.id,
    leaseToken: claimRes.lease_token,
    idempotencyKey: idempotencyKey('cleanup-sec-2'),
  });
});

test('SEC-003: scoped idempotency key can be reused in different commands/scopes without conflict', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'conc-post-2' && w.kind === 'content_write',
    { state: 'available' },
  );

  const actorA = 'agent:content_writer';
  const sharedKey = idempotencyKey('scoped-shared-key');

  const claimRes = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId: actorA,
    workItemId: item.id,
    idempotencyKey: sharedKey,
  });
  assert.ok(claimRes.lease_token);

  const releaseRes = await callTool('ba_release_work_item', {
    projectId: fixture.projectId,
    actorId: actorA,
    workItemId: item.id,
    leaseToken: claimRes.lease_token,
    idempotencyKey: sharedKey,
  });
  assert.equal(releaseRes.work_item.state, 'available');
});
