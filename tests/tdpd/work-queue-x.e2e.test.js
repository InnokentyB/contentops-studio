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

async function createProject(label = 'suite-x') {
  return prisma.project.create({
    data: {
      name: `Suite X ${label} ${randomUUID()}`,
      slug: `${label}-${randomUUID()}`,
      members: {
        create: { user_id: TEST_USER_ID, role: 'owner' }
      }
    }
  });
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

test('E2E-X09 / SC-X05: unknown dependency state cannot be reported as release-ready', async (t) => {
  requireTools('ba_upsert_initiative', 'ba_get_release_readiness');
  if (!requireDatabase(t)) return;

  const project = await createProject('unknown-readiness');
  await callTool('ba_upsert_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'E-UNKNOWN',
    kind: 'event',
    title: 'Event with dependency data not yet confirmed',
    status: 'planned',
  });

  const readiness = await callTool('ba_get_release_readiness', {
    projectId: project.id,
    actorId: ACTOR_ID,
    initiativeKey: 'E-UNKNOWN',
  });

  assert.equal(readiness.dependencies_status, 'dependencies_unknown');
  assert.equal(readiness.is_ready, false);
  assert.equal(readiness.readiness, 'unknown');
});

test('E2E-X10 / SC-X01: coverage audit reports mismatches and planner-only initiatives', async (t) => {
  requireTools('ba_upsert_initiative', 'ba_audit_plan_coverage');
  if (!requireDatabase(t)) return;

  const project = await createProject('coverage-diff');
  await callTool('ba_upsert_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'C-DIFF',
    kind: 'campaign',
    title: 'Campaign stored with the wrong date',
    startAt: '2026-08-12T09:00:00Z',
  });
  await callTool('ba_upsert_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'LOCAL-ONLY',
    kind: 'infrastructure',
    title: 'Planner-only initiative',
  });

  const coverage = await callTool('ba_audit_plan_coverage', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalPlan: {
      initiatives: [
        {
          external_key: 'C-DIFF',
          kind: 'campaign',
          start_at: '2026-08-11T09:00:00Z',
        },
      ],
    },
  });

  assert.deepEqual(coverage.missing_keys, []);
  assert.deepEqual(coverage.planner_only_keys, ['LOCAL-ONLY']);
  assert.deepEqual(coverage.mismatches, [
    {
      external_key: 'C-DIFF',
      fields: ['start_at'],
    },
  ]);
});

test('E2E-X11 / security: malformed or unbound actor identity cannot access initiative data', async (t) => {
  requireTools('ba_list_initiatives');
  if (!requireDatabase(t)) return;

  const project = await createProject('actor-boundary');
  for (const actorId of ['user:not-a-number', 'agent:unbound-cross-layer-agent', 'arbitrary-actor']) {
    const result = await client.callTool({
      name: 'ba_list_initiatives',
      arguments: { projectId: project.id, actorId },
    });
    assert.equal(result.isError, true, `${actorId} must be rejected`);
    const message = (result.content || []).map((item) => item.text || '').join('\n');
    assert.match(message, /Access denied|Security/i);
  }
});

test('E2E-X12 / import recovery: invalid dependency rolls back the whole operational-plan import', async (t) => {
  requireTools('ba_import_operational_plan', 'ba_list_initiatives');
  if (!requireDatabase(t)) return;

  const project = await createProject('atomic-import');
  const importResult = await client.callTool({
    name: 'ba_import_operational_plan',
    arguments: {
      projectId: project.id,
      actorId: ACTOR_ID,
      externalPlan: {
        initiatives: [
          { external_key: 'ATOMIC-1', kind: 'campaign', title: 'Must roll back' },
        ],
        dependencies: [
          { from: 'MISSING', to: 'ATOMIC-1', type: 'blocks' },
        ],
      },
      idempotencyKey: idempotencyKey('atomic-import'),
    },
  });
  assert.equal(importResult.isError, true);

  const after = await callTool('ba_list_initiatives', {
    projectId: project.id,
    actorId: ACTOR_ID,
  });
  assert.deepEqual(after.initiatives, []);
});

test('E2E-X13 / unified calendar: one MCP view returns measurement checkpoints, readiness, overdue and summary', async (t) => {
  requireTools('ba_import_operational_plan', 'ba_get_operational_calendar');
  if (!requireDatabase(t)) return;

  const project = await createProject('unified-calendar');
  await callTool('ba_import_operational_plan', {
    projectId: project.id,
    actorId: ACTOR_ID,
    idempotencyKey: idempotencyKey('unified-calendar-import'),
    externalPlan: {
      initiatives: [
        {
          external_key: 'MET-72',
          kind: 'campaign',
          subtype: 'measurement_checkpoint',
          title: 'Campaign metrics T+72',
          status: 'planned',
          measurement_at: '2026-08-12T12:00:00Z',
        },
        {
          external_key: 'BLOCK-1',
          kind: 'infrastructure',
          title: 'Overdue infrastructure blocker',
          status: 'blocked',
          due_at: '2026-08-10T10:00:00Z',
        },
      ],
      dependencies: [
        { from: 'BLOCK-1', to: 'MET-72', type: 'blocks' },
      ],
    },
  });

  const calendar = await callTool('ba_get_operational_calendar', {
    projectId: project.id,
    actorId: ACTOR_ID,
    fromDate: '2026-08-10',
    toDate: '2026-08-12',
    asOf: '2026-08-11T12:00:00Z',
  });

  assert.deepEqual(calendar.range, { from: '2026-08-10', to: '2026-08-12' });
  assert.equal(calendar.summary.total, 2);
  assert.equal(calendar.summary.in_range, 2);
  assert.equal(calendar.summary.overdue, 1);
  assert.equal(calendar.summary.by_kind.campaign, 1);
  assert.equal(calendar.summary.by_kind.infrastructure, 1);

  const checkpoint = calendar.items.find((item) => item.external_key === 'MET-72');
  assert.equal(checkpoint?.date_type, 'measurement_at');
  assert.equal(checkpoint?.readiness?.is_blocked, true);
  assert.ok(checkpoint?.readiness?.blockers.some((item) => item.external_key === 'BLOCK-1'));
  assert.ok(calendar.overdue_initiatives.some((item) => item.external_key === 'BLOCK-1'));
});

test('E2E-X14 / calendar validation: invalid or descending date ranges fail explicitly', async (t) => {
  requireTools('ba_get_operational_calendar');
  const malformed = await client.callTool({
    name: 'ba_get_operational_calendar',
    arguments: { projectId: 1, actorId: ACTOR_ID, fromDate: 'not-a-date', toDate: '2026-08-10' },
  });
  assert.equal(malformed.isError, true);
  assert.match((malformed.content || []).map((item) => item.text || '').join('\n'), /YYYY-MM-DD|invalid_string|Invalid/);

  if (!requireDatabase(t)) return;
  const project = await createProject('calendar-validation');
  const descending = await client.callTool({
    name: 'ba_get_operational_calendar',
    arguments: { projectId: project.id, actorId: ACTOR_ID, fromDate: '2026-08-12', toDate: '2026-08-10' },
  });
  assert.equal(descending.isError, true);
  assert.match((descending.content || []).map((item) => item.text || '').join('\n'), /INVALID_DATE_RANGE/);
});

test('E2E-X15 / import idempotency: replay returns one audited result and changed payload conflicts', async (t) => {
  requireTools('ba_import_operational_plan');
  if (!requireDatabase(t)) return;

  const project = await createProject('import-idempotency');
  const key = idempotencyKey('import-command-replay');
  const args = {
    projectId: project.id,
    actorId: ACTOR_ID,
    idempotencyKey: key,
    externalPlan: {
      initiatives: [{ external_key: 'IDEM-1', kind: 'event', title: 'Original payload', event_at: '2026-08-12T12:00:00Z' }],
    },
  };

  const first = await callTool('ba_import_operational_plan', args);
  const replay = await callTool('ba_import_operational_plan', args);
  assert.deepEqual(replay, first);

  const auditCount = await prisma.workflowEvent.count({
    where: {
      project_id: project.id,
      actor_id: ACTOR_ID,
      command: 'import_operational_plan',
      idempotency_key: key,
    },
  });
  assert.equal(auditCount, 1);

  const conflict = await client.callTool({
    name: 'ba_import_operational_plan',
    arguments: {
      ...args,
      externalPlan: {
        initiatives: [{ external_key: 'IDEM-1', kind: 'event', title: 'Changed payload', event_at: '2026-08-12T12:00:00Z' }],
      },
    },
  });
  assert.equal(conflict.isError, true);
  const conflictMessage = (conflict.content || []).map((item) => item.text || '').join('\n');
  assert.match(conflictMessage, /IDEMPOTENCY_CONFLICT/);
});

test('E2E-X16 / publication projection: a publication initiative materializes one linked execution task', async (t) => {
  requireTools('ba_upsert_initiative', 'ba_materialize_publication_task');
  if (!requireDatabase(t)) return;

  const project = await createProject('publication-projection');
  await callTool('ba_upsert_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'PUB-1',
    kind: 'publication',
    title: 'Publication with execution workspace',
    dueAt: '2026-08-13T10:00:00Z',
  });

  const args = {
    projectId: project.id,
    actorId: ACTOR_ID,
    initiativeKey: 'PUB-1',
    draftText: 'Ready-to-review publication body',
    publicationMode: 'manual_handoff',
    idempotencyKey: idempotencyKey('publication-projection'),
  };
  const first = await callTool('ba_materialize_publication_task', args);
  const replay = await callTool('ba_materialize_publication_task', args);

  assert.equal(replay.publication_task_id, first.publication_task_id);
  assert.equal(replay.work_item_id, first.work_item_id);
  assert.equal(await prisma.contentItem.count({ where: { project_id: project.id } }), 1);
  assert.equal(await prisma.workItem.count({
    where: { project_id: project.id, initiative_id: first.initiative_id, content_item_id: first.publication_task_id },
  }), 1);
});

test('E2E-X17 / calendar handoff: publication calendar item exposes its execution workspace', async (t) => {
  requireTools('ba_upsert_initiative', 'ba_materialize_publication_task', 'ba_get_operational_calendar');
  if (!requireDatabase(t)) return;

  const project = await createProject('calendar-publication-link');
  await callTool('ba_upsert_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'PUB-2',
    kind: 'publication',
    title: 'Open me from calendar',
    dueAt: '2026-08-13T10:00:00Z',
  });
  const projected = await callTool('ba_materialize_publication_task', {
    projectId: project.id,
    actorId: ACTOR_ID,
    initiativeKey: 'PUB-2',
    draftText: 'Publication body',
    publicationMode: 'approval_required',
    idempotencyKey: idempotencyKey('calendar-publication-link'),
  });

  const calendar = await callTool('ba_get_operational_calendar', {
    projectId: project.id,
    actorId: ACTOR_ID,
    fromDate: '2026-08-13',
    toDate: '2026-08-13',
  });
  const item = calendar.items.find((entry) => entry.external_key === 'PUB-2');
  assert.equal(item.publication_task.id, projected.publication_task_id);
  assert.equal(item.publication_task.mode, 'approval_required');
  assert.equal(item.publication_task.workspace_path, `/publication-tasks?taskId=${projected.publication_task_id}`);
  assert.equal(item.publication_task.has_draft, true);
});

test('E2E-X18 / publication completion: confirmed link completes the linked initiative', async (t) => {
  requireTools('ba_upsert_initiative', 'ba_materialize_publication_task', 'ba_confirm_publication', 'ba_get_initiative');
  if (!requireDatabase(t)) return;

  const project = await createProject('publication-completion');
  const channel = await prisma.socialChannel.create({
    data: {
      project_id: project.id,
      type: 'telegram',
      name: 'Publication completion channel',
      config: {},
    },
  });
  await callTool('ba_upsert_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'PUB-3',
    kind: 'publication',
    title: 'Confirm published result',
    dueAt: '2026-08-13T10:00:00Z',
  });
  const projected = await callTool('ba_materialize_publication_task', {
    projectId: project.id,
    actorId: ACTOR_ID,
    initiativeKey: 'PUB-3',
    draftText: 'Published body',
    channelId: channel.id,
    publicationMode: 'manual_handoff',
    idempotencyKey: idempotencyKey('publication-completion'),
  });

  await callTool('ba_confirm_publication', {
    projectId: project.id,
    taskId: projected.publication_task_id,
    publishedLink: 'https://example.com/published/pub-3',
  });
  const initiative = await callTool('ba_get_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'PUB-3',
  });
  assert.equal(initiative.status, 'completed');
  assert.equal(initiative.publication_task.published_link, 'https://example.com/published/pub-3');
});

test('E2E-X19 / writer boundary: content changes without changing the publication slot', async (t) => {
  requireTools('ba_upsert_initiative', 'ba_materialize_publication_task', 'ba_update_publication_content');
  if (!requireDatabase(t)) return;

  const project = await createProject('writer-content-boundary');
  const channel = await prisma.socialChannel.create({
    data: {
      project_id: project.id,
      type: 'telegram',
      name: 'Writer boundary channel',
      config: {},
    },
  });
  await callTool('ba_upsert_initiative', {
    projectId: project.id,
    actorId: ACTOR_ID,
    externalKey: 'PUB-WRITER-1',
    kind: 'publication',
    title: 'Immutable slot shell',
    dueAt: '2026-08-15T10:00:00Z',
  });
  const projected = await callTool('ba_materialize_publication_task', {
    projectId: project.id,
    actorId: ACTOR_ID,
    initiativeKey: 'PUB-WRITER-1',
    brief: 'Planner-owned brief',
    channelId: channel.id,
    publicationMode: 'manual_handoff',
    scheduleAt: '2026-08-15T10:00:00Z',
    idempotencyKey: idempotencyKey('writer-content-boundary'),
  });
  const before = await prisma.contentItem.findUniqueOrThrow({ where: { id: projected.publication_task_id } });
  assert.equal(before.content_revision, 0);

  const result = await callTool('ba_update_publication_content', {
    projectId: project.id,
    taskId: before.id,
    body: 'Writer-created publication body',
    expectedRevision: 0,
  });
  assert.equal(result.task.content_state, 'ready');
  assert.equal(result.task.content_revision, 1);

  const after = await prisma.contentItem.findUniqueOrThrow({ where: { id: before.id } });
  assert.equal(after.draft_text, 'Writer-created publication body');
  assert.equal(after.title, before.title);
  assert.equal(after.brief, before.brief);
  assert.equal(after.channel_id, before.channel_id);
  assert.equal(after.schedule_at.toISOString(), before.schedule_at.toISOString());
  assert.equal(after.status, before.status);

  const conflict = await client.callTool({
    name: 'ba_update_publication_content',
    arguments: {
      projectId: project.id,
      taskId: before.id,
      body: 'Stale overwrite',
      expectedRevision: 0,
    },
  });
  assert.equal(conflict.isError, true);
  assert.match((conflict.content || []).map((entry) => entry.text || '').join('\n'), /CONTENT_REVISION_CONFLICT/);
});
