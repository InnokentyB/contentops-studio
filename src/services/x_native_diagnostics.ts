import { Prisma } from '@prisma/client';
import prisma from '../db';
import { requireBrowserOwner } from './browser_publication_contract';
import { nativeStateRequestSchema, NativeStateReadError, checkedNativeStateResponse,
    type NativeStateResponse } from './x_native_diagnostics_contract';
import { projectNativeBinding } from './x_native_diagnostics_binding';
import { projectNativeInventory } from './x_native_diagnostics_inventory';
import { readNativeStateScope, readNativeInventory, readNativeTaskState } from './x_native_diagnostics_query';

export type NativeStateReadDependencies = { db: Pick<typeof prisma, '$transaction'>; enabled(): boolean };
const defaults: NativeStateReadDependencies = { db: prisma, enabled: () => process.env.X_NATIVE_PILOT_ENABLED === 'true' };
let activeReads = 0;

/** Owner-bound, capped observational read. Never enrollment, admission or a provider callback. */
export async function getXNativeState(input: unknown, deps: NativeStateReadDependencies = defaults): Promise<NativeStateResponse> {
    if (!deps.enabled()) throw new NativeStateReadError('X_NATIVE_PILOT_DISABLED');
    const parsed = nativeStateRequestSchema.safeParse(input);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(input), 'utf8') > 512) throw new NativeStateReadError('X_NATIVE_STATE_INVALID_INPUT');
    if (activeReads >= 2) throw new NativeStateReadError('X_NATIVE_STATE_BUSY');
    activeReads++;
    const started = performance.now();
    try {
        const response = await deps.db.$transaction(async tx => {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
            await requireBrowserOwner(tx, parsed.data);
            const source = await readNativeStateScope(tx, parsed.data);
            const binding = projectNativeBinding(nativeBindingSourceSchemaData(source));
            const { inventory, warnings } = projectNativeInventory(await readNativeInventory(tx, parsed.data), parsed.data);
            const taskState = await readNativeTaskState(tx, parsed.data);
            if (binding.status === 'inconsistent') warnings.push('BINDING_INCONSISTENT');
            if (taskState.attemptPresent || taskState.browserWorkPresent || taskState.nonterminalDispatchJobPresent
                || taskState.publicationFactPresent || taskState.publishedLinkPresent || taskState.currentReleasePresent) warnings.push('TASK_DELIVERY_HISTORY');
            const { actorId: internalActor, ...scope } = parsed.data;
            return checkedNativeStateResponse({ schemaVersion: 1, scope, observedAt: source.observedAt.toISOString(),
                complete: inventory.complete && taskState.status === 'known', binding, installations: inventory, taskState,
                warnings: [...new Set(warnings)], effects: { mutatesState: false, providerCalled: false,
                    submissionPermitted: false, registrationAuthorized: false } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 1500, maxWait: 300 });
        if (performance.now() - started > 2000) throw new NativeStateReadError('X_NATIVE_STATE_TIMEOUT');
        return response;
    } finally { activeReads--; }
}

function nativeBindingSourceSchemaData(source: Awaited<ReturnType<typeof readNativeStateScope>>) {
    const { observedAt: internalTime, ...binding } = source;
    return binding;
}
