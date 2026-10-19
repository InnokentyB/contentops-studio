import { sandboxedChromiumLaunchOptions } from '../services/browser_launch';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVkConnectorPlaywrightRuntime } from '../services/vk_connector_playwright_runtime';
test('RUNTIME-001 unavailable action admission cannot access profile or launch a browser', async () => {
    let launches = 0;
    const runtime = createVkConnectorPlaywrightRuntime({ actionAdmission: { assess: async () => ({ status: 'PERMISSION_UNVERIFIED' }) },
        profileDirectory: '/never-access-profile', evidenceDir: '/unused-evidence',
        media: { verify: async () => null, acknowledgement: async () => null },
        loadApprovedImage: async () => { throw new Error('must not load'); },
        launch: { launch: async () => { launches++; throw new Error('must not launch'); } } });
    assert.equal((await runtime.admission.assess()).status, 'PERMISSION_UNVERIFIED');
    await assert.rejects(runtime.withSession(async () => undefined), /PERMISSION_UNVERIFIED/);
    assert.equal(launches, 0);
});

test('RUNTIME-002 admitted local fixture owns context and closes it after callback failure', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch(sandboxedChromiumLaunchOptions({ headless: true, executablePath: process.env.APP_BROWSER_EXECUTABLE_PATH ?? chromium.executablePath() }));
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => route.abort());
        let closed = false; context.on('close', () => { closed = true; });
        const runtime = createVkConnectorPlaywrightRuntime({ actionAdmission: { assess: async () => ({ status: 'ACTION_ADMITTED', executionContext: 'production_admitted', authorization: 'application_host' }) },
            profileDirectory: '/never-access-profile', evidenceDir: '/unused-evidence', approvedAssetSha256: 'a'.repeat(64),
            loadApprovedImage: async () => { throw new Error('not requested'); }, launch: { launch: async () => context } });
        await assert.rejects(runtime.withSession(async session => { assert.ok(session.ui); throw new Error('fixture failure'); }), /fixture failure/);
        assert.equal(closed, true);
    } finally { await browser.close(); }
});

test('RUNTIME-003 admission expiration between assessment and session prevents launch', async () => {
    let checks = 0; let launches = 0;
    const runtime = createVkConnectorPlaywrightRuntime({ actionAdmission: { assess: async () => ++checks === 1
        ? { status: 'ACTION_ADMITTED', executionContext: 'production_admitted', authorization: 'application_host' } : { status: 'PERMISSION_UNVERIFIED' } },
        profileDirectory: '/never-access-profile', evidenceDir: '/unused-evidence', approvedAssetSha256: 'a'.repeat(64),
        loadApprovedImage: async () => { throw new Error('not requested'); }, launch: { launch: async () => { launches++; throw new Error('not allowed'); } } });
    assert.equal((await runtime.admission.assess()).status, 'ACTION_ADMITTED');
    await assert.rejects(runtime.withSession(async () => undefined), /PERMISSION_UNVERIFIED/); assert.equal(launches, 0);
});

test('RUNTIME-004 hung owned-context cleanup is bounded and quarantines subsequent launches', async () => {
    const { chromium } = await import('playwright'); const browser = await chromium.launch(sandboxedChromiumLaunchOptions({ headless: true, executablePath: process.env.APP_BROWSER_EXECUTABLE_PATH ?? chromium.executablePath() }));
    try {
        const context = await browser.newContext(); await context.route('**/*', route => route.abort());
        const originalClose = context.close.bind(context); context.close = async () => new Promise(() => undefined);
        let launches = 0;
        const runtime = createVkConnectorPlaywrightRuntime({ actionAdmission: { assess: async () => ({ status: 'ACTION_ADMITTED', executionContext: 'production_admitted', authorization: 'application_host' }) },
            profileDirectory: '/never-access-profile', evidenceDir: '/unused', approvedAssetSha256: 'a'.repeat(64), cleanupTimeoutMs: 10,
            loadApprovedImage: async () => { throw new Error('unused'); }, launch: { launch: async () => { launches++; return context; } } });
        await assert.rejects(runtime.withSession(async () => undefined), /SESSION_CLEANUP_UNCONFIRMED/);
        await assert.rejects(runtime.withSession(async () => undefined), /SESSION_CLEANUP_UNCONFIRMED/); assert.equal(launches, 1);
        await originalClose();
    } finally { await browser.close(); }
});
