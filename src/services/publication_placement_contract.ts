const DEFAULT_PLACEMENTS: Record<string, string[]> = {
    habr: ['article_cover'],
    vc: ['article_cover'],
    dzen: ['article_cover'],
    site: ['article_cover'],
    telegram: ['feed'],
    telegram_chat: ['feed'],
    vk: ['feed'],
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

