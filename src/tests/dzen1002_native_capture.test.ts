import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import puppeteer from 'puppeteer';
import puppeteerPublisherService from '../services/puppeteer_publisher.service';
import { readDzen1002Inventory } from '../services/dzen1002_inventory_browser';
import { z } from 'zod';
import { requireDzen1002Action } from '../services/dzen1002_action_restriction';
type Collector = { observe(input: { state: string; page: number; url: string; status: number; payload: unknown }): void;
    report(): Record<string, unknown> };
const Contract = z.object({ createDzen1002NativeCapture: z.custom<(title?: string) => Collector>(v => typeof v === 'function') });
function feature() {
    let raw: unknown;
    try { raw = require('../services/dzen1002_native_capture'); }
    catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error;
    }
    const parsed = Contract.safeParse(raw); assert.ok(parsed.success, 'native diagnostic admission/capture seam absent');
    return parsed.data;
}
test('DIAG001 unresolved action scope stops before session access without a permission callback', () => {
    for (const operation of ['inventory', 'publish', 'readback'] as const) {
        assert.throws(() => requireDzen1002Action(operation), /DZEN1002_ACTION_SCOPE_UNRESOLVED/);
    }
});
test('DIAG003/004 capture is sanitized observation, never ownership/end/absence proof', () => {
    const c = feature().createDzen1002NativeCapture('PRIVATE_TITLE');
    for (const state of ['published', 'draft']) c.observe({ state, page: 1,
        url: `https://dzen.ru/editor-api/v3/publications?state=${state}&cursor=CURSOR_SECRET`, status: 200,
        payload: { publications: [{ id: 'RAW_ID', title: 'PRIVATE_TITLE', state: 'published', token: 'TOKEN_SECRET' }],
            drafts: [], pinedPublications: [{ id: 'RAW_ID', title: 'PRIVATE_TITLE', unknownField: 'PRIVATE_VALUE' }],
            pagination: { hasMore: false, nextCursor: 'CURSOR_SECRET' }, cookies: 'COOKIE_SECRET' } });
    const report = c.report(); const serialized = JSON.stringify(report);
    for (const secret of ['RAW_ID', 'PRIVATE_TITLE', 'PRIVATE_VALUE', 'TOKEN_SECRET', 'COOKIE_SECRET', 'CURSOR_SECRET']) {
        assert.equal(serialized.includes(secret), false, secret);
    }
    assert.equal(report.native_end_rule_verified, false); assert.equal(report.coverage_verified, false);
    assert.ok(serialized.includes('candidate_1')); assert.ok(serialized.includes('title_matches_target'));
    assert.ok(serialized.includes('pinedPublications'));
});
test('DIAG002/005 foreign route and bounds fail closed without exporting raw input', () => {
    const f = feature(); const foreign = f.createDzen1002NativeCapture();
    foreign.observe({ state: 'published', page: 1, url: 'https://evil.example/?token=SECRET', status: 200, payload: {} });
    assert.equal(foreign.report().stop_reason, 'ROUTE_INVALID');
    const bound = f.createDzen1002NativeCapture();
    bound.observe({ state: 'published', page: 11, url: 'https://dzen.ru/editor-api/v3/publications?state=published', status: 200, payload: {} });
    assert.equal(bound.report().stop_reason, 'PAGE_LIMIT');
});
test('DIAG005 response/object/time budgets stop capture without proof or retry', () => {
    const f = feature(); const url = 'https://dzen.ru/editor-api/v3/publications?state=published';
    for (const [payload, reason] of [[{ publications: Array(1001).fill({}) }, 'OBJECT_LIMIT'],
        [{ title: 'x'.repeat(2 * 1024 * 1024) }, 'RESPONSE_LIMIT']] as const) {
        const c = f.createDzen1002NativeCapture(); c.observe({ state: 'published', page: 1, url, status: 200, payload });
        assert.equal(c.report().stop_reason, reason); assert.equal(c.report().coverage_verified, false);
        assert.equal(JSON.stringify(c.report()).includes('xxxx'), false);
    }
    let now = 0; const clock = mock.method(Date, 'now', () => now);
    try {
        const c = f.createDzen1002NativeCapture(); now = 60_000;
        c.observe({ state: 'published', page: 1, url, status: 200, payload: {} });
        assert.equal(c.report().stop_reason, 'TIME_LIMIT');
    } finally { clock.mock.restore(); }
});
test('DIAG001 production diagnostic stays disabled before cookie/profile/browser access, regardless of config attestation', async () => {
    const raw: unknown = require('../services/dzen1002_inventory_browser');
    const module = z.object({ readDzen1002NativeDiagnostic: z.custom<(config: Record<string, unknown>) => Promise<unknown>>(v => typeof v === 'function') }).safeParse(raw);
    assert.ok(module.success, 'production diagnostic admission boundary absent');
    let browsers = 0; let sessionReads = 0;
    const launch = mock.method(puppeteer, 'launch', async () => { browsers++; throw new Error('No live browser allowed'); });
    const config = { provider_admission: 'permitted', get cookies() { sessionReads++; return 'fixture=SECRET'; } };
    try { await assert.rejects(module.data.readDzen1002NativeDiagnostic(config), /DZEN1002_ACTION_SCOPE_UNRESOLVED/); }
    finally { launch.mock.restore(); }
    assert.equal(browsers, 0); assert.equal(sessionReads, 0);
});
test('DIAG006 existing adapter response observations reach preflight diagnostics with no added requests', async () => {
    let responses = 0; let navigations = 0; let closed = 0; let currentUrl = '';
    const page = { url: () => currentUrl, setUserAgent: async () => {}, on: () => {},
        setRequestInterception: async () => {}, setCookie: async () => {},
        goto: async (url: string) => { navigations++; currentUrl = url; },
        waitForResponse: async () => {
            const state = responses++ === 0 ? 'published' : 'draft';
            return { url: () => `https://dzen.ru/editor-api/v3/publications?state=${state}`,
                status: () => 200, headers: () => ({}), buffer: async () => Buffer.from(JSON.stringify({
                    publications: [], drafts: [], hasMore: false })) };
        } };
    const launch = mock.method(puppeteer, 'launch', async () => ({ newPage: async () => page, close: async () => { closed++; } }));
    const auth = mock.method(puppeteerPublisherService, 'assertDzenAuthenticated', async () => {});
    try {
        const result = await readDzen1002Inventory({ cookies: 'fixture=value', channel_id: '6a8029aba055ec36033bf81c' });
        assert.equal(responses, 2); assert.equal(navigations, 2); assert.equal(closed, 1);
        assert.ok('native_contract_observation' in result.inventory_diagnostics[0], 'observation missing from the existing preflight error/readback boundary');
    } finally { launch.mock.restore(); auth.mock.restore(); }
});
