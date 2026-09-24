/**
 * Shared types and error definitions for the publication engine.
 */

export type TelegramRouteTrace = {
    eligibility: {
        mtproto: boolean;
        bot_api_fallback: boolean;
        reason_code: 'project_session_missing' | 'session_connection_failed' | 'session_lookup_failed' | null;
        reason: string | null;
    };
    session_target: {
        configured: boolean;
        project_id: number;
        account_id: number | null;
        phone_hint: string | null;
    };
    target: {
        value: string | null;
        source: 'telegram_channel_id' | 'channel_handle' | 'bot_api_handle_resolution' | 'local_test_override' | 'missing';
        configured_channel_id: string | null;
        configured_handle: string | null;
        matched_channel_id: number | null;
    };
    asset_resolution: {
        has_asset: boolean;
        source: 'normalized_input' | 'none';
        kind: 'https_url' | 'http_url' | 'data_uri' | 'local_path' | 'none';
        resolved_url: string | null;
        server_resolvable: boolean;
        reason_code: 'asset_non_server_resolvable' | null;
    };
    fallback_reason: string | null;
    final_adapter: 'not_dispatched' | 'mtproto' | 'bot_api';
};

export class TelegramPublicationRouteError extends Error {
    constructor(message: string, public readonly routeTrace: TelegramRouteTrace) {
        super(message);
        this.name = 'TelegramPublicationRouteError';
    }
}

export interface AutomatedPublicationResult {
    adapter: string;
    publishedLink?: string | null;
    metrics?: Record<string, unknown>;
    routeTrace?: TelegramRouteTrace;
    warning?: string;
}

export interface DirectTelegramParams {
    projectId: number;
    channel: {
        id: number;
        type?: string;
        config?: unknown;
        [key: string]: unknown;
    };
    text: string;
    imageUrl?: string;
    requestHost?: string;
}

export interface VkStoryParams {
    projectId: number;
    taskId: number;
    channel: {
        id: number;
        type?: string;
        config?: Record<string, unknown>;
        [key: string]: unknown;
    };
    imageUrl: string;
    idempotencyKey?: string;
    poll?: unknown;
}

export interface TelegramTaskParams {
    projectId: number;
    taskId: number;
    channel: {
        id: number;
        type?: string;
        config?: Record<string, unknown>;
        [key: string]: unknown;
    };
    text: string;
    imageUrl?: string;
    requestHost?: string;
}

export interface OngoingRulePlan {
    projectId: number;
    meta: Record<string, unknown>;
    ongoing_rules: Array<Record<string, unknown>>;
    measurement: {
        snapshot_days?: number[];
        metrics?: Array<{
            id: string;
            source: string;
            url_ref?: string;
            [key: string]: unknown;
        }>;
        [key: string]: unknown;
    };
}

export interface PublicationPlanContext {
    meta: Record<string, unknown>;
    assets: Record<string, {
        target_url?: string;
        rotation_slot?: string;
        section_marker?: string;
        path?: string;
        links_to?: string;
        angle?: string;
        [key: string]: unknown;
    }>;
    accounts: Record<string, unknown>;
    measurement: Record<string, unknown>;
    ongoing_rules: Array<Record<string, unknown>>;
}

export interface TaskWithAssets {
    id: number;
    project_id: number;
    channel_id?: number | null;
    status: string;
    type?: string | null;
    layer?: string | null;
    title?: string | null;
    brief?: string | null;
    schedule_at?: Date | null;
    updated_at: Date;
    published_link?: string | null;
    assets?: Record<string, unknown> | null;
    quality_report?: Record<string, unknown> | null;
    metrics?: Record<string, unknown> | null;
    channel?: {
        id: number;
        type: string;
        name: string;
        config?: Record<string, unknown> | null;
    } | null;
}

