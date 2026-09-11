import { createHash, randomBytes, randomUUID } from 'crypto';
import prisma from '../db';
import type { McpCapabilityProfile } from '../mcp/capabilities';

export const MANAGED_MCP_PROFILES = [
    'strategist', 'planner', 'writer', 'editor', 'art_director', 'publisher', 'growth_analyst'
] as const satisfies readonly McpCapabilityProfile[];

const MANAGED_PROFILES = new Set<McpCapabilityProfile>([...MANAGED_MCP_PROFILES, 'organization_researcher']);

function profileSlug(profile: McpCapabilityProfile) {
    return profile.replace(/_/g, '-');
}

function safeProjectSlug(value: string) {
    const normalized = value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || 'project';
}

export function projectMcpNamespace(project: { id: number; slug: string }) {
    return `contentops_${safeProjectSlug(project.slug)}_p${project.id}`;
}

function projectTokenEnvVar(namespace: string, profile: McpCapabilityProfile) {
    return `${namespace}_${profile}_token`.toUpperCase();
}

function tomlString(value: string) {
    return JSON.stringify(value);
}

export function hashMcpToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
}

export function isManagedMcpProfile(value: unknown): value is McpCapabilityProfile {
    return typeof value === 'string' && MANAGED_PROFILES.has(value as McpCapabilityProfile);
}

export class ActiveMcpWorkspaceBundleError extends Error {
    constructor(public readonly bundleId: string) {
        super('An active MCP workspace already exists for this project member');
        this.name = 'ActiveMcpWorkspaceBundleError';
    }
}

class McpAccessTokenService {
    async create(projectId: number, userId: number, profile: McpCapabilityProfile, label: string, expiresAt?: Date | null) {
        if (!isManagedMcpProfile(profile)) throw new Error('Unsupported MCP profile');
        if (profile === 'organization_researcher') throw new Error('Organization researcher access must be organization-scoped');
        const membership = await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } });
        if (!membership) throw new Error('User is not a member of this project');

        const token = `mcp_${randomBytes(32).toString('base64url')}`;
        const record = await prisma.mcpAccessToken.create({
            data: {
                project_id: projectId,
                user_id: userId,
                profile,
                token_hash: hashMcpToken(token),
                label: label.trim() || `${profile} access`,
                expires_at: expiresAt || null
            },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
        return { token, access: record };
    }

    async createForOrganization(organizationId: number, userId: number, profile: McpCapabilityProfile, label: string, expiresAt?: Date | null) {
        if (profile !== 'organization_researcher') throw new Error('Only organization researcher access can be organization-scoped');
        const membership = await prisma.organizationMember.findUnique({
            where: { organization_id_user_id: { organization_id: organizationId, user_id: userId } }
        });
        if (!membership || !['owner', 'researcher'].includes(membership.role)) {
            throw new Error('User cannot research this organization');
        }

        const token = `mcp_${randomBytes(32).toString('base64url')}`;
        const record = await prisma.mcpAccessToken.create({
            data: {
                organization_id: organizationId,
                user_id: userId,
                profile,
                token_hash: hashMcpToken(token),
                label: label.trim() || `${profile} access`,
                expires_at: expiresAt || null
            },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
        return { token, access: record };
    }

    async list(projectId: number) {
        return prisma.mcpAccessToken.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: 'desc' },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
    }

    async listForOrganization(organizationId: number) {
        return prisma.mcpAccessToken.findMany({
            where: { organization_id: organizationId }, orderBy: { created_at: 'desc' },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
    }

    async revokeForOrganization(organizationId: number, id: number) {
        const existing = await prisma.mcpAccessToken.findFirst({ where: { id, organization_id: organizationId } });
        if (!existing) throw new Error('MCP access was not found');
        return prisma.mcpAccessToken.update({ where: { id }, data: { revoked_at: new Date() } });
    }

    async createWorkspaceBundle(
        projectId: number,
        userId: number,
        label: string,
        remoteUrl: string,
        options: { expiresAt?: Date | null; rotate?: boolean } = {}
    ) {
        const membership = await prisma.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: userId } },
            include: {
                project: { select: { id: true, name: true, slug: true } },
                user: { select: { id: true, name: true, email: true } }
            }
        });
        if (!membership) throw new Error('User is not a member of this project');

        const baseUrl = remoteUrl.replace(/\/+$/, '');
        const labelPrefix = label.trim() || 'Agent workspace';
        const bundleId = randomUUID();
        const issued = MANAGED_MCP_PROFILES.map((profile) => ({
            profile,
            token: `mcp_${randomBytes(32).toString('base64url')}`
        }));

        const records = await prisma.$transaction(async (transaction) => {
            await transaction.$queryRawUnsafe(
                'SELECT pg_advisory_xact_lock($1::int, $2::int)::text AS locked',
                projectId,
                userId
            );
            const activeBundle = await transaction.mcpAccessToken.findFirst({
                where: {
                    project_id: projectId,
                    user_id: userId,
                    bundle_id: { not: null },
                    revoked_at: null,
                    OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }]
                },
                select: { bundle_id: true },
                orderBy: { created_at: 'desc' }
            });
            if (activeBundle?.bundle_id && !options.rotate) throw new ActiveMcpWorkspaceBundleError(activeBundle.bundle_id);
            if (activeBundle?.bundle_id && options.rotate) {
                await transaction.mcpAccessToken.updateMany({
                    where: { project_id: projectId, user_id: userId, bundle_id: { not: null }, revoked_at: null },
                    data: { revoked_at: new Date() }
                });
            }
            return Promise.all(issued.map(({ profile, token }) => transaction.mcpAccessToken.create({
                data: {
                    project_id: projectId,
                    user_id: userId,
                    profile,
                    bundle_id: bundleId,
                    token_hash: hashMcpToken(token),
                    label: `${labelPrefix} · ${profile}`,
                    expires_at: options.expiresAt || null
                }
            })));
        });

        const serverNamespace = projectMcpNamespace(membership.project);
        const accesses = issued.map(({ profile, token }, index) => ({
            id: records[index].id,
            profile,
            token,
            endpoint: `${baseUrl}/${profileSlug(profile)}`,
            server_name: `${serverNamespace}_${profile}`,
            token_env_var: projectTokenEnvVar(serverNamespace, profile)
        }));
        const mcpServers = Object.fromEntries(accesses.map((access) => [
            access.server_name,
            { url: access.endpoint, headers: { Authorization: `Bearer ${access.token}` } }
        ]));
        const codexConfigToml = accesses.map((access) => [
            `[mcp_servers.${access.server_name}]`,
            `url = ${tomlString(access.endpoint)}`,
            `bearer_token_env_var = ${tomlString(access.token_env_var)}`,
            'required = true'
        ].join('\n')).join('\n\n');
        const secretsEnv = accesses
            .map((access) => `${access.token_env_var}=${access.token}`)
            .join('\n');
        const chatList = [
            'Strategist', 'Planning HQ', 'Content Writer', 'Chief Editor', 'Art Director', 'Publisher', 'Growth Analyst'
        ];

        return {
            schema_version: '2.0',
            bundle_id: bundleId,
            project: membership.project,
            user: membership.user,
            accesses,
            config: { mcpServers },
            codex: {
                server_namespace: serverNamespace,
                project_directory_name: `${safeProjectSlug(membership.project.slug)}-contentops-p${projectId}`,
                project_config_toml: codexConfigToml,
                secrets_env: secretsEnv
            },
            bootstrap_prompt: [
                `Set up the governed ContentOps workspace for project ${membership.project.name} (ID ${projectId}).`,
                `This bundle is exclusively bound to project ${membership.project.slug} (ID ${projectId}) under MCP namespace ${serverNamespace}.`,
                'Create or open one saved Codex project rooted in the dedicated directory containing the supplied .codex/config.toml.',
                `Inside that saved project, create these seven role chats if the host supports persistent chats: ${chatList.join(', ')}.`,
                'Do not create projectless role chats and do not use the globally shared ContentOps Workspace plugin connection for a multi-project setup.',
                'Connect each chat only to the matching project-namespaced ContentOps MCP server from the supplied configuration.',
                'In every chat, first call ba_get_agent_workspace_manifest, then ba_get_agent_chat_bootstrap with that chat id.',
                `Stop if the manifest project id is not ${projectId} or its slug is not ${membership.project.slug}.`,
                'Treat the returned permissions and handoffs as authoritative. Never print access tokens or copy them into chat messages.',
                'Publisher may deliver only through its visible governed tools and must obey release readiness and approval gates; never infer success without a confirmed publication fact.'
            ].join('\n')
        };
    }

    async revokeWorkspaceBundle(projectId: number, bundleId: string) {
        const result = await prisma.mcpAccessToken.updateMany({
            where: { project_id: projectId, bundle_id: bundleId, revoked_at: null },
            data: { revoked_at: new Date() }
        });
        if (!result.count) throw new Error('Active MCP workspace bundle was not found');
        return { revoked: result.count, bundle_id: bundleId };
    }

    async revoke(projectId: number, id: number) {
        const existing = await prisma.mcpAccessToken.findFirst({ where: { id, project_id: projectId } });
        if (!existing) throw new Error('MCP access was not found');
        return prisma.mcpAccessToken.update({ where: { id }, data: { revoked_at: new Date() } });
    }

    async authenticate(token: string, expectedProfile: McpCapabilityProfile) {
        const record = await prisma.mcpAccessToken.findUnique({ where: { token_hash: hashMcpToken(token) } });
        if (!record || record.profile !== expectedProfile || record.revoked_at || (record.expires_at && record.expires_at <= new Date())) return null;
        if (expectedProfile === 'organization_researcher') {
            if (!record.organization_id || record.project_id) return null;
            const membership = await prisma.organizationMember.findUnique({ where: { organization_id_user_id: { organization_id: record.organization_id, user_id: record.user_id } } });
            if (!membership || !['owner', 'researcher'].includes(membership.role)) return null;
        } else {
            if (!record.project_id || record.organization_id) return null;
            const membership = await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: record.project_id, user_id: record.user_id } } });
            if (!membership) return null;
        }
        await prisma.mcpAccessToken.update({ where: { id: record.id }, data: { last_used_at: new Date() } });
        return {
            credentialId: `db:${record.id}:${record.token_hash}`,
            principal: { userId: record.user_id, actorId: `user:${record.user_id}`, ...(record.project_id ? { projectId: record.project_id } : {}), ...(record.organization_id ? { organizationId: record.organization_id } : {}), profile: expectedProfile }
        };
    }

    async configuredProfiles() {
        const rows = await prisma.mcpAccessToken.groupBy({
            by: ['profile'],
            where: { revoked_at: null, OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
            _count: { _all: true }
        });
        return new Set(rows.filter(row => row._count._all > 0).map(row => row.profile));
    }
}

export default new McpAccessTokenService();
