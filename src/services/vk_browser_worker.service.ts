import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadVkRemoteImage } from './vk.service';

export interface VkBrowserJob {
    schema_version: 1;
    job_id: string;
    project_id: number;
    task_id: number;
    channel_id: number;
    idempotency_key: string;
    target: {
        community_url: string;
        placement: 'wall_post';
        community_id?: number;
    };
    payload: {
        text: string;
        image_path?: string | null;
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
    public_url: string;
    provider_object_id: string;
    published_at: string;
    text: string;
    image_present: boolean;
}

export interface VkBrowserUi {
    navigate(url: string): Promise<void>;
    loginRequired(): Promise<boolean>;
    openWallComposer(): Promise<void>;
    setPostText(text: string): Promise<void>;
    attachImage(imagePath: string): Promise<void>;
    captureScreenshot(screenshotPath: string): Promise<void>;
    submitPost?(): Promise<void>;
    readbackPost?(): Promise<VkBrowserReadback | null>;
}

interface SharedDependencies {
    ui?: VkBrowserUi;
    approvedAssetRoots: string[];
    evidenceDir: string;
    now?: () => Date;
    loadRemoteImage?: (url: string) => Promise<{ buffer: Buffer; filename: string }>;
}

export interface VkBrowserSubmissionControl {
    start(args: Record<string, unknown>): Promise<
        { status: 'started'; attempt_id: number }
        | { status: 'confirmed'; attempt_id: number; publication_fact_id: number; public_url: string }
        | { status: 'verification_required'; attempt_id: number; retry_allowed: false }
    >;
    confirm(args: Record<string, unknown>): Promise<{ publication_fact_id: number }>;
    markUncertain(args: Record<string, unknown>): Promise<void>;
}

interface SubmitDependencies extends SharedDependencies {
    ui: VkBrowserUi;
    control: VkBrowserSubmissionControl;
}

function sha256(value: string | Buffer) {
    return createHash('sha256').update(value).digest('hex');
}

function normalizedVkText(value: string) {
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

function approvedImagePath(rawPath: string, roots: string[]) {
    if (!path.isAbsolute(rawPath) || !fs.existsSync(rawPath) || !fs.statSync(rawPath).isFile()) {
        throw new Error('[VK_BROWSER_ASSET_INVALID] Approved image must be an existing absolute file');
    }
    const resolvedFile = fs.realpathSync(rawPath);
    const allowed = roots.some((root) => {
        if (!path.isAbsolute(root) || !fs.existsSync(root)) return false;
        const resolvedRoot = fs.realpathSync(root);
        const relative = path.relative(resolvedRoot, resolvedFile);
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (!allowed) throw new Error('[VK_BROWSER_ASSET_OUTSIDE_APPROVED_ROOT] Image is outside approved asset roots');
    return resolvedFile;
}

function assertBaseJob(job: VkBrowserJob) {
    if (job?.schema_version !== 1
        || !Number.isSafeInteger(job.project_id) || job.project_id <= 0
        || !Number.isSafeInteger(job.task_id) || job.task_id <= 0
        || !Number.isSafeInteger(job.channel_id) || job.channel_id <= 0
        || !job.job_id?.trim() || !job.idempotency_key?.trim()) {
        throw new Error('[VK_BROWSER_JOB_INVALID] Job identity is incomplete');
    }
    if (job.target?.placement !== 'wall_post') {
        throw new Error('[VK_BROWSER_PLACEMENT_UNSUPPORTED] The worker supports VK wall posts only');
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
    if (!text) throw new Error('[VK_BROWSER_TEXT_REQUIRED] Accepted publication text must not be empty');

    const expectsImage = Number.isSafeInteger(job.approval.selected_asset_id)
        && Number(job.approval.selected_asset_id) > 0;
    if (expectsImage && job.approval.visual_state !== 'APPROVED') {
        throw new Error('[VK_BROWSER_VISUAL_NOT_APPROVED] Selected visual must be approved');
    }
    if (job.payload.image_path && job.payload.image_url) {
        throw new Error('[VK_BROWSER_ASSET_AMBIGUOUS] Provide one approved image source');
    }
    if ((job.payload.image_path || job.payload.image_url) && !expectsImage) {
        throw new Error('[VK_BROWSER_ASSET_BINDING_REQUIRED] Browser image must match a selected approved asset');
    }
    if (expectsImage && !job.payload.image_path && !job.payload.image_url) {
        throw new Error('[VK_BROWSER_ASSET_MISSING] Selected approved visual is missing from the browser bundle');
    }

    const evidenceDir = path.resolve(dependencies.evidenceDir);
    fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    let imagePath: string | null = null;
    let imageBuffer: Buffer | null = null;
    let assetResolution = 'text_only';
    if (job.payload.image_path) {
        imagePath = approvedImagePath(job.payload.image_path, dependencies.approvedAssetRoots);
        imageBuffer = fs.readFileSync(imagePath);
        assetResolution = 'local_approved_file';
    } else if (job.payload.image_url) {
        const remote = await (dependencies.loadRemoteImage || loadVkRemoteImage)(job.payload.image_url);
        imageBuffer = remote.buffer;
        const extension = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(remote.filename).toLowerCase())
            ? path.extname(remote.filename).toLowerCase()
            : '.img';
        const assetsDir = path.join(evidenceDir, 'assets');
        fs.mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
        imagePath = path.join(assetsDir, `${sha256(imageBuffer).slice(0, 20)}${extension}`);
        fs.writeFileSync(imagePath, imageBuffer, { mode: 0o600 });
        assetResolution = 'https_approved_asset';
    }
    return {
        communityUrl,
        text,
        textSha256: sha256(text),
        imagePath,
        imageSha256: imageBuffer ? sha256(imageBuffer) : null,
        expectsImage,
        assetResolution,
        evidenceDir
    };
}

function validateReadback(job: VkBrowserJob, bundle: Awaited<ReturnType<typeof resolveBundle>>, readback: VkBrowserReadback | null) {
    if (!readback) throw new Error('[VK_BROWSER_READBACK_UNCONFIRMED] Provider object was not confirmed');
    let publicUrl: URL;
    try {
        publicUrl = new URL(readback.public_url);
    } catch {
        throw new Error('[VK_BROWSER_READBACK_UNCONFIRMED] Provider permalink is invalid');
    }
    const match = /^\/wall(-\d+)_(\d+)$/.exec(publicUrl.pathname);
    const expectedOwnerId = String(job.target.community_id);
    const expectedObjectId = match ? `${match[1]}_${match[2]}` : '';
    const publishedAt = new Date(readback.published_at);
    if (publicUrl.protocol !== 'https:'
        || !['vk.com', 'www.vk.com', 'vk.ru', 'www.vk.ru'].includes(publicUrl.hostname.toLowerCase())
        || !match || match[1] !== expectedOwnerId
        || readback.provider_object_id !== expectedObjectId
        || !Number.isFinite(publishedAt.getTime())
        || normalizedVkText(readback.text) !== normalizedVkText(bundle.text)
        || (bundle.expectsImage && readback.image_present !== true)) {
        throw new Error('[VK_BROWSER_READBACK_UNCONFIRMED] Exact accepted provider object was not confirmed');
    }
    return { ...readback, public_url: publicUrl.toString(), published_at: publishedAt.toISOString() };
}

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
            text_sha256: bundle.textSha256,
            text_length: bundle.text.length,
            image_sha256: bundle.imageSha256,
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

export async function submitVkBrowserPublication(job: VkBrowserJob, dependencies: SubmitDependencies) {
    const authorization = assertSubmitAuthorization(job);
    const bundle = await resolveBundle(job, dependencies);
    if (!dependencies.ui.submitPost || !dependencies.ui.readbackPost) {
        throw new Error('[VK_BROWSER_SUBMIT_UI_REQUIRED] Submit and readback UI are required');
    }

    await dependencies.ui.navigate(bundle.communityUrl);
    if (await dependencies.ui.loginRequired()) {
        throw new Error('[VK_BROWSER_LOGIN_REQUIRED] Sign in to the dedicated VK browser profile and retry');
    }
    let started: Awaited<ReturnType<VkBrowserSubmissionControl['start']>> | null = null;
    try {
        await dependencies.ui.openWallComposer();
        await dependencies.ui.setPostText(bundle.text);
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
            image_sha256: bundle.imageSha256,
            selected_asset_id: job.approval.selected_asset_id || null
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
        if (bundle.imagePath) await dependencies.ui.attachImage(bundle.imagePath);
        const screenshotPath = path.join(bundle.evidenceDir, `${sha256(job.job_id).slice(0, 16)}-pre-submit.png`);
        await dependencies.ui.captureScreenshot(screenshotPath);
        const evidenceSha256 = sha256(fs.readFileSync(screenshotPath));
        await dependencies.ui.submitPost();
        const readback = validateReadback(job, bundle, await dependencies.ui.readbackPost());
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
            image_sha256: bundle.imageSha256,
            selected_asset_id: job.approval.selected_asset_id || null,
            content_revision: job.approval.content_revision,
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
    } catch (error: any) {
        if (!started || started.status !== 'started') throw error;
        await dependencies.control.markUncertain({
            project_id: job.project_id,
            task_id: job.task_id,
            work_item_id: authorization.work_item_id,
            lease_token: authorization.lease_token,
            attempt_id: started.attempt_id,
            reason_code: String(error?.message || error).match(/^\[[A-Z0-9_]+\]/)?.[0] || '[VK_BROWSER_SUBMIT_UNCERTAIN]',
            idempotency_key: authorization.attempt_idempotency_key
        });
        throw error;
    }
}
