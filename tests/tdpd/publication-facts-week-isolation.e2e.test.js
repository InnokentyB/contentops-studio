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
const OTHER_ACTOR_ID = `user:${OTHER_USER_ID}`;

const pool = TEST_DATABASE_URL ? new Pool({ connectionString: TEST_DATABASE_URL }) : null;
const adapter = pool ? new PrismaPg(pool) : null;
const prisma = adapter ? new PrismaClient({ adapter }) : null;

let client;
let transport;
let toolNames = new Set();

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to run PFM/WPI database scenarios');
    return false;
  }
  return true;
}

function payload(result) {
  if (result?.isError) {
    const message = (result.content || []).map((entry) => entry.text || '').join('\n');
    assert.fail(message || 'MCP tool failed');
  }
  return result?.structuredContent || {};
}

async function callTool(name, args) {
  return payload(await client.callTool({ name, arguments: args }));
}

async function callToolError(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, `${name} must reject the request`);
  return (result.content || []).map((entry) => entry.text || '').join('\n');
}

function buildPlan(planId, start, end, actionId, scheduledAt) {
  return {
    meta: {
      plan_id: planId,
      plan_version: '1.0.0',
      cycle_start: start,
      cycle_end: end,
      timezone_default: 'Europe/Lisbon',
      week_theme: `Cycle ${start}`,
    },
    accounts: { primary_tg: { platform: 'telegram' } },
    assets: {},
    actions: [{
      id: actionId,
      item_key: actionId,
      display_name: `Publication ${actionId}`,
      channel: 'telegram',
      account_ref: 'primary_tg',
      action_type: 'post_text',
      status: 'planned',
      scheduled_at: scheduledAt,
    }],
    ongoing_rules: [],
    measurement: {},
  };
}

async function ensureUsers() {
  for (const [id, suffix] of [[TEST_USER_ID, 'owner'], [OTHER_USER_ID, 'other']]) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        email: `pfm-${suffix}-${id}@example.com`,
        password_hash: 'hash',
        name: `PFM ${suffix}`,
      },
    });
  }
}

test.before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  client = new Client({ name: 'tdpd-pfm-wpi', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const response = await client.listTools();
  toolNames = new Set((response.tools || []).map((entry) => entry.name));
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('RED-PFM-000: MCP exposes canonical publication facts and checkpoint queue', () => {
  for (const name of [
    'ba_record_publication_fact', 'ba_get_publication_fact', 'ba_list_metric_checkpoints',
    'ba_preview_week_package_repair', 'ba_apply_week_package_repair', 'ba_rollback_week_package_repair',
  ]) {
    assert.ok(toolNames.has(name), `${name} must exist before the combined slice can be GREEN`);
  }
});

test('E2E-PFM-001/002/005: post requires permalink and creates T+24h/T+7d once', async (t) => {
  if (!requireDatabase(t)) return;
  await ensureUsers();
  const planId = `pfm-${randomUUID()}`;
  const imported = await callTool('ba_import_publication_plan_json', {
    userId: TEST_USER_ID,
    planJson: JSON.stringify(buildPlan(planId, '2026-08-10', '2026-08-16', 'post-1', '2026-08-12T10:00:00Z')),
  });
  const item = await prisma.contentItem.findFirstOrThrow({ where: { project_id: imported.project.id } });

  const error = await callToolError('ba_record_publication_fact', {
    projectId: imported.project.id,
    actorId: ACTOR_ID,
    taskId: item.id,
    artifactKind: 'post',
    outcome: 'published',
    publishedAt: '2026-08-12T10:05:00Z',
    confirmationMode: 'manual',
  });
  assert.match(error, /PUBLIC_URL_REQUIRED/);

  const args = {
    projectId: imported.project.id,
    actorId: ACTOR_ID,
    taskId: item.id,
    artifactKind: 'post',
    outcome: 'published',
    publishedAt: '2026-08-12T10:05:00Z',
    publicUrl: 'https://example.com/posts/1',
    confirmationMode: 'manual',
    evidence: { type: 'public_url', ref: 'https://example.com/posts/1' },
  };
  const first = await callTool('ba_record_publication_fact', args);
  const replay = await callTool('ba_record_publication_fact', args);
  assert.equal(first.publication_fact.id, replay.publication_fact.id);
  assert.equal(first.created_metric_work_items, 2);

  const checkpoints = await prisma.metricSnapshot.findMany({
    where: { project_id: imported.project.id, content_item_id: item.id },
    orderBy: { checkpoint: 'asc' },
  });
  assert.deepEqual(checkpoints.map((entry) => entry.checkpoint), ['t24h', 't7d']);
  const metricWorkItems = await prisma.workItem.findMany({
    where: { project_id: imported.project.id, content_item_id: item.id, kind: 'metric_capture' },
    orderBy: { item_key: 'asc' },
  });
  assert.deepEqual(metricWorkItems.map((entry) => entry.item_key), [
    `metric:${item.id}:t24h`,
    `metric:${item.id}:t7d`,
  ]);
  assert.ok(metricWorkItems.every((entry) => entry.state === 'available' && entry.assignee_role === 'metrics_operator'));
  assert.equal((await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } })).published_link, args.publicUrl);
});

test('E2E-PFM-003/004: story can omit permalink but not identity or evidence', async (t) => {
  if (!requireDatabase(t)) return;
  await ensureUsers();
  const project = await prisma.project.create({
    data: {
      name: 'Story fact project',
      slug: `story-${randomUUID()}`,
      members: { create: { user_id: TEST_USER_ID, role: 'owner' } },
    },
  });
  const channel = await prisma.socialChannel.create({
    data: { project_id: project.id, name: 'story-channel', type: 'vk', config: {} },
  });
  const item = await prisma.contentItem.create({
    data: { project_id: project.id, channel_id: channel.id, type: 'vk:story', status: 'planned' },
  });

  const incomplete = await callToolError('ba_record_publication_fact', {
    projectId: project.id,
    actorId: ACTOR_ID,
    taskId: item.id,
    artifactKind: 'story',
    outcome: 'published',
    publishedAt: '2026-08-15T18:30:00Z',
    confirmationMode: 'manual',
  });
  assert.match(incomplete, /STORY_EVIDENCE_REQUIRED/);

  const result = await callTool('ba_record_publication_fact', {
    projectId: project.id,
    actorId: ACTOR_ID,
    taskId: item.id,
    artifactKind: 'story',
    outcome: 'published',
    publishedAt: '2026-08-15T18:30:00Z',
    providerObjectId: 'story:vk:20260815T183000',
    confirmationMode: 'manual',
    evidence: { type: 'screenshot', ref: 'asset://story-proof' },
  });
  assert.equal(result.publication_fact.public_url, null);
  assert.equal(result.publication_fact.artifact_kind, 'story');
});

test('E2E-PFM-006/010/014: zero stays observed, latest checkpoint wins, other project is hidden', async (t) => {
  if (!requireDatabase(t)) return;
  await ensureUsers();
  const project = await prisma.project.create({
    data: {
      name: 'Metrics fact project',
      slug: `metrics-${randomUUID()}`,
      members: { create: { user_id: TEST_USER_ID, role: 'owner' } },
    },
  });
  const channel = await prisma.socialChannel.create({
    data: { project_id: project.id, name: 'metrics-channel', type: 'telegram', config: {} },
  });
  const item = await prisma.contentItem.create({
    data: { project_id: project.id, channel_id: channel.id, type: 'telegram:post', status: 'planned' },
  });
  await callTool('ba_record_publication_fact', {
    projectId: project.id,
    actorId: ACTOR_ID,
    taskId: item.id,
    artifactKind: 'post',
    outcome: 'published',
    publishedAt: '2026-08-10T10:00:00Z',
    publicUrl: 'https://example.com/metric-post',
    confirmationMode: 'manual',
  });

  for (const [checkpoint, views] of [['t24h', 100], ['t7d', 180]]) {
    await callTool('ba_record_metric_snapshot', {
      projectId: project.id,
      actorId: ACTOR_ID,
      contentItemId: item.id,
      channelId: channel.id,
      checkpoint,
      collectionMode: 'manual',
      source: 'manual',
      collectionStatus: 'collected',
      capturedAt: checkpoint === 't24h' ? '2026-08-11T10:05:00Z' : '2026-08-17T10:05:00Z',
      metrics: {
        schema_version: 1,
        values: {
          views: { value: views, status: 'observed' },
          reactions: { value: 0, status: 'observed' },
          platform_clicks: { value: null, status: 'unknown' },
        },
      },
      idempotencyKey: `${project.id}-${item.id}-${checkpoint}`,
    });
  }

  const metrics = await callTool('ba_get_content_metrics', {
    projectId: project.id,
    actorId: ACTOR_ID,
    contentItemId: item.id,
  });
  assert.equal(metrics.latest_by_metric.views.value, 180);
  assert.equal(metrics.latest_by_metric.reactions.value, 0);
  assert.equal(metrics.latest_by_metric.platform_clicks.status, 'unknown');

  const hidden = await callToolError('ba_get_content_metrics', {
    projectId: project.id,
    actorId: OTHER_ACTOR_ID,
    contentItemId: item.id,
  });
  assert.match(hidden, /not found|access denied/i);
});

test('E2E-WPI-001–006: next delta creates an exact-cycle package and never moves published runtime', async (t) => {
  if (!requireDatabase(t)) return;
  await ensureUsers();
  const planId = `wpi-${randomUUID()}`;
  const w10 = await callTool('ba_import_publication_plan_json', {
    userId: TEST_USER_ID,
    planJson: JSON.stringify(buildPlan(planId, '2026-08-10', '2026-08-16', 'w10-post', '2026-08-12T10:00:00Z')),
  });
  const oldPackage = await prisma.weekPackage.findUniqueOrThrow({ where: { id: w10.week_package.id } });
  const oldItem = await prisma.contentItem.findFirstOrThrow({ where: { project_id: w10.project.id } });
  await callTool('ba_record_publication_fact', {
    projectId: w10.project.id,
    actorId: ACTOR_ID,
    taskId: oldItem.id,
    artifactKind: 'post',
    outcome: 'published',
    publishedAt: '2026-08-12T10:00:00Z',
    publicUrl: 'https://example.com/w10-post',
    confirmationMode: 'manual',
  });

  const w11Plan = buildPlan(planId, '2026-08-17', '2026-08-23', 'w11-post', '2026-08-18T10:00:00Z');
  const w11 = await callTool('ba_import_publication_plan_delta_json', {
    userId: TEST_USER_ID,
    planJson: JSON.stringify(w11Plan),
  });
  assert.notEqual(w11.week_package.id, oldPackage.id);
  assert.equal(w11.imported.previousPackagesUpdated, 0);
  assert.equal(w11.imported.movedTasks, 0);

  const afterOldPackage = await prisma.weekPackage.findUniqueOrThrow({ where: { id: oldPackage.id } });
  const afterOldItem = await prisma.contentItem.findUniqueOrThrow({ where: { id: oldItem.id } });
  assert.equal(afterOldPackage.week_start.toISOString(), oldPackage.week_start.toISOString());
  assert.equal(afterOldItem.week_package_id, oldPackage.id);
  assert.equal(afterOldItem.status, 'published');
  assert.equal(afterOldItem.published_link, 'https://example.com/w10-post');

  const replay = await callTool('ba_import_publication_plan_delta_json', {
    userId: TEST_USER_ID,
    planJson: JSON.stringify(w11Plan),
  });
  assert.equal(replay.week_package.id, w11.week_package.id);
  assert.equal(await prisma.weekPackage.count({ where: { project_id: w10.project.id } }), 2);

  const conflictPlan = buildPlan(planId, '2026-08-17', '2026-08-23', 'w10-post', '2026-08-19T10:00:00Z');
  const conflict = await callToolError('ba_import_publication_plan_delta_json', {
    userId: TEST_USER_ID,
    planJson: JSON.stringify(conflictPlan),
  });
  assert.match(conflict, /CROSS_CYCLE_TASK_ID/);
});

test('OPS-WPI-011/012: repair previews without writes, applies atomically, and rolls back from audit', async (t) => {
  if (!requireDatabase(t)) return;
  await ensureUsers();
  const project = await prisma.project.create({
    data: {
      name: 'Repair project',
      slug: `repair-${randomUUID()}`,
      members: { create: { user_id: TEST_USER_ID, role: 'owner' } },
    },
  });
  const source = await prisma.weekPackage.create({
    data: { project_id: project.id, week_start: new Date('2026-08-10Z'), week_end: new Date('2026-08-16Z') },
  });
  const item = await prisma.contentItem.create({
    data: { project_id: project.id, week_package_id: source.id, type: 'telegram:post', status: 'published', published_link: 'https://example.com/repair' },
  });
  const moves = [{ contentItemId: item.id, weekStart: '2026-08-17', weekEnd: '2026-08-23' }];
  const preview = await callTool('ba_preview_week_package_repair', { projectId: project.id, actorId: ACTOR_ID, moves });
  assert.equal(preview.dry_run, true);
  assert.equal((await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } })).week_package_id, source.id);

  const applyKey = `repair-apply-${randomUUID()}`;
  const applied = await callTool('ba_apply_week_package_repair', {
    projectId: project.id,
    actorId: ACTOR_ID,
    moves,
    reason: 'Restore exact week projection',
    idempotencyKey: applyKey,
  });
  assert.notEqual(applied.applied[0].to_week_package_id, source.id);
  const replay = await callTool('ba_apply_week_package_repair', {
    projectId: project.id,
    actorId: ACTOR_ID,
    moves,
    reason: 'Restore exact week projection',
    idempotencyKey: applyKey,
  });
  assert.equal(replay.replayed, true);

  await callTool('ba_rollback_week_package_repair', {
    projectId: project.id,
    actorId: ACTOR_ID,
    applyIdempotencyKey: applyKey,
    idempotencyKey: `repair-rollback-${randomUUID()}`,
  });
  assert.equal((await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } })).week_package_id, source.id);
});
