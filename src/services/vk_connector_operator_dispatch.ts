import fs from 'node:fs';
import { createVkConnectorApplicationBroker } from './vk_connector_application_broker';
import { readVkConnectorBoundedImage } from './vk_connector_bounded_image';
import { createVkConnectorPlaywrightRuntime } from './vk_connector_playwright_runtime';
import { runVkConnectorProviderJob, type VkConnectorProviderResult } from './vk_connector_provider_execution';
import type { VkConnectorConfig, VkConnectorProviderDispatch, VkConnectorControl, VkConnectorIdentity } from './vk_connector_consumer_runtime';
import { z } from 'zod';
const Health = z.object({ status: z.literal('online'), heartbeatAt: z.string().datetime({ offset: true }) }).passthrough();
/** Scoped renewal touches only this host receipt, never polls or executes another job. */
export async function withVkConnectorHeartbeat<T>(control: VkConnectorControl, identity: VkConnectorIdentity,
    run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal, intervalMs = 10_000): Promise<T> {
    const controller = new AbortController(); const stop = () => controller.abort();
    outer?.addEventListener('abort', stop, { once: true }); if (outer?.aborted) stop();
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined; let pending: Promise<void> = Promise.resolve();
    const renew = async (): Promise<void> => {
        try {
            const timeout = AbortSignal.timeout(10_000);
            let deadline: ReturnType<typeof setTimeout> | undefined;
            const expired = new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('[VK_CONNECTOR_HEARTBEAT_TIMEOUT]')), Math.min(intervalMs, 10_000)); });
            try { Health.parse(await Promise.race([control.call('ba_renew_vk_connector_heartbeat', { projectId: identity.projectId, actorId: identity.actorId,
                hostId: identity.hostId, instanceId: identity.instanceId }, AbortSignal.any([controller.signal, timeout])), expired])); }
            finally { if (deadline) clearTimeout(deadline); }
        } catch { controller.abort(); } // Failed renewal fences all subsequent worker operations.
        if (!stopped && !controller.signal.aborted) timer = setTimeout(() => { pending = renew(); }, intervalMs);
    };
    try { await renew(); if (controller.signal.aborted) throw new Error('[VK_CONNECTOR_HEARTBEAT_UNAVAILABLE]'); return await run(controller.signal); }
    finally { stopped = true; if (timer) clearTimeout(timer); controller.abort(); await pending; outer?.removeEventListener('abort', stop); }
}
/** Existing private resources only: no auto-provisioning, symlinks or another owner's profile. */
export function validateVkConnectorOperatorResources(profileDirectory: string, evidenceDir: string): void {
    for (const directory of [profileDirectory, evidenceDir]) {
        const info = fs.lstatSync(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700
            || (process.getuid && info.uid !== process.getuid())) throw new Error('[VK_CONNECTOR_PRIVATE_EXISTING_RESOURCE_REQUIRED]');
    }
}
/** Human-owned explicit entry only. The agent-managed loop never supplies this dispatch dependency. */
export function createVkConnectorOperatorDispatch(config: VkConnectorConfig, reconcileOnly = false): VkConnectorProviderDispatch {
    return async (input, control, signal): Promise<VkConnectorProviderResult> => {
        if (!config.profileDirectory || !config.evidenceDir) return { status: 'PERMISSION_UNVERIFIED', executionContext: 'production_blocked', reason: 'NOT_CONNECTED' };
        validateVkConnectorOperatorResources(config.profileDirectory, config.evidenceDir);
        return withVkConnectorHeartbeat(control, input.identity, async active => {
            const broker = createVkConnectorApplicationBroker(control, { projectId: input.identity.projectId, actorId: input.identity.actorId,
                hostId: input.identity.hostId, instanceId: input.identity.instanceId, jobId: input.jobId, generation: input.generation, packageSha256: input.packageSha256 });
            const runtime = createVkConnectorPlaywrightRuntime({ reconcileOnly, broker, profileDirectory: config.profileDirectory!, evidenceDir: config.evidenceDir!,
                approvedAssetSha256: input.binding.assetSha256,
                actionAdmission: { assess: async () => { await broker.authorize('wall_read', active); return { status: 'ACTION_ADMITTED', executionContext: 'production_admitted', authorization: 'application_host' }; } },
                loadApprovedImage: async url => {
                    const approved = new URL(url);
                    if (approved.protocol !== 'https:' || approved.username || approved.password || approved.port) throw new Error('[VK_CONNECTOR_ASSET_SOURCE_INVALID]');
                    const response = await fetch(approved.href, { redirect: 'error', signal: AbortSignal.any([active, AbortSignal.timeout(15_000)]) });
                    const buffer = await readVkConnectorBoundedImage(response, active);
                    if (!buffer) throw new Error('[VK_CONNECTOR_ASSET_UNCONFIRMED]');
                    return { buffer, filename: 'approved-image', contentType: response.headers.get('content-type') || undefined };
                } });
            return runVkConnectorProviderJob(input, control, runtime, active);
        }, signal);
    };
}
