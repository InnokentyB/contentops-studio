import { createHash } from 'crypto';
import { PublicationPlan, RUNTIME_LOCKED_TASK_STATUSES } from './types';

/**
 * Converts a string to a URL-friendly lowercase slug.
 */
export function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

/**
 * Extracts a marked section from markdown content up to the delimiter '---'.
 */
export function resolveSection(content: string, marker: string): string {
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => line.trim() === marker.trim());
    if (startIndex === -1) {
        return '';
    }

    const result: string[] = [];
    for (let i = startIndex + 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '---') {
            break;
        }
        result.push(lines[i]);
    }

    return result
        .join('\n')
        .replace(/\*\*Content Note\*\*[\s\S]*?(?=\n#|\n---|$)/g, '')
        .trim();
}

/**
 * Resolves a dotted reference path against a publication plan.
 */
export function resolveRef(plan: PublicationPlan, ref?: string | null): unknown {
    if (!ref) return null;

    const resolveParts = (parts: string[]): unknown => {
        let current: unknown = plan;
        for (const part of parts) {
            if (current == null || typeof current !== 'object') return null;
            current = (current as Record<string, unknown>)[part];
        }
        return current ?? null;
    };

    const parts = ref.split('.');
    const direct = resolveParts(parts);
    if (direct != null) {
        return direct;
    }

    const root = parts[0];
    if (plan.assets && root in plan.assets) {
        return resolveParts(['assets', ...parts]);
    }

    if (plan.accounts && root in plan.accounts) {
        return resolveParts(['accounts', ...parts]);
    }

    if (plan.meta && root in plan.meta) {
        return resolveParts(['meta', ...parts]);
    }

    return null;
}

/**
 * Deduplicates resource file entries by composite key (path, url, section marker).
 */
export function dedupeResourceFiles<T extends { relative_path?: string | null; url?: string | null; section_marker?: string | null }>(entries: T[]): T[] {
    const seen = new Set<string>();
    return entries.filter((entry) => {
        const key = [
            entry.relative_path || '',
            entry.url || '',
            entry.section_marker || ''
        ].join('|');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * Infers MIME content type from a relative file path.
 */
export function inferContentType(relativePath?: string | null): string {
    if (!relativePath) return 'text/plain';
    const normalized = relativePath.toLowerCase();
    if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'text/markdown';
    if (normalized.endsWith('.html') || normalized.endsWith('.htm')) return 'text/html';
    if (normalized.endsWith('.json')) return 'application/json';
    if (normalized.endsWith('.yaml') || normalized.endsWith('.yml')) return 'application/yaml';
    if (normalized.endsWith('.png')) return 'image/png';
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
    if (normalized.endsWith('.gif')) return 'image/gif';
    if (normalized.endsWith('.webp')) return 'image/webp';
    if (normalized.endsWith('.svg')) return 'image/svg+xml';
    if (normalized.endsWith('.pdf')) return 'application/pdf';
    return 'text/plain';
}

/**
 * Infers MIME content type from a URL filename extension.
 */
export function inferContentTypeFromUrl(url?: string | null): string | null {
    if (!url) return null;
    const lower = url.toLowerCase();
    if (/\.(png)(\?|$)/.test(lower)) return 'image/png';
    if (/\.(jpg|jpeg)(\?|$)/.test(lower)) return 'image/jpeg';
    if (/\.(gif)(\?|$)/.test(lower)) return 'image/gif';
    if (/\.(webp)(\?|$)/.test(lower)) return 'image/webp';
    if (/\.(svg)(\?|$)/.test(lower)) return 'image/svg+xml';
    if (/\.(html|htm)(\?|$)/.test(lower)) return 'text/html';
    if (/\.(md|markdown)(\?|$)/.test(lower)) return 'text/markdown';
    if (/\.(pdf)(\?|$)/.test(lower)) return 'application/pdf';
    return null;
}

/**
 * Calculates SHA-256 hex checksum of string content.
 */
export function checksumContent(content: string | null): string | null {
    if (typeof content !== 'string') return null;
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Computes scheduled timestamp and timezone for an action.
 */
export function computeSchedule(
    action: {
        scheduled_at?: string | null;
        scheduled_date?: string | null;
        scheduled_time_window?: { start?: string; timezone?: string } | null;
    },
    fallbackTimezone?: string
): { scheduled_at: Date; timezone: string } | null {
    if (action.scheduled_at) {
        const parsed = new Date(action.scheduled_at);
        if (!Number.isNaN(parsed.getTime())) {
            return {
                scheduled_at: parsed,
                timezone: fallbackTimezone || action.scheduled_time_window?.timezone || 'UTC'
            };
        }
    }

    if (!action.scheduled_date) return null;

    const start = action.scheduled_time_window?.start || '09:00';
    const timezone = action.scheduled_time_window?.timezone || fallbackTimezone || 'UTC';

    return {
        scheduled_at: new Date(`${action.scheduled_date}T${start}:00`),
        timezone
    };
}

/**
 * Resolves week theme from plan metadata with fallbacks.
 */
export function resolveImportedWeekTheme(plan: PublicationPlan): string {
    const candidate = plan.meta.week_theme
        || plan.meta.theme_hint
        || plan.meta.source_article_id
        || plan.meta.description
        || `Publication cycle ${plan.meta.plan_id}`;
    return String(candidate || '').trim() || `Publication cycle ${plan.meta.plan_id}`;
}

/**
 * Normalizes publication cycle date to UTC Date object.
 */
export function normalizeCycleDate(value: string | undefined, fallback: Date): Date {
    const candidate = value || fallback.toISOString().slice(0, 10);
    const match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) throw new Error(`Invalid publication cycle date: ${candidate}`);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * Derives negative publication outcome status string.
 */
export function derivePublicationOutcome(action: Record<string, unknown>): string | null {
    if (action?.status !== 'completed_with_negative_outcome') {
        return null;
    }

    const outcome = action.outcome as { result?: string } | undefined;
    const result = String(outcome?.result || '').toLowerCase();
    if (result.includes('ban') || result.includes('block')) return 'blocked';
    if (result.includes('remove')) return 'removed';
    if (result.includes('restrict')) return 'restricted';
    return 'blocked';
}

/**
 * Extracts imported task ID from content item metrics.
 */
export function getImportedTaskId(item: Record<string, unknown>): string | null {
    const metrics = item?.metrics as { task_id?: string } | undefined;
    const taskId = metrics?.task_id;
    return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null;
}

/**
 * Checks if an item is an external publication plan item.
 */
export function isExternalPublicationPlanItem(item: Record<string, unknown>): boolean {
    const assets = item?.assets as { source?: string } | undefined;
    return assets?.source === 'external_publication_plan' && Boolean(getImportedTaskId(item));
}

/**
 * Checks if a task status requires preserving runtime state.
 */
export function shouldPreserveRuntimeTask(item: Record<string, unknown>): boolean {
    return RUNTIME_LOCKED_TASK_STATUSES.has(String(item?.status || ''));
}

/**
 * Checks if imported task content should be frozen due to publication status.
 */
export function shouldFreezeImportedTaskContent(item: Record<string, unknown>): boolean {
    const status = String(item?.status || '');
    return status === 'published' || Boolean(item?.published_link);
}

/**
 * Merges incoming plan asset with existing plan asset.
 */
export function mergePlanAsset(
    existingAsset: Record<string, unknown> | null | undefined,
    incomingAsset: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
    if (!existingAsset) return incomingAsset;
    if (!incomingAsset) return existingAsset;

    const existingContent = typeof existingAsset?.content === 'string' ? existingAsset.content : null;
    const incomingContent = typeof incomingAsset?.content === 'string' ? incomingAsset.content : null;
    const preferredContent = existingContent && incomingContent
        ? (existingContent.length >= incomingContent.length ? existingContent : incomingContent)
        : (existingContent || incomingContent);

    return {
        ...existingAsset,
        ...incomingAsset,
        content: preferredContent ?? incomingAsset?.content ?? existingAsset?.content ?? null,
        path: incomingAsset?.path || existingAsset?.path || null,
        section_marker: incomingAsset?.section_marker || existingAsset?.section_marker || null
    };
}

/**
 * Merges incoming plan action with existing plan action.
 */
export function mergePlanAction(
    existingAction: Record<string, unknown> | null | undefined,
    incomingAction: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
    if (!existingAction) return incomingAction;
    if (!incomingAction) return existingAction;

    return {
        ...existingAction,
        ...incomingAction,
        notes: incomingAction?.notes || existingAction?.notes || null,
        human_review_reason: incomingAction?.human_review_reason || existingAction?.human_review_reason || null,
        asset_refs: Array.isArray(incomingAction?.asset_refs) && incomingAction.asset_refs.length > 0
            ? incomingAction.asset_refs
            : (existingAction?.asset_refs || []),
        content_files: Array.isArray(incomingAction?.content_files) && incomingAction.content_files.length > 0
            ? incomingAction.content_files
            : (existingAction?.content_files || []),
        verification: Array.isArray(incomingAction?.verification)
            ? incomingAction.verification
            : (existingAction?.verification || []),
        post_actions: Array.isArray(incomingAction?.post_actions)
            ? incomingAction.post_actions
            : (existingAction?.post_actions || []),
        dependencies: Array.isArray(incomingAction?.dependencies)
            ? incomingAction.dependencies
            : (existingAction?.dependencies || []),
        blocking_conditions: Array.isArray(incomingAction?.blocking_conditions)
            ? incomingAction.blocking_conditions
            : (existingAction?.blocking_conditions || [])
    };
}

/**
 * Merges incoming imported item data with existing DB record.
 */
export function mergeImportedItemData(
    existingItem: Record<string, unknown>,
    nextItemData: Record<string, unknown>,
    preserveRuntimeState: boolean
): Record<string, unknown> {
    const existingAssets = ((existingItem?.assets as Record<string, unknown>) || {}) as Record<string, unknown>;
    const nextAssets = ((nextItemData?.assets as Record<string, unknown>) || {}) as Record<string, unknown>;
    const existingQualityReport = ((existingItem?.quality_report as Record<string, unknown>) || {}) as Record<string, unknown>;
    const nextQualityReport = ((nextItemData?.quality_report as Record<string, unknown>) || {}) as Record<string, unknown>;
    const existingMetrics = ((existingItem?.metrics as Record<string, unknown>) || {}) as Record<string, unknown>;
    const nextMetrics = ((nextItemData?.metrics as Record<string, unknown>) || {}) as Record<string, unknown>;
    const freezeContent = shouldFreezeImportedTaskContent(existingItem);

    const mergedAssets = freezeContent
        ? {
            ...nextAssets,
            ...existingAssets,
            action: mergePlanAction(
                nextAssets.action as Record<string, unknown>,
                existingAssets.action as Record<string, unknown>
            ),
            resolved_assets: Array.isArray(existingAssets.resolved_assets) && existingAssets.resolved_assets.length > 0
                ? existingAssets.resolved_assets
                : nextAssets.resolved_assets
        }
        : {
            ...existingAssets,
            ...nextAssets
        };

    const mergedQualityReport = freezeContent
        ? {
            ...nextQualityReport,
            ...existingQualityReport
        }
        : {
            ...existingQualityReport,
            ...nextQualityReport
        };

    const mergedMetrics = freezeContent
        ? {
            ...nextMetrics,
            ...existingMetrics
        }
        : {
            ...existingMetrics,
            ...nextMetrics
        };

    return {
        ...nextItemData,
        status: preserveRuntimeState ? existingItem.status : nextItemData.status,
        channel_id: freezeContent ? (existingItem.channel_id ?? nextItemData.channel_id) : nextItemData.channel_id,
        type: freezeContent ? (existingItem.type || nextItemData.type) : nextItemData.type,
        layer: freezeContent ? (existingItem.layer || nextItemData.layer) : nextItemData.layer,
        title: freezeContent ? (existingItem.title || nextItemData.title) : nextItemData.title,
        brief: freezeContent ? (existingItem.brief || nextItemData.brief) : nextItemData.brief,
        key_points: freezeContent ? (existingItem.key_points || nextItemData.key_points) : nextItemData.key_points,
        cta: freezeContent ? (existingItem.cta || nextItemData.cta) : nextItemData.cta,
        schedule_at: freezeContent ? (existingItem.schedule_at || nextItemData.schedule_at) : nextItemData.schedule_at,
        published_link: preserveRuntimeState
            ? (existingItem.published_link || nextItemData.published_link)
            : (existingItem.published_link || nextItemData.published_link),
        assets: mergedAssets,
        quality_report: mergedQualityReport,
        metrics: mergedMetrics
    };
}

/**
 * Builds a cache key for content file snapshot.
 */
export function contentFileSnapshotKey(relativePath: string, sectionMarker?: string | null): string {
    return `${relativePath}::${sectionMarker || ''}`;
}
