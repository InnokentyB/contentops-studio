const DEFAULT_PLACEMENTS: Record<string, string[]> = {
    habr: ['article_cover'],
    vc: ['article_cover'],
    dzen: ['article_cover'],
    site: ['article_cover'],
    telegram: ['feed', 'story'],
    telegram_chat: ['feed', 'story'],
    vk: ['feed', 'story', 'article_cover'],
    linkedin: ['feed', 'carousel'],
    threads: ['feed'],
    x: ['feed'],
    ok: ['feed'],
    tenchat: ['feed'],
    facebook: ['feed'],
    instagram: ['feed', 'story', 'reel'],
    email: ['body'],
    video: ['video_cover']
};

export type PublicationPlacementAssetContract = {
    placement: string;
    artifact_kind: 'feed' | 'story' | 'article_cover' | 'other';
    dimensions: { width: number; height: number; aspect_ratio: string } | null;
    safe_area: { unit: 'px'; top: number; right: number; bottom: number; left: number } | null;
    poll: { supported: boolean; configuration_mode: 'native_configured' | 'native_manual' | 'not_supported' | 'not_applicable'; render_in_asset: boolean };
    transport: { materialization: 'feed_post' | 'story' | 'article' | 'asset'; connector_authority: 'configured' | 'manual_only' };
};

export function publicationPlacementAssetContract(
    channel: { type: string; config?: unknown },
    placement: string
): PublicationPlacementAssetContract {
    const normalizedType = channel.type.trim().toLowerCase();
    if (placement === 'story') {
        const poll = normalizedType === 'vk'
            ? { supported: true, configuration_mode: 'native_configured' as const, render_in_asset: false }
            : normalizedType === 'instagram'
                ? { supported: true, configuration_mode: 'native_manual' as const, render_in_asset: false }
                : ['telegram', 'telegram_chat'].includes(normalizedType)
                    ? { supported: false, configuration_mode: 'not_supported' as const, render_in_asset: false }
                    : { supported: false, configuration_mode: 'not_applicable' as const, render_in_asset: false };
        return {
            placement,
            artifact_kind: 'story',
            dimensions: { width: 1080, height: 1920, aspect_ratio: '9:16' },
            safe_area: { unit: 'px', top: 250, right: 80, bottom: 320, left: 80 },
            poll,
            transport: {
                materialization: 'story',
                connector_authority: normalizedType === 'vk' ? 'configured' : 'manual_only'
            }
        };
    }
    if (normalizedType === 'vk' && placement === 'article_cover') {
        return {
            placement,
            artifact_kind: 'article_cover',
            dimensions: { width: 1200, height: 675, aspect_ratio: '16:9' },
            safe_area: { unit: 'px', top: 72, right: 96, bottom: 72, left: 96 },
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'article', connector_authority: 'manual_only' }
        };
    }
    if (['dzen', 'zen', 'zen_article'].includes(normalizedType) && placement === 'article_cover') {
        return {
            placement,
            artifact_kind: 'article_cover',
            dimensions: null,
            safe_area: null,
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'article', connector_authority: 'configured' }
        };
    }
    return {
        placement,
        artifact_kind: placement === 'feed' ? 'feed' : placement === 'article_cover' ? 'article_cover' : 'other',
        dimensions: null,
        safe_area: null,
        poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
        transport: {
            materialization: placement === 'feed' ? 'feed_post' : 'asset',
            connector_authority: 'configured'
        }
    };
}

export function publicationPlacementManualChecklistNotes(contract: PublicationPlacementAssetContract) {
    return contract.artifact_kind === 'story' && contract.poll.configuration_mode === 'not_supported'
        ? ['Keep the prepared question and answer options as ordinary story content.']
        : [];
}

function configuredPlacements(config: unknown) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
    const raw = (config as any).raw_account;
    const values = [
        (config as any).canonical_placement,
        ...((config as any).canonical_placements || []),
        raw?.canonical_placement,
        ...(raw?.canonical_placements || [])
    ];
    return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim());
}

export function canonicalPlacementsForChannel(channel: { type: string; config?: unknown }) {
    const configured = configuredPlacements(channel.config);
    return configured.length ? [...new Set(configured)] : (DEFAULT_PLACEMENTS[channel.type.trim().toLowerCase()] || []);
}

export function assertCanonicalPublicationPlacement(channel: { id?: number; type: string; config?: unknown }, placement: string) {
    const allowed = canonicalPlacementsForChannel(channel);
    if (!allowed.length) {
        throw new Error(`[CHANNEL_PLACEMENT_CONTRACT_MISSING] Channel type ${channel.type} has no canonical placement contract`);
    }
    if (!allowed.includes(placement)) {
        throw new Error(`[TARGET_PLACEMENT_MISMATCH] Placement ${placement} is not canonical for channel type ${channel.type}; allowed: ${allowed.join(', ')}`);
    }
    return placement;
}
