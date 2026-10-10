import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VkClipUi } from './vk_browser_clip_ui';
import { submitVkClipPublication } from './vk_browser_clip_submission';
import { loadVkRemoteImage, loadVkRemoteMedia } from './vk.service';

export interface VkBrowserJob {
    schema_version: 1;
    job_id: string;
    project_id: number;
    task_id: number;
    channel_id: number;
    idempotency_key: string;
    target: {
        community_url: string;
        placement: 'wall_post' | 'article' | 'video' | 'story' | 'clip';
        community_id?: number;
    };
    payload: {
        text: string;
        title?: string | null;
        media_path?: string | null;
        media_url?: string | null;
        /** @deprecated Use media_path. Retained for wall-post job compatibility. */
        image_path?: string | null;
        /** @deprecated Use media_url. Retained for wall-post job compatibility. */
        image_url?: string | null;
    };
    approval: {
        content_revision: number;
        accepted_revision: number;
        text_state: string;
        visual_state?: string | null;
        selected_asset_id?: number | null;
    };
    execution: {
        mode: 'prepare_only' | 'submit';
        authorization?: {
            work_item_id: number;
            lease_token: string;
            approval_reference: string;
            attempt_idempotency_key: string;
        };
    };
}

export interface VkBrowserReadback {
    public_url: string | null;
    provider_object_id: string;
    published_at: string;
    text: string;
    title?: string | null;
    owner_id?: string | null;
    media_present?: boolean;
    image_present?: boolean;
}

export interface VkBrowserUi {
    clip?: VkClipUi;
    navigate(url: string): Promise<void>;
    loginRequired(): Promise<boolean>;
    openWallComposer(): Promise<void>;
    setPostText(text: string): Promise<void>;
    attachImage(imagePath: string): Promise<void>;
    captureScreenshot(screenshotPath: string): Promise<void>;
    submitPost?(): Promise<void>;
    readbackPost?(): Promise<VkBrowserReadback | null>;
    openComposer?(placement: VkBrowserJob['target']['placement']): Promise<void>;
    setContent?(content: { placement: VkBrowserJob['target']['placement']; title: string; text: string }): Promise<void>;
    attachMedia?(mediaPath: string, kind: VkBrowserMediaKind): Promise<void>;
    submit?(placement: VkBrowserJob['target']['placement']): Promise<void>;
    readback?(placement: VkBrowserJob['target']['placement']): Promise<VkBrowserReadback | null>;
}

interface SharedDependencies {
    clipOperationTimeoutMs?: number;
    ui?: VkBrowserUi;
    approvedAssetRoots: string[];
    evidenceDir: string;
    now?: () => Date;
    loadRemoteImage?: (url: string) => Promise<{ buffer: Buffer; filename: string; contentType?: string }>;
}

export interface VkBrowserSubmissionControl {
    start(args: Record<string, unknown>): Promise<
        { status: 'started'; attempt_id: number }
        | { status: 'confirmed'; attempt_id: number; publication_fact_id: number; public_url: string | null }
        | { status: 'verification_required'; attempt_id: number; retry_allowed: false }
    >;
    confirm(args: Record<string, unknown>): Promise<{ publication_fact_id: number }>;
    markUncertain(args: Record<string, unknown>): Promise<void>;
}

function plannerPlacement(placement: VkBrowserJob['target']['placement']) {
    return placement === 'clip' ? 'clip' : placement === 'wall_post' ? 'feed'
        : placement === 'article' ? 'article_cover'
            : placement === 'video' ? 'video_cover' : 'story';
}

interface SubmitDependencies extends SharedDependencies {
    ui: VkBrowserUi;
    control: VkBrowserSubmissionControl;
}

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function normalizedVkText(value: string): string {
    return value
        .replace(/\r/g, '')
        .replace(/[\u00a0\u202f]/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
}

function validatedTarget(rawUrl: string, communityId?: number) {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error('[VK_BROWSER_TARGET_INVALID] Community target must be a valid VK HTTPS URL');
    }
    if (url.protocol !== 'https:'
        || !['vk.com', 'www.vk.com'].includes(url.hostname.toLowerCase())
        || url.username || url.password
        || url.pathname === '/') {
        throw new Error('[VK_BROWSER_TARGET_INVALID] Community target must be a valid VK HTTPS URL');
    }
    url.hash = '';
    if (Number.isSafeInteger(communityId) && Number(communityId) < 0) {
        return `https://vk.com/club${Math.abs(Number(communityId))}`;
    }
    return url.toString();
}

function approvedMediaPath(rawPath: string, roots: string[]) {
    if (!path.isAbsolute(rawPath) || !fs.existsSync(rawPath) || !fs.statSync(rawPath).isFile()) {
        throw new Error('[VK_BROWSER_ASSET_INVALID] Approved media must be an existing absolute file');
    }
    const resolvedFile = fs.realpathSync(rawPath);
    const allowed = roots.some((root) => {
        if (!path.isAbsolute(root) || !fs.existsSync(root)) return false;
        const resolvedRoot = fs.realpathSync(root);
        const relative = path.relative(resolvedRoot, resolvedFile);
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (!allowed) throw new Error('[VK_BROWSER_ASSET_OUTSIDE_APPROVED_ROOT] Media is outside approved asset roots');
    return resolvedFile;
}

type VkBrowserMediaKind = 'image' | 'video';

function mediaKind(filename: string, contentType?: string): VkBrowserMediaKind | null {
    const normalizedType = contentType?.toLowerCase() || '';
    if (normalizedType.startsWith('image/')) return 'image';
    if (normalizedType.startsWith('video/')) return 'video';
    const extension = path.extname(filename).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return 'image';
    if (['.mp4', '.mov', '.m4v', '.webm'].includes(extension)) return 'video';
    return null;
}

function assertMediaContract(placement: VkBrowserJob['target']['placement'], kind: VkBrowserMediaKind | null) {
    if (!kind) throw new Error('[VK_BROWSER_MEDIA_TYPE_INVALID] Approved media type is unsupported');
    if (['video', 'clip'].includes(placement) && kind !== 'video') {
        throw new Error('[VK_BROWSER_MEDIA_TYPE_INVALID] VK video publication requires an approved video asset');
    }
    if (['wall_post', 'article'].includes(placement) && kind !== 'image') {
        throw new Error('[VK_BROWSER_MEDIA_TYPE_INVALID] This VK placement requires an approved image asset');
    }
    return kind;
}

function assertBaseJob(job: VkBrowserJob) {
    if (job?.schema_version !== 1
        || !Number.isSafeInteger(job.project_id) || job.project_id <= 0
        || !Number.isSafeInteger(job.task_id) || job.task_id <= 0
        || !Number.isSafeInteger(job.channel_id) || job.channel_id <= 0
        || !job.job_id?.trim() || !job.idempotency_key?.trim()) {
        throw new Error('[VK_BROWSER_JOB_INVALID] Job identity is incomplete');
    }
    if (!['wall_post', 'article', 'video', 'story', 'clip'].includes(job.target?.placement)) {
        throw new Error('[VK_BROWSER_PLACEMENT_UNSUPPORTED] Unsupported VK browser placement');
    }
    if (job.approval?.text_state !== 'accepted'
        || !Number.isSafeInteger(job.approval.content_revision)
        || job.approval.content_revision <= 0
        || job.approval.accepted_revision !== job.approval.content_revision) {
        throw new Error('[VK_BROWSER_APPROVAL_REQUIRED] Current text revision must be accepted');
    }
}

function assertSubmitAuthorization(job: VkBrowserJob) {
    const authorization = job.execution?.authorization;
    if (job.execution?.mode !== 'submit'
        || !Number.isSafeInteger(job.target?.community_id)
        || Number(job.target.community_id) >= 0
        || !authorization
        || !Number.isSafeInteger(authorization.work_item_id)
        || authorization.work_item_id <= 0
        || !authorization.lease_token?.trim()
        || !authorization.approval_reference?.trim()
        || !authorization.attempt_idempotency_key?.trim()) {
        throw new Error('[VK_BROWSER_SUBMIT_AUTHORIZATION_REQUIRED] Owner-released active browser lease is required');
    }
    return authorization;
}

async function resolveBundle(job: VkBrowserJob, dependencies: SharedDependencies) {
    assertBaseJob(job);
    const communityUrl = validatedTarget(job.target.community_url, job.target.community_id);
    const text = typeof job.payload?.text === 'string' ? job.payload.text.trim() : '';
    const title = typeof job.payload?.title === 'string' ? job.payload.title.trim() : '';
    if (job.target.placement !== 'story' && !text) {
        throw new Error('[VK_BROWSER_TEXT_REQUIRED] Accepted publication text must not be empty');
    }
    if (['article', 'video'].includes(job.target.placement) && !title) {
        throw new Error('[VK_BROWSER_TITLE_REQUIRED] Accepted title must not be empty');
    }

    const mediaPathInput = job.payload.media_path || job.payload.image_path || null;
    const mediaUrlInput = job.payload.media_url || job.payload.image_url || null;
    if ((job.payload.media_path && job.payload.image_path)
        || (job.payload.media_url && job.payload.image_url)) {
        throw new Error('[VK_BROWSER_ASSET_AMBIGUOUS] Provide one approved media source');
    }

    const expectsMedia = Number.isSafeInteger(job.approval.selected_asset_id)
        && Number(job.approval.selected_asset_id) > 0;
    const mediaRequired = ['article', 'video', 'story', 'clip'].includes(job.target.placement);
    if (expectsMedia && job.approval.visual_state !== 'APPROVED') {
        throw new Error('[VK_BROWSER_VISUAL_NOT_APPROVED] Selected visual must be approved');
    }
    if (mediaPathInput && mediaUrlInput) {
        throw new Error('[VK_BROWSER_ASSET_AMBIGUOUS] Provide one approved media source');
    }
    if ((mediaPathInput || mediaUrlInput) && !expectsMedia) {
        throw new Error('[VK_BROWSER_ASSET_BINDING_REQUIRED] Browser media must match a selected approved asset');
    }
    if ((expectsMedia || mediaRequired) && !mediaPathInput && !mediaUrlInput) {
        throw new Error('[VK_BROWSER_MEDIA_REQUIRED] Selected approved media is missing from the browser bundle');
    }

    const evidenceDir = path.resolve(dependencies.evidenceDir);
    fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    let resolvedMediaPath: string | null = null;
    let mediaBuffer: Buffer | null = null;
    let resolvedMediaKind: VkBrowserMediaKind | null = null;
    let assetResolution = 'text_only';
    if (mediaPathInput) {
        resolvedMediaPath = approvedMediaPath(mediaPathInput, dependencies.approvedAssetRoots);
        mediaBuffer = fs.readFileSync(resolvedMediaPath);
        resolvedMediaKind = assertMediaContract(job.target.placement, mediaKind(resolvedMediaPath));
        if (job.target.placement === 'clip' && (path.extname(resolvedMediaPath).toLowerCase() !== '.mp4'
            || mediaBuffer.length < 12 || mediaBuffer.subarray(4, 8).toString('ascii') !== 'ftyp')) {
            throw new Error('[VK_CLIP_MP4_REQUIRED] Clip requires approved MP4 container bytes');
        }
        assetResolution = 'local_approved_file';
    } else if (mediaUrlInput) {
        const defaultLoader = ['video', 'story', 'clip'].includes(job.target.placement)
            ? loadVkRemoteMedia
            : loadVkRemoteImage;
        const remote = await (dependencies.loadRemoteImage || defaultLoader)(mediaUrlInput);
        mediaBuffer = remote.buffer;
        if (job.target.placement === 'clip' && (path.extname(remote.filename).toLowerCase() !== '.mp4'
            || mediaBuffer.length < 12 || mediaBuffer.subarray(4, 8).toString('ascii') !== 'ftyp')) {
            throw new Error('[VK_CLIP_MP4_REQUIRED] Clip requires approved MP4 container bytes');
        }
        resolvedMediaKind = assertMediaContract(job.target.placement, mediaKind(remote.filename, remote.contentType));
        const rawExtension = path.extname(remote.filename).toLowerCase();
        const extension = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.m4v', '.webm'].includes(rawExtension)
            ? rawExtension
            : resolvedMediaKind === 'video' ? '.mp4' : '.img';
        const assetsDir = path.join(evidenceDir, 'assets');
        fs.mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
        resolvedMediaPath = path.join(assetsDir, `${sha256(mediaBuffer).slice(0, 20)}${extension}`);
        fs.writeFileSync(resolvedMediaPath, mediaBuffer, { mode: 0o600 });
        assetResolution = 'https_approved_asset';
    }
    return {
        communityUrl,
        placement: job.target.placement,
        title,
        titleSha256: title ? sha256(title) : null,
        text,
        textSha256: sha256(text),
        mediaPath: resolvedMediaPath,
        mediaKind: resolvedMediaKind,
        mediaSha256: mediaBuffer ? sha256(mediaBuffer) : null,
        expectsMedia,
        assetResolution,
        evidenceDir
    };
}

function validateReadback(job: VkBrowserJob, bundle: Awaited<ReturnType<typeof resolveBundle>>, readback: VkBrowserReadback | null) {
    if (!readback) throw new Error('[VK_BROWSER_READBACK_UNCONFIRMED] Provider object was not confirmed');
    const expectedOwnerId = String(job.target.community_id);
    const publishedAt = new Date(readback.published_at);
    let publicUrl: URL | null = null;
    if (readback.public_url) {
        try {
            publicUrl = new URL(readback.public_url);
        } catch {
            throw new Error('[VK_BROWSER_READBACK_UNCONFIRMED] Provider permalink is invalid');
        }
        if (publicUrl.protocol !== 'https:'
            || !['vk.com', 'www.vk.com', 'vk.ru', 'www.vk.ru'].includes(publicUrl.hostname.toLowerCase())) {
            throw new Error('[VK_BROWSER_READBACK_UNCONFIRMED] Provider permalink is invalid');
        }
    }
    const wallMatch = publicUrl ? /^\/wall(-\d+)_(\d+)$/.exec(publicUrl.pathname) : null;
    const videoMatch = publicUrl ? /^\/video(-\d+)_(\d+)$/.exec(publicUrl.pathname) : null;
    const identityMatches = bundle.placement === 'wall_post'
        ? Boolean(wallMatch && wallMatch[1] === expectedOwnerId
            && readback.provider_object_id === `${wallMatch[1]}_${wallMatch[2]}`)
        : bundle.placement === 'video'
            ? Boolean(videoMatch && videoMatch[1] === expectedOwnerId
                && readback.provider_object_id === `video${videoMatch[1]}_${videoMatch[2]}`)
            : bundle.placement === 'article'
                ? Boolean(publicUrl && /^\/@[^/]+/.test(publicUrl.pathname)
                    && readback.owner_id === expectedOwnerId && readback.provider_object_id.trim())
                : Boolean(readback.owner_id === expectedOwnerId && readback.provider_object_id.trim());
    const textMatches = bundle.placement === 'story'
        || normalizedVkText(readback.text) === normalizedVkText(bundle.text);
    const titleMatches = !bundle.title
        || normalizedVkText(readback.title || '') === normalizedVkText(bundle.title);
    const mediaPresent = readback.media_present === true || readback.image_present === true;
    if (!identityMatches
        || !Number.isFinite(publishedAt.getTime())
        || !textMatches
        || !titleMatches
        || (bundle.expectsMedia && !mediaPresent)) {
        throw new Error('[VK_BROWSER_READBACK_UNCONFIRMED] Exact accepted provider object was not confirmed');
    }
    return { ...readback, public_url: publicUrl?.toString() || null, published_at: publishedAt.toISOString() };
}

/** Prepare a governed bundle without opening or mutating a provider browser. */
export async function prepareVkBrowserPublication(job: VkBrowserJob, dependencies: SharedDependencies) {
    if (job.execution?.mode !== 'prepare_only') {
        throw new Error('[VK_BROWSER_PREPARE_MODE_REQUIRED] Prepare-only execution is required');
    }
    const bundle = await resolveBundle(job, dependencies);
    const preparedAt = (dependencies.now || (() => new Date()))().toISOString();
    return {
        schema_version: 1,
        job_id: job.job_id,
        project_id: job.project_id,
        task_id: job.task_id,
        channel_id: job.channel_id,
        idempotency_key: job.idempotency_key,
        status: 'prepared_not_submitted' as const,
        route_trace: {
            eligibility: 'accepted_revision',
            session_target: new URL(bundle.communityUrl).hostname,
            asset_resolution: bundle.assetResolution,
            fallback_reason: 'vk_api_credentials_unavailable',
            final_adapter: 'vk_browser_local'
        },
        payload: {
            placement: bundle.placement,
            title_sha256: bundle.titleSha256,
            title_length: bundle.title.length,
            text_sha256: bundle.textSha256,
            text_length: bundle.text.length,
            media_kind: bundle.mediaKind,
            media_sha256: bundle.mediaSha256,
            image_sha256: bundle.mediaKind === 'image' ? bundle.mediaSha256 : null,
            selected_asset_id: job.approval.selected_asset_id || null,
            content_revision: job.approval.content_revision
        },
        evidence: {
            prepared_at: preparedAt,
            screenshot_path: null,
            submitted: false,
            provider_upload: false
        }
    };
}

/** Submit one durable authorized attempt and confirm exact provider readback. */
export async function submitVkBrowserPublication(job: VkBrowserJob, dependencies: SubmitDependencies) {
    const authorization = assertSubmitAuthorization(job);
    const bundle = await resolveBundle(job, dependencies);
    if (bundle.placement === 'clip') return submitVkClipPublication(job, bundle, dependencies);
    const richMedia = bundle.placement !== 'wall_post';
    if (richMedia && (!dependencies.ui.openComposer || !dependencies.ui.setContent
        || !dependencies.ui.attachMedia || !dependencies.ui.submit || !dependencies.ui.readback)) {
        throw new Error('[VK_BROWSER_SUBMIT_UI_REQUIRED] Format-specific submit and readback UI are required');
    }
    if (!richMedia && (!dependencies.ui.submitPost || !dependencies.ui.readbackPost)) {
        throw new Error('[VK_BROWSER_SUBMIT_UI_REQUIRED] Submit and readback UI are required');
    }

    await dependencies.ui.navigate(bundle.communityUrl);
    if (await dependencies.ui.loginRequired()) {
        throw new Error('[VK_BROWSER_LOGIN_REQUIRED] Sign in to the dedicated VK browser profile and retry');
    }
    let started: Awaited<ReturnType<VkBrowserSubmissionControl['start']>> | null = null;
    try {
        if (richMedia) {
            await dependencies.ui.openComposer!(bundle.placement);
            await dependencies.ui.setContent!({ placement: bundle.placement, title: bundle.title, text: bundle.text });
        } else {
            await dependencies.ui.openWallComposer();
            await dependencies.ui.setPostText(bundle.text);
        }
        started = await dependencies.control.start({
            project_id: job.project_id,
            task_id: job.task_id,
            channel_id: job.channel_id,
            work_item_id: authorization.work_item_id,
            lease_token: authorization.lease_token,
            approval_reference: authorization.approval_reference,
            idempotency_key: authorization.attempt_idempotency_key,
            content_revision: job.approval.content_revision,
            text_sha256: bundle.textSha256,
            title_sha256: bundle.titleSha256,
            image_sha256: bundle.mediaSha256,
            selected_asset_id: job.approval.selected_asset_id || null,
            placement: plannerPlacement(bundle.placement)
        });
        if (started.status === 'confirmed') {
            return {
                status: 'confirmed_published' as const,
                attempt_id: started.attempt_id,
                publication_fact_id: started.publication_fact_id,
                public_url: started.public_url,
                replayed: true
            };
        }
        if (started.status === 'verification_required') {
            throw new Error('[VK_BROWSER_EXISTING_ATTEMPT_REQUIRES_RECONCILIATION] Existing provider attempt must be reconciled; automatic retry is forbidden');
        }
        if (bundle.mediaPath) {
            if (richMedia) await dependencies.ui.attachMedia!(bundle.mediaPath, bundle.mediaKind!);
            else await dependencies.ui.attachImage(bundle.mediaPath);
        }
        const screenshotPath = path.join(bundle.evidenceDir, `${sha256(job.job_id).slice(0, 16)}-pre-submit.png`);
        await dependencies.ui.captureScreenshot(screenshotPath);
        const evidenceSha256 = sha256(fs.readFileSync(screenshotPath));
        if (richMedia) await dependencies.ui.submit!(bundle.placement);
        else await dependencies.ui.submitPost!();
        const readback = validateReadback(job, bundle, richMedia
            ? await dependencies.ui.readback!(bundle.placement)
            : await dependencies.ui.readbackPost!());
        const confirmed = await dependencies.control.confirm({
            project_id: job.project_id,
            task_id: job.task_id,
            channel_id: job.channel_id,
            work_item_id: authorization.work_item_id,
            lease_token: authorization.lease_token,
            approval_reference: authorization.approval_reference,
            attempt_id: started.attempt_id,
            public_url: readback.public_url,
            provider_object_id: readback.provider_object_id,
            published_at: readback.published_at,
            text_sha256: bundle.textSha256,
            title_sha256: bundle.titleSha256,
            image_sha256: bundle.mediaSha256,
            selected_asset_id: job.approval.selected_asset_id || null,
            content_revision: job.approval.content_revision,
            placement: plannerPlacement(bundle.placement),
            evidence_sha256: evidenceSha256,
            idempotency_key: authorization.attempt_idempotency_key
        });
        return {
            status: 'confirmed_published' as const,
            attempt_id: started.attempt_id,
            publication_fact_id: confirmed.publication_fact_id,
            public_url: readback.public_url,
            replayed: false
        };
    } catch (error: unknown) {
        if (!started || started.status !== 'started') throw error;
        await dependencies.control.markUncertain({
            project_id: job.project_id,
            task_id: job.task_id,
            work_item_id: authorization.work_item_id,
            lease_token: authorization.lease_token,
            attempt_id: started.attempt_id,
            reason_code: (error instanceof Error ? error.message : '').match(/^\[[A-Z0-9_]+\]/)?.[0] || '[VK_BROWSER_SUBMIT_UNCERTAIN]',
            idempotency_key: authorization.attempt_idempotency_key
        });
        throw error;
    }
}
