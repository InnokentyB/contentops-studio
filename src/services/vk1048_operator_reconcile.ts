import { z } from 'zod';
import { createVk1048OperatorDispatch } from './vk1048_operator_dispatch';
import { VkConnectorPilotPackageSchema, vkConnectorPackageSha256, type VkConnectorControl, type VkConnectorConfig,
    type VkConnectorIdentity, type VkConnectorProviderDispatch } from './vk_connector_consumer_runtime';
const JOB = '3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de';
const Status = z.object({ jobId: z.literal(JOB), generation: z.number().int().positive(), packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.literal('verification_required') }).strip();
/** Human-owned one-shot recovery of the same frozen job. It cannot claim/upload/submit even if absence is proven. */
export async function runVk1048OperatorReconcile(config: VkConnectorConfig, identity: VkConnectorIdentity,
    control: VkConnectorControl, signal?: AbortSignal, dispatch?: VkConnectorProviderDispatch) {
    await control.call('ba_poll_vk_connector_jobs', identity, signal); // Register this instance; never execute returned jobs.
    const status = Status.parse(await control.call('ba_get_vk_connector_job', { projectId: 10, actorId: identity.actorId, jobId: JOB }, signal));
    const rebound = Status.parse(await control.call('ba_rebind_vk_connector_reconciliation', { projectId: 10, actorId: identity.actorId,
        hostId: identity.hostId, instanceId: identity.instanceId, jobId: JOB, generation: status.generation, packageSha256: status.packageSha256 }, signal));
    if (rebound.generation !== status.generation + 1 || rebound.packageSha256 !== status.packageSha256) throw new Error('[VK1048_RECOVERY_FENCED]');
    const execution = z.object({ binding: VkConnectorPilotPackageSchema, packageSha256: z.literal(status.packageSha256) }).strip()
        .parse(await control.call('ba_get_vk_connector_execution_package', { projectId: 10, actorId: identity.actorId,
            hostId: identity.hostId, instanceId: identity.instanceId, jobId: JOB, generation: rebound.generation, packageSha256: rebound.packageSha256 }, signal));
    if (vkConnectorPackageSha256(execution.binding) !== execution.packageSha256) throw new Error('[VK1048_PACKAGE_UNCONFIRMED]');
    return (dispatch ?? createVk1048OperatorDispatch(config, true))({ identity, jobId: JOB, generation: rebound.generation,
        packageSha256: execution.packageSha256, binding: execution.binding }, control, signal);
}
