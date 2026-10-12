import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VkBrowserJob, VkBrowserUi, VkBrowserSubmissionControl } from './vk_browser_worker.service';
import type { VkClipBaseline, VkClipReadback } from './vk_browser_clip_ui';

interface ClipBundle {
    communityUrl: string;
    text: string;
    textSha256: string;
    mediaPath: string | null;
    mediaSha256: string | null;
    evidenceDir: string;
}
interface ClipDependencies {
    ui: VkBrowserUi;
    control: VkBrowserSubmissionControl;
    now?: () => Date;
    clipOperationTimeoutMs?: number;
}
/** Exact snake-case evidence required by Planner Clip confirmation. */
export interface VkClipConfirmationProof {
    provider_kind: 'short_video';
    provider_timestamp_source: 'provider';
    clip_baseline_captured_at: string;
    clip_baseline_object_ids: string[];
    clip_submission_started_at: string;
    readback_observed_at: string;
    clip_media_sha256: string;
}

const SAFE_ERROR_CODES = new Set([
    '[VK_CLIP_UI_UNVERIFIED]', '[VK_CLIP_OPERATION_TIMEOUT]', '[VK_CLIP_EVIDENCE_INVALID]',
    '[VK_CLIP_BASELINE_UNCONFIRMED]', '[VK_CLIP_READBACK_UNCONFIRMED]',
    '[VK_CLIP_PROVIDER_OPERATION_FAILED]', '[VK_CLIP_UNCERTAIN_RECORD_FAILED]'
]);
function sanitizedError(error: unknown): Error {
    const code = error instanceof Error ? error.message.match(/^\[[A-Z0-9_]+\]/)?.[0] : undefined;
    const safeCode = code && SAFE_ERROR_CODES.has(code) ? code : '[VK_CLIP_PROVIDER_OPERATION_FAILED]';
    return new Error(`${safeCode} Clip operation failed; provider details are withheld`);
}

async function bounded<T>(operation: () => Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('[VK_CLIP_OPERATION_TIMEOUT] Clip operation did not finish within its bounded deadline')), milliseconds);
        })]);
    } catch (error: unknown) {
        throw sanitizedError(error);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
function timestamp(value: string): number {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error('[VK_CLIP_EVIDENCE_INVALID] Provider evidence requires valid timestamps');
    return parsed;
}
function normalize(text: string): string {
    return text.replace(/\r/g, '').replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n\n').trim();
}
function checkBaseline(baseline: VkClipBaseline, ownerId: string, now: number): void {
    const captured = timestamp(baseline.captured_at);
    if (baseline.complete !== true || baseline.owner_id !== ownerId || !Array.isArray(baseline.object_ids)
        || baseline.object_ids.length > 200 || new Set(baseline.object_ids).size !== baseline.object_ids.length
        || baseline.object_ids.some((id) => !new RegExp(`^clip${ownerId}_[1-9]\\d*$`).test(id))
        || captured > now || now - captured > 120_000) {
        throw new Error('[VK_CLIP_BASELINE_UNCONFIRMED] Complete recent Clip baseline for the exact community is required');
    }
}
function checkReadback(readback: VkClipReadback | null, baseline: VkClipBaseline, startedAt: string,
    bundle: ClipBundle, ownerId: string, now: number): VkClipReadback & VkClipConfirmationProof {
    if (!readback) throw new Error('[VK_CLIP_READBACK_UNCONFIRMED] New Clip was not confirmed');
    let url: URL;
    try { url = new URL(readback.public_url); }
    catch { throw new Error('[VK_CLIP_READBACK_UNCONFIRMED] Clip permalink is invalid'); }
    const match = /^https:\/\/(?:vk\.com|vk\.ru)\/clip(-[1-9]\d*)_([1-9]\d*)$/.exec(readback.public_url);
    const started = timestamp(startedAt);
    const observed = timestamp(readback.observed_at);
    const published = timestamp(readback.published_at);
    if (url.protocol !== 'https:' || !['vk.com', 'vk.ru'].includes(url.hostname)
        || url.port || url.username || url.password || url.search || url.hash || !match || match[1] !== ownerId
        || readback.provider_object_id !== `clip${match[1]}_${match[2]}` || readback.owner_id !== ownerId
        || readback.provider_kind !== 'short_video' || readback.provider_timestamp_source !== 'provider'
        || baseline.object_ids.includes(readback.provider_object_id)
        || normalize(readback.text) !== normalize(bundle.text) || readback.media_present !== true
        || readback.clip_media_sha256 !== bundle.mediaSha256
        || published < started - 10_000 || published > observed + 30_000
        || observed < started || observed > now + 30_000 || observed - started > 600_000) {
        throw new Error('[VK_CLIP_READBACK_UNCONFIRMED] Exact new provider Clip, timestamp, caption and approved media were not confirmed');
    }
    return { ...readback, public_url: `https://vk.com/clip${match[1]}_${match[2]}`,
        clip_baseline_captured_at: baseline.captured_at, clip_baseline_object_ids: [...baseline.object_ids],
        clip_submission_started_at: startedAt, readback_observed_at: readback.observed_at };
}

/** Execute only the Clip port; uncertain attempts require reconciliation, never a fallback. */
export async function submitVkClipPublication(job: VkBrowserJob, bundle: ClipBundle, dependencies: ClipDependencies) {
    const clip = dependencies.ui.clip;
    if (!clip) throw new Error('[VK_CLIP_UI_UNVERIFIED] A verified Clip-specific UI port is required');
    const timeout = dependencies.clipOperationTimeoutMs ?? 30_000;
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 60_000) {
        throw new Error('[VK_CLIP_DEADLINE_INVALID] Clip operation deadline must be bounded');
    }
    const step = <T>(operation: () => Promise<T>): Promise<T> => bounded(operation, timeout);
    await step(() => clip.assertSurfaceVerified());
    if (!bundle.mediaPath || !bundle.mediaSha256 || !job.execution.authorization) {
        throw new Error('[VK_CLIP_MEDIA_REQUIRED] Approved MP4 and active authorization are required');
    }
    const authorization = job.execution.authorization;
    const ownerId = String(job.target.community_id);
    const now = dependencies.now || (() => new Date());
    await step(() => dependencies.ui.navigate(bundle.communityUrl));
    if (await step(() => dependencies.ui.loginRequired())) throw new Error('[VK_BROWSER_LOGIN_REQUIRED] Dedicated VK session is required');
    const baseline = await step(() => clip.baseline(ownerId));
    checkBaseline(baseline, ownerId, now().getTime());
    await step(() => clip.openComposer(ownerId));
    await step(() => clip.setCaption(bundle.text));
    const identity = {
        project_id: job.project_id, task_id: job.task_id, channel_id: job.channel_id,
        work_item_id: authorization.work_item_id, lease_token: authorization.lease_token,
        approval_reference: authorization.approval_reference, idempotency_key: authorization.attempt_idempotency_key,
        content_revision: job.approval.content_revision, text_sha256: bundle.textSha256,
        title_sha256: null, image_sha256: bundle.mediaSha256, selected_asset_id: job.approval.selected_asset_id,
        placement: 'clip'
    };
    const started = await dependencies.control.start(identity).catch((error: unknown) => {
        throw sanitizedError(error);
    });
    if (started.status === 'confirmed') return {
        status: 'confirmed_published' as const, attempt_id: started.attempt_id,
        publication_fact_id: started.publication_fact_id, public_url: started.public_url, replayed: true
    };
    if (started.status === 'verification_required') {
        throw new Error('[VK_BROWSER_EXISTING_ATTEMPT_REQUIRES_RECONCILIATION] Existing Clip attempt must be reconciled; retry forbidden');
    }
    try {
        checkBaseline(baseline, ownerId, now().getTime());
        const startedAt = now().toISOString();
        await step(() => clip.attachMp4(bundle.mediaPath!, bundle.mediaSha256!));
        const screenshotPath = path.join(bundle.evidenceDir, `${createHash('sha256').update(job.job_id).digest('hex').slice(0, 16)}-clip-pre-submit.png`);
        await step(() => dependencies.ui.captureScreenshot(screenshotPath));
        const evidenceSha256 = createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex');
        await step(() => clip.submit());
        const readback = checkReadback(await step(() => clip.readback()), baseline, startedAt, bundle, ownerId, now().getTime());
        const confirmed = await dependencies.control.confirm({ ...identity, attempt_id: started.attempt_id,
            public_url: readback.public_url, provider_object_id: readback.provider_object_id,
            published_at: readback.published_at, evidence_sha256: evidenceSha256,
            provider_kind: readback.provider_kind, provider_timestamp_source: readback.provider_timestamp_source,
            clip_baseline_captured_at: readback.clip_baseline_captured_at,
            clip_baseline_object_ids: readback.clip_baseline_object_ids,
            clip_submission_started_at: readback.clip_submission_started_at,
            readback_observed_at: readback.readback_observed_at, clip_media_sha256: readback.clip_media_sha256 });
        return { status: 'confirmed_published' as const, attempt_id: started.attempt_id,
            publication_fact_id: confirmed.publication_fact_id, public_url: readback.public_url, replayed: false };
    } catch (error: unknown) {
        const safeError = sanitizedError(error);
        const reason = safeError.message.match(/^\[[A-Z0-9_]+\]/)?.[0] || '[VK_CLIP_PROVIDER_OPERATION_FAILED]';
        try {
            await dependencies.control.markUncertain({ ...identity, attempt_id: started.attempt_id, reason_code: reason });
        } catch {
            throw new Error('[VK_CLIP_UNCERTAIN_RECORD_FAILED] Clip attempt requires reconciliation; uncertainty recording failed');
        }
        throw safeError;
    }
}
