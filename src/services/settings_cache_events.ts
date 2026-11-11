import type { Prisma, PrismaClient } from '@prisma/client';
import { isCacheableSetting } from './settings_cache';
export const SETTINGS_CACHE_EVENT = 'settings.cache_invalidation.v1';
export type SettingsOperation = { id: number; projectId: number; key: string; operationId: string; phase: 'prepared' | 'committed' };
export const CACHE_GLOBAL_LOCK = 71063001;
export class SettingsCacheSyncError extends Error {
    readonly code = 'SETTINGS_CACHE_SYNC_UNAVAILABLE';
    constructor() { super('Settings were not saved: cache synchronization is unavailable. Check Redis connectivity for web and MCP, then retry.'); }
}
export class SettingsSavedCacheSyncPendingError extends Error {
    readonly code = 'SETTINGS_SAVED_CACHE_SYNC_PENDING';
    constructor() { super('SETTINGS_SAVED_CACHE_SYNC_PENDING: settings were saved. Do not repeat the save blindly; check Redis and the invalidation ledger. Reads bypass pending cache entries.'); }
}
function operation(row: {id: number; project_id: number; payload: Prisma.JsonValue}): SettingsOperation {
    const p = row.payload;
    if (!p || Array.isArray(p) || typeof p !== 'object' ||
        typeof p.key !== 'string' || !isCacheableSetting(p.key) ||
        typeof p.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(p.operationId) ||
        (p.phase !== 'prepared' && p.phase !== 'committed')) throw new Error('SETTINGS_CACHE_EVENT_INVALID: inspect the private invalidation ledger');
    return {id: row.id, projectId: row.project_id, key: p.key, operationId: p.operationId, phase: p.phase};
}
const select = { id: true, project_id: true, payload: true } as const;
export function createSettingsEventStore(db: PrismaClient) {
    const transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
        db.$transaction(fn, {timeout: 5000, maxWait: 3000});
    async function sharedLock(tx: Prisma.TransactionClient) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(${CACHE_GLOBAL_LOCK}::bigint)::text`;
    }
    async function keyLock(tx: Prisma.TransactionClient, p: number, key: string) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(71063002,hashtext(${'settings:'+p+':'+key}))::text`;
    }
    return {
        async prepare(projectId: number, key: string, operationId: string) {
            return db.outboxEvent.create({data: {project_id: projectId, event_type: SETTINGS_CACHE_EVENT,
                payload: {key, operationId, phase: 'prepared'}}, select});
        },
        async bootstrap(install: (pending: SettingsOperation[]) => Promise<void>) {
            return transaction(async tx => {
                await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CACHE_GLOBAL_LOCK}::bigint)::text`;
                const rows = await tx.outboxEvent.findMany({where: {event_type: SETTINGS_CACHE_EVENT, status:'pending'}, take:1001, select});
                if (rows.length > 1000) throw new Error('SETTINGS_CACHE_BACKLOG: drain invalidation events before enabling cache');
                await install(rows.map(operation));
            });
        },
        async commit<T>(event: SettingsOperation, checkBarrier: () => Promise<void>, write: (tx: Prisma.TransactionClient) => Promise<T>) {
            return transaction(async tx => {
                await sharedLock(tx); await keyLock(tx, event.projectId, event.key);
                const current = await tx.outboxEvent.findUniqueOrThrow({where: {id:event.id}});
                const bound=operation(current);
                if (current.status !== 'pending' || bound.phase !== 'prepared' || bound.projectId !== event.projectId ||
                    bound.key !== event.key || bound.operationId !== event.operationId) throw new SettingsCacheSyncError();
                await checkBarrier();
                const result = await write(tx);
                await tx.outboxEvent.update({where: {id:event.id}, data: {payload: {key:event.key,operationId:event.operationId,phase:'committed'}}});
                return result;
            });
        },
        async finish(event: SettingsOperation, invalidate: () => Promise<void>, abort = false) {
            return transaction(async tx => {
                await sharedLock(tx); await keyLock(tx, event.projectId, event.key);
                const row = await tx.outboxEvent.findUnique({where: {id:event.id}});
                if (!row || row.status !== 'pending') { await invalidate(); return; }
                const current = operation(row);
                if (current.phase === 'prepared' && !abort && row.created_at.getTime() > Date.now()-30000) return;
                await invalidate();
                await tx.outboxEvent.update({where: {id:row.id}, data: {status:'delivered'}});
            });
        },
        async pending() {
            const rows = await db.outboxEvent.findMany({where:{event_type:SETTINGS_CACHE_EVENT,status:'pending'},orderBy:{id:'asc'},take:100,select});
            return rows.map(operation);
        },
        decode: operation
    };
}
