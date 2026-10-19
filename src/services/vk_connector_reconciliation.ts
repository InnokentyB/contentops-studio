import { connectorHash, type ConnectorBinding } from './vk_connector_contract';
export interface VkConnectorWallPost {
    objectId: string; publicUrl: string; publishedAt: string; text: string;
    media: { assetSha256: string; providerMediaId: string; acknowledged: boolean } | null;
}
export interface VkConnectorWallEvidence {
    ownerId: string; capturedAt: string; startedAt: string; windowStart: string; windowEnd: string;
    coverage: 'complete_window' | 'partial'; exhausted: boolean; rows: VkConnectorWallPost[];
}
export type VkConnectorReconciliation = {kind:'exact_match';post:VkConnectorWallPost} | {kind:'proven_absence'} | {kind:'unknown';reason:string};
const unknown = (reason: string): VkConnectorReconciliation => ({kind: 'unknown', reason});
function absoluteDate(value: string): number {
    return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}
function exactUrl(value: string, objectId: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['vk.ru', 'vk.com', 'www.vk.ru', 'www.vk.com'].includes(url.hostname)
            && !url.username && !url.password && !url.port && !url.search && !url.hash
            && url.pathname === `/wall${objectId}`;
    } catch { return false; }
}
function normalized(text: string): string {
    return text.replace(/\r/g, '').replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n\n').trim();
}
/** Evaluates evidence from a trusted provider port; caller data alone is never permission to mutate. */
export function evaluateVkConnectorReconciliation(binding: ConnectorBinding, text: string, releasedAt: string,
    evidence: VkConnectorWallEvidence, now: Date): VkConnectorReconciliation {
    if (binding.placement !== 'feed') return unknown('FORMAT_UNSUPPORTED');
    if (connectorHash(text.trim()) !== binding.bodySha256) return unknown('PACKAGE_CHANGED');
    const captured = absoluteDate(evidence.capturedAt), started = absoluteDate(evidence.startedAt);
    const release = absoluteDate(releasedAt), from = absoluteDate(evidence.windowStart), to = absoluteDate(evidence.windowEnd);
    const current = now.getTime();
    if (evidence.ownerId !== String(binding.communityId)) return unknown('OWNER_UNCONFIRMED');
    if (![captured, started, release, from, to, current].every(Number.isFinite)
        || started > captured || captured > current || current - captured > 30_000
        || captured - started > 120_000 || from > release || to !== captured || to > current
        || release > captured) return unknown('COVERAGE_UNKNOWN');
    if (evidence.coverage !== 'complete_window' || !evidence.exhausted)
        return unknown('COVERAGE_UNKNOWN');
    if (evidence.rows.length > 100) return unknown('COVERAGE_UNKNOWN');
    const ids = new Set<string>();
    const matches: VkConnectorWallPost[] = [];
    for (const row of evidence.rows) {
        const published = absoluteDate(row.publishedAt);
        if (!new RegExp(`^${binding.communityId}_[1-9]\\d*$`).test(row.objectId)
            || ids.has(row.objectId) || !exactUrl(row.publicUrl, row.objectId)
            || !Number.isFinite(published) || published > captured) return unknown('OBJECT_UNCONFIRMED');
        ids.add(row.objectId);
        if (normalized(row.text) !== normalized(text)) continue;
        if (published < release || published < from || published > to) return unknown('OBJECT_UNCONFIRMED');
        const media = row.media;
        if (!media || !media.acknowledged || media.assetSha256 !== binding.assetSha256
            || !new RegExp(`^photo${binding.communityId}_[1-9]\\d*$`).test(media.providerMediaId))
            return unknown('MEDIA_UNCONFIRMED');
        matches.push(row);
    }
    if (matches.length > 1) return unknown('AMBIGUOUS_MATCH');
    if (matches.length === 1) return {kind: 'exact_match', post: matches[0]};
    return {kind: 'proven_absence'};
}
