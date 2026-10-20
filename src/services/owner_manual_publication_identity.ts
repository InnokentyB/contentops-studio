import type { Prisma } from '@prisma/client';
import { OWNER_MANUAL_EVIDENCE_PREFIX } from './owner_manual_publication_contract';

type ObjectScope = {
    projectId: number;
    taskId: number;
    channelType: string;
    publicUrl?: string | null;
    providerObjectId?: string | null;
};

type ObjectIdentity = { provider: 'vk' | 'dzen'; objectId: string; aliases: string[] };

export function ownerManualObjectAliases(provider: 'vk' | 'dzen', objectId: string): string[] {
    return provider === 'vk'
        ? [`https://vk.com/wall${objectId}`, `https://vk.ru/wall${objectId}`, `http://vk.com/wall${objectId}`, `http://vk.ru/wall${objectId}`]
        : [`https://dzen.ru/a/${objectId}`, `http://dzen.ru/a/${objectId}`];
}

function publicIdentity(scope: ObjectScope): ObjectIdentity | null {
    if (scope.channelType !== 'vk' && scope.channelType !== 'dzen') return null;
    const provider = scope.channelType;
    let objectId: string | undefined;
    if (scope.publicUrl) {
        let url: URL;
        try { url = new URL(scope.publicUrl); }
        catch { return null; }
        if (!['https:', 'http:'].includes(url.protocol)) return null;
        const match = provider === 'vk'
            ? (['vk.com', 'vk.ru'].includes(url.hostname) ? /^\/wall(-?[1-9]\d*_[1-9]\d*)$/.exec(url.pathname) : null)
            : (url.hostname === 'dzen.ru' ? /^\/a\/([A-Za-z0-9_-]+)$/.exec(url.pathname) : null);
        if (!match) return null;
        objectId = match[1];
    }
    if (!objectId && scope.providerObjectId) {
        const candidate = provider === 'vk' ? scope.providerObjectId.replace(/^wall/, '') : scope.providerObjectId;
        if ((provider === 'vk' ? /^-?[1-9]\d*_[1-9]\d*$/ : /^[A-Za-z0-9_-]+$/).test(candidate)) objectId = candidate;
    }
    if (!objectId) return null;
    return { provider, objectId, aliases: ownerManualObjectAliases(provider, objectId) };
}

/** Reciprocal object fence for every canonical fact writer, after the task lock and before writes. */
export async function assertOwnerManualObjectAvailable(tx: Prisma.TransactionClient, scope: ObjectScope): Promise<void> {
    const identities = [publicIdentity({ ...scope, providerObjectId: null }),
        publicIdentity({ ...scope, publicUrl: null })].filter((value): value is ObjectIdentity => value !== null);
    if (!identities.length) return;
    await tx.$queryRaw`SELECT id FROM planner.content_items WHERE project_id=${scope.projectId} AND id=${scope.taskId} FOR UPDATE`;
    const unique = [...new Map(identities.map(identity => [identity.objectId, identity])).values()]
        .sort((left, right) => left.objectId.localeCompare(right.objectId));
    for (const identity of unique) {
    const key = `owner-manual:${scope.projectId}:${identity.provider}:${identity.objectId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
    const collision = await tx.publicationFact.findFirst({
        where: {
            project_id: scope.projectId,
            content_item_id: { not: scope.taskId },
            confirmation_mode: 'manual', evidence_ref: { startsWith: OWNER_MANUAL_EVIDENCE_PREFIX },
            channel: { type: identity.provider },
            OR: [{ provider_object_id: identity.objectId }, { provider_object_id: identity.provider === 'vk' ? `wall${identity.objectId}` : identity.objectId },
                { public_url: { in: identity.aliases } }]
        },
        select: { id: true }
    });
    if (collision) throw new Error('[MANUAL_PUBLICATION_OBJECT_CONFLICT] This external object already belongs to another task Owner confirmation. Read its canonical manual fact; do not adopt, resend or reassign it.');
    }
}
