/** Versioned, local adapter evidence. This diagnostic does not claim a live provider scan. */
export interface DzenRadarCoverage {
    schema_version: 1;
    complete: false;
    project_id: number;
    channel_id: number;
    provenance: { source: 'adapter_contract'; contract_version: 'dzen_radar_v1'; checked_at: string; provider_requested: false };
    surfaces: { public_discovery: {
        status: 'unknown' | 'observed'; count: number | null;
        reason: { code: 'not_scanned' | 'bounded_cards_observed'; evidence: string[]; next_step: string };
    } } & Record<'owned_channel' | 'comments' | 'replies' | 'activity', {
        status: 'unknown'; count: null;
        reason: { code: 'not_scanned' | 'reader_not_implemented'; evidence: string[]; next_step: string };
    }>;
}

/** Report missing readers explicitly, after the caller has authorized the active project channel. */
export function buildDzenRadarCoverage(projectId: number, channelId: number, checkedAt: string): DzenRadarCoverage {
    const missing = (evidence: string[]): DzenRadarCoverage['surfaces']['owned_channel'] => ({
        status: 'unknown', count: null,
        reason: { code: 'reader_not_implemented', evidence,
            next_step: 'Use an authorized native read-only scan; retain UNKNOWN until surface evidence is recorded.' }
    });
    return {
        schema_version: 1, complete: false, project_id: projectId, channel_id: channelId,
        provenance: { source: 'adapter_contract', contract_version: 'dzen_radar_v1', checked_at: checkedAt, provider_requested: false },
        surfaces: {
            public_discovery: { status: 'unknown', count: null, reason: { code: 'not_scanned',
                evidence: ['src/services/puppeteer_publisher.service.ts#searchDzenPosts: reads bounded public search cards only'],
                next_step: 'Call ba_dzen_search_relevant_posts; its returned count is not total activity.' } },
            owned_channel: missing(['src/services/dzen.service.ts#readStudioPublications: incident publication inventory exists; no MCP owned-channel activity reader']),
            comments: missing(['src/services/dzen.service.ts#collectPostMetrics: comment counters only, no comment bodies or pagination']),
            replies: missing(['src/services/dzen_engagement.service.ts#comment: outbound preview/send only; no inbound reply reader']),
            activity: missing(['src/mcp/tools/media_metrics_tools.ts: no authenticated Dzen Activity/notifications reader'])
        }
    };
}

export interface DzenReadFailure {
    code: 'auth_required' | 'interactive_verification_required' | 'interface_changed' | 'timeout' | 'session_busy' | 'unsafe_profile' | 'provider_failure';
    retryable: boolean;
    next_step: string;
}

/** Classify allowlisted read errors without returning raw errors, URLs, cookies or provider payloads. */
export function dzenReadFailure(error: unknown): DzenReadFailure {
    const message = error instanceof Error ? error.message : '';
    if (/CAPTCHA|interactive account verification/i.test(message)) return { code: 'interactive_verification_required', retryable: false,
        next_step: 'Owner must complete native account verification; do not bypass the challenge.' };
    if (/DZEN_AUTH_REQUIRED|authenticated Dzen session|Dzen authentication|Dzen session is not authenticated/i.test(message)) {
        return { code: 'auth_required', retryable: false, next_step: 'Restore the authorized Dzen session through the owner connection workflow.' };
    }
    if (/DZEN_.*INTERFACE_CHANGED/.test(message)) return { code: 'interface_changed', retryable: false, next_step: 'Review native markup; do not interpret missing cards as no results.' };
    if (/DZEN_BROWSER_SESSION_BUSY/.test(message)) return { code: 'session_busy', retryable: true, next_step: 'Wait for the scoped browser session to be released.' };
    if (/DZEN_BROWSER_PROFILE_UNSAFE|DZEN_BROWSER_SCOPE_INVALID/.test(message)) return { code: 'unsafe_profile', retryable: false, next_step: 'Repair the trusted browser profile configuration.' };
    if (/timeout|timed out/i.test(message)) return { code: 'timeout', retryable: true, next_step: 'Retry the read later; coverage remains UNKNOWN.' };
    return { code: 'provider_failure', retryable: false, next_step: 'Inspect sanitized operator diagnostics before retrying the read.' };
}

export interface DzenRankedCard {
    url: string; title: string; snippet: string; score: number; matched_terms: string[];
}

export interface DzenScreenedCard extends DzenRankedCard {
    provenance: { source: 'dzen_search_card'; captured_at: string; evidence_ref: string; article_body_read: false };
    screening: {
        version: 'dzen_card_screen_v1';
        freshness: { status: 'unknown'; published_at: null; reason: 'publication_date_not_extracted' };
        quality: { disposition: 'review_required'; flags: string[]; basis: 'title_and_snippet_heuristics' };
    };
}

/** Add conservative heuristics; never discard a card or promote lexical relevance to quality/freshness. */
export function screenDzenCard(card: DzenRankedCard, capturedAt: string): DzenScreenedCard {
    const text = `${card.title} ${card.snippet}`;
    const flags: string[] = [];
    if (/купить|скидк|промокод|подпиш|запишитесь|бесплатный курс|buy now|subscribe/i.test(text)) flags.push('promotional_language');
    if (/лучши[йех]|топ[ -]?\d|\d+ способов|полное руководство|best \d|ultimate guide/i.test(text)) flags.push('seo_listicle_language');
    if (card.snippet.trim().length < 40) flags.push('limited_snippet');
    return { ...card,
        provenance: { source: 'dzen_search_card', captured_at: capturedAt, evidence_ref: card.url, article_body_read: false },
        screening: { version: 'dzen_card_screen_v1',
            freshness: { status: 'unknown', published_at: null, reason: 'publication_date_not_extracted' },
            quality: { disposition: 'review_required', flags, basis: 'title_and_snippet_heuristics' } }
    };
}
