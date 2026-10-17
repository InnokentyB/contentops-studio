import { VK_CONNECTOR_SCOPE, VK_CONNECTOR_HOST } from './vk_connector_fixture';
import { VkConnectorDispatchService } from '../../services/vk_connector_dispatch.service';
import { connectorPackageHash, type ConnectorStore, type ConnectorJob, type ConnectorHost, type ConnectorSnapshot, type ConnectorAuditData } from '../../services/vk_connector_contract';
export function harness(enabled = true, registeredMode: ConnectorHost['mode'] = 'infrastructure_only') {
    let snapshotError: string | null = null;
    let clock = new Date('2026-10-12T19:00:00Z');
    const jobs = new Map<string, ConnectorJob>(), hosts = new Map<string, ConnectorHost>();
    const events: (ConnectorAuditData & { command: string })[] = [];
    const snapshot: ConnectorSnapshot = { package: { ...VK_CONNECTOR_SCOPE, bodySha256: 'a'.repeat(64),
        assetSha256: 'b'.repeat(64), releaseSha256: 'c'.repeat(64) }, workItemId: 1699,
        factId: null, publicUrl: null, attemptId: null, attemptStatus: null, eligible: true };
    const commandResults = new Map<string, unknown>();
    const store: ConnectorStore = {
        commandResult: async (_p,a,c,k) => commandResults.get(`${a}:${c}:${k}`),
        authorize: async (p, a) => { if (p !== 10 || a !== 'user:2') throw new Error('[AUTH_UNAVAILABLE]'); },
        snapshot: async () => { if (snapshotError) throw new Error(snapshotError); return structuredClone(snapshot); },
        job: async (p, id) => { const j = jobs.get(id); return j?.projectId === p ? structuredClone(j) : null; },
        jobByKey: async (p, key) => structuredClone([...jobs.values()].find(j => j.projectId === p && j.idempotencyKey === key) || null),
        jobByPackage: async (p, hash) => structuredClone([...jobs.values()].find(j => j.projectId === p && j.packageSha256 === hash) || null),
        insertJob: async j => { jobs.set(j.jobId, structuredClone(j)); },
        updateJob: async (id, gen, state, patch) => {
            const j = jobs.get(id); if (!j || j.generation !== gen || j.state !== state) return false;
            Object.assign(j, structuredClone(patch)); return true;
        },
        candidates: async p => structuredClone([...jobs.values()].filter(j => j.projectId === p && ['queued', 'accepted','reconciling','ready','executing'].includes(j.state))),
        host: async (p, h) => { const host = hosts.get(h); return host?.projectId === p ? structuredClone(host) : null; },
        saveHost: async h => { hosts.set(h.hostId, structuredClone(h)); },
        event: async (_p, _t, actor, command, data) => { events.push({ ...structuredClone(data), command });
            if (data.idempotencyKey) commandResults.set(`${actor}:${command}:${data.idempotencyKey}`, structuredClone(data)); }
    };
    let chain = Promise.resolve();
    const repository = { transaction: <T>(run: (s: ConnectorStore) => Promise<T>): Promise<T> => {
        const next = chain.then(() => run(store)); chain = next.then(() => undefined, () => undefined); return next;
    } };
    const service = new VkConnectorDispatchService(repository, enabled, () => new Date(clock));
    const identity = { projectId: 10, actorId: 'user:2' };
    const consumer = { ...identity, hostId: VK_CONNECTOR_HOST, instanceId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', buildVersion: 'test-016' };
    hosts.set(consumer.hostId, { projectId: identity.projectId, hostId: consumer.hostId, instanceId: consumer.instanceId,
        buildVersion: 'synthetic-registered', heartbeatAt: new Date(clock.getTime() - 60_000), mode: registeredMode, blocker: null });
    const request = { ...identity, taskId: 1048, expectedPackageSha256: connectorPackageHash(snapshot.package), idempotencyKey: 'pilot1048-dispatch-v1' };
    return { service, repository, store, snapshot, jobs, hosts, events, identity, consumer, request,
        invalidate: () => { snapshotError = '[VK_CONNECTOR_PACKAGE_NOT_READY]'; },
        advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}
