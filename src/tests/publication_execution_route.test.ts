import assert from 'node:assert/strict';
import test from 'node:test';
import { browserFallbackReason, resolvePublicationExecutionRoute } from '../services/publication_execution_route';

const ready = {
    contentReady: true,
    visualReady: true,
    due: true,
    published: false,
    executionMode: 'automated' as const,
    directExecutionSupported: true,
    publicationMode: 'connector_auto'
};

test('ready API-capable publication is routed to connector scheduler', () => {
    assert.equal(resolvePublicationExecutionRoute(ready), 'connector_auto');
});

test('missing API or manual execution is routed to browser publication', () => {
    assert.equal(resolvePublicationExecutionRoute({ ...ready, directExecutionSupported: false }), 'browser_required');
    assert.equal(resolvePublicationExecutionRoute({ ...ready, executionMode: 'manual' }), 'connector_auto');
    assert.equal(resolvePublicationExecutionRoute({
        ...ready,
        executionMode: 'manual',
        publicationMode: 'manual_handoff'
    }), 'browser_required');
});

test('content and visual gates block both execution routes', () => {
    assert.equal(resolvePublicationExecutionRoute({ ...ready, contentReady: false }), 'waiting');
    assert.equal(resolvePublicationExecutionRoute({ ...ready, visualReady: false }), 'waiting');
    assert.equal(resolvePublicationExecutionRoute({ ...ready, due: false }), 'waiting');
});

test('published content cannot be routed for execution again', () => {
    assert.equal(resolvePublicationExecutionRoute({ ...ready, published: true }), 'published');
});

test('connector failure disables API retries and selects browser fallback', () => {
    assert.deepEqual(browserFallbackReason(new Error('token expired')), {
        code: 'CONNECTOR_PUBLISH_FAILED',
        message: 'token expired',
        retry_via_api: false,
        next_route: 'browser_required'
    });
});

test('an explicit browser route cannot fall back to the connector', () => {
    assert.equal(resolvePublicationExecutionRoute({
        ...ready,
        publicationMode: 'browser_required'
    }), 'browser_required');
});

test('approval-required task with an automated bundle remains waiting', () => {
    assert.equal(resolvePublicationExecutionRoute({ ...ready, publicationMode: 'approval_required' }), 'waiting');
    assert.equal(resolvePublicationExecutionRoute({ ...ready, publicationMode: 'owner_released' }), 'waiting');
});

test('VK ready publications use only the registered independent adapter regardless of direct API or browser mode', () => {
    for (const publicationMode of ['connector_auto', 'browser_required', 'manual_handoff', null]) {
        for (const directExecutionSupported of [true, false]) {
            const input = { ...ready, platform: 'vk', publicationMode, directExecutionSupported };
            assert.equal(resolvePublicationExecutionRoute(input), 'vk_adapter_required');
        }
    }
});

test('VK adapter route preserves publication and readiness gates', () => {
    const input = { ...ready, platform: 'vk' };
    assert.equal(resolvePublicationExecutionRoute({ ...input, published: true }), 'published');
    for (const gate of [{ contentReady: false }, { visualReady: false }, { due: false }, { publicationMode: 'approval_required' }, { publicationMode: 'owner_released' }]) {
        assert.equal(resolvePublicationExecutionRoute({ ...input, ...gate }), 'waiting');
    }
});

test('VK errors never grant browser or direct API fallback and exclude raw provider diagnostics', () => {
    const fallback = browserFallbackReason(new Error('raw credential-like provider error'), 'vk');
    assert.equal(fallback.code, 'VK_INDEPENDENT_ADAPTER_REQUIRED');
    assert.equal(fallback.next_route, 'vk_adapter_required'); assert.equal(fallback.retry_via_api, false);
    assert.equal(fallback.message.includes('raw credential-like'), false);
});

test('public VK platform names are normalized before route and fallback decisions', () => {
    for (const platform of ['VK', ' vk ', 'Vk']) {
        assert.equal(resolvePublicationExecutionRoute({ ...ready, platform }), 'vk_adapter_required');
        assert.equal(browserFallbackReason(new Error('provider error'), platform).next_route, 'vk_adapter_required');
    }
});
