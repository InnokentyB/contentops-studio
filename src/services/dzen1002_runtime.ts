import { z } from 'zod';
import { DZEN1002_MANIFEST } from './dzen_task1002_manifest';
import type { Dzen1002Args, Dzen1002Package, Dzen1002Claim, Dzen1002Receipt, Dzen1002Result } from './dzen1002_runtime_contract';
import type { Dzen1002Action } from './dzen1002_action_restriction';

const command = z.object({ projectId: z.literal(10), taskId: z.literal(1002),
    actorId: z.string().regex(/^user:[1-9]\d*$/), expectedManifestChecksum: z.literal(DZEN1002_MANIFEST),
    idempotencyKey: z.string().trim().min(1).max(200), dryRun: z.boolean().optional().default(true) }).strict();
const reconciliation = command.omit({ dryRun: true }).extend({ attemptId: z.number().int().positive() }).strict();

/** Internal dependency boundary. Ports are never accepted from MCP/config/HTTP callers. */
export interface Dzen1002RuntimePorts {
    authorize(operation: Dzen1002Action): void;
    replay(a: Dzen1002Args): Promise<Dzen1002Result | null>;
    inspect(a: Dzen1002Args): Promise<Dzen1002Package>;
    claim(a: Dzen1002Args): Promise<Dzen1002Claim>;
    start(a: Dzen1002Args, claim: Dzen1002Claim): Promise<void>;
    assertSubmit(a: Dzen1002Args, claim: Dzen1002Claim): Promise<void>;
    publish(claim: Dzen1002Claim, hooks: { beforeMutation(): Promise<void>; beforeSubmit(): Promise<void> }): Promise<Dzen1002Receipt>;
    saveReceipt(a: Dzen1002Args, claim: Dzen1002Claim, receipt: Dzen1002Receipt): Promise<void>;
    confirm(a: Dzen1002Args, claim: Dzen1002Claim): Promise<Dzen1002Result>;
    loadClaim(a: Dzen1002Args, id: number): Promise<Dzen1002Claim>;
    uncertain(a: Dzen1002Args, claim: Dzen1002Claim): Promise<void>;
}
function frozen(attemptId: number): Dzen1002Result {
    return { mode: 'verification_required', task_id: 1002, attempt_id: attemptId, retry_allowed: false };
}
/** Execute one bounded command; only a fresh committed claim/start can reach native mutation. */
export async function executeDzen1002(input: unknown, ports: Dzen1002RuntimePorts): Promise<Dzen1002Result> {
    const a = command.parse(input);
    const prior = await ports.replay(a); // Authenticated owner/current manifest even on cached replay.
    if (a.dryRun) {
        if (prior) return prior;
        await ports.inspect(a);
        return { mode: 'dry_run', task_id: 1002, retry_allowed: false };
    }
    ports.authorize('publish'); // Stored proof, manifest and owner release do not grant native permission.
    if (prior) return prior;
    const claim = await ports.claim(a);
    let started = false; let submitChecked = false;
    try {
        const receipt = await ports.publish(claim, {
            beforeMutation: async () => {
                if (started) throw new Error('[DZEN1002_START_ALREADY_CONSUMED]');
                await ports.start(a, claim); started = true;
            },
            beforeSubmit: async () => {
                if (!started || submitChecked) throw new Error('[DZEN1002_SUBMIT_FENCE_INVALID]');
                await ports.assertSubmit(a, claim); submitChecked = true;
            }
        });
        if (!started || !submitChecked) throw new Error('[DZEN1002_NATIVE_FENCE_MISSING]');
        await ports.saveReceipt(a, claim, receipt);
        return await ports.confirm(a, claim);
    } catch {
        // The claim/start/receipt already survives a failure of this best-effort marker.
        try { await ports.uncertain(a, claim); }
        catch { return frozen(claim.attemptId); } // Explicit fail-closed result, no raw provider error.
        return frozen(claim.attemptId);
    }
}
/** DB-only completion of one original attempt. Never claims, obtains sessions or dispatches. */
export async function reconcileDzen1002(input: unknown, ports: Dzen1002RuntimePorts): Promise<Dzen1002Result> {
    // Reconciliation has no dryRun/transport option and cannot trigger native work.
    const a = reconciliation.parse(input);
    const claim = await ports.loadClaim(a, a.attemptId);
    try { return await ports.confirm(a, claim); }
    catch { return frozen(claim.attemptId); }
}
