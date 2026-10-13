import assert from 'node:assert/strict';
import test from 'node:test';
import { validateVkPostConfirmation } from '../services/vk_post_confirmation';

const proof = {
    providerTimestampSource: 'provider',
    postBaselineCapturedAt: '2026-10-12T12:00:00Z',
    postBaselineObjectIds: ['-240051152_30'],
    postSubmissionStartedAt: '2026-10-12T12:00:01Z',
    readbackObservedAt: '2026-10-12T12:00:05Z',
    publishedAt: '2026-10-12T12:00:02Z',
    providerObjectId: '-240051152_31'
};
test('server accepts exact new wall evidence with provider publication time', () => {
    assert.doesNotThrow(() => validateVkPostConfirmation(proof, '-240051152', new Date('2026-10-12T12:00:06Z')));
});
for (const [name, changes] of [
    ['old object', { providerObjectId: '-240051152_30' }],
    ['foreign owner', { providerObjectId: '-42_31' }],
    ['invented clock', { providerTimestampSource: 'local_clock' }],
    ['before submission', { publishedAt: '2026-10-12T11:59:59Z' }],
    ['future', { publishedAt: '2026-10-12T13:00:00Z' }],
    ['stale baseline', { postBaselineCapturedAt: '2026-10-12T11:00:00Z' }],
    ['missing date', { publishedAt: '' }],
    ['missing baseline', { postBaselineObjectIds: undefined }]
] as const) {
    test(`server rejects ${name} post evidence`, () => {
        assert.throws(() => validateVkPostConfirmation({ ...proof, ...changes }, '-240051152', new Date('2026-10-12T12:00:06Z')), /VK_POST_PROOF_INVALID/);
    });
}
