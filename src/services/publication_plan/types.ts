/**
 * Types and interfaces for the publication plan domain.
 */

export interface PublicationPlanMeta {
    plan_id: string;
    plan_version?: string;
    generated_at?: string;
    source_article_id?: string;
    cycle_start?: string;
    cycle_end?: string;
    timezone_default?: string;
    owner?: string;
    pipeline_root?: string;
    week_theme?: string;
    theme_hint?: string;
    project_name?: string;
    description?: string;
}

export interface PublicationPlanAccount {
    platform?: string;
    type?: string;
    [key: string]: unknown;
}

export interface PublicationPlan {
    meta: PublicationPlanMeta;
    accounts: Record<string, PublicationPlanAccount>;
    assets: Record<string, Record<string, unknown>>;
    actions: Array<Record<string, unknown>>;
    ongoing_rules?: Array<Record<string, unknown>>;
    measurement?: Record<string, unknown>;
    dependencies_matrix_visualized?: Record<string, unknown>;
    asset_snapshots?: Record<string, AssetSnapshot>;
    content_file_snapshots?: Record<string, ContentFileSnapshot>;
    content_dictionary?: unknown;
    content_policy_matrix?: unknown;
    atoma_files?: unknown;
    atoma_files_description?: unknown;
    _fetched_url_contents?: Record<string, string>;
}

export type PublicationPlanImportMode = 'delta_safe' | 'full_sync';

export interface AssetSnapshot {
    ref: string;
    relative_path: string | null;
    file_name: string | null;
    section_marker: string | null;
    content: string | null;
    url?: string | null;
    content_type: string | null;
    content_length: number;
    checksum: string | null;
    source: 'filesystem' | 'inline' | 'mcp' | 'preserved';
    source_available: boolean;
    captured_at: string;
}

export interface ContentFileSnapshot {
    key: string;
    relative_path: string;
    file_name: string | null;
    section_marker: string | null;
    content: string | null;
    content_type: string | null;
    content_length: number;
    checksum: string | null;
    source: 'filesystem' | 'preserved';
    source_available: boolean;
    captured_at: string;
}

export const RUNTIME_LOCKED_TASK_STATUSES = new Set([
    'drafted',
    'revised',
    'approved',
    'scheduled',
    'ready_for_execution',
    'browser_required',
    'awaiting_manual_publication',
    'published'
]);
