import { createSettingsCache, isCacheableSetting } from './settings_cache';
export type CacheState = { version: string; blocked: boolean };
export interface SettingsStatePort { state(projectId: number, key: string): Promise<CacheState>; }
/** Shared revision checks surround local cached reads; Redis failures fall back to the DB. */
export function createCoordinatedSettingsReader<T extends {value: string} | null>(
    load: (projectId: number, key: string) => Promise<T>, port: SettingsStatePort
) {
    const cache = createSettingsCache(load);
    const versions = new Map<string, string>();
    function invalidate(projectId: number, key: string) {
        cache.invalidate(projectId, key); versions.delete(JSON.stringify([projectId, key]));
    }
    async function state(projectId: number, key: string) {
        try { return await port.state(projectId, key); }
        catch { cache.clear(); versions.clear(); return null; } // Uncertain coordination never authorizes a cache hit.
    }
    return {
        invalidate,
        async read(projectId: number, key: string, fresh = false): Promise<T> {
            if (fresh || !isCacheableSetting(key)) return load(projectId, key);
            const before = await state(projectId, key);
            if (!before || before.blocked) { invalidate(projectId, key); return load(projectId, key); }
            const id = JSON.stringify([projectId, key]);
            if (versions.get(id) !== before.version) cache.invalidate(projectId, key);
            if (versions.size >= 1000 && !versions.has(id)) return load(projectId,key);
            versions.set(id, before.version);
            const result = await cache.read(projectId, key);
            const after = await state(projectId, key);
            if (!after || after.blocked || after.version !== before.version) {
                invalidate(projectId, key); return load(projectId, key);
            }
            return result;
        }
    };
}
