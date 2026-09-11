const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { isToolAllowedForProfile } = require('../../dist/mcp/capabilities.js');

const SPEC_PATH = 'docs/tdpd/007-organization-intelligence-hub-spec-ru.md';
const SERVER_PATH = path.join(process.cwd(), 'dist', 'mcp', 'server.js');
const TEST_DATABASE_URL = process.env.TDPD_TEST_DATABASE_URL || '';
const TEST_USER_ID = Number(process.env.TDPD_TEST_USER_ID || 0);
const OTHER_USER_ID = Number(process.env.TDPD_TEST_OTHER_USER_ID || 0);
const ACTOR_ID = TEST_USER_ID ? `user:${TEST_USER_ID}` : 'tdpd-red-agent';

const REQUIRED_TOOLS = [
  'ba_get_organization_intelligence_context',
  'ba_search_organization_intelligence',
  'ba_get_organization_research_run',
  'ba_route_organization_signal',
  'ba_promote_project_signal',
];

const deterministicSignals = [
  {
    source: 'reddit',
    provider_object_id: 'reddit:content-ops-42',
    canonical_url: 'https://www.reddit.com/r/SaaS/comments/content_ops_42',
    title: 'We lost the approval state between agents',
    excerpt: 'Our planning agent and writing agent keep producing different operational truth.',
    observed_at: '2026-09-11T09:00:00.000Z',
  },
  {
    source: 'indie_hackers',
    provider_object_id: 'ih:research-once-73',
    canonical_url: 'https://www.indiehackers.com/post/research-once-73',
    title: 'Research once, route findings to several products',
    excerpt: 'A shared evidence inbox reduced duplicate discovery work across our portfolio.',
    observed_at: '2026-09-11T09:01:00.000Z',
  },
];

const pool = TEST_DATABASE_URL ? new Pool({ connectionString: TEST_DATABASE_URL }) : null;
const adapter = pool ? new PrismaPg(pool) : null;
const prisma = adapter ? new PrismaClient({ adapter }) : null;
let client;
let transport;
let toolNames = new Set();
let fixture;

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma || !TEST_USER_ID || !OTHER_USER_ID) {
    t.skip('Set TDPD_TEST_DATABASE_URL, TDPD_TEST_USER_ID, and TDPD_TEST_OTHER_USER_ID for TDPD-007 DB scenarios');
    return false;
  }
  return true;
}

function requireTools(...names) {
  for (const name of names) {
    assert.ok(toolNames.has(name), `[TDPD RED] ${name} is required by ${SPEC_PATH}`);
  }
}

function payload(result) {
  if (result?.isError) {
    const message = (result.content || []).map((entry) => entry.text || '').join('\n');
    assert.fail(message || 'MCP tool failed');
  }
  return result?.structuredContent || {};
}

async function callTool(name, args) {
  requireTools(name);
  return payload(await client.callTool({ name, arguments: args }));
}

async function callToolError(name, args) {
  requireTools(name);
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, `${name} must reject this request`);
  return (result.content || []).map((entry) => entry.text || '').join('\n');
}

async function ensureUser(id, suffix) {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, email: `tdpd-007-${suffix}-${id}@example.com`, password_hash: 'hash', name: `TDPD 007 ${suffix}` },
  });
}

async function createFixture() {
  if (fixture) return fixture;
  await ensureUser(TEST_USER_ID, 'owner');
  await ensureUser(OTHER_USER_ID, 'outsider');

  const organization = await prisma.organization.create({
    data: {
      name: 'TDPD 007 portfolio',
      slug: `tdpd-007-${randomUUID()}`,
      members: { create: { user_id: TEST_USER_ID, role: 'owner' } },
    },
  });
  const projectA = await prisma.project.create({
    data: {
      organization_id: organization.id,
      name: 'Approval workflow product',
      slug: `tdpd-007-a-${randomUUID()}`,
      members: { create: { user_id: TEST_USER_ID, role: 'owner' } },
      research_profile: {
        create: {
          revision: 1,
          audience: ['content operations teams'],
          problems: ['approval state', 'agent handoff'],
          themes: ['governed workflows'],
        },
      },
    },
  });
  const projectB = await prisma.project.create({
    data: {
      organization_id: organization.id,
      name: 'Portfolio research product',
      slug: `tdpd-007-b-${randomUUID()}`,
      members: { create: { user_id: TEST_USER_ID, role: 'owner' } },
      research_profile: {
        create: {
          revision: 1,
          audience: ['multi-product founders'],
          problems: ['duplicate discovery'],
          themes: ['shared research'],
        },
      },
    },
  });
  fixture = { organization, projectA, projectB };
  return fixture;
}

function searchArgs(organizationId, overrides = {}) {
  return {
    userId: TEST_USER_ID,
    organizationId,
    actorId: ACTOR_ID,
    query: 'Signals about governed content operations and shared product research',
    sources: ['reddit', 'indie_hackers'],
    projectScope: { mode: 'all_active' },
    waitMs: 5000,
    idempotencyKey: `tdpd-007-${randomUUID()}`,
    ...overrides,
  };
}

test.before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      ORGANIZATION_RESEARCH_ADAPTER_MODE: 'deterministic_test',
      ORGANIZATION_RESEARCH_TEST_RESPONSE: JSON.stringify({ signals: deterministicSignals }),
    },
  });
  client = new Client({ name: 'tdpd-007-red', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const response = await client.listTools();
  toolNames = new Set((response.tools || []).map((entry) => entry.name));
});

test.after(async () => {
  if (prisma && fixture?.organization?.id && prisma.organization) {
    await prisma.project.deleteMany({ where: { organization_id: fixture.organization.id } });
    await prisma.organization.deleteMany({ where: { id: fixture.organization.id } });
  }
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('E2E-007-000: organization researcher capability exposes the bounded Intelligence Hub tools', () => {
  requireTools(...REQUIRED_TOOLS);
  for (const name of REQUIRED_TOOLS.slice(0, 4)) {
    assert.equal(isToolAllowedForProfile('organization_researcher', name), true, `${name} must be allowed for organization_researcher`);
  }
  assert.equal(isToolAllowedForProfile('organization_researcher', 'ba_publish_task'), false);
  assert.equal(isToolAllowedForProfile('organization_researcher', 'ba_update_publication_content'), false);
});

test('E2E-007-001: one MCP search fans out once and returns project-specific assessments', async (t) => {
  if (!requireDatabase(t)) return;
  const { organization, projectA, projectB } = await createFixture();
  const result = await callTool('ba_search_organization_intelligence', searchArgs(organization.id));

  assert.equal(result.status, 'completed');
  assert.equal(result.source_outcomes.length, 2);
  assert.deepEqual(new Set(result.source_outcomes.map((entry) => entry.source)), new Set(['reddit', 'indie_hackers']));
  assert.equal(result.signals.length, 2);
  assert.equal(result.counts.fetched, 2);
  assert.equal(result.counts.deduplicated, 2);
  assert.ok(result.signals.every((signal) => signal.untrusted_external_content === true));
  for (const signal of result.signals) {
    assert.ok(signal.provenance?.canonical_url);
    assert.ok(signal.provenance?.snapshot_hash);
  }
  const assessedProjects = new Set(result.signals.flatMap((signal) => signal.project_assessments.map((assessment) => assessment.project_id)));
  assert.deepEqual(assessedProjects, new Set([projectA.id, projectB.id]));
});

test('E2E-007-002: replay with the same idempotency key returns the same run and no duplicate signals', async (t) => {
  if (!requireDatabase(t)) return;
  const { organization } = await createFixture();
  const idempotencyKey = `tdpd-007-replay-${randomUUID()}`;
  const args = searchArgs(organization.id, { idempotencyKey });
  const first = await callTool('ba_search_organization_intelligence', args);
  const replay = await callTool('ba_search_organization_intelligence', args);

  assert.equal(replay.research_run_id, first.research_run_id);
  assert.deepEqual(replay.signals.map((entry) => entry.id), first.signals.map((entry) => entry.id));
  assert.equal(await prisma.researchRun.count({ where: { organization_id: organization.id, idempotency_key: idempotencyKey } }), 1);
  assert.equal(await prisma.sourceSignal.count({ where: { organization_id: organization.id } }), 2);
});

test('E2E-007-003: a later run reuses canonical source identities instead of duplicating evidence', async (t) => {
  if (!requireDatabase(t)) return;
  const { organization } = await createFixture();
  const runsBefore = await prisma.researchRun.count({ where: { organization_id: organization.id } });
  const first = await callTool('ba_search_organization_intelligence', searchArgs(organization.id));
  const second = await callTool('ba_search_organization_intelligence', searchArgs(organization.id));

  assert.deepEqual(second.signals.map((entry) => entry.id), first.signals.map((entry) => entry.id));
  assert.equal(await prisma.sourceSignal.count({ where: { organization_id: organization.id } }), 2);
  assert.equal(await prisma.researchRun.count({ where: { organization_id: organization.id } }), runsBefore + 2);
});

test('E2E-007-004: routing exposes a signal to one project without creating downstream work', async (t) => {
  if (!requireDatabase(t)) return;
  const { organization, projectA } = await createFixture();
  const search = await callTool('ba_search_organization_intelligence', searchArgs(organization.id));
  const signal = search.signals[0];
  const assessment = signal.project_assessments.find((entry) => entry.project_id === projectA.id);
  const before = {
    initiatives: await prisma.initiative.count({ where: { project_id: projectA.id } }),
    content: await prisma.contentItem.count({ where: { project_id: projectA.id } }),
  };

  const route = await callTool('ba_route_organization_signal', {
    userId: TEST_USER_ID,
    actorId: ACTOR_ID,
    organizationId: organization.id,
    signalId: signal.id,
    projectId: projectA.id,
    assessmentRevision: assessment.revision,
    decision: 'routed',
    note: 'Review in the project inbox before creating work.',
    idempotencyKey: `tdpd-007-route-${randomUUID()}`,
  });

  assert.equal(route.project_id, projectA.id);
  assert.equal(route.state, 'routed');
  assert.equal(await prisma.initiative.count({ where: { project_id: projectA.id } }), before.initiatives);
  assert.equal(await prisma.contentItem.count({ where: { project_id: projectA.id } }), before.content);
});

test('E2E-007-005: explicit promotion is project-authorized, provenance-bound, and idempotent', async (t) => {
  if (!requireDatabase(t)) return;
  const { organization, projectA } = await createFixture();
  const search = await callTool('ba_search_organization_intelligence', searchArgs(organization.id));
  const signal = search.signals[0];
  const assessment = signal.project_assessments.find((entry) => entry.project_id === projectA.id);
  const route = await callTool('ba_route_organization_signal', {
    userId: TEST_USER_ID,
    actorId: ACTOR_ID,
    organizationId: organization.id,
    signalId: signal.id,
    projectId: projectA.id,
    assessmentRevision: assessment.revision,
    decision: 'routed',
    idempotencyKey: `tdpd-007-route-promote-${randomUUID()}`,
  });
  const idempotencyKey = `tdpd-007-promote-${randomUUID()}`;
  const args = {
    userId: TEST_USER_ID,
    actorId: ACTOR_ID,
    projectId: projectA.id,
    routeId: route.id,
    target: 'initiative',
    title: 'Validate cross-agent approval-state demand',
    idempotencyKey,
  };
  const first = await callTool('ba_promote_project_signal', args);
  const replay = await callTool('ba_promote_project_signal', args);

  assert.equal(replay.artifact.id, first.artifact.id);
  assert.equal(first.artifact.type, 'initiative');
  assert.equal(first.artifact.provenance.source_signal_id, signal.id);
  assert.equal(first.artifact.provenance.assessment_revision, assessment.revision);
});

test('E2E-007-006: project-only outsider cannot read or search the organization', async (t) => {
  if (!requireDatabase(t)) return;
  const { organization, projectA } = await createFixture();
  await prisma.projectMember.create({ data: { project_id: projectA.id, user_id: OTHER_USER_ID, role: 'viewer' } });

  const contextError = await callToolError('ba_get_organization_intelligence_context', {
    userId: OTHER_USER_ID,
    organizationId: organization.id,
  });
  assert.match(contextError, /access denied|organization access required/i);

  const searchError = await callToolError('ba_search_organization_intelligence', searchArgs(organization.id, {
    userId: OTHER_USER_ID,
    actorId: `user:${OTHER_USER_ID}`,
    idempotencyKey: `tdpd-007-outsider-${randomUUID()}`,
  }));
  assert.match(searchError, /access denied|organization access required/i);
});
