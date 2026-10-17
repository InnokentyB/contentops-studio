import { z } from 'zod';
import type { VkConnectorControl } from './vk_connector_consumer_runtime';
const Challenge = z.object({ challengeId: z.string().uuid(), nonce: z.string().min(16).max(256),
    purpose: z.enum(['wall_read', 'submission', 'post_confirm']), authorization: z.literal('application_host'),
    issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }) }).strip();
export type VkConnectorPurpose = z.infer<typeof Challenge>['purpose'];
export interface VkConnectorApplicationBroker {
    authorize(purpose: VkConnectorPurpose, signal?: AbortSignal): Promise<void>;
    attest(operation: 'wall_read' | 'post_confirm', proof: unknown): { challengeId: string; nonce: string; operation: string; proof: unknown };
    updateGeneration(generation: number): void;
}
/** Application authorization only; this capability makes no claim about agent/tool platform restrictions. */
export function createVkConnectorApplicationBroker(control: VkConnectorControl, scope: {
    projectId: number; actorId: string; hostId: string; instanceId: string; jobId: string; generation: number; packageSha256: string;
}, now: () => Date = () => new Date()): VkConnectorApplicationBroker {
    const grants = new Map<VkConnectorPurpose, z.infer<typeof Challenge>>();
    let generation = scope.generation;
    return { authorize: async (purpose, signal) => {
        const grant = Challenge.parse(await control.call('ba_issue_vk_connector_challenge', { ...scope, generation, purpose }, signal));
        const time = now().getTime();
        if (grant.purpose !== purpose || Date.parse(grant.issuedAt) > time || Date.parse(grant.expiresAt) <= time
            || Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt) > 120_000) throw new Error('[VK_CONNECTOR_CHALLENGE_INVALID]');
        grants.set(purpose, grant);
    }, attest: (operation, proof) => {
        const grant = grants.get(operation); grants.delete(operation);
        if (!grant || Date.parse(grant.expiresAt) <= now().getTime()) throw new Error('[VK_CONNECTOR_CHALLENGE_UNAVAILABLE]');
        return { challengeId: grant.challengeId, nonce: grant.nonce, operation, proof };
    }, updateGeneration: next => {
        if (!Number.isInteger(next) || next <= generation) throw new Error('[VK_CONNECTOR_GENERATION_INVALID]');
        generation = next; grants.clear();
    } };
}
