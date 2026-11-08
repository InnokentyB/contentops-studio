/** Only non-authoritative generation preferences. Never cache credential or lifecycle keys. */
const roles = ['multi_agent_post_creator', 'multi_agent_post_critic', 'multi_agent_post_fixer',
    'multi_agent_topic_creator', 'multi_agent_topic_critic', 'multi_agent_topic_fixer',
    'visual_architect', 'structural_critic', 'precision_fixer', 'image_critic'];
const allowed = new Set(roles.flatMap(role => [role + '_prompt', role + '_model']));
export const isCacheableSetting = (key: string) => allowed.has(key);
type Setting = { value: string } | null;
type Entry<T> = { expires: number; result?: T; pending?: Promise<T> };
/** Process-local, one-hour expiration. Invalidate only after committed writes. */
export function createSettingsCache<T extends Setting>(
    load: (projectId: number, key: string) => Promise<T>,
    now: () => number = Date.now, capacity = 1000
) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) throw new Error('Invalid settings cache capacity');
    const entries = new Map<string, Entry<T>>();
    const cacheKey = (projectId: number, key: string) => JSON.stringify([projectId, key]);
    async function read(projectId: number, key: string, fresh = false): Promise<T> {
        if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error('Invalid settings project');
        if (fresh || !allowed.has(key)) return load(projectId, key);
        const id = cacheKey(projectId, key);
        let entry = entries.get(id);
        if (entry && !entry.pending && entry.expires <= now()) { entries.delete(id); entry = undefined; }
        if (!entry) {
            if (entries.size >= capacity) {
                const victim = [...entries].find(([, candidate]) => !candidate.pending);
                // Never evict a load whose invalidation fence still has waiting callers.
                if (!victim) return load(projectId, key);
                entries.delete(victim[0]);
            }
            entry = { expires: now() + 3600000 };
            entries.set(id, entry);
            const current = entry;
            current.pending = Promise.resolve().then(() => load(projectId, key));
            try {
                const result = await current.pending;
                if (entries.get(id) !== current) return read(projectId, key);
                current.result = structuredClone(result);
                current.pending = undefined;
                return structuredClone(result);
            } catch (error) {
                if (entries.get(id) === current) entries.delete(id);
                throw error;
            }
        }
        if (entry.pending) {
            const result = await entry.pending;
            if (entries.get(id) !== entry) return read(projectId, key);
            return structuredClone(result);
        }
        return structuredClone(entry.result!);
    }
    return { read, clear() { entries.clear(); }, invalidate(projectId: number, key: string) { entries.delete(cacheKey(projectId, key)); } };
}
