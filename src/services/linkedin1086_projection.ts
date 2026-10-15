import { createHash } from 'node:crypto';
import { LINKEDIN1086 as p } from './linkedin1086_contract';
function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** Preserve only an audited exact1086 metadata projection across prepare/readback. */
export function preserve1086Handoff<T extends Record<string, unknown>>(bundle: T, metadata: unknown): T {
    const q = object(metadata);
    if (object(bundle.task).content_item_id !== 1086 || q.linkedin1086_metadata_repair !== p.body) return bundle;
    const body = object(bundle.publication).body;
    if (typeof body !== 'string' || createHash('sha256').update(body).digest('hex') !== p.body) {
        throw new Error('[LINKEDIN1086_PROJECTION_BODY_MISMATCH]');
    }
    return { ...bundle, mode: 'manual', content_language: 'en',
        task: { ...object(bundle.task), account_ref: p.profile } };
}
