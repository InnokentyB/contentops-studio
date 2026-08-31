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
