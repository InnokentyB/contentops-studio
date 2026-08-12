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
  return `tdpd-b-${label}-${randomUUID()}`;
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !prisma) {
    t.skip('Set TDPD_TEST_DATABASE_URL to execute DB-backed Suite B scenarios');
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
      week_theme: 'Suite B: Concurrency, Lease Recovery & Rewrite',
      project_name: `TDPD Suite B ${planId}`,
    },
    accounts: {
      primary_tg: { platform: 'telegram' },
    },
    assets: {
      inline_source: {
        type: 'source_context',
        content: 'Suite B test content source',
      },
    },
    actions: [
      {
        id: 'post-b1',
        item_key: 'post-b1',
        display_name: 'Post B1 for concurrent claim',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T10:00:00.000Z',
        scheduled_at: '2026-08-10T10:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'post-b2',
        item_key: 'post-b2',
        display_name: 'Post B2 for lease recovery',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T12:00:00.000Z',
        scheduled_at: '2026-08-10T12:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'post-b3',
        item_key: 'post-b3',
        display_name: 'Post B3 for reject rewrite',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T14:00:00.000Z',
        scheduled_at: '2026-08-10T14:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'post-b4',
        item_key: 'post-b4',
        display_name: 'Post B4 for stale approval',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T16:00:00.000Z',
        scheduled_at: '2026-08-10T16:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'post-b5',
        item_key: 'post-b5',
        display_name: 'Post B5 for reschedule audit',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T18:00:00.000Z',
        scheduled_at: '2026-08-10T18:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'post-b6',
        item_key: 'post-b6',
        display_name: 'Post B6 for idempotency scope',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T20:00:00.000Z',
        scheduled_at: '2026-08-10T20:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'post-b7',
        item_key: 'post-b7',
        display_name: 'Post B7 for active lease stability',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T21:00:00.000Z',
        scheduled_at: '2026-08-10T21:00:00.000Z',
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

      const planId = `tdpd-b-${randomUUID()}`;
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
        idempotencyKey: idempotencyKey('approve-suite-b'),
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
  client = new Client({ name: 'tdpd-b-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
});

test.after(async () => {
  if (client) await client.close();
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
});

test('B-001 / SC-B01: concurrent claim on the same available work item yields exactly 1 winner', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'post-b1' && w.kind === 'content_write',
    { state: 'available' },
  );

  const actor1 = 'agent:content_writer';
  const actor2 = 'system:planner';

  const claim1 = client.callTool({
    name: 'ba_claim_work_item',
    arguments: {
      projectId: fixture.projectId,
      actorId: actor1,
      workItemId: item.id,
      idempotencyKey: idempotencyKey('conc-claim-1'),
    },
  });

  const claim2 = client.callTool({
    name: 'ba_claim_work_item',
    arguments: {
      projectId: fixture.projectId,
      actorId: actor2,
      workItemId: item.id,
      idempotencyKey: idempotencyKey('conc-claim-2'),
    },
  });

  const [res1, res2] = await Promise.all([claim1, claim2]);
  const successCount = [res1, res2].filter((r) => !r.isError).length;
  const errorCount = [res1, res2].filter((r) => r.isError).length;

  assert.equal(successCount, 1, 'Exactly 1 concurrent claim must succeed');
  assert.equal(errorCount, 1, 'Exactly 1 concurrent claim must fail');

  const errRes = [res1, res2].find((r) => r.isError);
  const text = (errRes.content || []).map((i) => i.text || '').join('\n');
  assert.match(text, /WORK_ITEM_ALREADY_CLAIMED/);
});

test('B-002 / SC-B02: expired lease can be recovered by a new claim call', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'post-b2' && w.kind === 'content_write',
    { state: 'available' },
  );

  // Set lease_expires_at in the past via direct DB update
  const pastDate = new Date(Date.now() - 3600 * 1000);
  await prisma.workItem.update({
    where: { id: item.id },
    data: {
      state: 'claimed',
      lease_token: 'lease-expired-old',
      lease_expires_at: pastDate,
      lease_actor_id: 'agent:old_actor',
    },
  });

  // Now actor B claims the item with expired lease
  const newActor = 'agent:content_writer';
  const recoveryKey = idempotencyKey('recovery-claim');
  const recoveryClaim = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId: newActor,
    workItemId: item.id,
    idempotencyKey: recoveryKey,
  });

  assert.ok(recoveryClaim.lease_token);
  assert.notEqual(recoveryClaim.lease_token, 'lease-expired-old');

  // Verify DB state
  const updatedItem = await prisma.workItem.findUnique({ where: { id: item.id } });
  assert.equal(updatedItem.state, 'claimed');
  assert.equal(updatedItem.lease_actor_id, newActor);

  const staleCompletion = await client.callTool({
    name: 'ba_complete_work_item',
    arguments: {
      projectId: fixture.projectId,
      actorId: newActor,
      workItemId: item.id,
      leaseToken: 'lease-expired-old',
      result: { body: 'Must not be accepted' },
      idempotencyKey: idempotencyKey('expired-token-complete'),
    },
  });
  assert.equal(staleCompletion.isError, true, 'The previous expired token must remain invalid after recovery');

  const recoveryEvent = await prisma.workflowEvent.findFirst({
    where: {
      project_id: fixture.projectId,
      work_item_id: item.id,
      actor_id: newActor,
      command: 'ba_claim_work_item',
      idempotency_key: recoveryKey,
    },
  });
  assert.ok(recoveryEvent, 'Lease recovery must create an audit event');
  assert.equal(recoveryEvent.before_state?.lease_actor_id, 'agent:old_actor');
  assert.equal(recoveryEvent.before_state?.lease_expires_at, pastDate.toISOString());
  assert.equal(JSON.stringify(recoveryEvent.after_state).includes(recoveryClaim.lease_token), false, 'Audit history must not store the lease token');
});

test('B-003 / SC-B03: rejection of content creates a rewrite work item with incremented input_context_version', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'post-b3' && w.kind === 'content_write',
    { state: 'available' },
  );

  const writerActor = 'agent:content_writer';
  const reviewerActor = 'agent:content_reviewer';

  // Claim and complete content_write
  const claimRes = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId: writerActor,
    workItemId: item.id,
    idempotencyKey: idempotencyKey('claim-b3'),
  });
  await callTool('ba_complete_work_item', {
    projectId: fixture.projectId,
    actorId: writerActor,
    workItemId: item.id,
    leaseToken: claimRes.lease_token,
    result: { body: 'First draft for rejection test' },
    idempotencyKey: idempotencyKey('complete-b3'),
  });

  const reviewItem = await findWorkItem(
    fixture.projectId,
    (w) => w.content_item_id === item.content_item_id && w.kind === 'content_review',
  );

  // Reject the review item
  const rejectRes = await callTool('ba_decide_approval', {
    projectId: fixture.projectId,
    actorId: reviewerActor,
    workItemId: reviewItem.id,
    resultVersion: reviewItem.result_version,
    decision: 'rejected',
    comment: 'Tone needs to be more professional',
    idempotencyKey: idempotencyKey('decide-reject-b3'),
  });

  assert.equal(rejectRes.approval.decision, 'rejected');

  // Verify new content_write item exists with input_context_version = 2
  const rewriteItem = await findWorkItem(
    fixture.projectId,
    (w) => w.content_item_id === item.content_item_id && w.kind === 'content_write' && w.state === 'available',
  );

  assert.ok(rewriteItem);
  assert.equal(rewriteItem.input_context_version, 2, 'input_context_version must be incremented to 2');
});

test('B-004 / SC-B04: stale approval decision fails with [STALE_RESULT_VERSION]', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'post-b4' && w.kind === 'content_write',
    { state: 'available' },
  );

  const writerActor = 'agent:content_writer';
  const claimRes = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId: writerActor,
    workItemId: item.id,
    idempotencyKey: idempotencyKey('claim-b4'),
  });
  await callTool('ba_complete_work_item', {
    projectId: fixture.projectId,
    actorId: writerActor,
    workItemId: item.id,
    leaseToken: claimRes.lease_token,
    result: { body: 'Draft for stale approval test' },
    idempotencyKey: idempotencyKey('complete-b4'),
  });

  const reviewItem = await findWorkItem(
    fixture.projectId,
    (w) => w.content_item_id === item.content_item_id && w.kind === 'content_review',
  );

  const res = await client.callTool({
    name: 'ba_decide_approval',
    arguments: {
      projectId: fixture.projectId,
      actorId: 'agent:content_reviewer',
      workItemId: reviewItem.id,
      resultVersion: 999, // Stale version
      decision: 'approved',
      idempotencyKey: idempotencyKey('stale-approval-b4'),
    },
  });

  assert.equal(res.isError, true, 'Stale result_version decision must be rejected');
  const text = (res.content || []).map((i) => i.text || '').join('\n');
  assert.match(text, /STALE_RESULT_VERSION/);
});

test('B-005 / SC-B05: reschedule updates due_at and logs ba_reschedule_work_item audit event', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'post-b5' && w.kind === 'content_write',
    { state: 'available' },
  );

  const newDue = '2026-08-15T18:00:00.000Z';
  const rescheduleRes = await callTool('ba_reschedule_work_item', {
    projectId: fixture.projectId,
    actorId: 'system:planner',
    workItemId: item.id,
    dueAt: newDue,
    reason: 'Schedule adjusted by planner',
    idempotencyKey: idempotencyKey('reschedule-audit-b5'),
  });

  assert.ok(rescheduleRes.work_item);

  // Verify workflow event logged in DB
  const event = await prisma.workflowEvent.findFirst({
    where: {
      project_id: fixture.projectId,
      command: 'ba_reschedule_work_item',
      work_item_id: item.id,
    },
  });

  assert.ok(event, 'ba_reschedule_work_item workflow event must be logged');
  assert.equal(event.actor_id, 'system:planner');
});

test('B-006 / SC-B06: idempotency key is scoped per project, actor, and command', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'post-b6' && w.kind === 'content_write',
    { state: 'available' },
  );

  const key = idempotencyKey('scoped-key-reuse-b6');

  // Command 1: claim
  const claimRes = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId: 'agent:content_writer',
    workItemId: item.id,
    idempotencyKey: key,
  });
  assert.ok(claimRes.lease_token);

  // Command 2: release with same idempotency key string
  const releaseRes = await callTool('ba_release_work_item', {
    projectId: fixture.projectId,
    actorId: 'agent:content_writer',
    workItemId: item.id,
    leaseToken: claimRes.lease_token,
    idempotencyKey: key,
  });
  assert.equal(releaseRes.work_item.state, 'available');
});

test('B-007 / SC-B07: a second claim with a different key cannot rotate an active lease, even for its owner', async (t) => {
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const item = await findWorkItem(
    fixture.projectId,
    (w) => w.item_key === 'post-b7' && w.kind === 'content_write',
    { state: 'available' },
  );

  const actorId = 'agent:content_writer';
  const firstClaim = await callTool('ba_claim_work_item', {
    projectId: fixture.projectId,
    actorId,
    workItemId: item.id,
    idempotencyKey: idempotencyKey('stable-lease-first'),
  });

  const secondClaim = await client.callTool({
    name: 'ba_claim_work_item',
    arguments: {
      projectId: fixture.projectId,
      actorId,
      workItemId: item.id,
      idempotencyKey: idempotencyKey('stable-lease-second'),
    },
  });

  assert.equal(secondClaim.isError, true, 'A different command key must not replace an active lease');
  const persisted = await prisma.workItem.findUnique({ where: { id: item.id } });
  assert.equal(persisted.lease_token, firstClaim.lease_token, 'The original active lease token must remain valid');
});
