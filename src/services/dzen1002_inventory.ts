import { extractDzenStudioPublications, type DzenStudioPublication } from './puppeteer/dzen_dom_helpers';
import { describeDzen1002Pagination } from './dzen1002_pagination_shape';
import { Dzen1002ReadFailure, type Dzen1002ObservedResponse } from './dzen1002_read_failure';

export type InventoryState = 'published' | 'draft';
export type InventoryPage = { status: number; url: string; payload: unknown; paginationHeaders?: Record<string, string | undefined> };
export interface InventoryPort {
    first(state: InventoryState): Promise<InventoryPage>;
    next(url: string): Promise<InventoryPage>;
}
export type InventoryDiagnostic = { state: InventoryState; page: number; status: number | null;
    count: number; reason: string; path: '/editor-api/v3/publications';
    pagination_shape?: import('./dzen1002_pagination_shape').PaginationShape;
    native_contract_observation?: Record<string, unknown>;
    observed_responses?: Dzen1002ObservedResponse[] };
export type InventoryResult = { publications: DzenStudioPublication[]; complete: boolean;
    diagnostics: InventoryDiagnostic[] };

/** Task1002 read-only inventory seam; unknown evidence never proves absence. */
export async function enumerateDzen1002Inventory(port: InventoryPort,
    limits: { maxPages?: number; maxObjects?: number; budgetMs?: number; now?: () => number } = {}): Promise<InventoryResult> {
    const maxPages = limits.maxPages ?? 10; const maxObjects = limits.maxObjects ?? 1000;
    const budget = limits.budgetMs ?? 60_000; const now = limits.now ?? Date.now;
    if (![maxPages, maxObjects, budget].every(n => Number.isSafeInteger(n) && n > 0)
        || maxPages > 10 || maxObjects > 1000 || budget > 60_000) throw new Error('[DZEN1002_INVENTORY_LIMIT_INVALID]');
    const started = now(); const result: InventoryResult = { publications: [], complete: true, diagnostics: [] };
    for (const state of ['published', 'draft'] as const) {
        const seen = new Set<string>(); let target: string | undefined; let ended = false;
        for (let page = 1; page <= maxPages; page++) {
            const diagnostic: InventoryDiagnostic = { state, page, status: null, count: 0,
                reason: 'READ_FAILED', path: '/editor-api/v3/publications' };
            result.diagnostics.push(diagnostic);
            if (now() - started >= budget) { diagnostic.reason = 'TIME_LIMIT'; break; }
            let response: InventoryPage;
            try { response = await (target ? port.next(target) : port.first(state)); }
            catch (error: unknown) {
                if (error instanceof Dzen1002ReadFailure) {
                    diagnostic.reason = error.reason;
                    diagnostic.status = typeof error.status === 'number' && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
                    diagnostic.observed_responses = error.observedResponses.slice(0, 6);
                }
                break;
            } // Unknown raw provider errors stay READ_FAILED and never expose messages.
            diagnostic.status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
            if (page === 1) diagnostic.pagination_shape = describeDzen1002Pagination(response.payload, response.url, response.paginationHeaders);
            if (response.status !== 200) { diagnostic.reason = 'HTTP_ERROR'; break; }
            if (now() - started >= budget) { diagnostic.reason = 'TIME_LIMIT'; break; }
            let current: URL;
            try { current = new URL(response.url); }
            catch { diagnostic.reason = 'ROUTE_INVALID'; break; }
            if (current.origin !== 'https://dzen.ru' || current.pathname !== diagnostic.path
                || current.searchParams.get('state') !== state || current.username || current.password) {
                diagnostic.reason = 'ROUTE_INVALID'; break;
            }
            const root = record(response.payload);
            // Native pinned row schema/end semantics are not yet observed.
            // Never silently omit pinned objects from an exhaustive absence proof.
            if (Object.prototype.hasOwnProperty.call(root, 'pinedPublications')
                && (!Array.isArray(root.pinedPublications) || root.pinedPublications.length > 0)) {
                diagnostic.reason = 'PINNED_COLLECTION_UNVERIFIED'; break;
            }
            // Native Studio has separate collections. An explicit drafts field
            // wins even when malformed; never hide it behind empty publications.
            const collection = state === 'draft' && Object.prototype.hasOwnProperty.call(root, 'drafts') ? root.drafts : root.publications;
            const parsed = extractDzenStudioPublications({ ...root, publications: collection });
            if (!parsed) { diagnostic.reason = 'PAYLOAD_INVALID'; break; }
            diagnostic.count = parsed.publications.length;
            if (!parsed.title_readback_complete || parsed.publications.some(row => !row.provider_object_id || row.state !== state)) {
                diagnostic.reason = 'IDENTITY_TITLE_STATE_INCOMPLETE'; break;
            }
            let added = 0;
            for (const row of parsed.publications) {
                const id = row.provider_object_id!;
                if (seen.has(id)) continue;
                seen.add(id); added++; result.publications.push(row);
            }
            if (result.publications.length > maxObjects) { diagnostic.reason = 'OBJECT_LIMIT'; break; }
            const pagination = record(root.pagination);
            const more = [root.hasMore, root.has_more, pagination.hasMore, pagination.has_more].find(v => typeof v === 'boolean');
            const total = [root.total, root.totalCount, root.total_count, pagination.total, pagination.totalCount]
                .find((v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
            if ((total !== undefined && seen.size > total) || (more === false && total !== undefined && seen.size !== total)
                || (more === true && total !== undefined && seen.size >= total)) {
                diagnostic.reason = 'PAGINATION_CONFLICT'; break;
            }
            if (more === false || (total !== undefined && seen.size === total)) {
                diagnostic.reason = 'COMPLETE'; ended = true; break;
            }
            if (more === undefined && total === undefined) { diagnostic.reason = 'PAGINATION_UNKNOWN'; break; }
            if (page > 1 && added === 0) { diagnostic.reason = 'PAGINATION_NO_PROGRESS'; break; }
            if (page === maxPages) { diagnostic.reason = 'PAGE_LIMIT'; break; }
            const size = Number(current.searchParams.get('pageSize'));
            const key = ['offset', 'from', 'page', 'pageNumber', 'pageNum'].find(k => current.searchParams.has(k));
            if (!key || !Number.isSafeInteger(size) || size < 1 || size > 1000
                || ['cursor', 'nextCursor', 'next_cursor'].some(k => k in root || k in pagination || current.searchParams.has(k))) {
                diagnostic.reason = 'PAGINATION_ROUTE_UNKNOWN'; break;
            }
            const value = Number(current.searchParams.get(key));
            if (!Number.isSafeInteger(value) || value < 0) { diagnostic.reason = 'PAGINATION_ROUTE_UNKNOWN'; break; }
            current.searchParams.set(key, String(value + (key === 'offset' || key === 'from' ? size : 1)));
            target = current.toString(); diagnostic.reason = 'CONTINUE';
        }
        if (!ended) result.complete = false;
    }
    return result;
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
