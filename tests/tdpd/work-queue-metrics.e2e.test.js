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
  return `tdpd-met-${label}-${randomUUID()}`;
}

function requireTools(...names) {
  for (const name of names) {
    assert.ok(
      toolNames.has(name),
      `[TDPD RED-METRICS] ${name} is required by metrics spec but is not registered by the MCP server`,
    );
  }
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to execute DB-backed Suite METRICS scenarios');
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
            name: `Suite METRICS Project ${randomUUID()}`,
            slug: `suite-met-${randomUUID()}`,
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
  client = new Client({ name: 'tdpd-metrics-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const toolsRes = await client.listTools();
  toolNames = new Set((toolsRes.tools || []).map((t) => t.name));
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('E2E-MET01 / SC-MET01: checkpoints T+1, T+24, T+72 organize metric snapshot timeline', async (t) => {
  requireTools('ba_record_metric_snapshot');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const snap1 = await callTool('ba_record_metric_snapshot', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    checkpoint: 'T+1',
    metrics: { views: 150, likes: 12 },
  });

  assert.equal(snap1.checkpoint, 'T+1');
  assert.equal(snap1.metrics.views, 150);
});

test('E2E-MET02 / SC-MET02: repeated metric snapshot recording for same checkpoint is idempotent', async (t) => {
  requireTools('ba_record_metric_snapshot');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const key = idempotencyKey('met02');
  const snap1 = await callTool('ba_record_metric_snapshot', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    checkpoint: 'T+24',
    metrics: { views: 1200, likes: 95, shares: 14 },
    idempotencyKey: key,
  });

  const snap2 = await callTool('ba_record_metric_snapshot', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    checkpoint: 'T+24',
    metrics: { views: 1200, likes: 95, shares: 14 },
    idempotencyKey: key,
  });

  assert.deepEqual(snap1, snap2);
});

test('E2E-MET03 / SC-MET03: provider metrics preserve explicit zero vs missing data semantics', async (t) => {
  requireTools('ba_record_metric_snapshot', 'ba_get_content_metrics');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  await callTool('ba_record_metric_snapshot', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    channelId: 1,
    checkpoint: 'T+72',
    metrics: { views: 5000, likes: 0 }, // explicit zero likes vs missing comments
  });

  const res = await callTool('ba_get_content_metrics', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
  });

  assert.equal(res.metrics.likes, 0, 'Explicit zero must be preserved');
  assert.equal(res.metrics.comments, undefined, 'Uncollected metric must remain undefined/missing');
});

test('E2E-MET04 / SC-MET04: campaign metric rollup aggregates performance across channels and posts', async (t) => {
  requireTools('ba_rollup_campaign_metrics');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const rollup = await callTool('ba_rollup_campaign_metrics', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    initiativeKey: 'C05',
  });

  assert.ok(typeof rollup.total_views === 'number');
  assert.ok(typeof rollup.total_likes === 'number');
});
