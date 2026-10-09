import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { PlaywrightVkBrowserUi } from '../services/vk_browser_playwright_ui';
import { createHash } from 'node:crypto';
import type { VkClipBaseline, VkClipReadback, VkClipUi } from '../services/vk_browser_clip_ui';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { prepareVkBrowserPublication, submitVkBrowserPublication, type VkBrowserJob, type VkBrowserUi, type VkBrowserSubmissionControl } from '../services/vk_browser_worker.service';

function fixture(root: string): VkBrowserJob {
    const mediaPath = path.join(root, 'approved.mp4');
    fs.writeFileSync(mediaPath, Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex'));
    return {
        schema_version: 1, job_id: 'clip-900-r3', project_id: 10, task_id: 900, channel_id: 120,
        idempotency_key: 'clip-900-r3',
        target: { community_url: 'https://vk.com/club240051152', community_id: -240051152,
            placement: 'clip' },
        payload: { text: 'Accepted Clip caption', media_path: mediaPath },
        approval: { content_revision: 3, accepted_revision: 3, text_state: 'accepted', visual_state: 'APPROVED', selected_asset_id: 18 },
        execution: { mode: 'prepare_only' }
    };
}

function temporaryRoot(t: TestContext): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-clip-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test('VK Clip prepare preserves clip placement and approved MP4 without provider activity', async (t) => {
    const root = temporaryRoot(t);
    const result = await prepareVkBrowserPublication(fixture(root), { approvedAssetRoots: [root], evidenceDir: root });
    assert.equal(result.payload.placement, 'clip');
    assert.equal(result.payload.media_kind, 'video');
    assert.equal(result.evidence.provider_upload, false);
});

test('VK Clip submit fails closed before navigation when the Clip UI has not been verified', async (t) => {
    const root = temporaryRoot(t);
    let activity = 0;
    const ui: VkBrowserUi = {
        navigate: async () => { activity += 1; }, loginRequired: async () => false,
        openWallComposer: async () => { activity += 1; }, setPostText: async () => {}, attachImage: async () => {},
        captureScreenshot: async () => {}
    };
    const job = fixture(root);
    job.execution = { mode: 'submit', authorization: { work_item_id: 1, lease_token: 'lease', approval_reference: 'owner-approved', attempt_idempotency_key: 'clip-attempt-1' } };
    await assert.rejects(submitVkBrowserPublication(job, {
        ui, approvedAssetRoots: [root], evidenceDir: root,
        control: { start: async () => { activity += 1; return { status: 'started', attempt_id: 1 }; },
            confirm: async () => ({ publication_fact_id: 1 }), markUncertain: async () => {} }
    }), /VK_CLIP_UI_UNVERIFIED/);
    assert.equal(activity, 0);
});

function executable(root: string) {
    const job = fixture(root);
    job.execution = { mode: 'submit', authorization: { work_item_id: 1, lease_token: 'lease', approval_reference: 'owner-approved', attempt_idempotency_key: 'clip-attempt-1' } };
    const calls: string[] = [];
    const confirmations: Record<string, unknown>[] = [];
    const uncertain: Record<string, unknown>[] = [];
    const bytes = fs.readFileSync(job.payload.media_path!);
    const mediaHash = createHash('sha256').update(bytes).digest('hex');
    const baseline: VkClipBaseline = { owner_id: '-240051152', object_ids: ['clip-240051152_10'],
        complete: true, captured_at: '2026-10-09T12:00:00.000Z' };
    const readback: VkClipReadback = { public_url: 'https://vk.com/clip-240051152_11',
        provider_object_id: 'clip-240051152_11', owner_id: '-240051152', provider_kind: 'short_video',
        provider_timestamp_source: 'provider', published_at: '2026-10-09T12:00:01.000Z',
        observed_at: '2026-10-09T12:00:02.000Z', text: 'Accepted Clip caption', media_present: true,
        clip_media_sha256: mediaHash };
    const clip: VkClipUi = {
        assertSurfaceVerified: async () => { calls.push('verified'); },
        baseline: async () => { calls.push('baseline'); return baseline; },
        openComposer: async () => { calls.push('clip_composer'); },
        setCaption: async () => { calls.push('caption'); },
        attachMp4: async (_file, hash) => { assert.equal(hash, mediaHash); calls.push('upload'); },
        submit: async () => { calls.push('submit'); }, readback: async () => { calls.push('readback'); return readback; }
    };
    const ui: VkBrowserUi = {
        clip, navigate: async () => { calls.push('navigate'); }, loginRequired: async () => false,
        openWallComposer: async () => { assert.fail('Clip must not use wall composer'); },
        setPostText: async () => { assert.fail('Clip must not use wall text'); },
        attachImage: async () => { assert.fail('Clip must not upload images'); },
        openComposer: async () => { assert.fail('Clip must not use generic rich media composer'); },
        submit: async () => { assert.fail('Clip must not use generic rich media submit'); },
        captureScreenshot: async (file) => { calls.push('screenshot'); fs.writeFileSync(file, 'evidence'); }
    };
    const control: VkBrowserSubmissionControl = {
        start: async (args) => { assert.equal(args.placement, 'clip'); calls.push('start'); return { status: 'started', attempt_id: 7 }; },
        confirm: async (args) => { confirmations.push(args); calls.push('confirm'); return { publication_fact_id: 15 }; },
        markUncertain: async (args) => { uncertain.push(args); calls.push('uncertain'); }
    };
    const dependencies = { ui, control, approvedAssetRoots: [root], evidenceDir: root,
        now: () => new Date('2026-10-09T12:00:00.000Z') };
    return { job, calls, confirmations, uncertain, baseline, readback, clip, control, dependencies };
}

test('Clip orchestration confirms only a new exact provider short_video with complete evidence', async (t) => {
    const f = executable(temporaryRoot(t));
    const result = await submitVkBrowserPublication(f.job, f.dependencies);
    assert.equal(result.publication_fact_id, 15);
    assert.equal(result.public_url, 'https://vk.com/clip-240051152_11');
    assert.deepEqual(f.calls, ['verified', 'navigate', 'baseline', 'clip_composer', 'caption', 'start', 'upload', 'screenshot', 'submit', 'readback', 'confirm']);
    assert.equal(f.confirmations[0].provider_kind, 'short_video');
    assert.equal(f.confirmations[0].provider_timestamp_source, 'provider');
    assert.deepEqual(f.confirmations[0].clip_baseline_object_ids, ['clip-240051152_10']);
    assert.equal(f.confirmations[0].published_at, f.readback.published_at);
    assert.equal(f.confirmations[0].clip_media_sha256, f.readback.clip_media_sha256);
    assert.equal(f.confirmations[0].placement, 'clip');
    assert.deepEqual(f.uncertain, []);
});

for (const mutation of ['old_object', 'ordinary_video', 'wrong_owner', 'wrong_caption', 'wrong_media', 'old_timestamp', 'future_timestamp', 'missing_media', 'wrong_kind', 'invented_timestamp'] as const) {
    test(`Clip readback ${mutation} cannot create a publication fact or retry`, async (t) => {
        const f = executable(temporaryRoot(t));
        if (mutation === 'old_object') f.baseline.object_ids.push(f.readback.provider_object_id);
        if (mutation === 'ordinary_video') f.readback.public_url = 'https://vk.com/video-240051152_11';
        if (mutation === 'wrong_owner') f.readback.owner_id = '-42';
        if (mutation === 'wrong_caption') f.readback.text = 'Different caption';
        if (mutation === 'wrong_media') f.readback.clip_media_sha256 = 'f'.repeat(64);
        if (mutation === 'old_timestamp') f.readback.published_at = '2026-10-08T12:00:00.000Z';
        if (mutation === 'future_timestamp') f.readback.published_at = '2026-10-09T13:00:00.000Z';
        if (mutation === 'missing_media') f.readback.media_present = false;
        if (mutation === 'wrong_kind') Object.assign(f.readback, { provider_kind: 'video' });
        if (mutation === 'invented_timestamp') Object.assign(f.readback, { provider_timestamp_source: 'local_clock' });
        await assert.rejects(submitVkBrowserPublication(f.job, f.dependencies), /VK_CLIP_READBACK_UNCONFIRMED/);
        assert.equal(f.confirmations.length, 0);
        assert.equal(f.uncertain.length, 1);
        assert.equal(f.calls.filter((op) => op === 'submit').length, 1);
    });
}

for (const mutation of ['incomplete', 'stale', 'wrong_owner', 'unbounded'] as const) {
    test(`Clip baseline ${mutation} stops before attempt start and provider upload`, async (t) => {
        const f = executable(temporaryRoot(t));
        if (mutation === 'incomplete') f.baseline.complete = false;
        if (mutation === 'stale') f.baseline.captured_at = '2026-10-09T11:55:00.000Z';
        if (mutation === 'wrong_owner') f.baseline.owner_id = '-42';
        if (mutation === 'unbounded') f.baseline.object_ids = Array.from({ length: 201 }, (_, i) => `clip-240051152_${i}`);
        await assert.rejects(submitVkBrowserPublication(f.job, f.dependencies), /VK_CLIP_BASELINE_UNCONFIRMED/);
        assert.equal(f.calls.includes('start'), false);
        assert.equal(f.calls.includes('upload'), false);
        assert.equal(f.uncertain.length, 0);
    });
}

test('existing uncertain Clip attempt is not uploaded or resubmitted', async (t) => {
    const f = executable(temporaryRoot(t));
    f.control.start = async () => ({ status: 'verification_required', attempt_id: 7, retry_allowed: false });
    await assert.rejects(submitVkBrowserPublication(f.job, f.dependencies), /REQUIRES_RECONCILIATION/);
    assert.equal(f.calls.includes('upload'), false);
    assert.equal(f.calls.includes('submit'), false);
    assert.equal(f.uncertain.length, 0);
});

test('confirmed Clip idempotency replay skips provider upload and returns the prior fact', async (t) => {
    const f = executable(temporaryRoot(t));
    f.control.start = async () => ({ status: 'confirmed', attempt_id: 7, publication_fact_id: 15, public_url: f.readback.public_url });
    const result = await submitVkBrowserPublication(f.job, f.dependencies);
    assert.equal(result.replayed, true);
    assert.equal(f.calls.includes('upload'), false);
    assert.equal(f.calls.includes('submit'), false);
});

test('Clip submit acknowledgement loss marks uncertainty and performs no retry', async (t) => {
    const f = executable(temporaryRoot(t));
    f.clip.submit = async () => { f.calls.push('submit'); throw new Error('provider acknowledgement unavailable'); };
    await assert.rejects(submitVkBrowserPublication(f.job, f.dependencies), /VK_CLIP_PROVIDER_OPERATION_FAILED/);
    assert.equal(f.uncertain.length, 1);
    assert.equal(f.uncertain[0].reason_code, '[VK_CLIP_PROVIDER_OPERATION_FAILED]');
    assert.equal(f.confirmations.length, 0);
    assert.equal(f.calls.filter((op) => op === 'submit').length, 1);
});

test('Clip rejects images and fake MP4 bytes before provider navigation', async (t) => {
    const root = temporaryRoot(t);
    const job = fixture(root);
    fs.writeFileSync(job.payload.media_path!, 'not-MP4');
    await assert.rejects(prepareVkBrowserPublication(job, { approvedAssetRoots: [root], evidenceDir: root }), /VK_CLIP_MP4_REQUIRED/);
    const image = path.join(root, 'approved.png'); fs.writeFileSync(image, 'image'); job.payload.media_path = image;
    await assert.rejects(prepareVkBrowserPublication(job, { approvedAssetRoots: [root], evidenceDir: root }), /VK_BROWSER_MEDIA_TYPE_INVALID/);
});

test('Clip baseline timeout stops before durable attempt and provider mutation', async (t) => {
    const f = executable(temporaryRoot(t));
    f.clip.baseline = async () => new Promise(() => {});
    await assert.rejects(submitVkBrowserPublication(f.job, { ...f.dependencies, clipOperationTimeoutMs: 10 }), /VK_CLIP_OPERATION_TIMEOUT/);
    assert.equal(f.calls.includes('start'), false);
    assert.equal(f.calls.includes('upload'), false);
    assert.equal(f.uncertain.length, 0);
});

test('Playwright has no fabricated live Clip selectors and its default port is blocked', async () => {
    const ui = new PlaywrightVkBrowserUi({} as Page);
    await assert.rejects(ui.clip.assertSurfaceVerified(), /VK_CLIP_UI_UNVERIFIED/);
    await assert.rejects(ui.openComposer('clip'), /VK_CLIP_PORT_REQUIRED/);
    await assert.rejects(ui.submit('clip'), /VK_CLIP_PORT_REQUIRED/);
    await assert.rejects(ui.readback('clip'), /VK_CLIP_PORT_REQUIRED/);
});

for (const url of ['https://vk.com:443/clip-240051152_11', 'https://vk.com:444/clip-240051152_11', 'https://user:secret@vk.com/clip-240051152_11',
    'https://vk.com/clip-240051152_11?access_token=hidden', 'https://vk.com/clip-240051152_11#hidden',
    'https://vk.com/clip-240051152_0', 'https://vk.com/clip-240051152_011']) {
    test(`Clip readback rejects noncanonical URL ${new URL(url).pathname}`, async (t) => {
        const f = executable(temporaryRoot(t));
        f.readback.public_url = url;
        f.readback.provider_object_id = new URL(url).pathname.slice(1);
        await assert.rejects(submitVkBrowserPublication(f.job, f.dependencies), /VK_CLIP_READBACK_UNCONFIRMED/);
        assert.equal(f.confirmations.length, 0);
        assert.equal(f.uncertain.length, 1);
    });
}

test('raw provider errors are sanitized before reaching worker output or uncertain metadata', async (t) => {
    const f = executable(temporaryRoot(t));
    f.clip.submit = async () => { throw new Error('Cookie=SECRET_COOKIE access_token=SECRET_TOKEN'); };
    await assert.rejects(submitVkBrowserPublication(f.job, f.dependencies), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes('SECRET'), false);
        return true;
    });
    assert.equal(JSON.stringify(f.uncertain).includes('SECRET'), false);
});

test('upload deadline freezes uncertainty and late upload completion never chains into submit', async (t) => {
    const f = executable(temporaryRoot(t));
    let finishUpload: (() => void) | undefined;
    f.clip.attachMp4 = async () => new Promise<void>((resolve) => { f.calls.push('upload'); finishUpload = resolve; });
    await assert.rejects(submitVkBrowserPublication(f.job, { ...f.dependencies, clipOperationTimeoutMs: 10 }), /VK_CLIP_OPERATION_TIMEOUT/);
    assert.equal(f.uncertain.length, 1);
    finishUpload?.();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.calls.includes('submit'), false);
    assert.equal(f.confirmations.length, 0);
});

test('pre-mutation baseline provider errors are sanitized without starting a provider attempt', async (t) => {
    const f = executable(temporaryRoot(t));
    f.clip.baseline = async () => { throw new Error('SECRET_SESSION token=hidden'); };
    await assert.rejects(submitVkBrowserPublication(f.job, f.dependencies), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes('SECRET'), false);
        return /VK_CLIP_PROVIDER_OPERATION_FAILED/.test(error.message);
    });
    assert.equal(f.calls.includes('start'), false);
    assert.equal(f.calls.includes('upload'), false);
});
