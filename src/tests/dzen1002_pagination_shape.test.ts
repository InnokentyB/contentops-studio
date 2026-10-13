import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDzen1002Pagination } from '../services/dzen1002_pagination_shape';
import { enumerateDzen1002Inventory } from '../services/dzen1002_inventory';
import { Dzen1002ReadFailure } from '../services/dzen1002_read_failure';

// Synthetic diagnostic fixtures only: actual sanitized provider shape is pending.
test('SHAPE001 retains pagination field names/types and safe numeric/boolean values', () => {
    const shape = describeDzen1002Pagination({ publications: Array(13).fill({ title: 'PRIVATE', id: 'PRIVATE' }),
        paging: { hasNextPage: false, total: 13, cursor: 'SECRET' }, extraStructure: { body: 'PRIVATE' } },
        'https://dzen.ru/editor-api/v3/publications?state=published&pageSize=20&offset=0&token=SECRET');
    assert.deepEqual(shape.request, { pageSize: 20, offset: 0 });
    assert.deepEqual(shape.fields.find(f => f.name === 'publications'), { name: 'publications', type: 'array', count: 13 });
    assert.deepEqual(shape.nested.paging.find(f => f.name === 'hasNextPage'), { name: 'hasNextPage', type: 'boolean', value: false });
    assert.deepEqual(shape.nested.paging.find(f => f.name === 'cursor'), { name: 'cursor', type: 'string' });
    assert.equal(JSON.stringify(shape).includes('SECRET'), false);
    assert.equal(JSON.stringify(shape).includes('PRIVATE'), false);
});
test('SHAPE002 allowlists response pagination headers without emitting raw header values', () => {
    const shape = describeDzen1002Pagination({}, 'https://dzen.ru/', {
        'content-range': 'publications 0-12/13', 'x-total-count': '13',
        link: '<https://dzen.ru/?cursor=SECRET>; rel="next"', 'set-cookie': 'session=SECRET'
    });
    assert.deepEqual(shape.headers['content-range'], { type: 'range', unit: 'publications', values: [0, 12, 13] });
    assert.deepEqual(shape.headers['x-total-count'], { type: 'number', values: [13] });
    assert.deepEqual(shape.headers.link, { type: 'present' });
    assert.equal(JSON.stringify(shape).includes('SECRET'), false);
    assert.equal('set-cookie' in shape.headers, false);
});
test('SHAPE003 diagnostics are bounded and drop sensitive field names', () => {
    const payload = { ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, 'SECRET'])),
        cookies: 'SECRET', author_id: 'PRIVATE', email: 'PRIVATE' };
    const shape = describeDzen1002Pagination(payload, 'not a URL');
    assert.equal(shape.fields.length, 24);
    assert.equal(JSON.stringify(shape).includes('SECRET'), false);
    assert.equal(JSON.stringify(shape).includes('author_id'), false);
});
test('SHAPE004 shape projection must not manufacture coverage for unrecognized metadata', async () => {
    const result = await enumerateDzen1002Inventory({ first: async state => ({ status: 200,
        url: `https://dzen.ru/editor-api/v3/publications?state=${state}&pageSize=20&offset=0`,
        payload: { publications: [], paging: { hasNextPage: false } } }), next: async () => { throw new Error('No speculative paging'); } });
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0].reason, 'PAGINATION_UNKNOWN');
    assert.deepEqual(result.diagnostics[0].pagination_shape?.nested.paging[0], { name: 'hasNextPage', type: 'boolean', value: false });
});
test('CAUSE001 application-owned timeout/status cause survives without raw provider errors', async () => {
    const result = await enumerateDzen1002Inventory({ first: async () => { throw new Dzen1002ReadFailure('RESPONSE_TIMEOUT', 200,
        [{ path: '/editor-api/v3/publications', status: 200, state: 'other' }]); },
        next: async () => { throw new Error('must not retry'); } });
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0].reason, 'RESPONSE_TIMEOUT');
    assert.equal(result.diagnostics[0].status, 200);
});
test('SHAPE005 numeric and boolean string metadata is projected without raw strings or cursor values', () => {
    const shape = describeDzen1002Pagination({ pagination: { totalCount: '13', hasMore: 'false', nextCursor: '12345' } },
        'https://dzen.ru/editor-api/v3/publications?state=published');
    assert.deepEqual(shape.nested.pagination.find(f => f.name === 'totalCount'), { name: 'totalCount', type: 'string', value: 13 });
    assert.deepEqual(shape.nested.pagination.find(f => f.name === 'hasMore'), { name: 'hasMore', type: 'string', value: false });
    assert.deepEqual(shape.nested.pagination.find(f => f.name === 'nextCursor'), { name: 'nextCursor', type: 'string' });
});
