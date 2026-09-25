import * as fs from 'fs';
import * as path from 'path';
import prisma from '../../db';
import { PublicationPlan, AssetSnapshot, ContentFileSnapshot } from './types';
import {
    resolveSection,
    resolveRef,
    contentFileSnapshotKey,
    inferContentType,
    inferContentTypeFromUrl,
    checksumContent
} from './utils';
import { resolveAssetRefFromUrlRef } from './templates';

export interface ContentFileDescriptor {
    relativePath: string | null;
    resolvedUrl: string | null;
    assetCandidate: Record<string, unknown> | null;
    resolvedAssetRef: string | null;
    directInlineContent: string | null;
}

export interface AssetRuntimeResolution {
    ref: string;
    asset?: Record<string, unknown>;
    missing?: boolean;
    full_path?: string | null;
    file_name?: string | null;
    relative_path?: string | null;
    section_marker?: string | null;
    exists?: boolean;
    url?: string | null;
    content?: string | null;
    truncated?: boolean;
    snapshot_available?: boolean;
    content_type?: string | null;
    content_source?: string | null;
    snapshot?: AssetSnapshot | null;
}

/**
 * Resolves content file descriptor for a given file entry in plan action.
 */
export function resolveContentFileDescriptor(
    plan: PublicationPlan,
    file: { url_ref?: string | null; path?: string | null; url?: string | null } | null | undefined
): ContentFileDescriptor {
    const resolvedRef = file?.url_ref ? resolveRef(plan, file.url_ref) : null;
    const resolvedAssetRef = resolveAssetRefFromUrlRef(plan, file?.url_ref);
    const resolvedAsset = typeof file?.url_ref === 'string' && plan.assets?.[file.url_ref]
        ? plan.assets[file.url_ref]
        : (resolvedAssetRef ? plan.assets?.[resolvedAssetRef] : null);
    const assetCandidate = resolvedAsset && typeof resolvedAsset === 'object'
        ? resolvedAsset
        : (resolvedRef && typeof resolvedRef === 'object' ? (resolvedRef as Record<string, unknown>) : null);
    const relativePath = typeof file?.path === 'string' && file.path.trim()
        ? file.path.trim()
        : (typeof assetCandidate?.path === 'string' && (assetCandidate.path as string).trim() ? (assetCandidate.path as string).trim() : null);
    const resolvedUrl = (assetCandidate?.target_url as string | undefined) || (typeof resolvedRef === 'string' ? resolvedRef : file?.url || null);
    const directInlineContent = typeof resolvedAsset?.content === 'string'
        ? (resolvedAsset.content as string)
        : (resolvedUrl ? (plan._fetched_url_contents?.[resolvedUrl] || null) : null);

    return {
        relativePath,
        resolvedUrl,
        assetCandidate,
        resolvedAssetRef,
        directInlineContent
    };
}

/**
 * Collects all referenced relative file paths across assets and actions in a plan.
 */
export function collectReferencedRelativePaths(plan: PublicationPlan): string[] {
    const paths = new Set<string>();

    for (const asset of Object.values(plan.assets || {})) {
        if (typeof asset?.path === 'string' && (asset.path as string).trim()) {
            paths.add((asset.path as string).trim());
        }
    }

    for (const action of plan.actions || []) {
        const contentFiles = Array.isArray(action.content_files) ? action.content_files : [];
        for (const file of contentFiles) {
            const descriptor = resolveContentFileDescriptor(plan, file as { url_ref?: string | null; path?: string | null; url?: string | null });
            if (descriptor.relativePath) {
                paths.add(descriptor.relativePath);
            }
        }
    }

    return [...paths];
}

/**
 * Discovers potential workspace root directories from cwd and parent folders.
 */
export function discoverWorkspaceRoots(): string[] {
    const roots = new Set<string>();
    roots.add(process.cwd());
    roots.add(path.dirname(process.cwd()));

    const parent = path.dirname(process.cwd());
    try {
        for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            roots.add(path.join(parent, entry.name));
        }
    } catch {
        // Ignore directory listing failures and fall back to known roots.
    }

    return [...roots];
}

/**
 * Derives potential root directories up to 4 levels above the plan path.
 */
export function derivePlanPathRoots(planPath?: string): string[] {
    if (!planPath) return [];

    const roots: string[] = [];
    let current = path.dirname(path.resolve(planPath));
    for (let depth = 0; depth < 4; depth += 1) {
        roots.push(current);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    return roots;
}

/**
 * Resolves the pipeline root directory that contains the highest number of referenced paths.
 */
export function resolveImportPipelineRoot(
    plan: PublicationPlan,
    workspaceRoots: string[] = [],
    planPath?: string
): string | null {
    const referencedPaths = collectReferencedRelativePaths(plan);
    if (referencedPaths.length === 0) {
        return plan.meta.pipeline_root || null;
    }

    const candidateRoots = [
        ...(plan.meta.pipeline_root ? [plan.meta.pipeline_root] : []),
        ...workspaceRoots,
        ...derivePlanPathRoots(planPath),
        ...discoverWorkspaceRoots()
    ]
        .map((entry) => path.resolve(entry))
        .filter((entry, index, list) => Boolean(entry) && list.indexOf(entry) === index);

    let bestRoot: string | null = null;
    let bestScore = -1;

    for (const candidate of candidateRoots) {
        let score = 0;
        for (const relativePath of referencedPaths) {
            if (fs.existsSync(path.resolve(candidate, relativePath))) {
                score += 1;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestRoot = candidate;
        }
    }

    if (bestScore > 0 && bestRoot) {
        return bestRoot;
    }

    return plan.meta.pipeline_root || null;
}

/**
 * Reads asset content from the filesystem at the resolved pipeline root path.
 */
export function readAssetContent(
    plan: PublicationPlan,
    asset: { section_marker?: string | null },
    relativePath: string
): { fullPath: string; content: string } | null {
    const pipelineRoot = plan.meta.pipeline_root || '';
    if (!pipelineRoot) {
        return null;
    }

    const fullPath = path.resolve(pipelineRoot, relativePath);
    const normalizedRoot = path.resolve(pipelineRoot);
    if (!fullPath.startsWith(normalizedRoot)) {
        return null;
    }

    if (!fs.existsSync(fullPath)) {
        return null;
    }

    const rawContent = fs.readFileSync(fullPath, 'utf8');
    const sectionContent = asset.section_marker ? resolveSection(rawContent, asset.section_marker) : rawContent;
    return {
        fullPath,
        content: sectionContent && sectionContent.trim() ? sectionContent : rawContent
    };
}

/**
 * Builds snapshots for content files referenced across actions.
 */
export function buildContentFileSnapshots(
    plan: PublicationPlan,
    existingSnapshots: Record<string, ContentFileSnapshot> = {},
    targetActions?: Array<Record<string, unknown>>
): Record<string, ContentFileSnapshot> {
    const snapshots: Record<string, ContentFileSnapshot> = {};

    for (const action of targetActions || plan.actions || []) {
        const contentFiles = Array.isArray(action.content_files) ? action.content_files : [];
        for (const file of contentFiles) {
            const descriptor = resolveContentFileDescriptor(
                plan,
                file as { url_ref?: string | null; path?: string | null; url?: string | null }
            );
            const relativePath = descriptor.relativePath || '';
            if (!relativePath) continue;

            const sectionMarker = (file as { section_marker?: string | null })?.section_marker || null;
            const snapshotKey = contentFileSnapshotKey(relativePath, sectionMarker);
            const syntheticAsset = {
                path: relativePath,
                section_marker: sectionMarker
            };
            const resolved = readAssetContent(plan, syntheticAsset, relativePath);

            if (resolved?.content) {
                snapshots[snapshotKey] = {
                    key: snapshotKey,
                    relative_path: relativePath,
                    file_name: path.basename(relativePath),
                    section_marker: sectionMarker,
                    content: resolved.content,
                    content_type: inferContentType(relativePath),
                    content_length: resolved.content.length,
                    checksum: checksumContent(resolved.content),
                    source: 'filesystem',
                    source_available: true,
                    captured_at: new Date().toISOString()
                };
                continue;
            }

            const previous = existingSnapshots[snapshotKey];
            if (previous?.content) {
                snapshots[snapshotKey] = {
                    ...previous,
                    key: snapshotKey,
                    relative_path: relativePath,
                    file_name: path.basename(relativePath),
                    section_marker: sectionMarker,
                    source: 'preserved',
                    source_available: false
                };
            }
        }
    }

    return snapshots;
}

/**
 * Pre-fetches HTTP URLs referenced in plan assets and action content_files.
 */
export async function preloadPlanUrlContents(plan: PublicationPlan): Promise<void> {
    const fetched: Record<string, string> = {};
    const urlsToFetch = new Set<string>();

    if (plan.assets) {
        for (const ref of Object.keys(plan.assets)) {
            const asset = plan.assets[ref];
            if (asset) {
                const assetUrl = typeof asset.url === 'string'
                    ? (asset.url as string)
                    : (typeof asset.target_url === 'string' ? (asset.target_url as string) : null);
                if (assetUrl && assetUrl.startsWith('http')) {
                    urlsToFetch.add(assetUrl);
                }
            }
        }
    }

    if (plan.actions) {
        for (const action of plan.actions) {
            const contentFiles = Array.isArray(action?.content_files) ? action.content_files : [];
            for (const file of contentFiles) {
                const f = file as { url?: string; url_ref?: string };
                const fileUrl = typeof f?.url === 'string' ? f.url : null;
                if (fileUrl && fileUrl.startsWith('http')) {
                    urlsToFetch.add(fileUrl);
                }
                if (f?.url_ref && typeof f.url_ref === 'string' && f.url_ref.startsWith('http')) {
                    urlsToFetch.add(f.url_ref);
                }
            }
        }
    }

    if (urlsToFetch.size === 0) {
        return;
    }

    console.log(`[Plan Preloader] Fetching ${urlsToFetch.size} remote URLs in plan...`);

    await Promise.all(
        Array.from(urlsToFetch).map(async (url) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const text = await response.text();
                    fetched[url] = text;
                    console.log(`[Plan Preloader] Successfully fetched ${url} (${text.length} bytes)`);
                } else {
                    console.warn(`[Plan Preloader] Failed to fetch ${url}: ${response.statusText}`);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[Plan Preloader] Error fetching ${url}:`, msg);
            }
        })
    );

    plan._fetched_url_contents = fetched;
}

/**
 * Builds asset snapshots from plan assets, overrides, and filesystem reads.
 */
export function buildAssetSnapshots(
    plan: PublicationPlan,
    existingSnapshots: Record<string, AssetSnapshot> = {},
    overrides: Record<string, Partial<AssetSnapshot> & { content?: string | null; url?: string | null }> = {},
    targetAssetRefs?: string[]
): Record<string, AssetSnapshot> {
    const snapshots: Record<string, AssetSnapshot> = {};
    const refsToProcess = Array.isArray(targetAssetRefs) && targetAssetRefs.length > 0
        ? targetAssetRefs
        : Object.keys(plan.assets || {});

    for (const ref of refsToProcess) {
        const asset = (plan.assets || {})[ref];
        if (!asset) continue;
        const relativePath = typeof asset.path === 'string' ? (asset.path as string) : null;
        const sectionMarker = (asset.section_marker as string | undefined) || null;
        const previous = existingSnapshots[ref];
        const override = overrides[ref];

        if (override && typeof override.content === 'string') {
            snapshots[ref] = {
                ref,
                relative_path: relativePath,
                file_name: relativePath ? path.basename(relativePath) : null,
                section_marker: sectionMarker,
                content: override.content,
                url: override.url || null,
                content_type: override.content_type || inferContentType(relativePath),
                content_length: override.content.length,
                checksum: checksumContent(override.content),
                source: 'mcp',
                source_available: true,
                captured_at: new Date().toISOString()
            };
            continue;
        }

        if (override && typeof override.url === 'string' && override.url.trim()) {
            snapshots[ref] = {
                ref,
                relative_path: relativePath,
                file_name: relativePath ? path.basename(relativePath) : ref,
                section_marker: sectionMarker,
                content: null,
                url: override.url.trim(),
                content_type: override.content_type || inferContentType(relativePath) || inferContentTypeFromUrl(override.url) || null,
                content_length: 0,
                checksum: null,
                source: 'mcp',
                source_available: true,
                captured_at: new Date().toISOString()
            };
            continue;
        }

        const assetUrl = typeof asset.url === 'string'
            ? (asset.url as string)
            : (typeof asset.target_url === 'string' ? (asset.target_url as string) : null);
        const inlineContent = typeof asset.content === 'string'
            ? (asset.content as string)
            : (assetUrl ? (plan._fetched_url_contents?.[assetUrl] || null) : null);

        if (inlineContent) {
            snapshots[ref] = {
                ref,
                relative_path: relativePath,
                file_name: relativePath ? path.basename(relativePath) : ref,
                section_marker: sectionMarker,
                content: inlineContent,
                url: assetUrl,
                content_type: inferContentType(relativePath),
                content_length: inlineContent.length,
                checksum: checksumContent(inlineContent),
                source: 'inline',
                source_available: true,
                captured_at: new Date().toISOString()
            };
            continue;
        }

        if (!relativePath && assetUrl) {
            snapshots[ref] = {
                ref,
                relative_path: null,
                file_name: ref,
                section_marker: sectionMarker,
                content: null,
                url: assetUrl,
                content_type: inferContentTypeFromUrl(assetUrl) || null,
                content_length: 0,
                checksum: null,
                source: 'inline',
                source_available: true,
                captured_at: new Date().toISOString()
            };
            continue;
        }

        if (!relativePath) {
            continue;
        }

        const resolved = readAssetContent(plan, asset as { section_marker?: string | null }, relativePath);
        if (resolved) {
            snapshots[ref] = {
                ref,
                relative_path: relativePath,
                file_name: path.basename(relativePath),
                section_marker: sectionMarker,
                content: resolved.content,
                url: assetUrl,
                content_type: inferContentType(relativePath),
                content_length: resolved.content.length,
                checksum: checksumContent(resolved.content),
                source: 'filesystem',
                source_available: true,
                captured_at: new Date().toISOString()
            };
            continue;
        }

        if (previous?.content || previous?.url) {
            snapshots[ref] = {
                ...previous,
                ref,
                relative_path: relativePath,
                file_name: path.basename(relativePath),
                section_marker: sectionMarker,
                source: previous.source === 'mcp' ? 'mcp' : 'preserved',
                source_available: false
            };
        }
    }

    return snapshots;
}

/**
 * Resolves runtime view of an asset by reference.
 */
export function resolveAssetRuntime(
    plan: PublicationPlan,
    assetRef: string,
    maxChars?: number
): AssetRuntimeResolution {
    const asset = plan.assets?.[assetRef];
    if (!asset) {
        return {
            ref: assetRef,
            missing: true
        };
    }

    const relativePath = typeof asset.path === 'string' ? (asset.path as string) : null;
    const snapshot = plan.asset_snapshots?.[assetRef] || null;
    const runtimeRead = relativePath ? readAssetContent(plan, asset as { section_marker?: string | null }, relativePath) : null;
    const inlineContent = typeof asset.content === 'string' ? (asset.content as string) : null;
    const snapshotContent = typeof snapshot?.content === 'string' ? snapshot.content : null;
    const assetUrl = typeof asset.url === 'string'
        ? (asset.url as string)
        : (typeof asset.target_url === 'string' ? (asset.target_url as string) : null);
    const previewUrl = assetUrl || snapshot?.url || null;
    const content = runtimeRead?.content ?? inlineContent ?? snapshotContent;
    const truncated = typeof maxChars === 'number' && typeof content === 'string' && content.length > maxChars;

    return {
        ref: assetRef,
        asset,
        full_path: runtimeRead?.fullPath || (relativePath && plan.meta.pipeline_root ? path.resolve(plan.meta.pipeline_root, relativePath) : null),
        file_name: relativePath ? path.basename(relativePath) : (inlineContent ? assetRef : null),
        relative_path: relativePath,
        section_marker: (asset.section_marker as string | undefined) || null,
        exists: Boolean(content || previewUrl),
        url: previewUrl,
        content: typeof content === 'string'
            ? (truncated ? `${content.slice(0, maxChars)}\n...[truncated]` : content)
            : null,
        truncated: Boolean(truncated),
        snapshot_available: Boolean(snapshotContent),
        content_type: snapshot?.content_type || inferContentType(relativePath) || inferContentTypeFromUrl(previewUrl),
        content_source: runtimeRead?.content ? 'filesystem' : (inlineContent ? 'inline' : (snapshotContent ? (snapshot?.source || 'snapshot') : (previewUrl ? 'url' : null))),
        snapshot
    };
}

/**
 * Loads persisted asset snapshots for a project from project settings.
 */
export async function loadAssetSnapshots(projectId: number): Promise<Record<string, AssetSnapshot>> {
    const snapshots = await prisma.projectSettings.findFirst({
        where: {
            project_id: projectId,
            key: 'publication_plan_asset_snapshots'
        }
    });

    if (!snapshots?.value) {
        return {};
    }

    try {
        return JSON.parse(snapshots.value);
    } catch {
        return {};
    }
}

/**
 * Loads persisted content file snapshots for a project from project settings.
 */
export async function loadContentFileSnapshots(projectId: number): Promise<Record<string, ContentFileSnapshot>> {
    const snapshots = await prisma.projectSettings.findFirst({
        where: {
            project_id: projectId,
            key: 'publication_plan_content_file_snapshots'
        }
    });

    if (!snapshots?.value) {
        return {};
    }

    try {
        return JSON.parse(snapshots.value);
    } catch {
        return {};
    }
}

/**
 * Saves asset snapshots for a project into project settings.
 */
export async function saveAssetSnapshots(
    projectId: number,
    snapshots: Record<string, AssetSnapshot>
): Promise<Record<string, AssetSnapshot>> {
    await prisma.projectSettings.upsert({
        where: {
            project_id_key: {
                project_id: projectId,
                key: 'publication_plan_asset_snapshots'
            }
        },
        update: {
            value: JSON.stringify(snapshots)
        },
        create: {
            project_id: projectId,
            key: 'publication_plan_asset_snapshots',
            value: JSON.stringify(snapshots)
        }
    });

    return snapshots;
}

/**
 * Refreshes and saves asset snapshots for a project.
 */
export async function refreshAssetSnapshots(
    projectId: number,
    plan: PublicationPlan,
    overrides: Record<string, Partial<AssetSnapshot> & { content?: string | null; url?: string | null }> = {}
): Promise<Record<string, AssetSnapshot>> {
    const existing = await loadAssetSnapshots(projectId);
    const snapshots = buildAssetSnapshots(plan, existing, overrides);
    await saveAssetSnapshots(projectId, snapshots);
    return snapshots;
}
