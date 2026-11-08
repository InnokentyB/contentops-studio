import Redis from 'ioredis';
import { createHash, randomUUID } from 'crypto';
import { isCacheableSetting } from './settings_cache';
import type { SettingsOperation } from './settings_cache_events';
function databaseNamespace(value: string | undefined): string | null {
    try {
        if (!value) return null;
        const url=new URL(value);
        if (!['postgres:','postgresql:'].includes(url.protocol)) return null;
        return createHash('sha256').update(JSON.stringify([url.hostname,url.port||'5432',
            decodeURIComponent(url.pathname),decodeURIComponent(url.username)])).digest('hex');
    } catch { return null; } // Invalid binding disables coordination, never shares an unrelated DB namespace.
}
export function settingsRedisUrl(): string | null {
    if (process.env.REDIS_URL) return process.env.REDIS_URL;
    if (!process.env.REDISHOST) return null;
    const user = encodeURIComponent(process.env.REDISUSER || 'default');
    const password = encodeURIComponent(process.env.REDISPASSWORD || '');
    return 'redis://'+(password ? user+':'+password+'@' : '')+process.env.REDISHOST+':'+(process.env.REDISPORT || '6379');
}
/** Dedicated lazy connection; never imports queues or starts publication consumers. */
export function createSettingsRedis(url: string | null, databaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL) {
    const namespace=databaseNamespace(databaseUrl);
    const ROOT='contentops:settings-cache:v1:'+namespace+':', READY=ROOT+'ready';
    function prefix(projectId: number, key: string) {
        if (!Number.isSafeInteger(projectId) || projectId<1 || !isCacheableSetting(key)) throw new Error('Invalid cache scope');
        return ROOT+projectId+':'+key;
    }
    const client = url && namespace ? new Redis(url, {lazyConnect:true, enableOfflineQueue:false, maxRetriesPerRequest:0,
        connectTimeout:1000, commandTimeout:1000, retryStrategy:()=>null}) : null;
    // Errors are handled by the caller's bypass/refusal contract; never print Redis URLs.
    let lastWarning = 0;
    client?.on('error', () => {
        if (Date.now()-lastWarning > 30000) {
            lastWarning=Date.now();
            console.warn('[Settings cache] Redis unavailable; bypass cache and check Redis connectivity.');
        }
    });
    let connecting: Promise<void> | null = null;
    async function connection() {
        if (!client) throw new Error('SETTINGS_REDIS_NOT_CONFIGURED');
        if (client.status !== 'ready') {
            if (!connecting) connecting = client.connect().finally(()=>{connecting=null;});
            await connecting;
        }
        return client;
    }
    async function run(script: string, keys: string[], values: string[] = []) {
        const c = await connection();
        return c.eval(script, keys.length, ...keys, ...values);
    }
    return {
        async ready() {
            const c = await connection(); return c.get(READY);
        },
        async install(pending: SettingsOperation[]) {
            const keys = [READY]; const args: string[] = [randomUUID()];
            for (const e of pending) {
                keys.push(prefix(e.projectId,e.key)+':writers',prefix(e.projectId,e.key)+':version');
                args.push(e.operationId,randomUUID());
            }
            await run(`if redis.call('GET',KEYS[1]) then return 1 end
                for i=2,#KEYS,2 do redis.call('SADD',KEYS[i],ARGV[i]);redis.call('SET',KEYS[i+1],ARGV[i+1]) end
                redis.call('SET',KEYS[1],ARGV[1]);return 1`, keys, args);
        },
        async state(projectId: number, key: string) {
            const p = prefix(projectId,key);
            const result = await run(`local boot=redis.call('GET',KEYS[1]);if not boot then return nil end
                redis.call('SETNX',KEYS[2],ARGV[1]);return {boot..':'..redis.call('GET',KEYS[2]),redis.call('SCARD',KEYS[3])}`,
                [READY,p+':version',p+':writers'],[randomUUID()]);
            if (!Array.isArray(result) || typeof result[0] !== 'string' || typeof result[1] !== 'number') throw new Error('SETTINGS_CACHE_NOT_READY');
            return {version:result[0],blocked:result[1]>0};
        },
        async begin(e: SettingsOperation) {
            const p = prefix(e.projectId,e.key);
            const boot = await run(`local boot=redis.call('GET',KEYS[1]);if not boot then return nil end
                if redis.call('SCARD',KEYS[2])>=64 then return nil end
                redis.call('SADD',KEYS[2],ARGV[1]);redis.call('SET',KEYS[3],ARGV[2]);return boot`,
                [READY,p+':writers',p+':version'],[e.operationId,randomUUID()]);
            if (typeof boot !== 'string') throw new Error('SETTINGS_CACHE_BARRIER_UNAVAILABLE');
            return boot;
        },
        async verify(e: SettingsOperation, boot: string) {
            const p = prefix(e.projectId,e.key);
            const valid = await run(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
                return redis.call('SISMEMBER',KEYS[2],ARGV[2])`,[READY,p+':writers'],[boot,e.operationId]);
            if (valid !== 1) throw new Error('SETTINGS_CACHE_BARRIER_LOST');
        },
        async finish(e: SettingsOperation) {
            const p = prefix(e.projectId,e.key);
            await run(`if not redis.call('GET',KEYS[1]) then return redis.error_reply('CACHE_NOT_READY') end
                redis.call('SREM',KEYS[2],ARGV[1]);redis.call('SET',KEYS[3],ARGV[2]);return 1`,
                [READY,p+':writers',p+':version'],[e.operationId,randomUUID()]);
        },
        async close() { client?.disconnect(); }
    };
}
