"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonBytes = jsonBytes;
exports.textBytes = textBytes;
exports.logEgressDiagnostic = logEgressDiagnostic;
function isEnabled() {
    return process.env.EGRESS_DIAGNOSTICS_ENABLED !== 'false';
}
function sanitizeValue(value) {
    if (value === null || value === undefined || value === '')
        return '-';
    return String(value).replace(/\s+/g, ' ').trim();
}
function jsonBytes(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    }
    catch {
        return -1;
    }
}
function textBytes(value) {
    if (typeof value !== 'string' || !value.length)
        return 0;
    return Buffer.byteLength(value, 'utf8');
}
function logEgressDiagnostic(scope, details) {
    if (!isEnabled())
        return;
    const parts = Object.entries(details).map(([key, value]) => `${key}=${sanitizeValue(value)}`);
    console.log(`[EgressDiag] ${scope} ${parts.join(' ')}`);
}
