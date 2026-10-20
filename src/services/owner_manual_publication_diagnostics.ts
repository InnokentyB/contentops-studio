import type { PublicationDiagnostic } from './publication_diagnostics';

const catalog: Record<string, readonly [string, string, string]> = {
    MANUAL_PUBLICATION_TRANSPORT_PRESERVED: ['publication_history',
        'The Owner recorded an existing external object; prior transport remains unresolved and immutable.',
        'Read the canonical manual fact and its Owner confirmation audit. Do not retry, adopt, finalize or resend the previous transport. A correction requires a fresh Owner preview.'],
    MANUAL_PUBLICATION_OBJECT_CONFLICT: ['external_object',
        'This external object already belongs to another task Owner confirmation.',
        'Read the existing canonical manual fact with the Owner and correct the selected task or object. Do not reassign the object, create another confirmation or resend it.'],
    MANUAL_PUBLICATION_POLICY_INVALID: ['confirmation_authority',
        'The requested write mixes incompatible confirmation authorities or lacks a valid internal Owner policy.',
        'Use the authenticated Owner manual preview and confirmation commands. Ask engineering to repair the integration; never add bypass flags, actor fields or transport completion proof.'],
    MANUAL_PUBLICATION_POLICY_REQUIRED: ['confirmation_authority',
        'The reserved Owner provenance marker requires the authenticated manual confirmation lifecycle.',
        'Use the current project Owner profile to preview and confirm the existing external object. Do not submit reserved provenance through a generic fact writer or fabricate transport success.']
};

/** A reviewed exact prefix selects static text; raw exception text never leaves this boundary. */
export function ownerManualPreservationDiagnostic(error: unknown): PublicationDiagnostic | undefined {
    const code = error instanceof Error ? /^\[(MANUAL_PUBLICATION_[A-Z_]+)\](?:\s|$)/.exec(error.message)?.[1] : undefined;
    if (!code || !Object.prototype.hasOwnProperty.call(catalog, code)) return undefined;
    const [field, message, action] = catalog[code]!;
    return { code, message, reasons: [{ code, field, message, action }], retry_allowed: false };
}
