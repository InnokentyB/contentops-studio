import { describeDzen1002Pagination } from './dzen1002_pagination_shape';

type Admission = { state: string; expiresAt?: number };
/** Internal runtime seam, not a config/request attestation. No production authority is configured. */
export async function requireDzen1002DiagnosticAdmission(probe?: () => Promise<Admission>): Promise<void> {
    if (!probe) throw new Error('[DZEN1002_ADMISSION_SOURCE_UNAVAILABLE]');
    let decision: Admission;
    try { decision = await probe(); }
    catch { throw new Error('[DZEN1002_ADMISSION_SOURCE_UNAVAILABLE]'); }
    const now = Date.now();
    if (decision.state !== 'permitted' || !Number.isSafeInteger(decision.expiresAt)
        || (decision.expiresAt ?? 0) <= now || (decision.expiresAt ?? 0) > now + 60_000) {
        throw new Error('[DZEN1002_ACTION_ADMISSION_DENIED_OR_EXPIRED]');
    }
}
type Frame = { state: string; page: number; url: string; status: number; payload: unknown };
type NativeCaptureReport = { mode: 'diagnostic_only'; basis: 'observed_response_shape'; stop_reason: string | null;
    coverage_verified: false; native_end_rule_verified: false; provider_identity_verified: false;
    observed_rows: number; unique_id_candidates: number; pages: Record<string, unknown>[] };
const collections = ['publications', 'drafts', 'pinedPublications', 'pinPromoPublications'] as const;
const rowFields = ['id', 'publicationId', 'publication_id', 'title', 'state', 'status', 'type',
    'isDraft', 'isPublished', 'createdAt', 'created_at', 'publishedAt', 'published_at'];
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function type(value: unknown) { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; }

/** Observes already-received frames only. Never requests pages or interprets native ownership/end. */
export function createDzen1002NativeCapture(targetTitle?: string) {
    const started = Date.now(); const candidates = new Map<string, string>();
    const pages: Record<string, unknown>[] = []; let rowCount = 0; let stopReason: string | null = null;
    const statePages = { published: 0, draft: 0 };
    function observe(frame: Frame): void {
        if (stopReason) return;
        if (Date.now() - started >= 60_000) { stopReason = 'TIME_LIMIT'; return; }
        if (frame.state !== 'published' && frame.state !== 'draft') { stopReason = 'STATE_INVALID'; return; }
        if (!Number.isInteger(frame.page) || frame.page < 1 || frame.page > 10 || statePages[frame.state] >= 10) {
            stopReason = 'PAGE_LIMIT'; return;
        }
        let url: URL;
        try { url = new URL(frame.url); }
        catch { stopReason = 'ROUTE_INVALID'; return; }
        if (url.origin !== 'https://dzen.ru' || url.pathname !== '/editor-api/v3/publications'
            || url.username || url.password || url.searchParams.get('state') !== frame.state) {
            stopReason = 'ROUTE_INVALID'; return;
        }
        if (!Number.isInteger(frame.status) || frame.status < 100 || frame.status > 599) { stopReason = 'STATUS_INVALID'; return; }
        try {
            if (Buffer.byteLength(JSON.stringify(frame.payload) || '', 'utf8') > 2 * 1024 * 1024) {
                stopReason = 'RESPONSE_LIMIT'; return;
            }
        } catch { stopReason = 'PAYLOAD_INVALID'; return; }
        const root = record(frame.payload);
        const count = collections.reduce((n, key) => n + (Array.isArray(root[key]) ? root[key].length : 0), 0);
        // Conservative diagnostic row budget: unknown native identities cannot justify deduplicating the bound.
        if (rowCount + count > 1000) { stopReason = 'OBJECT_LIMIT'; return; }
        rowCount += count; statePages[frame.state]++;
        const shapes: Record<string, unknown> = {};
        for (const key of collections) {
            if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
            const values = root[key];
            shapes[key] = { type: type(values), ...(Array.isArray(values) ? {
                count: values.length, rows: values.map((value: unknown) => {
                    const row = record(value); const id = row.id;
                    let candidateRef: string | null = null;
                    if ((typeof id === 'string' && id.length > 0 && id.length <= 256)
                        || (typeof id === 'number' && Number.isSafeInteger(id))) {
                        const token = `${typeof id}:${id}`;
                        if (!candidates.has(token)) candidates.set(token, `candidate_${candidates.size + 1}`);
                        candidateRef = candidates.get(token) || null;
                    }
                    return { row_type: type(value), fields: rowFields.filter(name => name in row)
                        .map(name => ({ name, type: type(row[name]) })), candidate_ref: candidateRef,
                        identity_field_basis: candidateRef ? 'unverified_id_candidate' : 'not_observed',
                        title_present: typeof row.title === 'string' && Boolean(row.title.trim()),
                        title_matches_target: typeof row.title === 'string' && targetTitle !== undefined ? row.title === targetTitle : null,
                        ownership_verified: false };
                }) } : {}) };
        }
        pages.push({ state: frame.state, page: frame.page, status: frame.status,
            path: '/editor-api/v3/publications', pagination_shape: describeDzen1002Pagination(frame.payload, frame.url), collections: shapes });
        if (frame.status !== 200) stopReason = 'HTTP_ERROR';
    }
    function report(): NativeCaptureReport {
        return { mode: 'diagnostic_only', basis: 'observed_response_shape', stop_reason: stopReason,
            coverage_verified: false, native_end_rule_verified: false, provider_identity_verified: false,
            observed_rows: rowCount, unique_id_candidates: candidates.size,
            pages: structuredClone(pages) };
    }
    return { observe, report };
}
