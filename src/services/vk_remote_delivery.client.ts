import { createHash, randomUUID } from 'node:crypto';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

export interface VkRemoteDeliveryConfig {
    endpoint: string;
    bearerToken: string;
    installationId: string;
    projectId: number;
    accountId: string;
}

export interface VkRemoteDeliveryParams {
    projectId: number;
    taskId: number;
    channel: { id?: number; config?: Record<string, unknown> };
    text: string;
    imageUrl?: string;
    videoUrl?: string;
    placement?: 'feed' | 'clip';
    idempotencyKey: string;
    revision?: number;
    attemptId?: number;
}

export interface VkRemoteDeliveryResult {
    adapter: 'vk';
    deliveryMethod: 'vk_remote_adapter';
    publishedLink: string;
    metrics: {
        vk_owner_id: string;
        vk_post_id: string;
        vk_object_id: string;
        vk_installation_id: string;
        vk_published_at: string;
    };
}

type FetchLike = typeof fetch;

const TOKEN_RE = /^[a-zA-Z0-9._:-]{1,160}$/;
const VK_COMMUNITY_ID_RE = /^-[1-9]\d{0,18}$/;
const VK_OBJECT_ID_RE = /^(?:clip)?(-\d+)_(\d+)$/;

function isSafeHttpsEndpoint(raw: string): boolean {
    try {
        const u = new URL(raw);
        return u.protocol === 'https:' && !u.username && !u.password && u.pathname.length > 0;
    } catch {
        return false;
    }
}

export function extractNormalizedVkAccountId(config: Record<string, unknown> | null | undefined): string | null {
    if (!config || typeof config !== 'object') return null;
    const topLevel = resolveEffectiveChannelConfig('vk', config);
    const raw = topLevel.raw_account && typeof topLevel.raw_account === 'object'
        ? (topLevel.raw_account as Record<string, unknown>)
        : {};
    const candidate = raw.vk_id ?? topLevel.vk_id ?? null;
    if (candidate === null || candidate === undefined) return null;
    const text = String(candidate).trim();
    return VK_COMMUNITY_ID_RE.test(text) ? text : null;
}

export function resolveVkRemoteDeliveryConfig(
    env: Record<string, string | undefined> = process.env
): VkRemoteDeliveryConfig | null {
    const endpoint = env.VK_DELIVERY_ENDPOINT?.trim() || '';
    const bearerToken = env.VK_DELIVERY_BEARER_TOKEN?.trim() || '';
    const installationId = env.VK_DELIVERY_INSTALLATION_ID?.trim() || '';
    const rawProjectId = env.VK_DELIVERY_PROJECT_ID?.trim() || '10';
    const accountId = env.VK_DELIVERY_ACCOUNT_ID?.trim() || '-240051152';

    if (!endpoint || !bearerToken || !installationId) return null;
    if (!isSafeHttpsEndpoint(endpoint)) return null;
    if (!TOKEN_RE.test(installationId)) return null;
    const projectId = Number(rawProjectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return null;
    if (!VK_COMMUNITY_ID_RE.test(accountId)) return null;

    return { endpoint, bearerToken, installationId, projectId, accountId };
}

export function isVkRemoteDeliveryReady(
    projectId: number,
    channelConfig: Record<string, unknown> | null | undefined,
    env: Record<string, string | undefined> = process.env
): boolean {
    const cfg = resolveVkRemoteDeliveryConfig(env);
    if (!cfg) return false;
    if (cfg.projectId !== projectId) return false;
    const accountId = extractNormalizedVkAccountId(channelConfig);
    return accountId === cfg.accountId;
}

function canonicalPayloadJson(payload: Record<string, string>): string {
    const ordered: Record<string, string> = {};
    for (const k of Object.keys(payload).sort()) {
        ordered[k] = payload[k];
    }
    return JSON.stringify(ordered);
}

function positiveIntOrFallback(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export async function deliverVkViaRemoteAdapter(
    params: VkRemoteDeliveryParams,
    options?: {
        env?: Record<string, string | undefined>;
        fetchImpl?: FetchLike;
        nowMs?: () => number;
    }
): Promise<VkRemoteDeliveryResult> {
    const env = options?.env ?? process.env;
    const config = resolveVkRemoteDeliveryConfig(env);
    if (!config) {
        throw new Error('[VK_REMOTE_DELIVERY_NOT_CONFIGURED] Independent remote VK adapter is not configured');
    }

    const accountId = extractNormalizedVkAccountId(params.channel?.config);
    if (params.projectId !== config.projectId || accountId !== config.accountId) {
        throw new Error('[VK_REMOTE_DELIVERY_SCOPE_MISMATCH] Channel scope does not match pinned remote VK installation');
    }

    const placement = params.placement === 'clip' ? 'clip' : 'feed';
    const text = typeof params.text === 'string' ? params.text.trim() : '';
    const imageUrl = typeof params.imageUrl === 'string' && params.imageUrl.trim() ? params.imageUrl.trim() : undefined;
    const videoUrl = typeof params.videoUrl === 'string' && params.videoUrl.trim() ? params.videoUrl.trim() : undefined;

    const payload: Record<string, string> = {};
    if (placement === 'clip') {
        if (!videoUrl || !isSafeHttpsEndpoint(videoUrl)) {
            throw new Error('[VK_CLIP_VIDEO_REQUIRED] VK clip publication requires a valid HTTPS videoUrl');
        }
        if (text.length > 4000) {
            throw new Error('[VK_TEXT_REQUIRED] VK clip caption must be within 4000 characters');
        }
        payload.placement = 'clip';
        payload.videoUrl = videoUrl;
        if (text) payload.text = text;
    } else {
        if (!text || text.length > 16000) {
            throw new Error('[VK_TEXT_REQUIRED] VK publication text must be non-empty and within 16000 characters');
        }
        payload.text = text;
        if (imageUrl) payload.imageUrl = imageUrl;
    }
    const packageDigest = createHash('sha256').update(canonicalPayloadJson(payload), 'utf8').digest('hex');

    const nowMs = options?.nowMs ? options.nowMs() : Date.now();
    const taskId = positiveIntOrFallback(params.taskId, 1);
    const attemptId = positiveIntOrFallback(params.attemptId, taskId);
    const revision = positiveIntOrFallback(params.revision, 1);
    const requestId = `planner-${params.projectId}-${taskId}-${nowMs}`.slice(0, 160);
    const key = String(params.idempotencyKey || requestId).trim().slice(0, 200);

    const packet = {
        protocol: 'planner-delivery/1' as const,
        requestId,
        operation: 'deliver' as const,
        binding: {
            projectId: config.projectId,
            provider: 'vk' as const,
            accountId: config.accountId,
            installationId: config.installationId,
            taskId,
            attemptId,
            jobId: randomUUID(),
            workItemId: null,
            generation: 1,
            revision,
            packageDigest,
            manifest: `vk-planner-task-${taskId}`,
            key,
        },
        issuedAt: new Date(nowMs - 2000).toISOString(),
        expiresAt: new Date(nowMs + 175000).toISOString(),
        payload,
    };

    const fetchImpl = options?.fetchImpl ?? fetch;
    let response: Response;
    try {
        response = await fetchImpl(config.endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${config.bearerToken}`,
            },
            body: JSON.stringify(packet),
            signal: AbortSignal.timeout(185_000),
        });
    } catch (error: unknown) {
        const reason = error instanceof Error ? error.name : 'network_error';
        throw new Error(`[VK_REMOTE_DELIVERY_TRANSPORT_FAILED] Remote VK adapter unreachable (${reason})`);
    }

    let body: Record<string, unknown> | null = null;
    try {
        body = (await response.json()) as Record<string, unknown>;
    } catch {
        body = null;
    }

    if (response.status === 401 || response.status === 403) {
        throw new Error(`[VK_REMOTE_DELIVERY_UNAUTHORIZED] Remote VK adapter rejected credentials (HTTP ${response.status})`);
    }
    if (response.status === 409) {
        const code = typeof body?.code === 'string' ? body.code : 'blocked';
        throw new Error(`[VK_REMOTE_DELIVERY_BLOCKED] Remote VK adapter blocked delivery (${code})`);
    }
    if (!response.ok || body?.state !== 'custody_acknowledged') {
        const state = typeof body?.state === 'string' ? body.state : `http_${response.status}`;
        const code = typeof body?.code === 'string' ? `:${body.code}` : '';
        throw new Error(`[VK_REMOTE_DELIVERY_FAILED] Remote VK adapter did not acknowledge custody (${state}${code})`);
    }

    const receipt = body.receipt && typeof body.receipt === 'object'
        ? (body.receipt as Record<string, unknown>)
        : null;
    const objectId = typeof receipt?.objectId === 'string' ? receipt.objectId : '';
    const publicUrl = typeof receipt?.publicUrl === 'string' ? receipt.publicUrl : '';
    const publishedAt = typeof receipt?.publishedAt === 'string' ? receipt.publishedAt : new Date(nowMs).toISOString();
    const match = VK_OBJECT_ID_RE.exec(objectId);
    const expectedUrl = placement === 'clip'
        ? `https://vk.com/${objectId}`
        : `https://vk.com/wall${objectId}`;
    const validKind = placement === 'clip' ? objectId.startsWith('clip-') : !objectId.startsWith('clip');
    if (!match || !validKind || publicUrl !== expectedUrl || match[1] !== config.accountId) {
        throw new Error('[VK_REMOTE_DELIVERY_RECEIPT_INVALID] Remote VK adapter returned invalid publication receipt');
    }

    return {
        adapter: 'vk',
        deliveryMethod: 'vk_remote_adapter',
        publishedLink: publicUrl,
        metrics: {
            vk_owner_id: match[1],
            vk_post_id: match[2],
            vk_object_id: objectId,
            vk_installation_id: config.installationId,
            vk_published_at: publishedAt,
        },
    };
}
