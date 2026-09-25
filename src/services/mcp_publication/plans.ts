import path from 'path';
import prisma from '../../db';
import publicationPlanService from '../publication_plan.service';
import { requireUser } from './projects';

/**
 * Load publication plan context stored in project settings.
 */
export async function loadPublicationPlanContext(projectId: number) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: {
                in: [
                    'publication_plan_meta',
                    'publication_plan_assets',
                    'publication_plan_accounts',
                    'publication_plan_asset_snapshots',
                    'publication_plan_content_file_snapshots'
                ]
            }
        }
    });

    const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
    const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
    const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;
    const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
    const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;

    if (!meta || !assets || !accounts) {
        return null;
    }

    return {
        meta: JSON.parse(meta) as Record<string, unknown>,
        assets: JSON.parse(assets) as Record<string, unknown>,
        accounts: JSON.parse(accounts) as Record<string, unknown>,
        asset_snapshots: (assetSnapshots ? JSON.parse(assetSnapshots) : {}) as Record<string, unknown>,
        content_file_snapshots: (contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {}) as Record<string, unknown>,
        actions: [] as unknown[]
    };
}

/**
 * Resolve reference within publication plan.
 */
export function resolvePlanRef(plan: Record<string, unknown>, ref?: string | null): unknown {
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
    const assets = plan.assets as Record<string, unknown> | undefined;
    if (assets && root in assets) {
        return resolveParts(['assets', ...parts]);
    }

    const accounts = plan.accounts as Record<string, unknown> | undefined;
    if (accounts && root in accounts) {
        return resolveParts(['accounts', ...parts]);
    }

    const meta = plan.meta as Record<string, unknown> | undefined;
    if (meta && root in meta) {
        return resolveParts(['meta', ...parts]);
    }

    return null;
}

/**
 * Resolve plan relative path ensuring it stays within pipeline root.
 */
export function resolvePlanPath(pipelineRoot: string, relativePath: string): string {
    if (!pipelineRoot) {
        throw new Error('Imported publication plan does not define meta.pipeline_root');
    }

    const normalizedRoot = path.resolve(pipelineRoot);
    const resolvedPath = path.resolve(normalizedRoot, relativePath);
    const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;

    if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(rootWithSep)) {
        throw new Error(`Refusing to read path outside pipeline_root: ${relativePath}`);
    }

    return resolvedPath;
}

/**
 * Get schema format for publication plan.
 */
export function getPublicationPlanFormat() {
    return publicationPlanService.getPublicationPlanFormat();
}

/**
 * Get publication plan template.
 */
export function getPublicationPlanTemplate(input: {
    planId?: string;
    projectName?: string;
    owner?: string;
    timezone?: string;
    channelRef?: string;
    channelPlatform?: string;
} = {}) {
    return publicationPlanService.getPublicationPlanTemplate(input);
}

/**
 * Normalize and validate publication plan JSON.
 */
export function normalizePublicationPlan(planJson: string) {
    return publicationPlanService.normalizePublicationPlan(planJson);
}

/**
 * Import publication plan from JSON string.
 */
export async function importPublicationPlanJson(
    planJson: string,
    userId: number,
    workspaceRoots?: string[],
    importMode: 'delta_safe' | 'full_sync' = 'delta_safe'
) {
    const user = await requireUser(userId);

    const result = await publicationPlanService.importPlan({
        rawPlan: planJson,
        userId,
        workspaceRoots,
        importMode
    });

    return {
        imported_by: user,
        project: {
            id: result.project.id,
            name: result.project.name,
            slug: result.project.slug,
            description: result.project.description
        },
        week_package: result.week_package ? { id: result.week_package.id } : undefined,
        imported: result.imported
    };
}

/**
 * Import publication plan from file on disk.
 */
export async function importPublicationPlanFile(
    planPath: string,
    userId: number,
    workspaceRoots?: string[],
    importMode: 'delta_safe' | 'full_sync' = 'delta_safe'
) {
    const user = await requireUser(userId);
    const resolvedPlanPath = path.resolve(planPath);

    const result = await publicationPlanService.importPlan({
        planPath: resolvedPlanPath,
        userId,
        workspaceRoots,
        importMode
    });

    return {
        imported_by: user,
        source: {
            plan_path: resolvedPlanPath
        },
        project: {
            id: result.project.id,
            name: result.project.name,
            slug: result.project.slug,
            description: result.project.description
        },
        week_package: result.week_package ? { id: result.week_package.id } : undefined,
        imported: result.imported
    };
}

/**
 * List assets in imported publication plan.
 */
export async function listPublicationPlanAssets(projectId: number) {
    const plan = await loadPublicationPlanContext(projectId);
    if (!plan) {
        throw new Error(`No imported publication plan found for project ${projectId}`);
    }

    const pipelineRoot = path.resolve((plan.meta.pipeline_root as string) || '');
    return {
        project_id: projectId,
        plan_id: plan.meta.plan_id,
        pipeline_root: pipelineRoot,
        assets: Object.entries(plan.assets || {}).map(([ref, asset]) => {
            const assetObj = asset as Record<string, unknown> | null;
            const runtime = publicationPlanService.resolveAssetRuntime(plan as unknown as Parameters<typeof publicationPlanService.resolveAssetRuntime>[0], ref);

            return {
                ref,
                type: assetObj?.type || null,
                relative_path: runtime.relative_path || null,
                full_path: runtime.full_path || null,
                section_marker: assetObj?.section_marker || null,
                target_url: assetObj?.target_url || null,
                exists: runtime.exists === true,
                snapshot_available: runtime.snapshot_available === true,
                content_source: runtime.content_source || null
            };
        })
    };
}

/**
 * Read specific asset from publication plan.
 */
export async function readPublicationPlanAsset(projectId: number, assetRef: string, maxChars = 20000) {
    const plan = await loadPublicationPlanContext(projectId);
    if (!plan) {
        throw new Error(`No imported publication plan found for project ${projectId}`);
    }

    const asset = (plan.assets as Record<string, unknown>)?.[assetRef];
    if (!asset) {
        throw new Error(`Asset '${assetRef}' not found in imported publication plan`);
    }

    const runtime = publicationPlanService.resolveAssetRuntime(plan as unknown as Parameters<typeof publicationPlanService.resolveAssetRuntime>[0], assetRef, maxChars);

    return {
        project_id: projectId,
        plan_id: plan.meta.plan_id,
        asset_ref: assetRef,
        asset,
        relative_path: runtime.relative_path || null,
        full_path: runtime.full_path || null,
        exists: runtime.exists === true,
        section_marker: runtime.section_marker || null,
        truncated: runtime.truncated === true,
        snapshot_available: runtime.snapshot_available === true,
        content_source: runtime.content_source || null,
        url: runtime.url || null,
        content_type: runtime.content_type || null,
        content: runtime.content || null
    };
}

/**
 * Refresh snapshots for assets in publication plan.
 */
export async function refreshPublicationPlanAssetSnapshots(
    projectId: number,
    assetContents: Record<string, { content?: string; contentType?: string; url?: string }> = {}
) {
    const plan = await loadPublicationPlanContext(projectId);
    if (!plan) {
        throw new Error(`No imported publication plan found for project ${projectId}`);
    }

    const overrides = Object.fromEntries(
        Object.entries(assetContents).map(([ref, value]) => [
            ref,
            {
                content: typeof value.content === 'string' ? value.content : null,
                content_type: value.contentType || null,
                url: value.url || null
            }
        ])
    );

    const snapshots = await publicationPlanService.refreshAssetSnapshots(projectId, plan as unknown as Parameters<typeof publicationPlanService.refreshAssetSnapshots>[1], overrides);
    return {
        project_id: projectId,
        plan_id: plan.meta.plan_id,
        snapshots_count: Object.keys(snapshots).length,
        asset_refs: Object.keys(snapshots)
    };
}

/**
 * Read publication plan reference.
 */
export async function readPublicationPlanRef(projectId: number, ref: string, maxChars = 20000) {
    const plan = await loadPublicationPlanContext(projectId);
    if (!plan) {
        throw new Error(`No imported publication plan found for project ${projectId}`);
    }

    const resolved = resolvePlanRef(plan, ref);
    if (resolved == null) {
        throw new Error(`Reference '${ref}' could not be resolved`);
    }

    const assetRef = ref.split('.')[0];
    const asset = (plan.assets as Record<string, unknown>)?.[assetRef];

    if (asset && typeof resolved === 'object' && resolved !== null && 'path' in resolved) {
        const assetRead = await readPublicationPlanAsset(projectId, assetRef, maxChars);
        return {
            project_id: projectId,
            plan_id: plan.meta.plan_id,
            ref,
            resolved_type: 'asset',
            resolved_value: resolved,
            asset: assetRead
        };
    }

    return {
        project_id: projectId,
        plan_id: plan.meta.plan_id,
        ref,
        resolved_type: Array.isArray(resolved) ? 'array' : typeof resolved,
        resolved_value: resolved
    };
}
