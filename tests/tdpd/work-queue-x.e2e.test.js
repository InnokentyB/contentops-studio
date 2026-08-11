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
  return `tdpd-x-${label}-${randomUUID()}`;
}

function requireTools(...names) {
  for (const name of names) {
    assert.ok(
      toolNames.has(name),
      `[TDPD RED-X] ${name} is required by case-cross-layer-release-planning-ru.md but is not registered by the MCP server`,
    );
  }
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to execute DB-backed Suite X scenarios');
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

function buildExternalOperationalPlan() {
  return {
    meta: {
      plan_id: 'ext-op-plan-2026-08',
      title: 'Cross-Layer Release Plan August 2026',
    },
    initiatives: [
      { external_key: 'LM03', kind: 'publication', subtype: 'post', title: 'Publication Thursday', due_at: '2026-08-13T10:00:00Z' },
      { external_key: 'LM04', kind: 'publication', subtype: 'post', title: 'Publication Friday', due_at: '2026-08-14T10:00:00Z' },
      { external_key: 'I01', kind: 'infrastructure', subtype: 'email_sequence', title: 'Welcome Chain', due_at: '2026-08-10T18:00:00Z' },
      { external_key: 'I02', kind: 'infrastructure', subtype: 'robots_change', title: 'User-Agent * in robots.txt', due_at: '2026-08-10T18:00:00Z' },
      { external_key: 'C05', kind: 'campaign', subtype: 'seeding_wave', title: 'Seeding Wave 1', start_at: '2026-08-11T09:00:00Z' },
      { external_key: 'E01', kind: 'event', subtype: 'lesson', title: 'Lesson 4 + Case consents', event_at: '2026-08-12T15:00:00Z' },
      { external_key: 'I03', kind: 'event', subtype: 'cfp', title: 'CFP Berlin', due_at: '2026-08-12T23:59:59Z' },
      { external_key: 'C08', kind: 'campaign', subtype: 'decision_gate', title: 'Habr decision gate', decision_at: '2026-08-12T12:00:00Z' },
    ],
    dependencies: [
      { from: 'I01', to: 'C05', type: 'blocks' },
      { from: 'I02', to: 'C05', type: 'blocks' },
      { from: 'I01', to: 'LM03', type: 'blocks' },
    ]
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
      }

      // Create initial project with only LM03 and LM04
      const proj = await prisma.project.create({
        data: {
          name: `Suite X Project ${randomUUID()}`,
          slug: `suite-x-${randomUUID()}`,
          members: {
            create: { user_id: TEST_USER_ID, role: 'owner' }
          }
        }
      });

      // Upsert LM03 and LM04 into database
      await callTool('ba_upsert_initiative', {
        projectId: proj.id,
        actorId: ACTOR_ID,
        externalKey: 'LM03',
        kind: 'publication',
        subtype: 'post',
        title: 'Publication Thursday',
        dueAt: '2026-08-13T10:00:00Z'
      });

      await callTool('ba_upsert_initiative', {
        projectId: proj.id,
        actorId: ACTOR_ID,
        externalKey: 'LM04',
        kind: 'publication',
        subtype: 'post',
        title: 'Publication Friday',
        dueAt: '2026-08-14T10:00:00Z'
      });

      return { projectId: proj.id };
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
  client = new Client({ name: 'tdpd-x-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const toolsRes = await client.listTools();
  toolNames = new Set((toolsRes.tools || []).map((t) => t.name));
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('E2E-X01 / SC-X01: coverage audit detects incomplete plan coverage (2/8 covered, 6 missing)', async (t) => {
  requireTools('ba_audit_plan_coverage');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const result = await callTool('ba_audit_plan_coverage', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
  });

  assert.equal(result.total_external_initiatives, 8);
  assert.equal(result.covered_count, 2);
  assert.equal(result.missing_count, 6);
  assert.deepEqual(
    result.missing_keys.sort(),
    ['C05', 'C08', 'E01', 'I01', 'I02', 'I03'].sort()
  );
});

test('E2E-X02 / SC-X02: blocked campaign readiness reflects infrastructure blockers I01 and I02', async (t) => {
  requireTools('ba_get_release_readiness', 'ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: idempotencyKey('import-x02'),
  });

  const readiness = await callTool('ba_get_release_readiness', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    initiativeKey: 'C05',
  });

  assert.equal(readiness.is_ready, false);
  assert.equal(readiness.is_blocked, true);
  assert.ok(Array.isArray(readiness.blockers));
  const blockerKeys = readiness.blockers.map((b) => b.external_key);
  assert.ok(blockerKeys.includes('I01'));
  assert.ok(blockerKeys.includes('I02'));
});

test('E2E-X03 / SC-X03: overdue initiative shows downstream impact on C05 and email publication', async (t) => {
  requireTools('ba_list_release_blockers', 'ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: idempotencyKey('import-x03'),
  });

  const blockers = await callTool('ba_list_release_blockers', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    asOf: '2026-08-11T00:00:00Z',
  });

  assert.ok(Array.isArray(blockers.overdue_initiatives));
  const i01 = blockers.overdue_initiatives.find((i) => i.external_key === 'I01');
  assert.ok(i01, 'I01 must be flagged as overdue');
  assert.ok(Array.isArray(i01.downstream_impact));
  const impactedKeys = i01.downstream_impact.map((d) => d.external_key);
  assert.ok(impactedKeys.includes('C05'));
  assert.ok(impactedKeys.includes('LM03'));
});

test('E2E-X04 / SC-X04: operational calendar preserves semantics of different date types', async (t) => {
  requireTools('ba_get_operational_calendar', 'ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: idempotencyKey('import-x04'),
  });

  const calendar = await callTool('ba_get_operational_calendar', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    fromDate: '2026-08-10',
    toDate: '2026-08-12',
  });

  assert.ok(Array.isArray(calendar.items));
  const i01 = calendar.items.find((i) => i.external_key === 'I01');
  const c05 = calendar.items.find((i) => i.external_key === 'C05');
  const e01 = calendar.items.find((i) => i.external_key === 'E01');
  const c08 = calendar.items.find((i) => i.external_key === 'C08');

  assert.equal(i01?.date_type, 'due_at');
  assert.equal(c05?.date_type, 'start_at');
  assert.equal(e01?.date_type, 'event_at');
  assert.equal(c08?.date_type, 'decision_at');
});

test('E2E-X05 / SC-X05: unconfirmed dependencies are marked unknown and not hallucinated', async (t) => {
  requireTools('ba_get_initiative', 'ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: idempotencyKey('import-x05'),
  });

  const initiative = await callTool('ba_get_initiative', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalKey: 'E01',
  });

  assert.equal(initiative.dependencies_status, 'dependencies_unknown');
  assert.deepEqual(initiative.confirmed_blockers, []);
});

test('E2E-X06 / SC-X01: repeated import of operational plan is idempotent by external_key', async (t) => {
  requireTools('ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const key = idempotencyKey('import-op-plan-idempotent');
  const import1 = await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: key,
  });

  const import2 = await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: key,
  });

  assert.equal(import1.imported_count, import2.imported_count);
});

test('E2E-X07 / SC-X02: circular blocking dependency link is rejected', async (t) => {
  requireTools('ba_link_initiatives', 'ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: idempotencyKey('import-x07'),
  });

  const res = await client.callTool({
    name: 'ba_link_initiatives',
    arguments: {
      projectId: fixture.projectId,
      actorId: ACTOR_ID,
      fromKey: 'C05',
      toKey: 'I01', // I01 already blocks C05 -> creating cycle C05 -> I01 -> C05
      type: 'blocks',
    },
  });

  assert.equal(res.isError, true, 'Circular dependency link must be rejected');
  const text = (res.content || []).map((i) => i.text || '').join('\n');
  assert.match(text, /CYCLE_DETECTED|CIRCULAR_DEPENDENCY/);
});

test('E2E-X08 / SC-X03: clearing a blocker recalculates downstream readiness', async (t) => {
  requireTools('ba_upsert_initiative', 'ba_get_release_readiness', 'ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  await callTool('ba_import_operational_plan', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalPlan: buildExternalOperationalPlan(),
    idempotencyKey: idempotencyKey('import-x08'),
  });

  // Complete I01 and I02
  await callTool('ba_upsert_initiative', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalKey: 'I01',
    kind: 'infrastructure',
    title: 'Welcome Chain',
    status: 'completed',
  });
  await callTool('ba_upsert_initiative', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    externalKey: 'I02',
    kind: 'infrastructure',
    title: 'User-Agent * in robots.txt',
    status: 'completed',
  });

  const readiness = await callTool('ba_get_release_readiness', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    initiativeKey: 'C05',
  });

  assert.equal(readiness.is_blocked, false);
  assert.equal(readiness.is_ready, true);
});
