const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const SPEC_PATH = 'docs/tdpd/001-mcp-weekly-production-spec-ru.md';
const SERVER_PATH = path.join(process.cwd(), 'dist', 'mcp', 'server.js');
const TEST_DATABASE_URL = process.env.TDPD_TEST_DATABASE_URL || '';
const TEST_USER_ID = Number(process.env.TDPD_TEST_USER_ID || 0);
const OTHER_USER_ID = Number(process.env.TDPD_TEST_OTHER_USER_ID || 0);
const ACTOR_ID = TEST_USER_ID ? `user:${TEST_USER_ID}` : 'tdpd-red-agent';
const AS_OF = '2026-08-09T12:00:00.000Z';

let client;
let transport;
let toolNames = new Set();
let fixturePromise;
let writtenFixturePromise;

function idempotencyKey(label) {
  return `tdpd-red-${label}-${randomUUID()}`;
}

function requireTools(...names) {
  for (const name of names) {
    assert.ok(
      toolNames.has(name),
      `[TDPD RED] ${name} is required by ${SPEC_PATH} but is not registered by the MCP server`,
    );
  }
}

function requireDatabase(t) {
  if (!TEST_DATABASE_URL || !Number.isInteger(TEST_USER_ID) || TEST_USER_ID <= 0) {
    t.skip('Set TDPD_TEST_DATABASE_URL and TDPD_TEST_USER_ID to execute DB-backed MCP scenarios');
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
      week_theme: 'Агентное производство контента без ручной передачи контекста',
      project_name: `TDPD work queue ${planId}`,
    },
    accounts: {
      primary_tg: { platform: 'telegram' },
    },
    assets: {
      inline_source: {
        type: 'source_context',
        content: 'Планнер должен отдавать агенту следующее действие, контекст и точный дедлайн.',
      },
      unavailable_source: {
        type: 'markdown_source',
        path: '/host-only/content/source.md',
      },
    },
    actions: [
      {
        id: 'overdue-post',
        item_key: 'overdue-post',
        display_name: 'Просроченный материал',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T10:00:00.000Z',
        scheduled_at: '2026-08-10T10:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'upcoming-post',
        item_key: 'upcoming-post',
        display_name: 'Ближайший материал',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T18:00:00.000Z',
        scheduled_at: '2026-08-11T10:00:00.000Z',
        content_files: [{ role: 'source_context', url_ref: 'inline_source' }],
      },
      {
        id: 'missing-source-post',
        item_key: 'missing-source-post',
        display_name: 'Материал с недоступным источником',
        channel: 'telegram',
        account_ref: 'primary_tg',
        action_type: 'post_text',
        status: 'planned',
        content_due_at: '2026-08-09T16:00:00.000Z',
        scheduled_at: '2026-08-12T10:00:00.000Z',
        content_files: [{ role: 'source_context', path: '/host-only/content/source.md' }],
      },
    ],
    ongoing_rules: [],
    measurement: {},
  };
}

async function ensureFixture() {
  if (!fixturePromise) {
    fixturePromise = (async () => {
      const planId = `tdpd-work-queue-${randomUUID()}`;
      const imported = await callTool('ba_import_publication_plan_json', {
        userId: TEST_USER_ID,
        planJson: JSON.stringify(buildWeekPlan(planId)),
      });

      assert.ok(imported.project?.id, 'import must return project.id');
      assert.ok(imported.week_package?.id, 'R-001a: import must return week_package.id');

      await callTool('ba_decide_week_plan', {
        projectId: imported.project.id,
        actorId: ACTOR_ID,
        weekPackageId: imported.week_package.id,
        planVersion: '1.0.0',
        decision: 'approved',
        idempotencyKey: idempotencyKey('approve-plan'),
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
    asOf: AS_OF,
    filter,
  });
  const workItems = response.work_items || [];
  const workItem = workItems.find(predicate);
  assert.ok(workItem, `Expected work item not found in ${JSON.stringify(workItems)}`);
  return workItem;
}

async function ensureWrittenFixture() {
  if (!writtenFixturePromise) {
    writtenFixturePromise = (async () => {
      const fixture = await ensureFixture();
      const writeItem = await findWorkItem(
        fixture.projectId,
        (item) => item.item_key === 'overdue-post' && item.kind === 'content_write',
        { state: 'available' },
      );

      const claimed = await callTool('ba_claim_work_item', {
        projectId: fixture.projectId,
        actorId: ACTOR_ID,
        workItemId: writeItem.id,
        leaseSeconds: 1800,
        idempotencyKey: idempotencyKey('claim-write'),
      });
      assert.ok(claimed.lease_token, 'claim must return lease_token');

      const context = await callTool('ba_get_work_item_context', {
        projectId: fixture.projectId,
        actorId: ACTOR_ID,
        workItemId: writeItem.id,
      });
      assert.match(context.week?.frame || '', /Агентное производство/);
      assert.match(JSON.stringify(context.resources || []), /следующее действие/);

      const completed = await callTool('ba_complete_work_item', {
        projectId: fixture.projectId,
        actorId: ACTOR_ID,
        workItemId: writeItem.id,
        leaseToken: claimed.lease_token,
        result: {
          body: 'Готовый текст первого материала.',
          format: 'text/markdown',
        },
        idempotencyKey: idempotencyKey('complete-write'),
      });

      assert.equal(completed.work_item?.state, 'completed');
      assert.equal(completed.result_version, 1);

      const reviewItem = await findWorkItem(
        fixture.projectId,
        (item) => item.item_key === 'overdue-post' && item.kind === 'content_review',
        { state: 'available' },
      );

      return { ...fixture, writeItem, reviewItem, completed };
    })();
  }
  return writtenFixturePromise;
}

test.before(async () => {
  const childEnv = {
    ...process.env,
    ...(TEST_DATABASE_URL ? { DATABASE_URL: TEST_DATABASE_URL } : {}),
  };
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    cwd: process.cwd(),
    env: childEnv,
    stderr: 'pipe',
  });
  client = new Client({ name: 'tdpd-work-queue-e2e', version: '0.1.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  toolNames = new Set((listed.tools || []).map((tool) => tool.name));
});

test.after(async () => {
  await client?.close().catch(() => {});
});

test('E2E-001 / SC-001: an approved weekly plan creates an explainable work queue without duplicates', async (t) => {
  requireTools('ba_decide_week_plan', 'ba_get_week_execution_summary');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const summary = await callTool('ba_get_week_execution_summary', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    weekPackageId: fixture.weekPackageId,
    asOf: AS_OF,
  });

  assert.equal(summary.materials.total, 3);
  assert.equal(summary.materials.with_next_action, 3);
  assert.equal(summary.work_items.content_write.available, 2);
  assert.equal(summary.work_items.content_write.blocked, 1);
});

test('E2E-002 / SC-002: overdue available work is returned before future work with an explicit reason', async (t) => {
  requireTools('ba_list_work_items');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const response = await callTool('ba_list_work_items', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    asOf: AS_OF,
    filter: { state: 'available' },
  });

  assert.equal(response.work_items[0].item_key, 'overdue-post');
  assert.equal(response.work_items[0].schedule_health, 'overdue');
  assert.equal(response.work_items[0].reason_code, 'content_overdue');
  assert.equal(response.work_items[0].overdue_seconds, 7200);
  assert.equal(response.work_items[0].next_action, 'claim');
});

test('E2E-003 / SC-003: claim, context and completion create one immutable result version and unlock review', async (t) => {
  requireTools(
    'ba_list_work_items',
    'ba_claim_work_item',
    'ba_get_work_item_context',
    'ba_complete_work_item',
  );
  if (!requireDatabase(t)) return;

  const fixture = await ensureWrittenFixture();
  assert.equal(fixture.completed.work_item.state, 'completed');
  assert.equal(fixture.completed.result_version, 1);
  assert.equal(fixture.reviewItem.state, 'available');
  assert.equal(fixture.reviewItem.result_version, 1);
});

test('E2E-006 / SC-006: approval is attached to the current result version and completes review', async (t) => {
  requireTools('ba_decide_approval', 'ba_get_work_item');
  if (!requireDatabase(t)) return;

  const fixture = await ensureWrittenFixture();
  const approved = await callTool('ba_decide_approval', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    workItemId: fixture.reviewItem.id,
    resultVersion: 1,
    decision: 'approved',
    idempotencyKey: idempotencyKey('approve-content'),
  });

  assert.equal(approved.work_item.state, 'completed');
  assert.equal(approved.approval.result_version, 1);
  assert.equal(approved.approval.decision, 'approved');

  const persisted = await callTool('ba_get_work_item', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    workItemId: fixture.reviewItem.id,
  });
  assert.equal(persisted.work_item.approval.decision, 'approved');
});

test('E2E-009 / SC-009: an unavailable host-only source blocks work with a machine-readable exception', async (t) => {
  requireTools('ba_list_work_items', 'ba_list_schedule_exceptions');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const blocked = await findWorkItem(
    fixture.projectId,
    (item) => item.item_key === 'missing-source-post' && item.kind === 'content_write',
    { state: 'blocked' },
  );
  assert.equal(blocked.reason_code, 'SOURCE_UNAVAILABLE');
  assert.deepEqual(blocked.missing_resource_refs, ['/host-only/content/source.md']);

  const exceptions = await callTool('ba_list_schedule_exceptions', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    asOf: AS_OF,
    includeBlocked: true,
  });
  assert.ok(exceptions.exceptions.some((item) => (
    item.work_item_id === blocked.id && item.reason_code === 'SOURCE_UNAVAILABLE'
  )));
});

test('E2E-010 / SC-010: content overdue is distinct from a missed publication slot', async (t) => {
  requireTools('ba_list_schedule_exceptions');
  if (!requireDatabase(t)) return;

  const fixture = await ensureFixture();
  const beforePublish = await callTool('ba_list_schedule_exceptions', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    asOf: '2026-08-09T12:00:00.000Z',
    includeBlocked: true,
  });
  const overduePost = beforePublish.exceptions.filter((item) => item.item_key === 'overdue-post');
  assert.ok(overduePost.some((item) => item.reason_code === 'content_overdue'));
  assert.ok(!overduePost.some((item) => item.reason_code === 'publication_missed'));

  const afterPublish = await callTool('ba_list_schedule_exceptions', {
    projectId: fixture.projectId,
    actorId: ACTOR_ID,
    asOf: '2026-08-10T10:00:01.000Z',
    includeBlocked: true,
  });
  assert.ok(afterPublish.exceptions.some((item) => (
    item.item_key === 'overdue-post' && item.reason_code === 'publication_missed'
  )));
});

test('E2E-014 / SC-014: an actor from another project cannot read or claim protected work', async (t) => {
  requireTools('ba_get_work_item', 'ba_claim_work_item');
  if (!requireDatabase(t)) return;
  if (!Number.isInteger(OTHER_USER_ID) || OTHER_USER_ID <= 0) {
    t.skip('Set TDPD_TEST_OTHER_USER_ID to execute the cross-project authorization scenario');
    return;
  }

  const fixture = await ensureFixture();
  const protectedItem = await findWorkItem(
    fixture.projectId,
    (item) => item.item_key === 'upcoming-post' && item.kind === 'content_write',
    { state: 'available' },
  );
  const foreignActor = `user:${OTHER_USER_ID}`;

  for (const [toolName, args] of [
    ['ba_get_work_item', {
      projectId: fixture.projectId,
      actorId: foreignActor,
      workItemId: protectedItem.id,
    }],
    ['ba_claim_work_item', {
      projectId: fixture.projectId,
      actorId: foreignActor,
      workItemId: protectedItem.id,
      idempotencyKey: idempotencyKey('foreign-claim'),
    }],
  ]) {
    const result = await client.callTool({ name: toolName, arguments: args });
    assert.equal(result.isError, true, `${toolName} must reject a foreign actor`);
    const text = (result.content || []).map((item) => item.text || '').join('\n');
    assert.doesNotMatch(text, /Агентное производство|следующее действие|overdue-post/);
  }
});

