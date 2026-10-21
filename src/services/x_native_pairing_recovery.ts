import { z } from 'zod';

/** Legacy input is validated only; new requests use repeatable ordinary pairing. */
export const pairingRecoverySchema = z.object({ phase: z.enum(['preview', 'authorize', 'apply', 'revoke']),
    predecessorNonce: z.string().regex(/^[a-f0-9]{64}$/), approvalReference: z.string().trim().min(10).max(500),
    grantId: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().superRefine((r, ctx) => {
    if (((r.phase === 'apply' || r.phase === 'revoke') && !r.grantId) || (r.phase === 'authorize' && r.grantId)) {
        ctx.addIssue({ code: 'custom', message: 'Apply/revoke requires grantId; authorize forbids it' });
    }
});
