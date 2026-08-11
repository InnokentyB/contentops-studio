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
let fixturePromise;

function idempotencyKey(label) {
  return `tdpd-auto-${label}-${randomUUID()}`;
}

function requireTools(...names) {
  for (const name of names) {
    assert.ok(
      toolNames.has(name),
      `[TDPD RED-AUTO] ${name} is required by product spec but is not registered by the MCP server`,
    );
  }
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to execute DB-backed Suite AUTO scenarios');
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

        const proj = await prisma.project.create({
          data: {
            name: `Suite AUTO Project ${randomUUID()}`,
            slug: `suite-auto-${randomUUID()}`,
            members: {
              create: { user_id: TEST_USER_ID, role: 'owner' },
            },
          },
        });

        return { projectId: proj.id };
      }
      return { projectId: 1 };
    })();
  }
  return fixturePromise;
}

test.before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  client = new Client({ name: 'tdpd-auto-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const toolsRes = await client.listTools();
  toolNames = new Set((toolsRes.tools || []).map((t) => t.name));
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('E2E-AUTO01 / SC-AUTO01: assisted posting is default unless automatic mode is configured by policy', async (t) => {
  requireTools('ba_execute_delivery');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const res = await callTool('ba_execute_delivery', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    idempotencyKey: idempotencyKey('auto01'),
  });

  assert.equal(res.mode, 'assisted');
  assert.equal(res.requires_manual_confirmation, true);
});

test('E2E-AUTO02 / SC-AUTO02: automatic posting without approval decision fails with [APPROVAL_REQUIRED]', async (t) => {
  requireTools('ba_execute_delivery');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const res = await client.callTool({
    name: 'ba_execute_delivery',
    arguments: {
      projectId: fixture.projectId,
      actorId: ACTOR_ID,
      contentItemId: 1,
      channelId: 2,
      forceAutomatic: true,
      unapproved: true,
    },
  });

  assert.equal(res.isError, true);
  const text = (res.content || []).map((i) => i.text || '').join('\n');
  assert.match(text, /APPROVAL_REQUIRED/);
});

test('E2E-AUTO03 / SC-AUTO03: repeated delivery call with same idempotency key does not re-post', async (t) => {
  requireTools('ba_execute_delivery');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const key = idempotencyKey('retry-auto03');
  const res1 = await callTool('ba_execute_delivery', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    idempotencyKey: key,
  });

  const res2 = await callTool('ba_execute_delivery', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    idempotencyKey: key,
  });

  assert.deepEqual(res1, res2);
});

test('E2E-AUTO04 / SC-AUTO04: delivery failure records failed attempt and allows delivery recovery', async (t) => {
  requireTools('ba_execute_delivery', 'ba_recover_delivery');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const del = await callTool('ba_execute_delivery', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    simulateFailure: true,
    idempotencyKey: idempotencyKey('auto04-fail'),
  });

  assert.equal(del.status, 'failed');

  const rec = await callTool('ba_recover_delivery', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    deliveryAttemptId: del.attempt_id,
  });

  assert.equal(rec.status, 'delivered');
});

test('E2E-AUTO05 / SC-AUTO05: delivery tracks scheduled_at vs actual_published_at explicitly', async (t) => {
  requireTools('ba_execute_delivery');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const del = await callTool('ba_execute_delivery', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    scheduledAt: '2026-08-11T12:00:00Z',
    idempotencyKey: idempotencyKey('auto05'),
  });

  assert.ok(del.scheduled_at);
  assert.ok(del.actual_published_at);
  assert.notEqual(del.scheduled_at, del.actual_published_at);
});
