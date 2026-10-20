import type { Prisma } from '@prisma/client';

const marker: unique symbol = Symbol('owner-manual-fact-policy');
export type OwnerManualFactPolicy = Readonly<{ [marker]: true }>;
type Hooks = {
    beforeWrite(tx: Prisma.TransactionClient): Promise<void>;
    afterWrite(tx: Prisma.TransactionClient, factId: number): Promise<void>;
    beforeCommit(tx: Prisma.TransactionClient): Promise<void>;
};
const capabilities = new WeakMap<OwnerManualFactPolicy, Readonly<Hooks>>();

/** Internal composition capability; JSON/RPC data cannot construct an authorization policy. */
export function createOwnerManualFactPolicy(hooks: Hooks): OwnerManualFactPolicy {
    const policy = Object.freeze({ [marker]: true as const });
    capabilities.set(policy, Object.freeze({ ...hooks }));
    return policy;
}

export function ownerManualFactPolicy(policy: OwnerManualFactPolicy | undefined): Readonly<Hooks> | null {
    if (policy === undefined) return null;
    const hooks = capabilities.get(policy);
    if (!hooks) throw new Error('[MANUAL_PUBLICATION_POLICY_INVALID] Use the authenticated Owner confirmation command.');
    return hooks;
}
