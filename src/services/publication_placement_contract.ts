import publicationAdapterService from './publication_adapter.service';

const DEFAULT_PLACEMENTS: Record<string, string[]> = {
    habr: ['article_cover'],
    vc: ['article_cover'],
    dzen: ['article_cover', 'feed'],
    medium: ['article_cover'],
    devto: ['article_cover'],
    site: ['article_cover'],
    setka: ['feed'],
    telegram: ['feed', 'story'],
    telegram_chat: ['feed', 'story'],
    vk: ['feed', 'story', 'article_cover', 'video_cover', 'clip'],
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
    artifact_kind: 'feed' | 'story' | 'article_cover' | 'video' | 'clip' | 'other';
    dimensions: { width: number; height: number; aspect_ratio: string } | null;
    safe_area: { unit: 'px'; top: number; right: number; bottom: number; left: number } | null;
    accepted_mime_types?: Array<'image/png' | 'image/jpeg' | 'video/mp4'>;
    poll: { supported: boolean; configuration_mode: 'native_configured' | 'native_manual' | 'not_supported' | 'not_applicable'; render_in_asset: boolean };
    transport: { materialization: 'feed_post' | 'story' | 'article' | 'video' | 'clip' | 'asset'; connector_authority: 'configured' | 'manual_only' };
};

export function publicationPlacementAssetContract(
    channel: { type: string; config?: unknown },
    placement: string,
    media: { mime_type?: string; width?: number | null; height?: number | null } = {}
): PublicationPlacementAssetContract {
    const contract = basePlacementAssetContract(channel, placement, media);
    const config = channel.config !== null && typeof channel.config === 'object'
        && !Array.isArray(channel.config) ? channel.config as Record<string, unknown> : {};
    const modes = config.execution_modes;
    // An explicit manual-only channel cannot gain API authority from stale capability flags.
    if (Array.isArray(modes) && modes.length > 0
        && modes.every(mode => typeof mode === 'string'
            && ['manual', 'manual_handoff', 'browser_required', 'browser'].includes(mode))) {
        return { ...contract, transport: { ...contract.transport, connector_authority: 'manual_only' } };
    }
    return contract;
}

function placementPlatform(type:string):string {
    const normalized=type.trim().toLowerCase();
    if(normalized==='zen')return 'dzen';
    if(normalized==='habr_article')return 'habr';
    if(normalized==='vc_article')return 'vc';
    return normalized==='odnoklassniki'?'ok':normalized;
}

function declaredPlacements(type:string):string[] {
    return type.trim().toLowerCase()==='zen_article'?['article_cover']:(DEFAULT_PLACEMENTS[placementPlatform(type)]||[]);
}

/** Implemented materialization, not live readiness or publication authority. */
export function isKnownPublicationPlacement(channel:{type:string;config?:unknown},placement:string):boolean {
    const declared=declaredPlacements(channel.type);
    if(declared.length)return declared.includes(placement);
    // Existing adapter support may supply a feed contract absent editorial
    // defaults. Configuration alone cannot register an executor or override an
    // article-only provider; never trust config.platform or capability flags.
    if(placement!=='feed'||!configuredPlacements(channel.config).includes('feed'))return false;
    const account={platform:channel.type.trim().toLowerCase()};
    if(publicationAdapterService.supportsDirectExecution(account))return true;
    const derived=publicationAdapterService.buildAdapterConfig('',account);
    return derived.capability_flags.manual_handoff
        &&publicationPlacementAssetContract(channel,placement).transport.connector_authority==='manual_only';
}

function basePlacementAssetContract(
    channel: { type: string; config?: unknown },
    placement: string,
    media: { mime_type?: string; width?: number | null; height?: number | null } = {}
): PublicationPlacementAssetContract {
    const normalizedType = placementPlatform(channel.type);
    if (normalizedType === 'vk' && placement === 'clip') {
        // Editorial canvas, not an assertion about VK upload limits. Live Clip UAT is pending.
        return {
            placement,
            artifact_kind: 'clip',
            dimensions: { width: 1080, height: 1920, aspect_ratio: '9:16' },
            safe_area: null,
            accepted_mime_types: ['video/mp4'],
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'clip', connector_authority: 'manual_only' }
        };
    }
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
    if ((normalizedType === 'vk' && placement === 'video_cover')
        || (['vk', 'telegram', 'telegram_chat'].includes(normalizedType)
            && placement === 'feed' && media.mime_type === 'video/mp4')) {
        return {
            placement,
            artifact_kind: 'video',
            dimensions: media.width && media.height
                ? { width: media.width, height: media.height, aspect_ratio: `${media.width}:${media.height}` }
                : null,
            safe_area: null,
            accepted_mime_types: ['video/mp4'],
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: {
                materialization: 'video',
                connector_authority: normalizedType === 'vk' ? 'manual_only' : 'configured'
            }
        };
    }
    if (normalizedType === 'setka' && placement === 'feed') {
        return {
            placement,
            artifact_kind: 'feed',
            dimensions: { width: 1200, height: 900, aspect_ratio: '4:3' },
            safe_area: { unit: 'px', top: 96, right: 144, bottom: 96, left: 144 },
            accepted_mime_types: ['image/png', 'image/jpeg'],
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'feed_post', connector_authority: 'configured' }
        };
    }
    if (normalizedType === 'vk' && placement === 'feed') {
        return {
            placement,
            artifact_kind: 'feed',
            dimensions: { width: 1080, height: 1080, aspect_ratio: '1:1' },
            safe_area: { unit: 'px', top: 72, right: 72, bottom: 72, left: 72 },
            accepted_mime_types: ['image/png', 'image/jpeg'],
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'feed_post', connector_authority: 'configured' }
        };
    }
    if (['dzen', 'zen', 'zen_article'].includes(normalizedType) && placement === 'article_cover') {
        // Planner editorial canvas: conservative wide cover with internal text-safe insets.
        // These are asset-production defaults, not a claim about provider upload limits.
        return {
            placement,
            artifact_kind: 'article_cover',
            dimensions: { width: 1200, height: 630, aspect_ratio: '1.91:1' },
            safe_area: { unit: 'px', top: 63, right: 120, bottom: 63, left: 120 },
            accepted_mime_types: ['image/png', 'image/jpeg'],
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'article', connector_authority: 'configured' }
        };
    }
    if (normalizedType === 'dzen' && placement === 'feed') {
        // Dzen documents the first post image as its cover, but does not specify
        // a fixed post-image aspect ratio or safe area. Art must choose the canvas
        // for the particular revision; do not borrow the article-cover geometry.
        return {
            placement,
            artifact_kind: 'feed',
            dimensions: null,
            safe_area: null,
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'feed_post', connector_authority: 'configured' }
        };
    }
    if (['telegram', 'telegram_chat', 'threads', 'linkedin'].includes(normalizedType) && placement === 'feed') {
        // Shared portrait editorial canvas; keep copy inside the insets for feed crops.
        return {
            placement,
            artifact_kind: 'feed',
            dimensions: { width: 1080, height: 1350, aspect_ratio: '4:5' },
            safe_area: { unit: 'px', top: 108, right: 86, bottom: 108, left: 86 },
            accepted_mime_types: ['image/png', 'image/jpeg'],
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'feed_post', connector_authority: normalizedType === 'linkedin' ? 'manual_only' : 'configured' }
        };
    }
    if (['medium', 'devto'].includes(normalizedType) && placement === 'article_cover') {
        return {
            placement,
            artifact_kind: 'article_cover',
            dimensions: { width: 1200, height: 630, aspect_ratio: '1.91:1' },
            safe_area: { unit: 'px', top: 63, right: 120, bottom: 63, left: 120 },
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'article', connector_authority: 'manual_only' }
        };
    }
    if (normalizedType === 'vc' && placement === 'article_cover') {
        return {
            placement,
            artifact_kind: 'article_cover',
            dimensions: { width: 1200, height: 627, aspect_ratio: '1.91:1' },
            safe_area: { unit: 'px', top: 63, right: 120, bottom: 63, left: 120 },
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'article', connector_authority: 'manual_only' }
        };
    }
    if (normalizedType === 'habr' && placement === 'article_cover') {
        return {
            placement,
            artifact_kind: 'article_cover',
            dimensions: { width: 1200, height: 630, aspect_ratio: '1.91:1' },
            safe_area: { unit: 'px', top: 63, right: 120, bottom: 63, left: 120 },
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'article', connector_authority: 'manual_only' }
        };
    }
    if (normalizedType === 'site' && placement === 'article_cover') {
        return {
            placement,
            artifact_kind: 'article_cover',
            dimensions: { width: 1200, height: 630, aspect_ratio: '1.91:1' },
            safe_area: { unit: 'px', top: 63, right: 120, bottom: 63, left: 120 },
            poll: { supported: false, configuration_mode: 'not_applicable', render_in_asset: false },
            transport: { materialization: 'article', connector_authority: 'manual_only' }
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
    if (contract.artifact_kind === 'clip') {
        return [
            'Use the VK Clip editor for the selected approved video and accepted caption.',
            'Confirm the intended account and capture the resulting Clip permalink before recording publication.'
        ];
    }
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
    const placements=configured.length?[...new Set(configured)]:declaredPlacements(channel.type);
    return channel.type.trim().toLowerCase()==='zen_article'?placements.filter(placement=>placement==='article_cover'):placements;
}

export function placementForContentAcceptance(channel: { type: string; config?: unknown }, current: string | null | undefined) {
    const canonical = canonicalPlacementsForChannel(channel);
    // This article-only provider alias must not accept an old feed binding that
    // its native route will reinterpret as an article. Other legacy types retain
    // their existing acceptance semantics; this is not an unrelated migration.
    if(channel.type.trim().toLowerCase()==='zen_article')
        return assertCanonicalPublicationPlacement(channel,current||canonical[0]||'article_cover');
    if (channel.type.trim().toLowerCase() === 'site' && current === 'feed' && canonical.includes('article_cover')) {
        return 'article_cover';
    }
    return current || canonical[0] || 'feed';
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
