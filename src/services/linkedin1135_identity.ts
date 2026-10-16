/** Preserve LinkedIn's actual object namespace; a share is not an activity with the same number. */
export function validateLinkedIn1135Identity(publicUrl: string, providerObjectId: string, publishedAt: string) {
    if (!URL.canParse(publicUrl)) throw new Error('[PROVIDER_IDENTITY_INVALID]');
    const url = new URL(publicUrl), published = new Date(publishedAt);
    const match = /^\/feed\/update\/(urn:li:(?:activity|share):[1-9]\d*)\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'www.linkedin.com' || url.port || url.username || url.password
        || url.hash || !match || match[1] !== providerObjectId || !Number.isFinite(published.getTime())
        || [...url.searchParams.entries()].some(([key, value]) => key !== 'actorCompanyId' || value !== '79633032')) {
        throw new Error('[PROVIDER_IDENTITY_INVALID]');
    }
    return { publicUrl: `https://www.linkedin.com/feed/update/${providerObjectId}/`,
        providerObjectId, publishedAt: published.toISOString() };
}
