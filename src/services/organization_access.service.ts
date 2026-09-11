import prisma from '../db';

export type OrganizationRole = 'owner' | 'researcher' | 'viewer';
export type OrganizationCapability = 'read' | 'search' | 'configure_sources' | 'route';

type OrganizationAccessClient = Pick<typeof prisma, 'organizationMember' | 'project'>;

const CAPABILITY_ROLES: Record<OrganizationCapability, ReadonlySet<OrganizationRole>> = {
    read: new Set(['owner', 'researcher', 'viewer']),
    search: new Set(['owner', 'researcher']),
    configure_sources: new Set(['owner']),
    route: new Set(['owner', 'researcher'])
};

function isOrganizationRole(value: string): value is OrganizationRole {
    return value === 'owner' || value === 'researcher' || value === 'viewer';
}

export function organizationRoleAllows(role: string, capability: OrganizationCapability): boolean {
    return isOrganizationRole(role) && CAPABILITY_ROLES[capability].has(role);
}

export function userIdFromActor(actorId: string): number {
    if (!actorId.startsWith('user:')) throw new Error('[Security] Organization access denied');
    const userId = Number(actorId.slice(5));
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('[Security] Organization access denied');
    return userId;
}

export async function requireOrganizationAccess(
    organizationId: number,
    userId: number,
    capability: OrganizationCapability = 'read',
    client: OrganizationAccessClient = prisma
) {
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error('[Security] Organization access denied');
    }
    const membership = await client.organizationMember.findUnique({
        where: { organization_id_user_id: { organization_id: organizationId, user_id: userId } },
        select: { id: true, role: true }
    });
    if (!membership || !organizationRoleAllows(membership.role, capability)) {
        throw new Error('[Security] Organization access denied');
    }
    return membership;
}

export async function requireOrganizationActorAccess(
    organizationId: number,
    actorId: string,
    capability: OrganizationCapability = 'read',
    client: OrganizationAccessClient = prisma
) {
    return requireOrganizationAccess(organizationId, userIdFromActor(actorId), capability, client);
}

export async function requireProjectInOrganization(
    organizationId: number,
    projectId: number,
    client: OrganizationAccessClient = prisma
) {
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
        throw new Error('[Security] Organization access denied');
    }
    const project = await client.project.findFirst({
        where: { id: projectId, organization_id: organizationId },
        select: { id: true, organization_id: true, is_archived: true }
    });
    if (!project) throw new Error('[Security] Organization access denied');
    return project;
}

export async function requireOrganizationProjectAccess(
    organizationId: number,
    projectId: number,
    userId: number,
    capability: OrganizationCapability,
    client: OrganizationAccessClient = prisma
) {
    const [membership, project] = await Promise.all([
        requireOrganizationAccess(organizationId, userId, capability, client),
        requireProjectInOrganization(organizationId, projectId, client)
    ]);
    return { membership, project };
}
