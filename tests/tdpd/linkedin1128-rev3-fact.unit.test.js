const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const access = require('../../dist/services/project_access.service');
const fact = require('../../dist/services/publication_fact.service').default;
test('r3 fact completes only its new WI and preserves superseded WI1924 verbatim', async t => {
    t.mock.method(access, 'requireProjectActorAccess', async () => undefined);
    const rows = [{ id: 1924, state: 'blocked', reason_code: 'SUPERSEDED_BY_ACCEPTED_REVISION3' }, { id: 2001, state: 'claimed', reason_code: null }];
    const originalOld = { ...rows[0] }; const now = new Date();
    const tx = { contentItem: { findFirst: async () => ({ id: 1128, channel_id: 6, channel: { type: 'linkedin' } }), update: async () => undefined },
        publicationFact: { create: async ({ data }) => ({ ...data, id: 900, created_at: now, updated_at: now }) },
        metricSnapshot: { findUnique: async () => ({ id: 1 }) },
        workItem: { findFirst: async () => ({ id: 1000 }), updateMany: async ({ where, data }) => {
            for (const row of rows) if ((!where.id || row.id === where.id) && !where.state.notIn.includes(row.state)) Object.assign(row, data);
            return { count: 1 };
        } }, workflowEvent: { create: async () => undefined } };
    const original = db.default.$transaction; db.default.$transaction = async run => run(tx);
    t.after(() => { db.default.$transaction = original; });
    await fact.record({ projectId: 7, taskId: 1128, actorId: 'user:2', artifactKind: 'post', outcome: 'published',
        confirmationMode: 'reconciled', publishedAt: '2026-10-15T12:00:00Z', publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
        providerObjectId: 'urn:li:activity:123', beforeWrite: async () => undefined, browserWorkItemId: 2001 });
    assert.deepEqual(rows[0], originalOld); assert.equal(rows[1].state, 'completed');
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
