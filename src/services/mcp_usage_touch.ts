/** Operational last-use timestamps are coarse; this is never an authorization cache. */
export function createMcpUsageTouch(now: () => number = Date.now) {
    const recent = new Map<number, { expires: number; pending?: Promise<void> }>();
    return async (id: number, write: () => Promise<unknown>): Promise<void> => {
        const existing = recent.get(id);
        if (existing && existing.expires > now()) { await existing.pending; return; }
        if (recent.size >= 1000) recent.delete(recent.keys().next().value!);
        const entry = { expires: now() + 60000, pending: undefined as Promise<void> | undefined };
        recent.set(id, entry);
        entry.pending = Promise.resolve().then(write).then(() => undefined);
        try { await entry.pending; entry.pending = undefined; }
        catch (error) { if (recent.get(id) === entry) recent.delete(id); throw error; }
    };
}
