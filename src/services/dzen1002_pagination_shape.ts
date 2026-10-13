export type PaginationField = { name: string; type: string; value?: boolean | number; count?: number };
export type PaginationShape = { fields: PaginationField[]; nested: Record<string, PaginationField[]>;
    request: Record<string, number>; headers: Record<string, { type: string; values?: number[]; unit?: string }> };

const VALUES = new Set(['hasMore', 'has_more', 'hasNextPage', 'has_next_page', 'hasNext', 'has_next',
    'isLastPage', 'is_last_page', 'isLast', 'is_last', 'hasMorePublications', 'hasNextPublication',
    'total', 'totalCount', 'total_count', 'totalPages', 'total_pages',
    'pageCount', 'page_count', 'count', 'totalPublications', 'pageSize', 'page_size', 'limit', 'size',
    'offset', 'from', 'page', 'pageNumber', 'pageNum', 'nextOffset', 'next_offset', 'nextPage', 'next_page', 'nextFrom']);
const CURSORS = new Set(['cursor', 'nextCursor', 'next_cursor', 'continuationToken', 'nextContinuationToken', 'nextPageToken']);
const CONTAINERS = ['pagination', 'paging', 'pageInfo', 'page_info', 'page', 'paginationInfo'];

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function fields(value: unknown): PaginationField[] {
    return Object.entries(record(value)).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name)
        && (CURSORS.has(name) || !/cookie|secret|password|authorization|header|bearer|author|user|email|phone|profile|token|(^id$)/i.test(name)))
        .slice(0, 24).map(([name, item]) => {
            const field: PaginationField = { name, type: item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item };
            if (VALUES.has(name) && typeof item === 'boolean') field.value = item;
            if (VALUES.has(name) && typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 && item <= 10_000_000) field.value = item;
            if (VALUES.has(name) && typeof item === 'string' && /^\d{1,8}$/.test(item) && Number(item) <= 10_000_000) field.value = Number(item);
            if (VALUES.has(name) && (item === 'true' || item === 'false')) field.value = item === 'true';
            if ((name === 'publications' || name === 'drafts') && Array.isArray(item)) field.count = item.length;
            return field;
        });
}

/** Diagnostic projection only; a response shape is not evidence of exhaustive coverage. */
export function describeDzen1002Pagination(payload: unknown, url: string,
    headers: Record<string, string | undefined> = {}): PaginationShape {
    const root = record(payload);
    const shape: PaginationShape = { fields: fields(root), nested: {}, request: {}, headers: {} };
    for (const name of CONTAINERS) if (root[name] !== undefined) shape.nested[name] = fields(root[name]);
    try {
        const params = new URL(url).searchParams;
        for (const name of ['pageSize', 'page_size', 'limit', 'offset', 'from', 'page', 'pageNumber', 'pageNum']) {
            const value = params.get(name);
            if (value !== null && /^\d{1,8}$/.test(value) && Number(value) <= 10_000_000) shape.request[name] = Number(value);
        }
    } catch { shape.request = {}; } // Invalid routes never export their raw strings.
    for (const name of ['x-total-count', 'x-total', 'x-pagination-total-count', 'content-range', 'link']) {
        const raw = headers[name]; if (!raw) continue;
        const range = /^[A-Za-z]+ (\d+)-(\d+)\/(\d+)$/.exec(raw);
        if (/^\d{1,8}$/.test(raw) && Number(raw) <= 10_000_000) shape.headers[name] = { type: 'number', values: [Number(raw)] };
        else if (range && range.slice(1).every(n => Number(n) <= 10_000_000)) {
            const unit = raw.split(' ')[0].toLowerCase();
            shape.headers[name] = { type: 'range', unit: ['bytes', 'items', 'publications'].includes(unit) ? unit : 'other', values: range.slice(1).map(Number) };
        } else shape.headers[name] = { type: 'present' };
    }
    return shape;
}
