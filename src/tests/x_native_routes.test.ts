import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { registerXNativeRoutes, type NativeHttpServices } from '../routes/x_native.routes';
import { NativePairingWaitError } from '../services/x_native_pairing_issue';
import { xNativeErrorDiagnostic } from '../services/x_native_actionable_diagnostics';

async function fixture(enabled = true, ownerError?: Error) {
    const calls: { operation: string; input: unknown; origin?: string }[] = [];
    const services: NativeHttpServices = { enabled: () => enabled,
        actorFromToken: token => { if (token !== 'synthetic-owner') throw Error('RAW_PRIVATE_AUTH_DETAIL'); return 'user:4'; },
        owner: async (operation, input) => { if (ownerError) throw ownerError; calls.push({ operation, input }); return { publication_authorized: false }; },
        delegate: async (operation, input, origin) => { calls.push({ operation, input, origin });
            if (operation === 'receipt') throw Error('[X_NATIVE_SIGNATURE_INVALID] RAW_PRIVATE_DETAIL');
            return { submission_permitted: false }; } };
    const app = Fastify(); await app.register(rateLimit, { global: false });
    // Production-equivalent app CORS denies extension origins; the signed bridge owns its exact-origin transport.
    await app.register(cors, { origin: (origin, callback) => callback(null, !origin || origin === 'https://planner.example.test') });
    await registerXNativeRoutes(app, services); await app.ready();
    return { app, calls };
}
test('pairing backoff is exact and safe through HTTP and MCP diagnostics', async () => {
    const error = new NativePairingWaitError('X_NATIVE_PAIRING_THROTTLED', 123), h = await fixture(true, error);
    try {
        const response = await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/pair',
            headers: { authorization: 'Bearer synthetic-owner' }, payload: {} });
        assert.equal(response.statusCode, 429); assert.equal(response.headers['retry-after'], '123');
        assert.equal(response.json().retry_after_seconds, 123); assert.equal(response.json().retry_at, error.retryAt);
        const diagnostic = xNativeErrorDiagnostic(error);
        assert.equal(diagnostic.retry_after_seconds, 123); assert.equal(diagnostic.retry_at, error.retryAt);
        assert.equal(diagnostic.retry_allowed, false); assert.deepEqual(h.calls, []);
    } finally { await h.app.close(); }
});
test('disabled rollout and missing owner authorization have zero execution authority', async () => {
    const off = await fixture(false);
    try { assert.equal((await off.app.inject({ method: 'POST', url: '/api/integrations/x-native/pair', payload: {} })).statusCode, 503);
        assert.deepEqual(off.calls, []); } finally { await off.app.close(); }
    const h = await fixture();
    try { assert.equal((await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/register', payload: {} })).statusCode, 409);
        assert.deepEqual(h.calls, []); } finally { await h.app.close(); }
});
test('the bridge enforces its bounded per-route request rate', async () => {
    const h = await fixture(), origin = `chrome-extension://${'a'.repeat(32)}`;
    try {
        for (let index = 0; index < 30; index++) assert.equal((await h.app.inject({ method: 'POST',
            url: '/api/integrations/x-native/read', headers: { origin }, payload: {} })).statusCode, 200);
        assert.equal((await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/read',
            headers: { origin }, payload: {} })).statusCode, 429);
        assert.equal(h.calls.length, 30);
    } finally { await h.app.close(); }
});
test('owner actor is derived from authentication, including nested challenge context', async () => {
    const h = await fixture();
    try {
        const response = await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/challenge',
            headers: { authorization: 'Bearer synthetic-owner' }, payload: { context: { actorId: 'user:999' }, phase: 'start', attemptId: null } });
        assert.equal(response.statusCode, 200);
        assert.equal((h.calls[0].input as { context: { actorId: string } }).context.actorId, 'user:4');
    } finally { await h.app.close(); }
});
test('delegate browser origins are bounded; errors disclose only safe code and never raw detail', async () => {
    const h = await fixture(), origin = `chrome-extension://${'a'.repeat(32)}`;
    try {
        for (const bad of ['https://x.com', 'null', `chrome-extension://${'a'.repeat(32)}.evil`]) {
            assert.equal((await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/read',
                headers: { origin: bad }, payload: {} })).statusCode, 409);
        }
        assert.deepEqual(h.calls, []);
        const result = await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/receipt', headers: { origin }, payload: {} });
        assert.deepEqual(result.json(), { code: 'X_NATIVE_SIGNATURE_INVALID', retry_allowed: false });
        assert.equal(result.headers['access-control-allow-origin'], origin);
        assert.equal(result.headers['cache-control'], 'no-store');
        assert.ok(!result.body.includes('PRIVATE'));
    } finally { await h.app.close(); }
});
test('preflight permits only the extension JSON transport; oversized bodies never reach handlers', async () => {
    const h = await fixture(), origin = `chrome-extension://${'a'.repeat(32)}`;
    try {
        const cors = await h.app.inject({ method: 'OPTIONS', url: '/api/integrations/x-native/read', headers: { origin,
            'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
        assert.equal(cors.statusCode, 204); assert.equal(cors.headers['access-control-allow-origin'], origin);
        assert.equal(cors.headers['access-control-allow-credentials'], undefined);
        assert.equal((await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/read',
            headers: { origin, 'content-type': 'text/plain' }, payload: '{}' })).statusCode, 409);
        assert.equal((await h.app.inject({ method: 'POST', url: '/api/integrations/x-native/read',
            headers: { origin }, payload: { tooLarge: 'x'.repeat(25000) } })).statusCode, 413);
        assert.deepEqual(h.calls, []);
    } finally { await h.app.close(); }
});
