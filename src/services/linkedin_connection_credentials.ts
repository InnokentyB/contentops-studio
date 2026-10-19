import { z } from 'zod';
import { decryptChannelSecret, encryptChannelSecret } from '../utils/channel_secrets';
export const linkedInConnectionMetadataSchema = z.object({ expiresAt: z.string().datetime(), scopes: z.array(z.string().regex(/^[A-Za-z0-9_]+$/)).max(100), memberUrn: z.string().regex(/^urn:li:person:[A-Za-z0-9_-]+$/), authorUrn: z.string().regex(/^urn:li:(person:[A-Za-z0-9_-]+|organization:[0-9]+)$/), accountKind: z.enum(['personal', 'organization']), clientId: z.string().min(1), verifiedAt: z.string().datetime(), organizationAuthorized: z.boolean(), imageReadAuthorized: z.boolean(), postReadAuthorized: z.boolean() }).strict();
export type LinkedInConnectionMetadata = z.infer<typeof linkedInConnectionMetadataSchema>;
const envelopeSchema = z.object({ version: z.literal(1), provider: z.literal('linkedin'), projectId: z.number().int().positive(), channelId: z.number().int().positive(), token: z.string().min(1), metadata: linkedInConnectionMetadataSchema }).strict();
export function sealLinkedInCredentials(token: string, metadata: LinkedInConnectionMetadata, binding: {
    projectId: number;
    channelId: number;
}): string { return encryptChannelSecret(JSON.stringify(envelopeSchema.parse({ version: 1, provider: 'linkedin', ...binding, token, metadata }))); }
/** Compatibility readers extract tokens in memory. JSON envelope is never returned to legacy publishers or logs. */
export function decryptLinkedInToken(ciphertext: string): string { const plaintext = decryptChannelSecret(ciphertext); if (!plaintext.startsWith('{'))
    return plaintext; return envelopeSchema.parse(JSON.parse(plaintext)).token; }
/** Verification requires AEAD-authenticated metadata and exact tenant/channel; editable config is never grant evidence. */
export function resolveLinkedInCredentials(input: unknown, expected?: {
    projectId: number;
    channelId: number;
}): {
    token: string;
    metadata: LinkedInConnectionMetadata | null;
    verified: boolean;
} {
    const config = z.record(z.string(), z.unknown()).parse(input);
    if (typeof config.access_token_encrypted !== 'string')
        return { token: typeof config.access_token === 'string' ? config.access_token : '', metadata: null, verified: false };
    const plaintext = decryptChannelSecret(config.access_token_encrypted);
    if (!plaintext.startsWith('{'))
        return { token: plaintext, metadata: null, verified: false };
    const envelope = envelopeSchema.parse(JSON.parse(plaintext)), metadata = envelope.metadata;
    const outer = linkedInConnectionMetadataSchema.safeParse(config.linkedin_oauth);
    const exact = outer.success && JSON.stringify(outer.data) === JSON.stringify(metadata) && metadata.authorUrn === config.linkedin_urn && Boolean(expected && expected.projectId === envelope.projectId && expected.channelId === envelope.channelId);
    return { token: envelope.token, metadata: exact ? metadata : null, verified: Boolean(exact && new Date(metadata.expiresAt).getTime() > Date.now()) };
}
