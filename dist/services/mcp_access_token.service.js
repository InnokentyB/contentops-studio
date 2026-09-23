"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashMcpToken = hashMcpToken;
exports.isManagedMcpProfile = isManagedMcpProfile;
const crypto_1 = require("crypto");
const db_1 = __importDefault(require("../db"));
const MANAGED_PROFILES = new Set(['planner', 'writer', 'art_director', 'strategist', 'organization_researcher']);
function hashMcpToken(token) {
    return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
}
function isManagedMcpProfile(value) {
    return typeof value === 'string' && MANAGED_PROFILES.has(value);
}
class McpAccessTokenService {
    async create(projectId, userId, profile, label, expiresAt) {
        if (!isManagedMcpProfile(profile))
            throw new Error('Unsupported MCP profile');
        if (profile === 'organization_researcher')
            throw new Error('Organization researcher access must be organization-scoped');
        const membership = await db_1.default.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } });
        if (!membership)
            throw new Error('User is not a member of this project');
        const token = `mcp_${(0, crypto_1.randomBytes)(32).toString('base64url')}`;
        const record = await db_1.default.mcpAccessToken.create({
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
    async createForOrganization(organizationId, userId, profile, label, expiresAt) {
        if (profile !== 'organization_researcher')
            throw new Error('Only organization researcher access can be organization-scoped');
        const membership = await db_1.default.organizationMember.findUnique({
            where: { organization_id_user_id: { organization_id: organizationId, user_id: userId } }
        });
        if (!membership || !['owner', 'researcher'].includes(membership.role)) {
            throw new Error('User cannot research this organization');
        }
        const token = `mcp_${(0, crypto_1.randomBytes)(32).toString('base64url')}`;
        const record = await db_1.default.mcpAccessToken.create({
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
    async list(projectId) {
        return db_1.default.mcpAccessToken.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: 'desc' },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
    }
    async listForOrganization(organizationId) {
        return db_1.default.mcpAccessToken.findMany({
            where: { organization_id: organizationId }, orderBy: { created_at: 'desc' },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
    }
    async revoke(projectId, id) {
        const existing = await db_1.default.mcpAccessToken.findFirst({ where: { id, project_id: projectId } });
        if (!existing)
            throw new Error('MCP access was not found');
        return db_1.default.mcpAccessToken.update({ where: { id }, data: { revoked_at: new Date() } });
    }
    async revokeForOrganization(organizationId, id) {
        const existing = await db_1.default.mcpAccessToken.findFirst({ where: { id, organization_id: organizationId } });
        if (!existing)
            throw new Error('MCP access was not found');
        return db_1.default.mcpAccessToken.update({ where: { id }, data: { revoked_at: new Date() } });
    }
    async authenticate(token, expectedProfile) {
        const record = await db_1.default.mcpAccessToken.findUnique({ where: { token_hash: hashMcpToken(token) } });
        if (!record || record.profile !== expectedProfile || record.revoked_at || (record.expires_at && record.expires_at <= new Date()))
            return null;
        if (expectedProfile === 'organization_researcher') {
            if (!record.organization_id || record.project_id)
                return null;
            const membership = await db_1.default.organizationMember.findUnique({
                where: { organization_id_user_id: { organization_id: record.organization_id, user_id: record.user_id } }
            });
            if (!membership || !['owner', 'researcher'].includes(membership.role))
                return null;
        }
        else {
            if (!record.project_id || record.organization_id)
                return null;
            const membership = await db_1.default.projectMember.findUnique({ where: { project_id_user_id: { project_id: record.project_id, user_id: record.user_id } } });
            if (!membership)
                return null;
        }
        await db_1.default.mcpAccessToken.update({ where: { id: record.id }, data: { last_used_at: new Date() } });
        return {
            credentialId: `db:${record.id}:${record.token_hash}`,
            principal: {
                userId: record.user_id,
                actorId: `user:${record.user_id}`,
                ...(record.project_id ? { projectId: record.project_id } : {}),
                ...(record.organization_id ? { organizationId: record.organization_id } : {}),
                profile: expectedProfile
            }
        };
    }
    async configuredProfiles() {
        const rows = await db_1.default.mcpAccessToken.groupBy({
            by: ['profile'],
            where: { revoked_at: null, OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
            _count: { _all: true }
        });
        return new Set(rows.filter(row => row._count._all > 0).map(row => row.profile));
    }
}
exports.default = new McpAccessTokenService();
