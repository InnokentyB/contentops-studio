import assert from 'node:assert/strict';
import test from 'node:test';
import { enumerateDzen1002Inventory, type InventoryPort, type InventoryState } from '../services/dzen1002_inventory';

const row = (id: string, state: InventoryState, title: string | null = id) => ({ id, title,
    status: state, isPublished: state === 'published' });
const url = (state: InventoryState, offset = 0) => `https://dzen.ru/editor-api/v3/publications?state=${state}&pageSize=1&offset=${offset}`;
function fixture(published: unknown[], draft: unknown[], status = 200): InventoryPort {
    const lists = { published, draft };
    const get = async (target: string) => { const parsed = new URL(target);
        const state = parsed.searchParams.get('state') as InventoryState;
        return { url: target, status, payload: lists[state][Number(parsed.searchParams.get('offset') || 0)] };
    };
    return { first: state => get(url(state)), next: get };
}
test('INV001 reads multiple pages and both segments before complete absence evidence', async () => {
    const result = await enumerateDzen1002Inventory(fixture([
        { publications: [row('p1', 'published')], hasMore: true },
        { publications: [row('p2', 'published')], hasMore: false }
    ], [{ publications: [row('d1', 'draft')], hasMore: false }]));
    assert.equal(result.complete, true);
    assert.deepEqual(result.publications.map(r => r.provider_object_id), ['p1', 'p2', 'd1']);
    assert.deepEqual(result.diagnostics.map(r => r.state), ['published', 'published', 'draft']);
});
test('INV002 unknown pagination is incomplete even for an empty short page', async () => {
    const result = await enumerateDzen1002Inventory(fixture([{ publications: [] }], [{ publications: [], hasMore: false }]));
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0]?.reason, 'PAGINATION_UNKNOWN');
    assert.equal(result.diagnostics[1]?.state, 'draft');
});
test('INV003 draft exact-title duplicate remains visible', async () => {
    const result = await enumerateDzen1002Inventory(fixture([{ publications: [], hasMore: false }],
        [{ publications: [row('duplicate', 'draft', 'Exact title')], total: 1 }]));
    assert.equal(result.complete, true);
    assert.equal(result.publications[0]?.title, 'Exact title');
});
test('INV004 missing title blocks coverage without dropping the other segment', async () => {
    const result = await enumerateDzen1002Inventory(fixture([{ publications: [row('p', 'published', null)], hasMore: false }],
        [{ publications: [], hasMore: false }]));
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0]?.reason, 'IDENTITY_TITLE_STATE_INCOMPLETE');
    assert.equal(result.diagnostics.length, 2);
});
test('INV005 HTTP failures and thrown secrets are sanitized and never retried', async () => {
    let calls = 0;
    const result = await enumerateDzen1002Inventory({ first: async state => {
        calls++; if (state === 'published') throw new Error('session=SECRET');
        return { url: url(state), status: 403, payload: 'token=SECRET' };
    }, next: async () => { throw new Error('unexpected retry'); } });
    assert.equal(calls, 2);
    assert.equal(result.complete, false);
    assert.deepEqual(result.diagnostics.map(r => r.reason), ['READ_FAILED', 'HTTP_ERROR']);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('INV006 page bound blocks partial enumeration', async () => {
    const result = await enumerateDzen1002Inventory(fixture([{ publications: [row('p', 'published')], hasMore: true }],
        [{ publications: [], hasMore: false }]), { maxPages: 1 });
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0]?.reason, 'PAGE_LIMIT');
});
test('INV007 unknown cursor route cannot be guessed from hasMore', async () => {
    const result = await enumerateDzen1002Inventory({ first: async state => ({ status: 200,
        url: `https://dzen.ru/editor-api/v3/publications?state=${state}&pageSize=1`,
        payload: { publications: [row(state, state)], hasMore: true, cursor: 'SECRET' } }),
        next: async () => { throw new Error('must not guess pagination'); } });
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0]?.reason, 'PAGINATION_ROUTE_UNKNOWN');
    assert.equal(JSON.stringify(result.diagnostics).includes('SECRET'), false);
});
test('INV008 object and time limits fail closed', async () => {
    const port = fixture([{ publications: [row('p1', 'published'), row('p2', 'published')], hasMore: false }],
        [{ publications: [], hasMore: false }]);
    const capped = await enumerateDzen1002Inventory(port, { maxObjects: 1 });
    assert.equal(capped.complete, false);
    assert.equal(capped.diagnostics[0]?.reason, 'OBJECT_LIMIT');
    let clock = 0;
    const expired = await enumerateDzen1002Inventory(port, { budgetMs: 1, now: () => clock++ });
    assert.equal(expired.complete, false);
    assert.equal(expired.diagnostics[0]?.reason, 'TIME_LIMIT');
});
test('INV009 repeated page cannot prove exhaustive coverage', async () => {
    const repeated = { publications: [row('p1', 'published')], total: 3 };
    const result = await enumerateDzen1002Inventory(fixture([repeated, repeated], [{ publications: [], hasMore: false }]));
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[1]?.reason, 'PAGINATION_NO_PROGRESS');
});
test('INV010 pagination conflicts and wrong-host routes are explicit gaps', async () => {
    const conflict = await enumerateDzen1002Inventory(fixture([{ publications: [], hasMore: false, total: 2 }],
        [{ publications: [], hasMore: false }]));
    assert.equal(conflict.complete, false);
    assert.equal(conflict.diagnostics[0]?.reason, 'PAGINATION_CONFLICT');
    const route = await enumerateDzen1002Inventory({ first: async state => ({ url: 'https://evil.example/?token=SECRET',
        status: 200, payload: { publications: [], hasMore: false } }), next: async () => { throw new Error('unexpected'); } });
    assert.equal(route.complete, false);
    assert.equal(route.diagnostics[0]?.reason, 'ROUTE_INVALID');
    assert.equal(JSON.stringify(route).includes('SECRET'), false);
});

// Collection names follow the sanitized native shape captured after main@4ddad2b.
// Row values below are synthetic: native draft rows/end-of-list were not captured.
test('INV011 native dual collections select drafts without hiding an exact-title duplicate', async () => {
    const result = await enumerateDzen1002Inventory(fixture([
        { publications: [row('p', 'published')], drafts: [], hasMore: false }
    ], [{ publications: [], drafts: [row('d', 'draft', 'Exact title')], hasMore: false }]));
    assert.equal(result.complete, true);
    assert.deepEqual(result.publications.map(r => r.provider_object_id), ['p', 'd']);
    assert.equal(result.diagnostics[1].count, 1);
});
test('INV012 dual collection shape does not prove end-of-list from a short page', async () => {
    const result = await enumerateDzen1002Inventory(fixture([
        { publications: [row('p', 'published')], drafts: [] }
    ], [{ publications: [], drafts: [row('d', 'draft')] }]));
    assert.equal(result.complete, false);
    assert.deepEqual(result.diagnostics.map(d => d.reason), ['PAGINATION_UNKNOWN', 'PAGINATION_UNKNOWN']);
    assert.equal(result.diagnostics[1].count, 1);
});
test('INV013 malformed or contradictory drafts cannot fall back to empty publications', async () => {
    for (const drafts of [null, {}, [row('wrong-state', 'published')]]) {
        const result = await enumerateDzen1002Inventory(fixture([
            { publications: [], drafts: [], hasMore: false }
        ], [{ publications: [], drafts, hasMore: false }]));
        assert.equal(result.complete, false);
        assert.notEqual(result.diagnostics[1].reason, 'COMPLETE');
    }
});
