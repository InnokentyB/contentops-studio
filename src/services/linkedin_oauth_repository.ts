import { Prisma, ProviderOAuthConnectionAttempt } from '@prisma/client';
import prisma from '../db';
import { configHash, LinkedInOAuthError, oauthConfiguration, isOAuthFailureCode, type OAuthFailureCode } from './linkedin_oauth_contract';
import { sealLinkedInCredentials, LinkedInConnectionMetadata } from './linkedin_connection_credentials';
type Client = Prisma.TransactionClient;
/** Read only the latest exact-channel attempt metadata; no credential, state or browser binding fields are selected. */
export async function latestLinkedInConnectionAttempt(projectId: number, channelId: number): Promise<{
    status: string; code: OAuthFailureCode | null; createdAt: string; expectedAuthorUrn: string | null;
} | null> {
    const attempt = await prisma.providerOAuthConnectionAttempt.findFirst({
        where: { project_id: projectId, channel_id: channelId, provider: 'linkedin', purpose: 'channel_reconnect' },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        select: { status: true, failure_code: true, created_at: true, expires_at: true, expected_author_urn: true },
    });
    if (!attempt || !['pending', 'exchanging', 'completed', 'failed'].includes(attempt.status)) return null;
    const expected = attempt.expected_author_urn;
    return { status: attempt.status === 'pending' && attempt.expires_at.getTime() <= Date.now() ? 'expired' : attempt.status,
        code: attempt.status === 'failed' && isOAuthFailureCode(attempt.failure_code) ? attempt.failure_code : null,
        createdAt: attempt.created_at.toISOString(), expectedAuthorUrn: expected && expected.length <= 200 && /^urn:li:(person:[A-Za-z0-9_-]+|organization:[0-9]+)$/.test(expected) ? expected : null };
}
export async function oauthChannel(client: Client, userId: number, projectId: number, channelId: number) { const member = await client.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } }, include: { user: true } }); if (member?.role !== 'owner' || member.user.is_demo)
    throw new LinkedInOAuthError('LINKEDIN_OAUTH_AUTH_REQUIRED'); const channel = await client.socialChannel.findUnique({ where: { project_id_id: { project_id: projectId, id: channelId } } }); if (!channel || channel.type !== 'linkedin')
    throw new LinkedInOAuthError('LINKEDIN_CHANNEL_REQUIRED'); return channel; }
async function lockAuthority(client: Client, userId: number, projectId: number, channelId: number) {
    await client.$queryRaw `SELECT id FROM planner.users WHERE id=${userId} FOR SHARE`;
    await client.$queryRaw `SELECT id FROM planner.project_members WHERE project_id=${projectId} AND user_id=${userId} FOR SHARE`;
    await client.$queryRaw `SELECT id FROM planner.social_channels WHERE project_id=${projectId} AND id=${channelId} FOR UPDATE`;
}
export async function currentAttempt(client: Client, attempt: ProviderOAuthConnectionAttempt) { if (attempt.expires_at.getTime() <= Date.now())
    throw new LinkedInOAuthError('LINKEDIN_OAUTH_STATE_INVALID'); const channel = await oauthChannel(client, attempt.user_id, attempt.project_id, attempt.channel_id); if (configHash(channel.config) !== attempt.channel_config_hash)
    throw new LinkedInOAuthError('LINKEDIN_OAUTH_CHANNEL_CHANGED'); return channel; }
export const oauthRepository = {
    async create(data: Prisma.ProviderOAuthConnectionAttemptUncheckedCreateInput) { return prisma.$transaction(async (tx) => { await oauthChannel(tx, data.user_id, data.project_id, data.channel_id); return tx.providerOAuthConnectionAttempt.create({ data }); }); },
    find(stateHash: string) { return prisma.providerOAuthConnectionAttempt.findUnique({ where: { state_hash: stateHash } }); },
    async consume(attempt: ProviderOAuthConnectionAttempt, now: Date) { return prisma.$transaction(async (tx) => { await lockAuthority(tx, attempt.user_id, attempt.project_id, attempt.channel_id); await currentAttempt(tx, attempt); const changed = await tx.providerOAuthConnectionAttempt.updateMany({ where: { id: attempt.id, status: 'pending', expires_at: { gt: now } }, data: { status: 'exchanging', consumed_at: now } }); if (changed.count !== 1)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_ALREADY_USED'); }); },
    async fail(id: string, code: string) { await prisma.providerOAuthConnectionAttempt.updateMany({ where: { id, status: 'exchanging' }, data: { status: 'failed', failure_code: code } }); },
    async complete(attempt: ProviderOAuthConnectionAttempt, token: string, metadata: LinkedInConnectionMetadata) {
        const encrypted = sealLinkedInCredentials(token, metadata, { projectId: attempt.project_id, channelId: attempt.channel_id });
        await prisma.$transaction(async (tx) => {
            // Lock user -> membership -> channel -> attempt; revocation/config writes cannot race the final commit.
            await lockAuthority(tx, attempt.user_id, attempt.project_id, attempt.channel_id);
            if (metadata.clientId !== attempt.client_id || oauthConfiguration().clientId !== attempt.client_id)
                throw new LinkedInOAuthError('LINKEDIN_OAUTH_CONFIG_REQUIRED');
            const custody = await tx.providerOAuthConnectionAttempt.findUnique({ where: { id: attempt.id } });
            if (!custody || custody.expires_at.getTime() <= Date.now()) throw new LinkedInOAuthError('LINKEDIN_OAUTH_STATE_INVALID');
            if (custody.status !== 'exchanging') throw new LinkedInOAuthError('LINKEDIN_OAUTH_ALREADY_USED');
            const channel = await currentAttempt(tx, attempt);
            const existing = channel.config as Prisma.JsonObject;
            const changed = await tx.providerOAuthConnectionAttempt.updateMany({ where: { id: attempt.id, status: 'exchanging', expires_at: { gt: new Date() } }, data: { status: 'completed', completed_at: new Date() } });
            if (changed.count !== 1)
                throw new LinkedInOAuthError('LINKEDIN_OAUTH_ALREADY_USED');
            const next = { ...existing, linkedin_urn: metadata.authorUrn, access_token_encrypted: encrypted, linkedin_oauth: metadata, analytics_scope_enabled: metadata.scopes.includes('r_member_postAnalytics'), last_reconnected_at: metadata.verifiedAt };
            delete (next as Prisma.JsonObject).access_token;
            await tx.socialChannel.update({ where: { id: channel.id }, data: { config: next } });
            await tx.workflowEvent.create({ data: { project_id: attempt.project_id, actor_id: `user:${attempt.user_id}`, command: 'linkedin_oauth.complete', idempotency_key: attempt.id, after_state: { channel_id: channel.id, account_kind: metadata.accountKind, member_urn: metadata.memberUrn, author_urn: metadata.authorUrn, scopes: metadata.scopes, expires_at: metadata.expiresAt } } });
        });
    }
};
