import assert from 'node:assert/strict';
import test from 'node:test';
import { LinkedInTask995RecoveryService } from '../services/linkedin_task995_recovery.service';

const bodyHash = '807c2ee9d0815e55c2b94f7730ac35459d660a122e27b61b56b4e67ea66eb41e';

function harness(matches: Array<{ urn: string; permalink: string; text: string }> = [], connectorMode = 'linkedin_api') {
    const task: any = { id: 995, project_id: 7, channel_id: 5, content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null,
        draft_text: 'accepted body', status: 'ready_for_execution', published_link: null,
        publication_fact: null, channel: { id: 5, type: 'linkedin', config: { access_token: 'secret', linkedin_urn: 'urn:li:person:1',
            account_type: 'personal', connector_mode: connectorMode } } };
    const attempts: any[] = [];
    const events: any[] = [];
    let facts = 0;
    const db: any = {
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) => {
            if (where.status !== undefined && task.status !== where.status) return { count: 0 };
            if (where.publication_mode !== undefined && task.publication_mode !== where.publication_mode) return { count: 0 };
            Object.assign(task, data); return { count: 1 };
        } },
        socialChannel: { update: async ({ data }: any) => { Object.assign(task.channel, data); return task.channel; } },
        deliveryAttempt: {
            findFirst: async () => attempts[0] || null,
            create: async ({ data }: any) => { const value = { id: 44, ...data }; attempts.push(value); return value; },
            update: async ({ data }: any) => Object.assign(attempts[0], data)
        },
        workflowEvent: {
            findUnique: async ({ where }: any) => events.find(event => {
                const key = where.project_id_actor_id_command_idempotency_key;
                return event.data.project_id === key.project_id && event.data.actor_id === key.actor_id
                    && event.data.command === key.command && event.data.idempotency_key === key.idempotency_key;
            }) || null,
            create: async ({ data }: any) => { const event = { id: events.length + 1, data, after_state: data.after_state }; events.push(event); return event; }
        },
        projectMember: { findFirst: async () => ({ user_id: 2 }), findUnique: async () => ({ user_id: 2, role: 'owner' }) },
        $transaction: async (fn: any) => fn(db)
    };
    const service = new LinkedInTask995RecoveryService({
        db, hashBody: () => bodyHash,
        linkedin: { findRecentPublishedPosts: async () => ({ available: true, posts: matches }) },
        facts: { record: async () => { facts += 1; } }
    });
    return { service, task, attempts, events, get facts() { return facts; } };
}

test('task #995 historical click becomes one durable UNKNOWN attempt and replays without provider send', async () => {
    const h = harness();
    const first = await h.service.protectHistoricalAttempt();
    const replay = await h.service.protectHistoricalAttempt();
    assert.equal(first.state, 'UNKNOWN');
    assert.equal(replay.attempt_id, first.attempt_id);
    assert.equal(h.attempts.length, 1);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.facts, 0);
});

test('read-only reconciliation records a fact only for one exact accepted-body match', async () => {
    const h = harness([{ urn: 'urn:li:ugcPost:123', permalink: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:123', text: 'accepted body' }]);
    await h.service.protectHistoricalAttempt();
    const result = await h.service.reconcile();
    assert.equal(result.state, 'confirmed');
    assert.equal(h.facts, 1);
    assert.equal(h.attempts[0].status, 'delivered');
});

test('zero or ambiguous LinkedIn readback remains UNKNOWN and never invents a fact', async () => {
    const h = harness([]);
    await h.service.protectHistoricalAttempt();
    const result = await h.service.reconcile();
    assert.equal(result.state, 'UNKNOWN');
    assert.equal(h.facts, 0);
});

test('personal browser-assisted LinkedIn delegates readback without requiring API credentials or sending', async () => {
    const h = harness([], 'browser_assisted');
    h.task.channel.config = { account_type: 'personal', connector_mode: 'browser_assisted' };
    await h.service.protectHistoricalAttempt();
    const result = await h.service.reconcile();
    assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.reconciliation, 'browser_required');
    assert.equal(result.reason, 'browser_reconciliation_delegated');
    assert.equal(result.resend_allowed, false);
    assert.equal(h.facts, 0);
});

test('owner repair makes task #995 browser-assisted without changing the UNKNOWN attempt or creating a fact', async () => {
    const h = harness();
    await h.service.protectHistoricalAttempt();
    const attemptBefore = { ...h.attempts[0] };

    const result = await h.service.repairBrowserAssistedRouting({
        actorId: 'user:2', idempotencyKey: 'linkedin-995-browser-route-test'
    });
    const replay = await h.service.repairBrowserAssistedRouting({
        actorId: 'user:2', idempotencyKey: 'linkedin-995-browser-route-test'
    });

    assert.equal(result.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.task.publication_mode, 'browser_required');
    assert.equal(h.task.channel.config.connector_mode, 'browser_assisted');
    assert.equal(h.task.channel.config.capability_flags.api_publish, false);
    assert.equal(h.task.channel.config.capability_flags.browser_publish, true);
    assert.deepEqual(h.attempts[0], attemptBefore);
    assert.equal(h.attempts.length, 1);
    assert.equal(h.facts, 0);
});
