import type { Prisma } from '@prisma/client';
import { requirePublicationPrincipal } from '../mcp/publication-principal';
import { ownerManualError, type OwnerManualInput, type OwnerManualIdentity } from './owner_manual_publication_contract';
export function ownerManualPrincipal(projectId: number) {
    try {
        const p = requirePublicationPrincipal(projectId);
        if (p.profile !== 'owner')
            throw ownerManualError('OWNER_REQUIRED');
        return p;
    }
    catch {
        throw ownerManualError('OWNER_REQUIRED');
    }
}
export async function ownerManualLocks(tx: Prisma.TransactionClient, input: OwnerManualInput) {
    const principal = ownerManualPrincipal(input.projectId);
    const users = await tx.$queryRaw<Array<{
        is_demo: boolean;
    }>> `SELECT is_demo FROM planner.users WHERE id=${principal.userId} FOR SHARE`;
    if (users.length !== 1 || users[0].is_demo)
        throw ownerManualError('OWNER_REQUIRED');
    const members = await tx.$queryRaw<Array<{
        role: string;
    }>> `SELECT role FROM planner.project_members WHERE project_id=${input.projectId} AND user_id=${principal.userId} FOR SHARE`;
    if (members.length !== 1 || members[0].role !== 'owner')
        throw ownerManualError('OWNER_REQUIRED');
    const rows = await tx.$queryRaw<Array<{
        id: number;
        channel_id: number | null;
    }>> `SELECT id,channel_id FROM planner.content_items WHERE id=${input.taskId} AND project_id=${input.projectId} FOR UPDATE`;
    if (rows.length !== 1 || !rows[0].channel_id)
        throw ownerManualError('CHANNEL_MISMATCH');
    const channels = await tx.$queryRaw<Array<{
        type: string;
        is_active: boolean;
        vk_id: string | null;
        group_id: string | null;
        channel_id: string | null;
    }>> `SELECT type,is_active,config->>'vk_id' AS vk_id,config->>'group_id' AS group_id,config->>'channel_id' AS channel_id FROM planner.social_channels WHERE id=${rows[0].channel_id} AND project_id=${input.projectId} FOR SHARE`;
    const channel = channels[0];
    if (!channel || !channel.is_active || !['vk', 'dzen'].includes(channel.type))
        throw ownerManualError('CHANNEL_MISMATCH');
    let url: URL;
    try {
        url = new URL(input.publicUrl);
    }
    catch {
        throw ownerManualError('URL_INVALID');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || input.publicUrl.includes('%') || url.href !== input.publicUrl)
        throw ownerManualError('URL_INVALID');
    let identity: OwnerManualIdentity;
    if (channel.type === 'vk') {
        const match = /^\/wall(-?[1-9]\d*)_([1-9]\d*)$/.exec(url.pathname);
        if (!['vk.com', 'vk.ru'].includes(url.hostname) || !match)
            throw ownerManualError('URL_INVALID');
        const account = channel.vk_id || (channel.group_id && /^[1-9]\d*$/.test(channel.group_id) ? `-${channel.group_id}` : null);
        if (!account || account !== match[1] || (channel.vk_id && channel.group_id && channel.vk_id !== `-${channel.group_id}`))
            throw ownerManualError('CHANNEL_MISMATCH');
        url.hostname = 'vk.com';
        identity = { provider: 'vk', object_id: `${match[1]}_${match[2]}`, public_url: url.href, account_id: account, account_linkage: 'locally_validated' };
    }
    else {
        const match = /^\/a\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
        if (url.hostname !== 'dzen.ru' || !match)
            throw ownerManualError('URL_INVALID');
        identity = { provider: 'dzen', object_id: match[1], public_url: url.href, account_id: channel.channel_id, account_linkage: 'owner_attested' };
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.publishedAt) || !Number.isFinite(Date.parse(input.publishedAt)) || Date.parse(input.publishedAt) > Date.now())
        throw ownerManualError('TIME_INVALID');
    const clock = input.publishedAt.slice(11, 19).split(':').map(Number);
    if (clock[0] > 23 || clock[1] > 59 || clock[2] > 59)
        throw ownerManualError('TIME_INVALID');
    const dateParts = input.publishedAt.slice(0, 10).split('-').map(Number);
    const calendar = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
    if (calendar.getUTCFullYear() !== dateParts[0] || calendar.getUTCMonth() !== dateParts[1] - 1 || calendar.getUTCDate() !== dateParts[2])
        throw ownerManualError('TIME_INVALID');
    for (const ref of [input.ownerConfirmationReference])
        if (/(?:bearer\s|authorization|cookie\s*[:=]|access[_-]?token|token\s*=|https?:\/\/[^\s]+\?)/i.test(ref))
            throw ownerManualError('REFERENCE_INVALID');
    if (input.publishedRevision)
        throw ownerManualError('REVISION_UNVERIFIED');
    return { principal, identity };
}
