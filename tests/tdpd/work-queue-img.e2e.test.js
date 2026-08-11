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
  return `tdpd-img-${label}-${randomUUID()}`;
}

function requireTools(...names) {
  for (const name of names) {
    assert.ok(
      toolNames.has(name),
      `[TDPD RED-IMG] ${name} is required by asset pipeline spec but is not registered by the MCP server`,
    );
  }
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to execute DB-backed Suite IMG scenarios');
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
            name: `Suite IMG Project ${randomUUID()}`,
            slug: `suite-img-${randomUUID()}`,
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
  client = new Client({ name: 'tdpd-img-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const toolsRes = await client.listTools();
  toolNames = new Set((toolsRes.tools || []).map((t) => t.name));
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('E2E-IMG01 / SC-IMG01: required-asset gate blocks review completion without generated asset', async (t) => {
  requireTools('ba_generate_image_asset');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const res = await callTool('ba_generate_image_asset', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    prompt: 'A futuristic city skyline',
    provider: 'gemini-imagen-3',
  });

  assert.ok(res.asset_id);
  assert.equal(res.status, 'candidate');
});

test('E2E-IMG02 / SC-IMG02: image generation immutably records prompt version, seed, provider, and model', async (t) => {
  requireTools('ba_generate_image_asset');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const res = await callTool('ba_generate_image_asset', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    prompt: 'A sleek modern workspace',
    provider: 'gemini-imagen-3',
    model: 'imagen-3.0-generate-002',
    seed: 42,
    promptVersion: 2,
  });

  assert.equal(res.provider, 'gemini-imagen-3');
  assert.equal(res.model, 'imagen-3.0-generate-002');
  assert.equal(res.seed, 42);
  assert.equal(res.prompt_version, 2);
});

test('E2E-IMG03 / SC-IMG03: image regeneration creates new asset version preserving history', async (t) => {
  requireTools('ba_generate_image_asset', 'ba_list_image_assets');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const gen1 = await callTool('ba_generate_image_asset', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    prompt: 'Concept draft v1',
  });

  const gen2 = await callTool('ba_generate_image_asset', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    prompt: 'Concept draft v2',
  });

  assert.notEqual(gen1.asset_id, gen2.asset_id);
  assert.equal(gen2.asset_version, gen1.asset_version + 1);

  const history = await callTool('ba_list_image_assets', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
  });

  assert.ok(Array.isArray(history.assets));
  assert.ok(history.assets.length >= 2);
});

test('E2E-IMG04 / SC-IMG04: human asset rejection allows new candidate generation', async (t) => {
  requireTools('ba_generate_image_asset', 'ba_review_image_asset');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const gen = await callTool('ba_generate_image_asset', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    prompt: 'Unapproved candidate image',
  });

  const rev = await callTool('ba_review_image_asset', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    assetId: gen.asset_id,
    decision: 'rejected',
    reason: 'Colors are off',
  });

  assert.equal(rev.status, 'rejected');
});

test('E2E-IMG05 / SC-IMG05: asset alt_text and channel aspect ratio constraints are validated', async (t) => {
  requireTools('ba_generate_image_asset');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const res = await callTool('ba_generate_image_asset', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    contentItemId: 1,
    prompt: 'Banner for VK post',
    altText: 'A high contrast promotional banner for VK post',
    aspectRatio: '16:9',
  });

  assert.equal(res.alt_text, 'A high contrast promotional banner for VK post');
  assert.equal(res.aspect_ratio, '16:9');
});
