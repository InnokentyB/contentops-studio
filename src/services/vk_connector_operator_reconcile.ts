import { z } from 'zod';
import { createVkConnectorOperatorDispatch } from './vk_connector_operator_dispatch';
import { type VkConnectorControl, type VkConnectorConfig,
    type VkConnectorIdentity, type VkConnectorProviderDispatch } from './vk_connector_consumer_runtime';
import { ConnectorBindingSchema, connectorPackageHash } from './vk_connector_contract';
const Status = z.object({ jobId: z.string().uuid(), generation: z.number().int().positive(), packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.literal('verification_required') }).strip();
/** Human-owned one-shot recovery of the same frozen job. It cannot claim/upload/submit even if absence is proven. */
export async function runVkConnectorOperatorReconcile(config: VkConnectorConfig, identity: VkConnectorIdentity,
    control: VkConnectorControl, requestedJobId: string, signal?: AbortSignal, dispatch?: VkConnectorProviderDispatch) {
    const jobId = z.string().uuid().parse(requestedJobId);
    await control.call('ba_poll_vk_connector_jobs', identity, signal); // Register this instance; never execute returned jobs.
    const status = Status.parse(await control.call('ba_get_vk_connector_job', { projectId: identity.projectId, actorId: identity.actorId, jobId }, signal));
    const rebound = Status.parse(await control.call('ba_rebind_vk_connector_reconciliation', { projectId: identity.projectId, actorId: identity.actorId,
        hostId: identity.hostId, instanceId: identity.instanceId, jobId, generation: status.generation, packageSha256: status.packageSha256 }, signal));
    if (status.jobId !== jobId || rebound.jobId !== jobId || rebound.generation !== status.generation + 1 || rebound.packageSha256 !== status.packageSha256) throw new Error('[VK_CONNECTOR_RECOVERY_FENCED]');
    const execution = z.object({ binding: ConnectorBindingSchema, packageSha256: z.literal(status.packageSha256) }).strip()
        .parse(await control.call('ba_get_vk_connector_execution_package', { projectId: identity.projectId, actorId: identity.actorId,
            hostId: identity.hostId, instanceId: identity.instanceId, jobId, generation: rebound.generation, packageSha256: rebound.packageSha256 }, signal));
    if (execution.binding.projectId !== identity.projectId || connectorPackageHash(execution.binding) !== execution.packageSha256) throw new Error('[VK_CONNECTOR_PACKAGE_UNCONFIRMED]');
    return (dispatch ?? createVkConnectorOperatorDispatch(config, true))({ identity, jobId, generation: rebound.generation,
        packageSha256: execution.packageSha256, binding: execution.binding }, control, signal);
}
