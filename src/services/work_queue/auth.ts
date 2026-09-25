import prisma from '../../db';
import { DbClient, REGISTERED_SERVICE_IDENTITIES, WorkQueueScope } from './types';
import { recordWorkflowEvent } from './infrastructure';

/**
 * Verifies that the given actor is a project owner.
 * Extracts user ID from actor string format "user:{id}".
 * @throws Error if the actor is not a project owner.
 */
export async function requireProjectOwner(
    client: DbClient,
    projectId: number,
    actorId: string
): Promise<number> {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) {
        throw new Error('[Security] Access denied: Project owner user actor is required');
    }

    const userId = Number(match[1]);
    const membership = await client.projectMember.findUnique({
        where: {
            project_id_user_id: {
                project_id: projectId,
                user_id: userId
            }
        }
    });

    if (!membership || membership.role !== 'owner') {
        throw new Error('[Security] Access denied: Project owner role is required to manage service identity bindings');
    }

    return userId;
}

/**
 * Verifies that the given actor is registered, has required scope, and has access to the project.
 * Handles both user actors (member-based) and service/agent actors (binding-based).
 * @throws Error if authorization fails.
 */
export async function requireProjectAccess(
    client: DbClient,
    projectId: number,
    actorId: string,
    requiredScope?: WorkQueueScope
): Promise<void> {
    if (!actorId || typeof actorId !== 'string' || !actorId.trim()) {
        throw new Error(`[Security] Access denied: Actor ID is required`);
    }

    const project = await client.project.findUnique({
        where: { id: projectId }
    });
    if (!project) {
        throw new Error(`[Security] Access denied: Project ${projectId} does not exist`);
    }

    if (actorId.startsWith('user:')) {
        const parsedUserId = Number(actorId.split(':')[1]);
        if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
            throw new Error(`[Security] Access denied: Invalid user actor ID format "${actorId}"`);
        }

        const member = await client.projectMember.findUnique({
            where: {
                project_id_user_id: {
                    project_id: projectId,
                    user_id: parsedUserId
                }
            }
        });

        if (!member) {
            throw new Error(`[Security] Access denied: actor ${actorId} does not have access to project ${projectId}`);
        }
        return;
    }

    // Service / Agent actor identity validation
    const registeredIdentity = REGISTERED_SERVICE_IDENTITIES[actorId];
    if (!registeredIdentity) {
        throw new Error(`[Security] Access denied: Actor "${actorId}" is not a registered service identity`);
    }

    if (requiredScope && !registeredIdentity.scopes.includes(requiredScope)) {
        throw new Error(`[Security] Access denied: Actor "${actorId}" lacks required scope "${requiredScope}"`);
    }

    const binding = await client.serviceIdentityBinding.findUnique({
        where: {
            project_id_actor_id: {
                project_id: projectId,
                actor_id: actorId
            }
        }
    });

    if (!binding || !binding.is_active) {
        throw new Error(`[Security] Access denied: Service identity "${actorId}" has no active project binding for project ${projectId}`);
    }
}

/**
 * Shared authorization boundary for adjacent MCP workflow services.
 * Keeps project membership and service-identity binding checks in one place.
 */
export async function assertProjectAccess(
    client: DbClient,
    projectId: number,
    actorId: string,
    requiredScope?: WorkQueueScope
): Promise<void> {
    await requireProjectAccess(client, projectId, actorId, requiredScope);
}

/**
 * Binds a registered service identity to a project.
 * Creates or re-activates a service identity binding.
 */
export async function bindServiceIdentity(params: {
    projectId: number;
    actorId: string;
    serviceActorId: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const identity = REGISTERED_SERVICE_IDENTITIES[params.serviceActorId];
        if (!identity) {
            throw new Error(`[Security] Access denied: Actor "${params.serviceActorId}" is not a registered service identity`);
        }

        const binding = await tx.serviceIdentityBinding.upsert({
            where: {
                project_id_actor_id: {
                    project_id: params.projectId,
                    actor_id: params.serviceActorId
                }
            },
            update: { is_active: true },
            create: {
                project_id: params.projectId,
                actor_id: params.serviceActorId,
                is_active: true
            }
        });

        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_bind_service_identity',
            afterState: { service_actor_id: binding.actor_id, is_active: binding.is_active }
        });

        return {
            binding: {
                actor_id: binding.actor_id,
                name: identity.name,
                scopes: identity.scopes,
                is_active: binding.is_active
            }
        };
    });
}

/**
 * Deactivates a service identity binding for a project.
 */
export async function unbindServiceIdentity(params: {
    projectId: number;
    actorId: string;
    serviceActorId: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const existing = await tx.serviceIdentityBinding.findUnique({
            where: {
                project_id_actor_id: {
                    project_id: params.projectId,
                    actor_id: params.serviceActorId
                }
            }
        });
        if (!existing) {
            throw new Error(`Service identity binding for "${params.serviceActorId}" was not found in project ${params.projectId}`);
        }

        const binding = await tx.serviceIdentityBinding.update({
            where: { id: existing.id },
            data: { is_active: false }
        });

        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_unbind_service_identity',
            beforeState: { service_actor_id: binding.actor_id, is_active: true },
            afterState: { service_actor_id: binding.actor_id, is_active: false }
        });

        return { binding: { actor_id: binding.actor_id, is_active: binding.is_active } };
    });
}

/**
 * Lists all service identity bindings for a project with their registered metadata.
 */
export async function listServiceBindings(params: {
    projectId: number;
    actorId: string;
}): Promise<{ bindings: Record<string, unknown>[] }> {
    await requireProjectOwner(prisma, params.projectId, params.actorId);
    const bindings = await prisma.serviceIdentityBinding.findMany({
        where: { project_id: params.projectId },
        orderBy: { actor_id: 'asc' }
    });

    return {
        bindings: bindings.map((binding) => {
            const identity = REGISTERED_SERVICE_IDENTITIES[binding.actor_id];
            return {
                actor_id: binding.actor_id,
                name: identity?.name || binding.actor_id,
                scopes: identity?.scopes || [],
                is_active: binding.is_active,
                updated_at: binding.updated_at.toISOString()
            };
        })
    };
}
