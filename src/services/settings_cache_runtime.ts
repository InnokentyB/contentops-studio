import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createSettingsEventStore, SettingsCacheSyncError, SettingsSavedCacheSyncPendingError } from './settings_cache_events';
import { createSettingsRedis } from './settings_cache_redis';
import { isCacheableSetting } from './settings_cache';
import { createCoordinatedSettingsReader } from './coordinated_settings_reader';
export function createSettingsCacheRuntime(db: PrismaClient, redis: ReturnType<typeof createSettingsRedis>, options = {cacheEnabled:true}) {
    const store = createSettingsEventStore(db);
    let bootstrap: Promise<void> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let running: Promise<void> | null = null;
    let closing = false, lastWarning = 0;
    function warning() {
        if (Date.now()-lastWarning < 30000) return;
        lastWarning=Date.now();
        console.warn('[Settings cache] Synchronization pending; reads use PostgreSQL. Check Redis connectivity and pending settings invalidation events.');
    }
    async function ensure() {
        if (closing) throw new SettingsCacheSyncError();
        if (await redis.ready()) return;
        if (!bootstrap) bootstrap = store.bootstrap(async pending => {
            if (!await redis.ready()) await redis.install(pending);
        }).finally(()=>{bootstrap=null;});
        await bootstrap;
    }
    function deliver(): Promise<void> {
        if (running || closing) return running || Promise.resolve();
        running=(async()=>{
            try {
                await ensure();
                for (const e of await store.pending()) {
                    if (closing) break;
                    await store.finish(e,()=>redis.finish(e));
                }
            } catch { warning(); } // Durable events/barriers remain pending, never acknowledged on failure.
        })().finally(()=>{running=null;});
        return running;
    }
    function start() {
        if (!timer && !closing) { timer=setInterval(()=>{void deliver();},5000); timer.unref(); }
    }
    const reader = createCoordinatedSettingsReader(
        (projectId,key)=>db.projectSettings.findUnique({where:{project_id_key:{project_id:projectId,key}},select:{value:true}}),
        {async state(projectId,key) {
            start();
            try { return await redis.state(projectId,key); }
            catch (error) {
                if (!(error instanceof Error) || error.message !== 'SETTINGS_CACHE_NOT_READY') throw error;
                await ensure(); return redis.state(projectId,key);
            }
        }}
    );
    return {
        read: options.cacheEnabled ? reader.read : (projectId: number, key: string) =>
            db.projectSettings.findUnique({where:{project_id_key:{project_id:projectId,key}},select:{value:true}}),
        invalidate: reader.invalidate,
        async write<T>(projectId: number, key: string, write: (tx: Prisma.TransactionClient)=>Promise<T>): Promise<T> {
            if (!isCacheableSetting(key)) return write(db);
            start();
            try { await ensure(); } catch { throw new SettingsCacheSyncError(); }
            const row = await store.prepare(projectId,key,randomUUID());
            const e = store.decode(row);
            let result: T;
            try {
                result=await store.commit(e,async()=>{
                    try { const boot=await redis.begin(e); await redis.verify(e,boot); }
                    catch { throw new SettingsCacheSyncError(); }
                },write);
            } catch (error) {
                try { await ensure(); await store.finish(e,()=>redis.finish(e),true); } catch { warning(); }
                reader.invalidate(projectId,key);
                throw error;
            }
            reader.invalidate(projectId,key);
            try { await ensure(); await store.finish(e,()=>redis.finish(e)); }
            catch {
                warning();
                throw new SettingsSavedCacheSyncPendingError();
            }
            return result;
        },
        deliver,
        async close() {
            closing=true;
            if (timer) clearInterval(timer);
            await running;
            await redis.close();
        }
    };
}
