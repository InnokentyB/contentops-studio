import type { OwnedPublicationRequest } from './owned_publication_contract';
import { requirePublicationPrincipal, currentPublicationPrincipal } from '../mcp/publication-principal';
import { isDzenPublicationPlatform } from './vk_publication_route_contract';
import { requireProjectActorAccess } from './project_access.service';
import db from '../db';
/** Existing command and dispatcher share this production-only composition root. */
export async function tryOwnedPublicationTask(args: OwnedPublicationRequest): Promise<Record<string, unknown> | null> {
    const startedAt = Date.now();
    // Existing local non-Dzen executors retain their own authorization contract.
    // Provider classification exposes no package, credential or execution authority.
    const principal = currentPublicationPrincipal() ? requirePublicationPrincipal(args.projectId) : null;
    const task = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('statement_timeout','5000',true)`;
        if (principal) await requireProjectActorAccess(args.projectId, principal.actorId, tx);
        return tx.contentItem.findFirst({ where: { project_id: args.projectId, id: args.taskId },
            select: { channel: { select: { type: true, project_id: true } } } });
    }, { timeout: 10000, maxWait: 5000 });
    if (!task || task.channel?.project_id !== args.projectId) throw new Error('[PUBLICATION_TASK_NOT_FOUND]');
    if (!isDzenPublicationPlatform(task.channel.type)) {
        if ((args.operation && args.operation !== 'publish') || args.attemptId !== undefined
            || args.expectedPackageSha256 !== undefined || args.expectedManifestChecksum !== undefined
            || args.approvalReference !== undefined || args.expectedAcceptedRevision !== undefined) {
            throw new Error('[PROVIDER_OPERATION_UNSUPPORTED]');
        }
        return null;
    }
    const ownedPrincipal = principal || requirePublicationPrincipal(args.projectId);
    const [{ OwnedPublicationService }, { OwnedPublicationStore }, { loadAgentWorkspaceManifest },
        { default: facts }, { createProductionOwnedPublicationAdapter }] = await Promise.all([
        import('./owned_publication_service'), import('./owned_publication_store'), import('./agent_workspace_manifest.service'),
        import('./publication_fact.service'), import('./owned_publication_registry')
    ]);
    const store = new OwnedPublicationStore({ db, manifest: loadAgentWorkspaceManifest, facts });
    const remaining = 230000 - (Date.now() - startedAt);
    if (remaining <= 0) return { state: 'blocked', project_id: args.projectId, task_id: args.taskId,
        retry_allowed: false, blocker: 'OWNED_INVOCATION_TIMED_OUT' };
    const service = new OwnedPublicationService({ store, adapter: createProductionOwnedPublicationAdapter(), workBudgetMs: remaining });
    return { ...await service.execute(args, { ...ownedPrincipal, profile: ownedPrincipal.profile || 'owner', projectId: args.projectId }) };
}
