type DiagnosticValue = string | number | boolean | null | undefined;

function isEnabled() {
    return process.env.EGRESS_DIAGNOSTICS_ENABLED !== 'false';
}

function sanitizeValue(value: DiagnosticValue) {
    if (value === null || value === undefined || value === '') return '-';
    return String(value).replace(/\s+/g, ' ').trim();
}

export function jsonBytes(value: unknown) {
    try {
        return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    } catch {
        return -1;
    }
}

export function textBytes(value?: string | null) {
    if (typeof value !== 'string' || !value.length) return 0;
    return Buffer.byteLength(value, 'utf8');
}

export function logEgressDiagnostic(scope: string, details: Record<string, DiagnosticValue>) {
    if (!isEnabled()) return;

    const parts = Object.entries(details).map(([key, value]) => `${key}=${sanitizeValue(value)}`);
    console.log(`[EgressDiag] ${scope} ${parts.join(' ')}`);
}
