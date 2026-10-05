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
        mode: 'prepare_only';
    };
}

export interface VkBrowserUi {
    navigate(url: string): Promise<void>;
    loginRequired(): Promise<boolean>;
    openWallComposer(): Promise<void>;
    setPostText(text: string): Promise<void>;
    attachImage(imagePath: string): Promise<void>;
    captureScreenshot(screenshotPath: string): Promise<void>;
}

interface PrepareDependencies {
    ui: VkBrowserUi;
    approvedAssetRoots: string[];
    evidenceDir: string;
    now?: () => Date;
    loadRemoteImage?: (url: string) => Promise<{ buffer: Buffer; filename: string }>;
}

function sha256(value: string | Buffer) {
    return createHash('sha256').update(value).digest('hex');
}

function validatedTarget(rawUrl: string) {
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

function assertJob(job: VkBrowserJob) {
    if (job?.schema_version !== 1
        || !Number.isSafeInteger(job.project_id) || job.project_id <= 0
        || !Number.isSafeInteger(job.task_id) || job.task_id <= 0
        || !Number.isSafeInteger(job.channel_id) || job.channel_id <= 0
        || !job.job_id?.trim() || !job.idempotency_key?.trim()) {
        throw new Error('[VK_BROWSER_JOB_INVALID] Job identity is incomplete');
    }
    if ((job.execution as any)?.mode !== 'prepare_only') {
        throw new Error('[VK_BROWSER_SUBMIT_DISABLED] The MVP may prepare a post but cannot submit it');
    }
    if (job.target?.placement !== 'wall_post') {
        throw new Error('[VK_BROWSER_PLACEMENT_UNSUPPORTED] The MVP supports VK wall posts only');
    }
    if (job.approval?.text_state !== 'accepted'
        || !Number.isSafeInteger(job.approval.content_revision)
        || job.approval.content_revision <= 0
        || job.approval.accepted_revision !== job.approval.content_revision) {
        throw new Error('[VK_BROWSER_APPROVAL_REQUIRED] Current text revision must be accepted');
    }
}

export async function prepareVkBrowserPublication(job: VkBrowserJob, dependencies: PrepareDependencies) {
    assertJob(job);
    const communityUrl = validatedTarget(job.target.community_url);
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

    await dependencies.ui.navigate(communityUrl);
    if (await dependencies.ui.loginRequired()) {
        throw new Error('[VK_BROWSER_LOGIN_REQUIRED] Sign in to the dedicated VK browser profile and retry');
    }
    await dependencies.ui.openWallComposer();
    await dependencies.ui.setPostText(text);
    if (imagePath) await dependencies.ui.attachImage(imagePath);

    const screenshotName = `${sha256(job.job_id).slice(0, 16)}-prepared.png`;
    const screenshotPath = path.join(evidenceDir, screenshotName);
    await dependencies.ui.captureScreenshot(screenshotPath);

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
            session_target: new URL(communityUrl).hostname,
            asset_resolution: assetResolution,
            fallback_reason: 'vk_api_credentials_unavailable',
            final_adapter: 'vk_browser_local'
        },
        payload: {
            text_sha256: sha256(text),
            text_length: text.length,
            image_sha256: imageBuffer ? sha256(imageBuffer) : null,
            selected_asset_id: job.approval.selected_asset_id || null,
            content_revision: job.approval.content_revision
        },
        evidence: {
            prepared_at: preparedAt,
            screenshot_path: screenshotPath,
            submitted: false
        }
    };
}
