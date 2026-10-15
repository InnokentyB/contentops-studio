import { threads1114ArgsSchema, assertThreads1114Snapshot, THREADS1114 as p } from './threads1114_contract';
export type Threads1114Request = { projectId: number; taskId: number; actorId: string; expectedManifestChecksum: string;
    approvalReference: string; idempotencyKey: string; dryRun?: boolean };
export type Threads1114Result = { id: string; url: string; publishedAt: string };
export type Threads1114Ports = {
    replay(args: Threads1114Request, operation: 'release' | 'send'): Promise<Record<string, unknown> | null>;
    inspect(args: Threads1114Request, released: boolean): Promise<{ snapshot: unknown; credentialReady: boolean; releaseValid: boolean }>;
    preflight(): Promise<void>; release(args: Threads1114Request): Promise<Record<string, unknown>>;
    claim(args: Threads1114Request): Promise<{ id: number; body: string }>;
    assertDispatch(args: Threads1114Request, id: number): Promise<void>;
    publish(body: string): Promise<Threads1114Result>;
    confirm(args: Threads1114Request, id: number, result: Threads1114Result): Promise<Record<string, unknown>>;
    uncertain(args: Threads1114Request, id: number): Promise<void>; now(): number;
};
function validate(args: Threads1114Request) {
    if (!threads1114ArgsSchema.safeParse(args).success) throw new Error('[THREADS1114_SCOPE_MISMATCH]');
}
function identity(result: Threads1114Result) {
    let url: URL;
    try { url = new URL(result.url); } catch { throw new Error('[THREADS1114_PROVIDER_IDENTITY_INVALID]'); }
    if (!/^\d+$/.test(result.id) || url.protocol !== 'https:' || url.username || url.password
        || !['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(url.hostname)
        || !/^\/@innokentybo\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
        || !Number.isFinite(Date.parse(result.publishedAt)) || Date.parse(result.publishedAt) < Date.parse(p.schedule)) {
        throw new Error('[THREADS1114_PROVIDER_IDENTITY_INVALID]');
    }
}
export async function releaseThreads1114(ports: Threads1114Ports, args: Threads1114Request) {
    validate(args);
    const prior = await ports.replay(args, 'release'); if (prior) return prior;
    const checked = await ports.inspect(args, false); assertThreads1114Snapshot(checked.snapshot, false);
    if (!checked.credentialReady) throw new Error('[THREADS1114_CONNECTOR_NOT_READY]');
    await ports.preflight(); return ports.release(args);
}
export async function executeThreads1114(ports: Threads1114Ports, args: Threads1114Request): Promise<Record<string, unknown>> {
    validate(args);
    if (!args.dryRun) { const prior = await ports.replay(args, 'send'); if (prior) return prior; }
    const checked = await ports.inspect(args, true); assertThreads1114Snapshot(checked.snapshot, true);
    if (!checked.releaseValid) throw new Error('[THREADS1114_OWNER_RELEASE_REQUIRED]');
    if (!checked.credentialReady) throw new Error('[THREADS1114_CONNECTOR_NOT_READY]');
    if (args.dryRun) return { mode: 'dry_run', task_id: 1114, channel_id: 138,
        live_publish_supported: true, route_executable: true, provider_checks_not_performed: true,
        accepted_revision: 1, selected_asset_id: null, delivery_method: 'threads_api', published: false };
    if (ports.now() < Date.parse(p.schedule)) throw new Error('[THREADS1114_NOT_DUE]');
    await ports.preflight();
    const claim = await ports.claim(args);
    try {
        await ports.assertDispatch(args, claim.id);
        const result = await ports.publish(claim.body); identity(result);
        return await ports.confirm(args, claim.id, result);
    } catch {
        try { await ports.uncertain(args, claim.id); }
        catch { throw new Error('[THREADS1114_UNCERTAIN_RECORD_FAILED] Reconcile the existing pending attempt; never resend'); }
        throw new Error('[THREADS1114_PUBLICATION_UNCERTAIN] Reconcile the existing attempt; never resend');
    }
}
