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
const createdProjectIds = [];

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to run TDPD-006 Slice A database scenarios');
    return false;
  }
  return true;
}

function requireTool(name) {
  assert.ok(toolNames.has(name), `${name} must exist before TDPD-006 Slice A can be GREEN`);
}

function payload(result) {
  if (result?.isError) {
    const message = (result.content || []).map((entry) => entry.text || '').join('\n');
    assert.fail(message || 'MCP tool failed');
  }
  return result?.structuredContent || {};
}

async function callTool(name, args) {
  requireTool(name);
  return payload(await client.callTool({ name, arguments: args }));
}

async function callToolError(name, args) {
  requireTool(name);
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, `${name} must reject the request`);
  return (result.content || []).map((entry) => entry.text || '').join('\n');
}

async function ensureOwner() {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: {
      id: TEST_USER_ID,
      email: `tdpd-006-owner-${TEST_USER_ID}@example.com`,
      password_hash: 'hash',
      name: 'TDPD 006 owner',
    },
  });
}

async function createPilotProject() {
  await ensureOwner();
  const project = await prisma.project.create({
    data: {
      name: 'TDPD 006 pilot',
      slug: `tdpd-006-${randomUUID()}`,
      members: { create: { user_id: TEST_USER_ID, role: 'owner' } },
      settings: { create: { key: 'weekly_theme_pipeline_v1', value: 'true' } },
    },
  });
  createdProjectIds.push(project.id);
  const channel = await prisma.socialChannel.create({
    data: {
      project_id: project.id,
      name: '@analysts_thinking',
      type: 'telegram',
      config: { workflow_mode: 'automatic', telegram_channel_id: '111' },
    },
  });
  return { project, channel };
}

function themeArgs(projectId, channelId, overrides = {}) {
  return {
    projectId,
    actorId: ACTOR_ID,
    channelId,
    targetWeekStart: '2026-08-24',
    targetWeekEnd: '2026-08-30',
    timezone: 'Europe/Lisbon',
    title: 'Как аналитик сохраняет субъектность при работе с агентами',
    body: 'Одна ось недели: делегировать производство, но не отдавать постановку задачи и приёмку результата.',
    sourceRefs: [{ type: 'planner_note', ref: 'uat://week-theme/2026-08-23' }],
    expectedRevision: 0,
    state: 'accepted',
    acceptedAt: '2026-08-22T16:30:00Z',
    idempotencyKey: `theme-${randomUUID()}`,
    ...overrides,
  };
}

function previewArgs(projectId, channelId, theme, overrides = {}) {
  return {
    projectId,
    actorId: ACTOR_ID,
    channelId,
    weekPackageId: theme.week_package_id,
    themeContentItemId: theme.theme_content_item_id,
    themeRevision: theme.theme_revision,
    timezone: 'Europe/Lisbon',
    scheduleTemplate: { localTime: '12:00', days: [1, 2, 3, 4, 5, 6, 7] },
    idempotencyKey: `preview-${randomUUID()}`,
    ...overrides,
  };
}

function assertSevenDayPreview(preview) {
  assert.equal(preview.proposals.length, 7);
  assert.deepEqual(
    preview.proposals.map((entry) => entry.local_date),
    ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
  );
  assert.equal(new Set(preview.proposals.map((entry) => entry.local_date)).size, 7);
  for (const [index, proposal] of preview.proposals.entries()) {
    assert.equal(proposal.day_index, index + 1);
    assert.ok(proposal.thesis?.trim());
    assert.ok(proposal.function?.trim());
    assert.ok(proposal.source?.theme_content_item_id);
    assert.ok(proposal.difference_from_neighbors?.trim());
    assert.ok(proposal.publish_at?.includes('T'));
  }
}

test.before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      WEEK_TOPIC_GENERATOR_MODE: 'deterministic_test',
    },
  });
  client = new Client({ name: 'tdpd-006-slice-a', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const response = await client.listTools();
  toolNames = new Set((response.tools || []).map((entry) => entry.name));
});

test.after(async () => {
  if (prisma && createdProjectIds.length) {
    await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  }
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('E2E-006-001: accepted Sunday theme creates exactly seven dated proposals and no production queue', async (t) => {
  if (!requireDatabase(t)) return;
  const { project, channel } = await createPilotProject();
  const theme = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id));
  const preview = await callTool('ba_generate_week_topic_preview', previewArgs(project.id, channel.id, theme));

  assert.equal(preview.approval_status, 'awaiting_plan_approval');
  assert.equal(preview.theme_revision, theme.theme_revision);
  assertSevenDayPreview(preview);

  const productionItems = await prisma.workItem.count({
    where: {
      project_id: project.id,
      kind: { in: ['content_write', 'anti_slop_review', 'chief_editor_review', 'image_generate', 'image_review', 'delivery'] },
    },
  });
  assert.equal(productionItems, 0);
});

test('E2E-006-002: preview generation replay returns the same plan version without duplicates', async (t) => {
  if (!requireDatabase(t)) return;
  const { project, channel } = await createPilotProject();
  const theme = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id));
  const idempotencyKey = `preview-replay-${randomUUID()}`;
  const args = previewArgs(project.id, channel.id, theme, { idempotencyKey });
  const first = await callTool('ba_generate_week_topic_preview', args);
  const replay = await callTool('ba_generate_week_topic_preview', args);

  assert.equal(replay.plan_version, first.plan_version);
  assert.deepEqual(replay.proposals.map((entry) => entry.id), first.proposals.map((entry) => entry.id));
  const pipeline = await callTool('ba_get_week_pipeline', {
    projectId: project.id,
    actorId: ACTOR_ID,
    weekPackageId: theme.week_package_id,
  });
  assert.equal(pipeline.days.length, 7);
});

test('E2E-006-003: changing the accepted theme makes the old preview stale', async (t) => {
  if (!requireDatabase(t)) return;
  const { project, channel } = await createPilotProject();
  const themeV1 = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id));
  const previewV1 = await callTool('ba_generate_week_topic_preview', previewArgs(project.id, channel.id, themeV1));
  const themeV2 = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id, {
    expectedRevision: themeV1.theme_revision,
    body: 'Уточнённая ось недели: сохранять субъектность через постановку, ограничения и проверяемую приёмку.',
    idempotencyKey: `theme-v2-${randomUUID()}`,
  }));
  assert.equal(themeV2.theme_revision, themeV1.theme_revision + 1);

  const error = await callToolError('ba_decide_week_plan', {
    projectId: project.id,
    actorId: ACTOR_ID,
    weekPackageId: themeV1.week_package_id,
    planVersion: previewV1.plan_version,
    decision: 'approved',
    idempotencyKey: `stale-approve-${randomUUID()}`,
  });
  assert.match(error, /STALE_THEME_REVISION/);
});

test('E2E-006-004: rejecting preview records the comment and creates no production work', async (t) => {
  if (!requireDatabase(t)) return;
  const { project, channel } = await createPilotProject();
  const theme = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id));
  const preview = await callTool('ba_generate_week_topic_preview', previewArgs(project.id, channel.id, theme));
  await callTool('ba_decide_week_plan', {
    projectId: project.id,
    actorId: ACTOR_ID,
    weekPackageId: theme.week_package_id,
    planVersion: preview.plan_version,
    decision: 'rejected',
    comment: 'Дни 3 и 4 повторяют один тезис.',
    idempotencyKey: `reject-${randomUUID()}`,
  });

  const pipeline = await callTool('ba_get_week_pipeline', {
    projectId: project.id,
    actorId: ACTOR_ID,
    weekPackageId: theme.week_package_id,
  });
  assert.equal(pipeline.approval.decision, 'rejected');
  assert.equal(pipeline.approval.comment, 'Дни 3 и 4 повторяют один тезис.');
  assert.equal(await prisma.workItem.count({
    where: { project_id: project.id, kind: { in: ['content_write', 'image_generate', 'delivery'] } },
  }), 0);
});

test('E2E-006-005: approving current preview creates exactly seven content_write items and replay is idempotent', async (t) => {
  if (!requireDatabase(t)) return;
  const { project, channel } = await createPilotProject();
  const theme = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id));
  const preview = await callTool('ba_generate_week_topic_preview', previewArgs(project.id, channel.id, theme));
  const args = {
    projectId: project.id,
    actorId: ACTOR_ID,
    weekPackageId: theme.week_package_id,
    planVersion: preview.plan_version,
    decision: 'approved',
    idempotencyKey: `approve-${randomUUID()}`,
  };
  await callTool('ba_decide_week_plan', args);
  await callTool('ba_decide_week_plan', args);

  const writes = await prisma.workItem.findMany({
    where: { project_id: project.id, week_package_id: theme.week_package_id, kind: 'content_write' },
  });
  assert.equal(writes.length, 7);
  assert.equal(new Set(writes.map((entry) => entry.content_item_id)).size, 7);
  assert.ok(writes.every((entry) => entry.state === 'available'));
});

test('E2E-006-017: draft or late Sunday theme blocks preview with a machine-readable reason', async (t) => {
  if (!requireDatabase(t)) return;
  const { project, channel } = await createPilotProject();
  const draft = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id, {
    state: 'draft',
    acceptedAt: null,
    idempotencyKey: `draft-${randomUUID()}`,
  }));
  const draftError = await callToolError('ba_generate_week_topic_preview', previewArgs(project.id, channel.id, draft));
  assert.match(draftError, /WEEK_THEME_NOT_APPROVED/);

  const late = await callTool('ba_upsert_week_theme', themeArgs(project.id, channel.id, {
    expectedRevision: draft.theme_revision,
    state: 'accepted',
    acceptedAt: '2026-08-22T17:30:01Z',
    idempotencyKey: `late-${randomUUID()}`,
  }));
  const lateError = await callToolError('ba_generate_week_topic_preview', previewArgs(project.id, channel.id, late));
  assert.match(lateError, /WEEK_THEME_LATE/);
});

test('E2E-006-018: planner and writer profiles expose only their pipeline responsibilities', () => {
  for (const tool of ['ba_upsert_week_theme', 'ba_generate_week_topic_preview', 'ba_decide_week_plan', 'ba_get_week_pipeline']) {
    assert.equal(isToolAllowedForProfile('planner', tool), true, `planner must be allowed to use ${tool}`);
  }
  assert.equal(isToolAllowedForProfile('planner', 'ba_update_publication_content'), false);
  assert.equal(isToolAllowedForProfile('planner', 'ba_publish_direct'), false);

  for (const tool of ['ba_list_work_items', 'ba_claim_work_item', 'ba_get_work_item_context', 'ba_complete_work_item', 'ba_block_work_item', 'ba_release_work_item']) {
    assert.equal(isToolAllowedForProfile('writer', tool), true, `writer must be allowed to use ${tool}`);
  }
  assert.equal(isToolAllowedForProfile('writer', 'ba_upsert_week_theme'), false);
  assert.equal(isToolAllowedForProfile('writer', 'ba_decide_week_plan'), false);
  assert.equal(isToolAllowedForProfile('writer', 'ba_publish_direct'), false);
});
