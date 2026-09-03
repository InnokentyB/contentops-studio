import { createHash, randomBytes } from 'crypto';
import prisma from '../db';
import type { McpCapabilityProfile } from '../mcp/capabilities';

export const MANAGED_MCP_PROFILES = [
    'strategist', 'planner', 'writer', 'editor', 'art_director', 'publisher', 'growth_analyst'
] as const satisfies readonly McpCapabilityProfile[];

const MANAGED_PROFILES = new Set<McpCapabilityProfile>(MANAGED_MCP_PROFILES);

function profileSlug(profile: McpCapabilityProfile) {
    return profile.replace(/_/g, '-');
}

export function hashMcpToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
}

export function isManagedMcpProfile(value: unknown): value is McpCapabilityProfile {
    return typeof value === 'string' && MANAGED_PROFILES.has(value as McpCapabilityProfile);
}

class McpAccessTokenService {
    async create(projectId: number, userId: number, profile: McpCapabilityProfile, label: string, expiresAt?: Date | null) {
        if (!isManagedMcpProfile(profile)) throw new Error('Unsupported MCP profile');
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

    async list(projectId: number) {
        return prisma.mcpAccessToken.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: 'desc' },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
    }

    async createWorkspaceBundle(projectId: number, userId: number, label: string, remoteUrl: string) {
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
        const issued = MANAGED_MCP_PROFILES.map((profile) => ({
            profile,
            token: `mcp_${randomBytes(32).toString('base64url')}`
        }));

        const records = await prisma.$transaction(async (transaction) => Promise.all(issued.map(({ profile, token }) =>
            transaction.mcpAccessToken.create({
                data: {
                    project_id: projectId,
                    user_id: userId,
                    profile,
                    token_hash: hashMcpToken(token),
                    label: `${labelPrefix} · ${profile}`
                }
            })
        )));

        const accesses = issued.map(({ profile, token }, index) => ({
            id: records[index].id,
            profile,
            token,
            endpoint: `${baseUrl}/${profileSlug(profile)}`
        }));
        const mcpServers = Object.fromEntries(accesses.map((access) => [
            `contentops-${profileSlug(access.profile)}`,
            { url: access.endpoint, headers: { Authorization: `Bearer ${access.token}` } }
        ]));
        const chatList = [
            'Strategist', 'Planning HQ', 'Content Writer', 'Chief Editor', 'Art Director', 'Publisher', 'Growth Analyst'
        ];

        return {
            schema_version: '1.0',
            project: membership.project,
            user: membership.user,
            accesses,
            config: { mcpServers },
            bootstrap_prompt: [
                `Set up the governed ContentOps workspace for project ${membership.project.name} (ID ${projectId}).`,
                `Create these seven role chats if the host supports persistent chats: ${chatList.join(', ')}.`,
                'Connect each chat only to the matching ContentOps MCP server from the supplied configuration.',
                'In every chat, first call ba_get_agent_workspace_manifest, then ba_get_agent_chat_bootstrap with that chat id.',
                'Treat the returned permissions and handoffs as authoritative. Never print access tokens or copy them into chat messages.',
                'Publisher may deliver only through its visible governed tools and must obey release readiness and approval gates; never infer success without a confirmed publication fact.'
            ].join('\n')
        };
    }

    async revoke(projectId: number, id: number) {
        const existing = await prisma.mcpAccessToken.findFirst({ where: { id, project_id: projectId } });
        if (!existing) throw new Error('MCP access was not found');
        return prisma.mcpAccessToken.update({ where: { id }, data: { revoked_at: new Date() } });
    }

    async authenticate(token: string, expectedProfile: McpCapabilityProfile) {
        const record = await prisma.mcpAccessToken.findUnique({ where: { token_hash: hashMcpToken(token) } });
        if (!record || record.profile !== expectedProfile || record.revoked_at || (record.expires_at && record.expires_at <= new Date())) return null;
        const membership = await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: record.project_id, user_id: record.user_id } } });
        if (!membership) return null;
        await prisma.mcpAccessToken.update({ where: { id: record.id }, data: { last_used_at: new Date() } });
        return {
            credentialId: `db:${record.id}:${record.token_hash}`,
            principal: { userId: record.user_id, actorId: `user:${record.user_id}`, projectId: record.project_id, profile: expectedProfile }
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
