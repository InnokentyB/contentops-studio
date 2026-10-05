import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    prepareVkBrowserPublication,
    type VkBrowserJob,
    type VkBrowserUi
} from '../services/vk_browser_worker.service';

function fixture(imagePath: string, overrides: Partial<VkBrowserJob> = {}): VkBrowserJob {
    return {
        schema_version: 1,
        job_id: 'vk-browser:10:900:r3',
        project_id: 10,
        task_id: 900,
        channel_id: 120,
        idempotency_key: 'vk-browser:10:900:r3',
        target: {
            community_url: 'https://vk.com/analystcraft',
            placement: 'wall_post'
        },
        payload: {
            text: '  Accepted VK publication text  ',
            image_path: imagePath
        },
        approval: {
            content_revision: 3,
            accepted_revision: 3,
            text_state: 'accepted',
            visual_state: 'APPROVED',
            selected_asset_id: 18
        },
        execution: { mode: 'prepare_only' },
        ...overrides
    };
}

function fakeUi(loginRequired = false) {
    const calls: Array<{ operation: string; value?: string }> = [];
    const ui: VkBrowserUi = {
        navigate: async (url) => { calls.push({ operation: 'navigate', value: url }); },
        loginRequired: async () => loginRequired,
        openWallComposer: async () => { calls.push({ operation: 'open_composer' }); },
        setPostText: async (text) => { calls.push({ operation: 'set_text', value: text }); },
        attachImage: async (imagePath) => { calls.push({ operation: 'attach_image', value: imagePath }); },
        captureScreenshot: async (screenshotPath) => {
            calls.push({ operation: 'screenshot', value: screenshotPath });
            fs.writeFileSync(screenshotPath, 'png-evidence');
        }
    };
    return { ui, calls };
}

test('local VK worker prepares the exact approved payload and never submits it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-test-'));
    const imagePath = path.join(root, 'approved.png');
    const evidenceDir = path.join(root, 'evidence');
    fs.writeFileSync(imagePath, 'approved-image');
    const { ui, calls } = fakeUi();

    const result = await prepareVkBrowserPublication(fixture(imagePath), {
        ui,
        approvedAssetRoots: [root],
        evidenceDir,
        now: () => new Date('2026-10-05T12:00:00.000Z')
    });

    assert.deepEqual(calls.map((call) => call.operation), [
        'navigate', 'open_composer', 'set_text', 'attach_image', 'screenshot'
    ]);
    assert.equal(calls.find((call) => call.operation === 'set_text')?.value, 'Accepted VK publication text');
    assert.equal(calls.some((call) => call.operation === 'submit'), false);
    assert.equal(result.status, 'prepared_not_submitted');
    assert.equal(result.route_trace.final_adapter, 'vk_browser_local');
    assert.equal(result.route_trace.asset_resolution, 'local_approved_file');
    assert.equal(result.payload.text_length, 'Accepted VK publication text'.length);
    assert.match(result.payload.text_sha256, /^[a-f0-9]{64}$/);
    assert.match(result.payload.image_sha256 || '', /^[a-f0-9]{64}$/);
    assert.equal('text' in (result as any).payload, false);
    assert.equal(fs.existsSync(result.evidence.screenshot_path), true);
});

test('local VK worker materializes the approved HTTPS asset before opening the composer', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-remote-'));
    const { ui, calls } = fakeUi();
    const job = fixture('', {
        payload: {
            text: 'Accepted remote-image post',
            image_url: 'https://cdn.example/approved.png'
        }
    });
    const requested: string[] = [];
    const result = await prepareVkBrowserPublication(job, {
        ui,
        approvedAssetRoots: [],
        evidenceDir: path.join(root, 'evidence'),
        loadRemoteImage: async (url) => {
            requested.push(url);
            return { buffer: Buffer.from('remote-approved-image'), filename: 'approved.png' };
        }
    });

    assert.deepEqual(requested, ['https://cdn.example/approved.png']);
    const attached = calls.find((call) => call.operation === 'attach_image')?.value || '';
    assert.equal(path.dirname(attached), path.join(root, 'evidence', 'assets'));
    assert.equal(fs.readFileSync(attached, 'utf8'), 'remote-approved-image');
    assert.equal(result.route_trace.asset_resolution, 'https_approved_asset');
    assert.doesNotMatch(JSON.stringify(result), /cdn\.example/);
});

test('local VK worker rejects ambiguous image sources', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-ambiguous-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            payload: {
                text: 'Accepted text',
                image_path: imagePath,
                image_url: 'https://cdn.example/approved.png'
            }
        }), {
            ui: fakeUi().ui,
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence')
        }),
        /VK_BROWSER_ASSET_AMBIGUOUS/
    );
});

test('local VK worker never attaches an image without its approved asset binding', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-unbound-'));
    const imagePath = path.join(root, 'unbound.png');
    fs.writeFileSync(imagePath, 'image');
    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            approval: {
                content_revision: 3,
                accepted_revision: 3,
                text_state: 'accepted',
                visual_state: 'APPROVED',
                selected_asset_id: null
            }
        }), {
            ui: fakeUi().ui,
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence')
        }),
        /VK_BROWSER_ASSET_BINDING_REQUIRED/
    );
});

test('local VK worker rejects a session that requires login before touching the composer', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-login-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const { ui, calls } = fakeUi(true);

    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath), {
            ui,
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence')
        }),
        /VK_BROWSER_LOGIN_REQUIRED/
    );
    assert.deepEqual(calls.map((call) => call.operation), ['navigate']);
});

test('local VK worker refuses unapproved, stale or live-submit jobs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-guards-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const dependencies = { ui: fakeUi().ui, approvedAssetRoots: [root], evidenceDir: path.join(root, 'evidence') };

    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            approval: { content_revision: 4, accepted_revision: 3, text_state: 'accepted', visual_state: 'APPROVED', selected_asset_id: 18 }
        }), dependencies),
        /VK_BROWSER_APPROVAL_REQUIRED/
    );
    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            execution: { mode: 'submit' as 'prepare_only' }
        }), dependencies),
        /VK_BROWSER_SUBMIT_DISABLED/
    );
});

test('local VK worker constrains target host and approved asset roots', async () => {
    const approvedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-approved-'));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-outside-'));
    const outsideImage = path.join(outsideRoot, 'not-approved.png');
    fs.writeFileSync(outsideImage, 'image');
    const dependencies = {
        ui: fakeUi().ui,
        approvedAssetRoots: [approvedRoot],
        evidenceDir: path.join(approvedRoot, 'evidence')
    };

    await assert.rejects(
        prepareVkBrowserPublication(fixture(outsideImage), dependencies),
        /VK_BROWSER_ASSET_OUTSIDE_APPROVED_ROOT/
    );
    await assert.rejects(
        prepareVkBrowserPublication(fixture(outsideImage, {
            target: { community_url: 'https://example.com/analystcraft', placement: 'wall_post' }
        }), dependencies),
        /VK_BROWSER_TARGET_INVALID/
    );
});

test('local VK worker evidence never includes cookies, profile data or publication text', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-redaction-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const { ui } = fakeUi();
    const result = await prepareVkBrowserPublication(fixture(imagePath), {
        ui,
        approvedAssetRoots: [root],
        evidenceDir: path.join(root, 'evidence')
    });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /Accepted VK publication text/);
    assert.doesNotMatch(serialized, /cookie|storage_state|profile_dir/i);
});
