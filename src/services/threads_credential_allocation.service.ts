import { createHash } from 'crypto';
import prisma from '../db';
import threadsService from './threads.service';
import { isEncryptedChannelSecret } from '../utils/channel_secrets';
import { prepareChannelConfigForStorage, resolveEffectiveChannelConfig } from '../utils/channel.utils';

type JsonRecord = Record<string, unknown>;

interface ChannelRecord {
    id: number;
    project_id: number;
    type: string;
    name: string;
    updated_at: Date;
    config: unknown;
}

interface AllocationTransaction {
    projectMember: {
        findUnique(args: unknown): Promise<{ role: string } | null>;
    };
    socialChannel: {
        findFirst(args: unknown): Promise<ChannelRecord | null>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
    workflowEvent: {
        findFirst(args: unknown): Promise<{ before_state: unknown; after_state: unknown } | null>;
        create(args: unknown): Promise<unknown>;
    };
}

interface AllocationDb {
    $transaction<T>(operation: (tx: AllocationTransaction) => Promise<T>): Promise<T>;
}

interface ThreadsIdentityClient {
    testConnection(config: { access_token?: string; threads_user_id?: string }): Promise<{
        success: boolean;
        details?: { id: string; username?: string };
        error?: string;
    }>;
}

type AllocationPreflight = {
    replay: ThreadsCredentialAllocationResult;
    source?: never;
    target?: never;
    credential?: never;
} | {
    replay?: never;
    source: ChannelRecord;
    target: ChannelRecord;
    credential: { encryptedToken: string; threadsUserId: string };
};

export interface ThreadsCredentialAllocationDependencies {
    db: AllocationDb;
    threads: ThreadsIdentityClient;
}

export interface ThreadsCredentialAllocationRequest {
    actorId: string;
    sourceProjectId: number;
    sourceChannelId: number;
    targetProjectId: number;
    targetChannelId: number;
    expectedSourceUpdatedAt: string;
    expectedTargetUpdatedAt: string;
    idempotencyKey: string;
}

export interface ThreadsCredentialAllocationResult {
    source_project_id: number;
    source_channel_id: number;
    target_project_id: number;
    target_channel_id: number;
    threads_user_id: string;
    username: string | null;
    provider_identity_verified: true;
    replayed: boolean;
}

export interface ThreadsLegacyCredentialMigrationRequest {
    actorId: string;
    projectId: 32;
    channelId: 176;
    expectedUpdatedAt: string;
    idempotencyKey: string;
}

export interface ThreadsLegacyCredentialMigrationResult {
    project_id: 32;
    channel_id: 176;
    threads_user_id: string;
    encrypted_at_rest: true;
    replayed: boolean;
}

function record(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function requestHash(request: unknown): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

function actorUserId(actorId: string): number {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED] Authenticated user principal is required');
    return Number(match[1]);
}

function storedCredential(configValue: unknown): { encryptedToken: string; threadsUserId: string } {
    const config = record(configValue);
    const raw = record(config.raw_account);
    const encryptedToken = String(config.access_token_encrypted || raw.access_token_encrypted || '');
    const threadsUserId = String(config.threads_user_id || config.user_id
        || raw.threads_user_id || raw.user_id || '');
    if (!encryptedToken || !isEncryptedChannelSecret(encryptedToken) || !threadsUserId) {
        throw new Error('[THREADS_ENCRYPTED_CREDENTIAL_REQUIRED] Source must contain an encrypted token and identity');
    }
    return { encryptedToken, threadsUserId };
}

function targetConfig(configValue: unknown, credential: { encryptedToken: string; threadsUserId: string }): JsonRecord {
    const config = { ...record(configValue) };
    const raw = { ...record(config.raw_account) };
    delete config.access_token;
    delete raw.access_token;
    delete raw.access_token_encrypted;
    delete raw.threads_user_id;
    delete raw.user_id;
    config.raw_account = raw;
    config.access_token_encrypted = credential.encryptedToken;
    config.threads_user_id = credential.threadsUserId;
    return config;
}

/**
 * Allocates one encrypted Threads credential between channels after dual-owner,
 * provider-identity, idempotency and compare-and-swap checks.
 */
export class ThreadsCredentialAllocationService {
    constructor(private readonly dependencies: ThreadsCredentialAllocationDependencies) {}

    async allocate(request: ThreadsCredentialAllocationRequest): Promise<ThreadsCredentialAllocationResult> {
        const userId = actorUserId(request.actorId);
        const command = 'ba_allocate_threads_channel_credential';
        const hash = requestHash(request);
        const preflight = await this.dependencies.db.$transaction<AllocationPreflight>(async tx => {
            for (const projectId of [request.sourceProjectId, request.targetProjectId]) {
                const membership = await tx.projectMember.findUnique({ where: {
                    project_id_user_id: { project_id: projectId, user_id: userId }
                } });
                if (membership?.role !== 'owner') {
                    throw new Error('[OWNER_REQUIRED] The same user must own source and target projects');
                }
            }
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: request.targetProjectId,
                actor_id: request.actorId,
                command,
                idempotency_key: request.idempotencyKey
            } });
            if (prior) {
                const before = record(prior.before_state);
                if (before.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return { replay: { ...record(prior.after_state), replayed: true } as unknown as ThreadsCredentialAllocationResult };
            }
            const [source, target] = await Promise.all([
                tx.socialChannel.findFirst({ where: { id: request.sourceChannelId, project_id: request.sourceProjectId } }),
                tx.socialChannel.findFirst({ where: { id: request.targetChannelId, project_id: request.targetProjectId } })
            ]);
            if (!source || !target || source.type !== 'threads' || target.type !== 'threads') {
                throw new Error('[THREADS_CHANNEL_SCOPE_MISMATCH] Source and target must be Threads channels in their projects');
            }
            if (source.updated_at.toISOString() !== request.expectedSourceUpdatedAt
                || target.updated_at.toISOString() !== request.expectedTargetUpdatedAt) {
                throw new Error('[THREADS_CREDENTIAL_CAS_CONFLICT] Channel version changed');
            }
            return { source, target, credential: storedCredential(source.config) };
        });
        if (preflight.replay) return preflight.replay;

        const executable = resolveEffectiveChannelConfig('threads', preflight.source.config);
        const verification = await this.dependencies.threads.testConnection({
            access_token: typeof executable.access_token === 'string' ? executable.access_token : undefined,
            threads_user_id: preflight.credential.threadsUserId
        });
        if (!verification.success || verification.details?.id !== preflight.credential.threadsUserId) {
            throw new Error('[THREADS_IDENTITY_VERIFICATION_FAILED] Provider identity could not be verified');
        }
        const verifiedIdentity = verification.details;

        return this.dependencies.db.$transaction(async tx => {
            for (const projectId of [request.sourceProjectId, request.targetProjectId]) {
                const membership = await tx.projectMember.findUnique({ where: {
                    project_id_user_id: { project_id: projectId, user_id: userId }
                } });
                if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED] Ownership changed');
            }
            const unchangedSource = await tx.socialChannel.findFirst({ where: {
                id: request.sourceChannelId,
                project_id: request.sourceProjectId,
                type: 'threads',
                updated_at: new Date(request.expectedSourceUpdatedAt)
            } });
            if (!unchangedSource) throw new Error('[THREADS_CREDENTIAL_CAS_CONFLICT] Source channel changed');
            const changed = await tx.socialChannel.updateMany({
                where: {
                    id: request.targetChannelId,
                    project_id: request.targetProjectId,
                    type: 'threads',
                    updated_at: new Date(request.expectedTargetUpdatedAt)
                },
                data: { config: targetConfig(preflight.target.config, preflight.credential) }
            });
            if (changed.count !== 1) throw new Error('[THREADS_CREDENTIAL_CAS_CONFLICT] Target channel changed');
            const result: ThreadsCredentialAllocationResult = {
                source_project_id: request.sourceProjectId,
                source_channel_id: request.sourceChannelId,
                target_project_id: request.targetProjectId,
                target_channel_id: request.targetChannelId,
                threads_user_id: preflight.credential.threadsUserId,
                username: verifiedIdentity.username || null,
                provider_identity_verified: true,
                replayed: false
            };
            await tx.workflowEvent.create({ data: {
                project_id: request.targetProjectId,
                actor_id: request.actorId,
                command,
                idempotency_key: request.idempotencyKey,
                before_state: {
                    request_hash: hash,
                    source_project_id: request.sourceProjectId,
                    source_channel_id: request.sourceChannelId,
                    target_channel_id: request.targetChannelId,
                    expected_source_updated_at: request.expectedSourceUpdatedAt,
                    expected_target_updated_at: request.expectedTargetUpdatedAt
                },
                after_state: result
            } });
            return result;
        });
    }

    /** Encrypts the exact legacy project 32/channel 176 Threads token in place without exposing it. */
    async migrateLegacySource(request: ThreadsLegacyCredentialMigrationRequest): Promise<ThreadsLegacyCredentialMigrationResult> {
        const userId = actorUserId(request.actorId);
        const command = 'ba_encrypt_legacy_threads_source_credential';
        const hash = requestHash(request);
        return this.dependencies.db.$transaction(async tx => {
            const membership = await tx.projectMember.findUnique({ where: {
                project_id_user_id: { project_id: 32, user_id: userId }
            } });
            if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED] Project 32 owner is required');
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 32, actor_id: request.actorId, command, idempotency_key: request.idempotencyKey
            } });
            if (prior) {
                if (record(prior.before_state).request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return { ...record(prior.after_state), replayed: true } as unknown as ThreadsLegacyCredentialMigrationResult;
            }
            const channel = await tx.socialChannel.findFirst({ where: {
                id: 176, project_id: 32, type: 'threads'
            } });
            if (!channel || channel.updated_at.toISOString() !== request.expectedUpdatedAt) {
                throw new Error('[THREADS_CREDENTIAL_CAS_CONFLICT] Source channel changed');
            }
            const config = record(channel.config);
            const raw = record(config.raw_account);
            const legacyToken = typeof config.access_token === 'string'
                ? config.access_token
                : (typeof raw.access_token === 'string' ? raw.access_token : '');
            const threadsUserId = String(config.threads_user_id || config.user_id
                || raw.threads_user_id || raw.user_id || '');
            if (!legacyToken || !threadsUserId || config.access_token_encrypted || raw.access_token_encrypted) {
                throw new Error('[THREADS_LEGACY_CREDENTIAL_REQUIRED] Exact plaintext legacy source credential is required');
            }
            const prepared = prepareChannelConfigForStorage('threads', config);
            const changed = await tx.socialChannel.updateMany({
                where: { id: 176, project_id: 32, type: 'threads', updated_at: new Date(request.expectedUpdatedAt) },
                data: { config: prepared }
            });
            if (changed.count !== 1) throw new Error('[THREADS_CREDENTIAL_CAS_CONFLICT] Source channel changed');
            const result: ThreadsLegacyCredentialMigrationResult = {
                project_id: 32,
                channel_id: 176,
                threads_user_id: threadsUserId,
                encrypted_at_rest: true,
                replayed: false
            };
            await tx.workflowEvent.create({ data: {
                project_id: 32,
                actor_id: request.actorId,
                command,
                idempotency_key: request.idempotencyKey,
                before_state: { request_hash: hash, expected_updated_at: request.expectedUpdatedAt,
                    credential_storage: 'legacy_plaintext' },
                after_state: result
            } });
            return result;
        });
    }
}

export default new ThreadsCredentialAllocationService({
    db: prisma as unknown as AllocationDb,
    threads: threadsService
});
