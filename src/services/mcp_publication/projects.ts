import prisma from '../../db';
import { Prisma } from '@prisma/client';
import { slugifyProjectName, normalizeProjectKind } from '../../utils/project.utils';
import { redactConfig, summarizeProject, summarizeUser } from './helpers';
import { ProjectRole } from './types';

/**
 * Fetch user or throw 404.
 */
export async function requireUser(userId: number) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true
        }
    });

    if (!user) {
        throw new Error(`User ${userId} not found`);
    }

    return user;
}

/**
 * Assert user has minimum required access role for project.
 */
export async function assertProjectAccess(userId: number, projectId: number, minRole: ProjectRole = 'viewer') {
    const membership = await prisma.projectMember.findUnique({
        where: {
            project_id_user_id: {
                project_id: projectId,
                user_id: userId
            }
        }
    });

    if (!membership) {
        throw new Error(`User ${userId} does not have access to project ${projectId}`);
    }

    const roles: ProjectRole[] = ['viewer', 'editor', 'owner'];
    if (roles.indexOf(membership.role as ProjectRole) < roles.indexOf(minRole)) {
        throw new Error(`User ${userId} does not have ${minRole} access to project ${projectId}`);
    }

    return membership;
}

/**
 * Generate a unique project slug.
 */
export async function makeUniqueProjectSlug(baseSlug?: string, fallbackName?: string, excludeProjectId?: number) {
    const source = baseSlug?.trim() || fallbackName?.trim() || `project-${Date.now()}`;
    const normalized = slugifyProjectName(source) || `project-${Date.now()}`;
    let candidate = normalized;
    let suffix = 2;

    while (await prisma.project.findFirst({
        where: {
            slug: candidate,
            ...(excludeProjectId ? { id: { not: excludeProjectId } } : {})
        },
        select: { id: true }
    })) {
        candidate = `${normalized}-${suffix}`;
        suffix += 1;
    }

    return candidate;
}

/**
 * List projects accessible or all if userId omitted.
 */
export async function listProjects(options: { userId?: number; includeArchived?: boolean } = {}) {
    const where: Prisma.ProjectWhereInput = {};

    if (options.userId) {
        where.members = {
            some: {
                user_id: options.userId
            }
        };
    }

    if (!options.includeArchived) {
        where.is_archived = false;
    }

    const projects = await prisma.project.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        include: {
            members: options.userId
                ? {
                    where: { user_id: options.userId },
                    select: { role: true }
                }
                : false,
            channels: {
                orderBy: { id: 'asc' },
                take: 12
            },
            _count: {
                select: {
                    channels: true,
                    content_items: true
                }
            }
        }
    });

    return projects.map((project: (typeof projects)[number]) => summarizeProject(project, (project.members as Array<{ role: string }> | undefined)?.[0]?.role || null));
}

/**
 * List all users.
 */
export async function listUsers(options: { includeArchivedProjects?: boolean } = {}) {
    const users = await prisma.user.findMany({
        orderBy: { id: 'asc' },
        include: {
            memberships: {
                where: options.includeArchivedProjects
                    ? undefined
                    : {
                        project: {
                            is_archived: false
                        }
                    },
                orderBy: { project_id: 'asc' },
                include: {
                    project: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            is_archived: true
                        }
                    }
                }
            }
        }
    });

    return users.map((user: (typeof users)[number]) => summarizeUser(user));
}

/**
 * Get user by id.
 */
export async function getUser(userId: number, options: { includeArchivedProjects?: boolean } = {}) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            memberships: {
                where: options.includeArchivedProjects
                    ? undefined
                    : {
                        project: {
                            is_archived: false
                        }
                    },
                orderBy: { project_id: 'asc' },
                include: {
                    project: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            is_archived: true
                        }
                    }
                }
            }
        }
    });

    if (!user) {
        throw new Error(`User ${userId} not found`);
    }

    return summarizeUser(user);
}

/**
 * Create a new project.
 */
export async function createProject(params: {
    userId: number;
    name: string;
    slug?: string;
    description?: string;
    kind?: string;
}) {
    const user = await requireUser(params.userId);
    const slug = await makeUniqueProjectSlug(params.slug, params.name);
    const organization = await prisma.organizationMember.findFirst({
        where: { user_id: params.userId, role: 'owner', organization: { is_archived: false } },
        orderBy: { organization_id: 'asc' },
        select: { organization_id: true }
    });
    if (!organization) throw new Error('An owner organization is required');

    const project = await prisma.project.create({
        data: {
            name: params.name,
            slug,
            description: params.description,
            kind: normalizeProjectKind(params.kind),
            organization_id: organization.organization_id,
            research_profile: { create: { revision: 1 } },
            members: {
                create: {
                    user_id: params.userId,
                    role: 'owner'
                }
            }
        },
        include: {
            channels: {
                orderBy: { id: 'asc' },
                take: 12
            },
            _count: {
                select: {
                    channels: true,
                    content_items: true
                }
            }
        }
    });

    return {
        created_by: user,
        project: summarizeProject(project, 'owner')
    };
}

/**
 * Update project details.
 */
export async function updateProject(params: {
    userId: number;
    projectId: number;
    name?: string;
    slug?: string;
    description?: string | null;
    kind?: string;
}) {
    await assertProjectAccess(params.userId, params.projectId, 'owner');

    const existing = await prisma.project.findUnique({
        where: { id: params.projectId }
    });

    if (!existing) {
        throw new Error(`Project ${params.projectId} not found`);
    }

    const slug = typeof params.slug === 'string' && params.slug.trim()
        ? await makeUniqueProjectSlug(params.slug, existing.name, existing.id)
        : undefined;

    const project = await prisma.project.update({
        where: { id: params.projectId },
        data: {
            ...(typeof params.name === 'string' ? { name: params.name } : {}),
            ...(typeof params.description === 'string' || params.description === null ? { description: params.description } : {}),
            ...(slug ? { slug } : {}),
            ...(typeof params.kind === 'string' ? { kind: normalizeProjectKind(params.kind) } : {})
        },
        include: {
            channels: {
                orderBy: { id: 'asc' },
                take: 12
            },
            _count: {
                select: {
                    channels: true,
                    content_items: true
                }
            }
        }
    });

    return {
        project: summarizeProject(project, 'owner')
    };
}

/**
 * Archive or unarchive a project.
 */
export async function archiveProject(params: {
    userId: number;
    projectId: number;
    archived?: boolean;
}) {
    await assertProjectAccess(params.userId, params.projectId, 'owner');
    const nextArchived = params.archived !== false;

    const project = await prisma.project.update({
        where: { id: params.projectId },
        data: {
            is_archived: nextArchived,
            archived_at: nextArchived ? new Date() : null
        },
        include: {
            channels: {
                orderBy: { id: 'asc' },
                take: 12
            },
            _count: {
                select: {
                    channels: true,
                    content_items: true
                }
            }
        }
    });

    return {
        project: summarizeProject(project, 'owner')
    };
}

/**
 * List channels for a project with redacted config.
 */
export async function listChannels(projectId: number) {
    const channels = await prisma.socialChannel.findMany({
        where: { project_id: projectId },
        orderBy: { id: 'asc' }
    });

    return channels.map((channel: (typeof channels)[number]) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        is_active: channel.is_active,
        config: redactConfig(channel.config)
    }));
}

/**
 * Resolve target social channel by id or type.
 */
export async function resolveChannel(projectId: number, channelId?: number, channelType?: string) {
    if (channelId) {
        const channel = await prisma.socialChannel.findFirst({
            where: {
                id: channelId,
                project_id: projectId,
                is_active: true
            }
        });

        if (!channel) {
            throw new Error(`Channel ${channelId} not found or inactive for project ${projectId}`);
        }

        return channel;
    }

    if (!channelType) {
        throw new Error('Either `channelId` or `channelType` must be provided');
    }

    const channel = await prisma.socialChannel.findFirst({
        where: {
            project_id: projectId,
            type: channelType,
            is_active: true
        },
        orderBy: { id: 'asc' }
    });

    if (!channel) {
        throw new Error(`No active channel of type '${channelType}' found for project ${projectId}`);
    }

    return channel;
}
