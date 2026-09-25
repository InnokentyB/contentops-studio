import {
    PublicationPlan,
    PublicationPlanImportMode,
    AssetSnapshot,
    ContentFileSnapshot,
    RUNTIME_LOCKED_TASK_STATUSES,
    slugify,
    resolveSection,
    resolveRef,
    dedupeResourceFiles,
    inferContentType,
    inferContentTypeFromUrl,
    checksumContent,
    computeSchedule,
    resolveImportedWeekTheme,
    normalizeCycleDate,
    derivePublicationOutcome,
    getImportedTaskId,
    isExternalPublicationPlanItem,
    shouldPreserveRuntimeTask,
    shouldFreezeImportedTaskContent,
    mergePlanAsset,
    mergePlanAction,
    mergeImportedItemData,
    contentFileSnapshotKey,
    resolveAssetRefFromUrlRef,
    getPublicationPlanFormat,
    getPublicationPlanTemplate,
    parsePlan,
    loadPlanFromPath,
    normalizePublicationPlan,
    resolveContentFileDescriptor,
    collectReferencedRelativePaths,
    discoverWorkspaceRoots,
    derivePlanPathRoots,
    resolveImportPipelineRoot,
    readAssetContent,
    buildContentFileSnapshots,
    preloadPlanUrlContents,
    buildAssetSnapshots,
    resolveAssetRuntime,
    loadAssetSnapshots,
    loadContentFileSnapshots,
    saveAssetSnapshots,
    refreshAssetSnapshots,
    resolveAcceptedPublicationBody,
    resolveApprovedSelectedAsset,
    buildHandoffBundle,
    buildGeneratedContentItemHandoff,
    loadStoredPlan,
    mergePlansForDelta,
    importPlan
} from './publication_plan';

export {
    PublicationPlan,
    PublicationPlanImportMode,
    AssetSnapshot,
    ContentFileSnapshot,
    RUNTIME_LOCKED_TASK_STATUSES,
    slugify,
    resolveSection,
    resolveRef,
    dedupeResourceFiles,
    inferContentType,
    inferContentTypeFromUrl,
    checksumContent,
    computeSchedule,
    resolveImportedWeekTheme,
    normalizeCycleDate,
    derivePublicationOutcome,
    getImportedTaskId,
    isExternalPublicationPlanItem,
    shouldPreserveRuntimeTask,
    shouldFreezeImportedTaskContent,
    mergePlanAsset,
    mergePlanAction,
    mergeImportedItemData,
    contentFileSnapshotKey
};

/**
 * Facade service for publication plan management, importing, and handoff bundles.
 */
class PublicationPlanService {
    private async loadStoredPlan(projectId: number): Promise<PublicationPlan | null> {
        return loadStoredPlan(projectId);
    }

    private mergePlansForDelta(existingPlan: PublicationPlan, incomingPlan: PublicationPlan): PublicationPlan {
        return mergePlansForDelta(existingPlan, incomingPlan);
    }

    private resolveAssetRefFromUrlRef(plan: PublicationPlan, urlRef?: string | null): string | null {
        return resolveAssetRefFromUrlRef(plan, urlRef);
    }

    private resolveContentFileDescriptor(
        plan: PublicationPlan,
        file: { url_ref?: string | null; path?: string | null; url?: string | null } | null | undefined
    ) {
        return resolveContentFileDescriptor(plan, file);
    }

    getPublicationPlanFormat() {
        return getPublicationPlanFormat();
    }

    getPublicationPlanTemplate(input: {
        planId?: string;
        projectName?: string;
        owner?: string;
        timezone?: string;
        channelRef?: string;
        channelPlatform?: string;
    } = {}) {
        return getPublicationPlanTemplate(input);
    }

    normalizePublicationPlan(raw: string) {
        return normalizePublicationPlan(raw);
    }

    parsePlan(raw: string): PublicationPlan {
        return parsePlan(raw);
    }

    private collectReferencedRelativePaths(plan: PublicationPlan) {
        return collectReferencedRelativePaths(plan);
    }

    private discoverWorkspaceRoots() {
        return discoverWorkspaceRoots();
    }

    private derivePlanPathRoots(planPath?: string) {
        return derivePlanPathRoots(planPath);
    }

    private resolveImportPipelineRoot(plan: PublicationPlan, workspaceRoots: string[] = [], planPath?: string) {
        return resolveImportPipelineRoot(plan, workspaceRoots, planPath);
    }

    loadPlanFromPath(planPath: string): PublicationPlan {
        return loadPlanFromPath(planPath);
    }

    private buildContentFileSnapshots(
        plan: PublicationPlan,
        existingSnapshots: Record<string, ContentFileSnapshot> = {},
        targetActions?: Array<Record<string, unknown>>
    ) {
        return buildContentFileSnapshots(plan, existingSnapshots, targetActions);
    }

    private async preloadPlanUrlContents(plan: PublicationPlan): Promise<void> {
        return preloadPlanUrlContents(plan);
    }

    async importPlan(params: {
        rawPlan?: string;
        planPath?: string;
        userId: number;
        workspaceRoots?: string[];
        importMode?: PublicationPlanImportMode;
    }) {
        return importPlan(params);
    }

    private readAssetContent(
        plan: PublicationPlan,
        asset: { section_marker?: string | null },
        relativePath: string
    ) {
        return readAssetContent(plan, asset, relativePath);
    }

    buildAssetSnapshots(
        plan: PublicationPlan,
        existingSnapshots: Record<string, AssetSnapshot> = {},
        overrides: Record<string, Partial<AssetSnapshot> & { content?: string | null; url?: string | null }> = {},
        targetAssetRefs?: string[]
    ) {
        return buildAssetSnapshots(plan, existingSnapshots, overrides, targetAssetRefs);
    }

    resolveAssetRuntime(plan: PublicationPlan, assetRef: string, maxChars?: number) {
        return resolveAssetRuntime(plan, assetRef, maxChars);
    }

    async loadAssetSnapshots(projectId: number) {
        return loadAssetSnapshots(projectId);
    }

    async loadContentFileSnapshots(projectId: number) {
        return loadContentFileSnapshots(projectId);
    }

    async saveAssetSnapshots(projectId: number, snapshots: Record<string, AssetSnapshot>) {
        return saveAssetSnapshots(projectId, snapshots);
    }

    async refreshAssetSnapshots(
        projectId: number,
        plan: PublicationPlan,
        overrides: Record<string, Partial<AssetSnapshot> & { content?: string | null; url?: string | null }> = {}
    ) {
        return refreshAssetSnapshots(projectId, plan, overrides);
    }

    private resolveAcceptedPublicationBody(
        item: Record<string, unknown> | null | undefined,
        required = false
    ) {
        return resolveAcceptedPublicationBody(item, required);
    }

    buildHandoffBundle(
        plan: PublicationPlan,
        item: Record<string, unknown>,
        options: { requireAcceptedContent?: boolean } = {}
    ) {
        return buildHandoffBundle(plan, item, options);
    }

    buildGeneratedContentItemHandoff(
        item: Record<string, unknown>,
        options: { requireAcceptedContent?: boolean } = {}
    ) {
        return buildGeneratedContentItemHandoff(item, options);
    }

    private resolveApprovedSelectedAsset(item: Record<string, unknown> | null | undefined) {
        return resolveApprovedSelectedAsset(item);
    }
}

export default new PublicationPlanService();
