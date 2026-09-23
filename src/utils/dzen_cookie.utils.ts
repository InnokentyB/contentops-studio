const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

type StoredCookie = {
    name?: unknown;
    value?: unknown;
    domain?: unknown;
};

function isDzenDomain(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const domain = value.trim().toLowerCase().replace(/^\.+/, '');
    return domain === 'dzen.ru' || domain.endsWith('.dzen.ru');
}

/**
 * Convert a browser-exported cookie array into a request Cookie header.
 * Cookie values are deliberately kept local to this function and must never be logged.
 */
export function normalizeDzenCookieHeader(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (!trimmed.startsWith('[')) return trimmed;

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        throw new Error('Dzen cookies JSON is invalid');
    }
    if (!Array.isArray(parsed)) throw new Error('Dzen cookies JSON must be an array');

    const byName = new Map<string, string>();
    for (const candidate of parsed as StoredCookie[]) {
        if (!candidate || typeof candidate !== 'object' || !isDzenDomain(candidate.domain)) continue;
        if (typeof candidate.name !== 'string' || !COOKIE_NAME.test(candidate.name)) continue;
        if (typeof candidate.value !== 'string' || candidate.value.length === 0) continue;
        if (/[;\r\n\x00-\x1f\x7f]/.test(candidate.value)) continue;
        byName.set(candidate.name, candidate.value);
    }

    const header = Array.from(byName, ([name, value]) => `${name}=${value}`).join('; ');
    if (!header) throw new Error('No valid dzen.ru cookies were found');
    return header;
}
