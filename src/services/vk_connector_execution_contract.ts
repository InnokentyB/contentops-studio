import type { ConnectorExecutionPackage, ConsumerJobIdentity } from './vk_connector_contract';
import type { VkConnectorWallEvidence, VkConnectorWallPost } from './vk_connector_reconciliation';
import type { startVkBrowserSubmission, confirmVkBrowserSubmission, markVkBrowserSubmissionUncertain } from './vk_browser_submission_control.service';
export type ConnectorExecutionIdentity = ConsumerJobIdentity & { packageSha256: string };
export type ConnectorExecutionLease = { workItemId: 1699; leaseToken: string; leaseExpiresAt: string; generation: number };
export type ConnectorStartArgs = ConnectorExecutionIdentity & Parameters<typeof startVkBrowserSubmission>[1];
export type ConnectorConfirmArgs = ConnectorExecutionIdentity & Parameters<typeof confirmVkBrowserSubmission>[1] & {
    providerAttestation?: unknown; mediaAcknowledgement: { assetSha256: string; providerMediaId: string; acknowledged: true; providerObjectId: string } };
export type ConnectorUncertainArgs = ConnectorExecutionIdentity & Parameters<typeof markVkBrowserSubmissionUncertain>[1];
export type ConnectorStartResult = { status: 'started'; attempt_id: number }
    | { status: 'confirmed'; attempt_id: number; publication_fact_id: number; public_url: string | null }
    | { status: 'verification_required'; attempt_id: number; retry_allowed: false };
/** Trusted server-side ports are not populated by public tool arguments or environment flags. */
export interface VkConnectorExecutionPorts {
    admission(identity?: ConnectorExecutionIdentity, purpose?: 'wall_read' | 'submission' | 'post_confirm'): Promise<'NOT_CHECKED' | 'POLICY_DENIED' | 'PERMITTED'>;
    verifyEvidence(identity: ConnectorExecutionIdentity, execution: ConnectorExecutionPackage,
        supplied: unknown): Promise<VkConnectorWallEvidence | null>;
    verifyMediaAcknowledgement(args: ConnectorConfirmArgs, execution: ConnectorExecutionPackage): Promise<boolean>;
    claimLease(args: { projectId: 10; actorId: string; workItemId: 1699; idempotencyKey: string }): Promise<{ leaseToken: string; leaseExpiresAt: string }>;
    checkLease(args: ConnectorExecutionIdentity & { leaseToken: string }): Promise<void>;
    start(args: ConnectorStartArgs): Promise<ConnectorStartResult>;
    confirm(args: ConnectorConfirmArgs): Promise<{ publication_fact_id: number }>;
    uncertain(args: ConnectorUncertainArgs): Promise<unknown>;
    recordMatchedFact(args: ConnectorExecutionIdentity, execution: ConnectorExecutionPackage,
        post: VkConnectorWallPost): Promise<{ factId: number; publicUrl: string }>;
}
