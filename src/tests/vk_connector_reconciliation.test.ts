import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVkConnectorReconciliation, type VkConnectorWallEvidence } from '../services/vk_connector_reconciliation';
import { connectorHash, VK_CONNECTOR_SCOPE } from '../services/vk_connector_contract';
const binding = { ...VK_CONNECTOR_SCOPE, bodySha256: connectorHash('Exact accepted text'), assetSha256: 'b'.repeat(64), releaseSha256: 'c'.repeat(64) };
const now = new Date('2026-10-13T10:00:00Z');
const releasedAt = '2026-10-10T11:38:03Z';
function evidence(): VkConnectorWallEvidence {
    return { ownerId: '-240051152', capturedAt: now.toISOString(), startedAt: '2026-10-13T09:59:00Z',
        windowStart: releasedAt, windowEnd: now.toISOString(), coverage: 'complete_window', exhausted: true, rows: [] };
}
function post() {
    return { objectId: '-240051152_31', publicUrl: 'https://vk.ru/wall-240051152_31', publishedAt: '2026-10-13T09:58:00Z',
        text: 'Exact accepted text', media: { assetSha256: binding.assetSha256, providerMediaId: 'photo-240051152_55', acknowledged: true } };
}
function evaluate(value: VkConnectorWallEvidence) {
    return evaluateVkConnectorReconciliation(binding, 'Exact accepted text', releasedAt, value, now);
}
test('VK017-RECONCILE: unique exact owner/text/approved media/provider date yields exact match', () => {
    const e = evidence(); e.rows = [post()]; const result = evaluate(e);
    assert.equal(result.kind, 'exact_match');
    if (result.kind === 'exact_match') assert.equal(result.post.objectId, '-240051152_31');
});
test('VK017-RECONCILE: absence requires complete release-through-now bounded wall coverage', () => {
    assert.equal(evaluate(evidence()).kind, 'proven_absence');
    for (const patch of [ {coverage: 'partial' as const}, {exhausted: false}, {windowStart: '2026-10-12T00:00:00Z'},
        {windowEnd: '2026-10-13T09:59:00Z'}, {startedAt: '2026-10-13T09:57:00Z'}, {capturedAt: '2026-10-13T09:58:00Z'},
        {ownerId: '-22884714'} ]) assert.equal(evaluate({...evidence(), ...patch}).kind, 'unknown');
});
test('VK017-RECONCILE: text match with missing/unacknowledged/different media cannot permit resend', () => {
    for (const media of [null, {...post().media, acknowledged: false}, {...post().media, assetSha256: 'd'.repeat(64)},
        {...post().media, providerMediaId: ''}]) {
        const e = evidence(); e.rows = [{...post(), media}]; assert.equal(evaluate(e).kind, 'unknown');
    }
});
test('VK017-RECONCILE: ambiguous objects, relative date, foreign link and object overflow remain unknown', () => {
    for (const rows of [ [post(), {...post(), objectId:'-240051152_32', publicUrl:'https://vk.ru/wall-240051152_32'}],
        [{...post(), publishedAt:'6 минут назад'}], [{...post(), publicUrl:'https://example.com/wall-240051152_31'}],
        Array.from({length:101}, (_,i)=>({...post(),objectId:`-240051152_${i+1}`})) ]) {
        const e=evidence(); e.rows=rows; assert.equal(evaluate(e).kind,'unknown');
    }
});

test('VK017-RECONCILE: changed accepted caption cannot establish absence', () => {
    assert.equal(evaluateVkConnectorReconciliation(binding, 'Different caption', releasedAt, evidence(), now).kind, 'unknown');
});

test('VK017-RECONCILE: one exact candidate in partial inventory or outside release window stays unknown', () => {
    const e = evidence(); e.rows = [post()];
    assert.equal(evaluate({...e, coverage: 'partial'}).kind, 'unknown');
    assert.equal(evaluate({...e, exhausted: false}).kind, 'unknown');
    e.rows = [{...post(), publishedAt: '2026-10-09T10:00:00Z'}];
    assert.equal(evaluate(e).kind, 'unknown');
});

test('VK017-RECONCILE: complete inventory ending at a fresh capture does not invent future coverage', () => {
    const e = evidence(); e.capturedAt = '2026-10-13T09:59:55Z'; e.windowEnd = e.capturedAt;
    assert.equal(evaluate(e).kind, 'proven_absence');
});

test('VK017-RECONCILE: coverage beyond its observed capture is unconfirmed', () => {
    const e = evidence(); e.capturedAt = '2026-10-13T09:59:55Z';
    assert.equal(evaluate(e).kind, 'unknown');
});
