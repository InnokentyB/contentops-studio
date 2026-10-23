import { createHash } from 'crypto';
import {setTimeout as pause} from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import {assertVisualReassessmentReady} from './visual_reassessment_binding';
import threadsService from './threads.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { assertThreadsOwnerRelease } from './threads_release_diagnostics';
import {digest, threadsReconcileSchema, verifyThreadsRecovery, assertThreadsRecoveryProfile, assertThreadsPackageProof, type ThreadsReconcileArgs} from './threads_api_contract';
import {apiSerial, createThreadsApiState, loadThreadsApiState, threadsPhaseJournal, reserveThreadsRead, assertThreadsFinalizer} from './threads_api_store';

const RELEASE_COMMAND = 'ba_release_approved_threads_task';
const SEND_COMMAND = 'ba_publish_threads_task';
const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

export type GenericThreadsReleaseArgs = {
    projectId: number; taskId: number; actorId: string; approvalReference: string;
    expectedManifestChecksum: string; expectedAcceptedRevision: number; expectedContentRevision: number;
    expectedBodySha256: string; expectedChannelId: number; expectedScheduleAt: string;
    expectedVisualState: 'NO_VISUAL_NEEDED'; expectedSelectedAssetId: null; expectedPlacement: 'feed';
    expectedThreadsUserId: string; expectedUsername: string; idempotencyKey: string;
};

export type GenericThreadsPublishArgs = {
    projectId: number; taskId: number; actorId: string; approvalReference: string;
    expectedManifestChecksum: string; releaseIdempotencyKey: string; idempotencyKey: string; dryRun?: boolean;
};

type Database = typeof prisma;
type Deps = { db: Database; threads: typeof threadsService; facts: typeof publicationFactService;
    manifest: typeof loadAgentWorkspaceManifest; now(): number; recoveryEnabled?: boolean;
    pause?: (ms:number,signal?:AbortSignal)=>Promise<void> };

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function object(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function ownerId(actorId: string) {
    const match = /^user:([1-9]\d*)$/.exec(actorId);
    if (!match) throw new Error('[THREADS_OWNER_REQUIRED]');
    return Number(match[1]);
}
function releaseRequestHash(a: GenericThreadsReleaseArgs) { return hash(JSON.stringify(a)); }
function sendRequestHash(a: GenericThreadsPublishArgs) {
    return hash(JSON.stringify({ ...a, dryRun: false }));
}

export class GenericThreadsReleaseService {
    constructor(private readonly deps: Deps) {}

    private async manifest(tx: Prisma.TransactionClient, projectId: number, actorId: string, expected: string) {
        const userId = ownerId(actorId);
        const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } });
        if (member?.role !== 'owner') throw new Error('[THREADS_OWNER_REQUIRED]');
        const manifest = await this.deps.manifest(projectId, userId, tx);
        if (manifest.project.id !== projectId || manifest.checksum !== expected) {
            throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
        }
        return manifest;
    }

    private async inspect(tx: Prisma.TransactionClient, projectId: number, taskId: number, actorId: string,
        expectedManifestChecksum: string, expectedMode: 'approval_required' | 'owner_released', attemptId?: number) {
        const manifest = await this.manifest(tx, projectId, actorId, expectedManifestChecksum);
        const task = await tx.contentItem.findFirst({ where: { id: taskId, project_id: projectId },
            include: { channel: true, publication_fact: true, selected_asset: true } });
        if (!task || task.channel?.type !== 'threads') throw new Error('[THREADS_TASK_MISMATCH]');
        await assertVisualReassessmentReady(tx,projectId,taskId);
        const [decision, review, art, firstAttempt, browserWork] = await Promise.all([
            tx.artDirectionDecision.findFirst({ where: { project_id: projectId, content_item_id: taskId,
                source_content_revision: task.content_revision, placement: 'feed', status: 'active' }, orderBy: { id: 'desc' } }),
            tx.workItem.findFirst({ where: { project_id: projectId, content_item_id: taskId, kind: 'content_review',
                state: 'completed', input_context_version: task.content_revision }, orderBy: { id: 'desc' } }),
            tx.workItem.findFirst({ where: { project_id: projectId, content_item_id: taskId, kind: 'art_direction',
                state: 'completed', input_context_version: task.content_revision }, orderBy: { id: 'desc' } }),
            tx.deliveryAttempt.findFirst({ where: { project_id: projectId, content_item_id: taskId }, orderBy: { id: 'asc' } }),
            tx.workItem.findFirst({ where: { project_id: projectId, content_item_id: taskId, kind: 'browser_publish',
                state: { notIn: ['completed', 'cancelled'] } } })
        ]);
        const config = resolveEffectiveChannelConfig('threads', task.channel.config || {});
        const body = task.draft_text || '';
        const baseValid = task.channel.is_active && task.text_state === 'accepted'
            && task.accepted_revision === task.content_revision && body.trim().length > 0 && body.length <= 500
            && task.visual_state === 'NO_VISUAL_NEEDED' && task.selected_asset_id === null && !task.selected_asset
            && task.visual_placement === 'feed' && task.visual_mode !== 'required'
            && decision?.decision === 'NO_VISUAL_NEEDED' && decision.channel === 'threads'
            && decision.source_content_revision === task.content_revision
            && decision.decision_version === task.visual_decision_version
            && Boolean(review) && Boolean(art) && task.handoff_state === 'ready'
            && task.publication_mode === expectedMode && task.status === (attemptId ? 'publishing' : 'ready_for_execution')
            && !task.publication_fact && !task.published_link && !browserWork
            && (attemptId ? firstAttempt?.id === attemptId && firstAttempt.status === 'pending' : !firstAttempt)
            && !object(task.quality_report).publication_hold;
        if (!baseValid) throw new Error('[THREADS_GENERIC_PACKAGE_GUARD_FAILED]');
        if (!config.access_token || !config.threads_user_id) throw new Error('[THREADS_CONNECTOR_NOT_READY]');
        return { manifest, task, decision, config, body, bodySha256: hash(body) };
    }

    private async providerPreflight(config: Record<string, any>, bodySha256: string, expectedUserId: string, expectedUsername: string) {
        const token = String(config.access_token);
        const identity = await this.deps.threads.testConnection({ access_token: token, threads_user_id: expectedUserId });
        if (!identity.success || identity.details?.id !== expectedUserId || identity.details.username !== expectedUsername) {
            throw new Error('[THREADS_PROVIDER_IDENTITY_UNVERIFIED]');
        }
        let after: string | undefined;
        const signal = AbortSignal.timeout(30_000);
        for (let page = 0; page < 5; page += 1) {
            const posts = await this.deps.threads.getOwnPosts(token, expectedUserId, after, signal);
            if (posts.items.some(post => typeof post.text === 'string' && hash(post.text) === bodySha256)) {
                throw new Error('[THREADS_DUPLICATE_FOUND]');
            }
            if (!posts.after) return;
            if (posts.after === after) break;
            after = posts.after;
        }
        throw new Error('[THREADS_HISTORY_INCOMPLETE]');
    }

    async release(a: GenericThreadsReleaseArgs) {
        const prior = await this.deps.db.$transaction(async tx => {
            await this.manifest(tx, a.projectId, a.actorId, a.expectedManifestChecksum);
            return tx.workflowEvent.findFirst({ where: { project_id: a.projectId,
                content_item_id: a.taskId, actor_id: a.actorId, command: RELEASE_COMMAND, idempotency_key: a.idempotencyKey } });
        }, serial);
        if (prior) {
            if (object(prior.before_state).request_hash !== releaseRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return object(prior.after_state);
        }
        const checked = await this.deps.db.$transaction(tx => this.inspect(tx, a.projectId, a.taskId, a.actorId,
            a.expectedManifestChecksum, 'approval_required'), serial);
        const schedule = checked.task.schedule_at?.toISOString() || null;
        const username = String(checked.config.channel_username || checked.config.account_ref || '').replace(/^@/, '');
        if (checked.task.channel_id !== a.expectedChannelId
            || checked.task.content_revision !== a.expectedContentRevision || checked.task.accepted_revision !== a.expectedAcceptedRevision
            || checked.bodySha256 !== a.expectedBodySha256 || schedule !== a.expectedScheduleAt
            || checked.task.publish_at?.toISOString() !== a.expectedScheduleAt
            || a.expectedVisualState !== 'NO_VISUAL_NEEDED' || a.expectedSelectedAssetId !== null || a.expectedPlacement !== 'feed'
            || checked.config.threads_user_id !== a.expectedThreadsUserId || username !== a.expectedUsername) {
            throw new Error('[THREADS_GENERIC_EXPECTATION_MISMATCH]');
        }
        await this.providerPreflight(checked.config, checked.bodySha256, a.expectedThreadsUserId, a.expectedUsername);
        return this.deps.db.$transaction(async tx => {
            const replay = await tx.workflowEvent.findFirst({ where: { project_id: a.projectId, content_item_id: a.taskId,
                actor_id: a.actorId, command: RELEASE_COMMAND, idempotency_key: a.idempotencyKey } });
            if (replay) return object(replay.after_state);
            const current = await this.inspect(tx, a.projectId, a.taskId, a.actorId, a.expectedManifestChecksum, 'approval_required');
            if (current.bodySha256 !== a.expectedBodySha256 || current.task.updated_at.getTime() !== checked.task.updated_at.getTime()) {
                throw new Error('[THREADS_GENERIC_CAS_CONFLICT]');
            }
            const changed = await tx.contentItem.updateMany({ where: { id: a.taskId, project_id: a.projectId,
                updated_at: current.task.updated_at, publication_mode: 'approval_required', status: 'ready_for_execution' },
            data: { publication_mode: 'owner_released' } });
            if (changed.count !== 1) throw new Error('[THREADS_GENERIC_CAS_CONFLICT]');
            const proof = { publication_authorized: true, task_id: a.taskId, channel_id: a.expectedChannelId,
                accepted_revision: a.expectedAcceptedRevision, content_revision: a.expectedContentRevision,
                body_sha256: a.expectedBodySha256, manifest_checksum: a.expectedManifestChecksum,
                threads_user_id: a.expectedThreadsUserId, username: a.expectedUsername,
                schedule_at: a.expectedScheduleAt, publish_at: current.task.publish_at?.toISOString() || null,
                visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null, placement: 'feed',
                decision_id: current.decision?.id, actor_id: a.actorId, release_idempotency_key: a.idempotencyKey };
            await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                actor_id: a.actorId, command: RELEASE_COMMAND, idempotency_key: a.idempotencyKey,
                before_state: { request_hash: releaseRequestHash(a), approval_reference: a.approvalReference,
                    manifest_checksum: a.expectedManifestChecksum }, after_state: proof } });
            return proof;
        }, serial);
    }

    async publish(a: GenericThreadsPublishArgs,callerSignal?:AbortSignal) {
        if(callerSignal?.aborted)throw new Error('[THREADS_RECOVERY_INTERRUPTED]');
        const prior = await this.deps.db.$transaction(async tx => {
            await this.manifest(tx, a.projectId, a.actorId, a.expectedManifestChecksum);
            return tx.workflowEvent.findFirst({ where: { project_id: a.projectId,
                content_item_id: a.taskId, actor_id: a.actorId, command: SEND_COMMAND, idempotency_key: a.idempotencyKey } });
        }, serial);
        if (prior) {
            if (object(prior.before_state).request_hash !== sendRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return object(prior.after_state);
        }
        const checked = await this.deps.db.$transaction(tx => this.inspect(tx, a.projectId, a.taskId, a.actorId,
            a.expectedManifestChecksum, 'owner_released'), serial);
        const release = await this.deps.db.workflowEvent.findFirst({ where: { project_id: a.projectId,
            content_item_id: a.taskId, actor_id: a.actorId, command: RELEASE_COMMAND,
            idempotency_key: a.releaseIdempotencyKey }, orderBy: { id: 'desc' } });
        const proof = assertThreadsOwnerRelease(release, { body_sha256: checked.bodySha256,
            channel_id: checked.task.channel_id, accepted_revision: checked.task.accepted_revision,
            manifest_checksum: a.expectedManifestChecksum, actor_id: a.actorId, approval_reference: a.approvalReference });
        const dueAt = checked.task.publish_at || checked.task.schedule_at;
        if (!dueAt || this.deps.now() < dueAt.getTime()) throw new Error('[THREADS_NOT_DUE]');
        if (a.dryRun) return { mode: 'dry_run', task_id: a.taskId, channel_id: checked.task.channel_id,
            live_publish_supported: true, route_executable: true, accepted_revision: checked.task.accepted_revision,
            selected_asset_id: null, delivery_method: 'threads_api', published: false };
        await this.providerPreflight(checked.config, checked.bodySha256, String(proof.threads_user_id), String(proof.username));
        if(callerSignal?.aborted)throw new Error('[THREADS_RECOVERY_INTERRUPTED]');
        const claim = await this.deps.db.$transaction(async tx => {
            const current = await this.inspect(tx, a.projectId, a.taskId, a.actorId, a.expectedManifestChecksum, 'owner_released');
            const changed = await tx.contentItem.updateMany({ where: { id: a.taskId, project_id: a.projectId,
                updated_at: current.task.updated_at, status: 'ready_for_execution', publication_mode: 'owner_released' },
            data: { status: 'publishing' } });
            if (changed.count !== 1) throw new Error('[THREADS_PUBLICATION_ALREADY_CLAIMED]');
            const attempt = await tx.deliveryAttempt.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                channel_id: current.task.channel_id!, mode: 'automatic', status: 'pending', attempt_number: 1,
                idempotency_key: a.idempotencyKey, scheduled_at: current.task.schedule_at, requires_manual_confirmation: true } });
            if(this.deps.recoveryEnabled){
                await createThreadsApiState(tx,{projectId:a.projectId,taskId:a.taskId,channelId:current.task.channel_id!,
                    actorId:a.actorId,manifestChecksum:a.expectedManifestChecksum,revision:current.task.content_revision,
                    bodySha256:current.bodySha256,releaseKey:a.releaseIdempotencyKey,releaseSha256:digest(JSON.stringify(proof)),
                    userId:String(proof.threads_user_id),username:String(proof.username)},attempt.id);
            }
            await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                actor_id: a.actorId, command: `${SEND_COMMAND}:claim`, idempotency_key: a.idempotencyKey,
                before_state: { request_hash: sendRequestHash(a), approval_reference: a.approvalReference },
                after_state: { attempt_id: attempt.id } } });
            return { attemptId: attempt.id, body: current.body, token: String(current.config.access_token),
                userId: String(proof.threads_user_id), username: String(proof.username) };
        }, serial);
        let result: { id: string; url: string; publishedAt: string };
        try {
            const dispatch = await this.deps.db.$transaction(tx => this.inspect(tx, a.projectId, a.taskId,
                a.actorId, a.expectedManifestChecksum, 'owner_released', claim.attemptId), serial);
            if (String(dispatch.config.access_token) !== claim.token
                || String(dispatch.config.threads_user_id) !== claim.userId
                || dispatch.body !== claim.body) throw new Error('[THREADS_DISPATCH_GUARD_FAILED]');
            const journal=this.deps.recoveryEnabled?threadsPhaseJournal(
                run=>this.deps.db.$transaction(run,serial),{projectId:a.projectId,taskId:a.taskId,attemptId:claim.attemptId},
                async tx=>{await this.recoveryGuard(tx,{...a,attemptId:claim.attemptId});},this.deps.now):undefined;
            result = await this.deps.threads.publishVerifiedText(claim.userId, claim.token, claim.body, claim.username,journal,callerSignal);
        } catch (error:unknown) {
            try{await this.deps.db.$transaction(async tx => {
                await tx.deliveryAttempt.updateMany({ where: { id: claim.attemptId, project_id: a.projectId,
                    content_item_id: a.taskId, status: 'pending', idempotency_key: a.idempotencyKey },
                data: { requires_manual_confirmation: true, error_message: 'THREADS_OUTCOME_UNCERTAIN_RECONCILE_ONLY' } });
                await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                    actor_id: a.actorId, command: `${SEND_COMMAND}:uncertain`, idempotency_key: a.idempotencyKey,
                    before_state: { request_hash: sendRequestHash(a) },
                    after_state: { attempt_id: claim.attemptId, retry_allowed: false } } });
            }, serial);}catch{throw new Error('[THREADS_ATTEMPT_PERSISTENCE_UNAVAILABLE]');}
            if(this.deps.recoveryEnabled){
                const {row}=await this.deps.db.$transaction(tx=>loadThreadsApiState(tx,a.projectId,a.taskId,claim.attemptId),serial);
                if(!row.publish_started_at&&error instanceof Error&&/^\[(?:THREADS_|MCP_|PROJECT_)/.test(error.message))throw error;
                return this.reconcile({...a,attemptId:claim.attemptId,projectId:a.projectId,taskId:a.taskId,
                    actorId:a.actorId,expectedManifestChecksum:a.expectedManifestChecksum},callerSignal);
            }
            throw new Error('[THREADS_PUBLICATION_UNCERTAIN] Reconcile before retry');
        }
        if(this.deps.recoveryEnabled)return this.reconcile({...a,attemptId:claim.attemptId,
            projectId:a.projectId,taskId:a.taskId,actorId:a.actorId,expectedManifestChecksum:a.expectedManifestChecksum},callerSignal);
        const response = { mode: 'published', task_id: a.taskId, provider_object_id: result.id,
            public_url: result.url, published_at: result.publishedAt, retry_allowed: false };
        try{await this.deps.facts.record({ projectId: a.projectId, taskId: a.taskId, actorId: a.actorId,
            artifactKind: 'post', outcome: 'published', confirmationMode: 'automatic', publishedAt: result.publishedAt,
            publicUrl: result.url, providerObjectId: result.id, evidence: { type: 'api', ref: result.id },
            beforeWrite: async tx => {
                const current = await this.inspect(tx, a.projectId, a.taskId, a.actorId, a.expectedManifestChecksum, 'owner_released', claim.attemptId);
                if (current.bodySha256 !== checked.bodySha256) throw new Error('[THREADS_GENERIC_PACKAGE_CHANGED]');
                if(this.deps.recoveryEnabled){
                    const row=await assertThreadsFinalizer(tx,{projectId:a.projectId,taskId:a.taskId,attemptId:claim.attemptId},result.id,null,this.deps.now());
                    await tx.apiDeliveryRecovery.update({where:{id:row.id},data:{state:'confirmed',row_version:{increment:1}}});
                }
                const updated = await tx.deliveryAttempt.updateMany({ where: { id: claim.attemptId,
                    project_id: a.projectId, content_item_id: a.taskId, status: 'pending', idempotency_key: a.idempotencyKey },
                data: { status: 'delivered', actual_published_at: new Date(result.publishedAt), requires_manual_confirmation: false } });
                if (updated.count !== 1) throw new Error('[THREADS_ATTEMPT_CONFLICT]');
                await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                    actor_id: a.actorId, command: SEND_COMMAND, idempotency_key: a.idempotencyKey,
                    before_state: { request_hash: sendRequestHash(a), approval_reference: a.approvalReference },
                    after_state: response } });
            } });}catch(error:unknown){
                if(this.deps.recoveryEnabled)throw new Error('[THREADS_FACT_COMMIT_PENDING] Reconcile the existing attempt; never resend');
                throw error;
            }
        return response;
    }

    private async recoveryGuard(tx:Prisma.TransactionClient,a:ThreadsReconcileArgs){
        const checked=await this.inspect(tx,a.projectId,a.taskId,a.actorId,a.expectedManifestChecksum,'owner_released',a.attemptId);
        const {snapshot,row}=await loadThreadsApiState(tx,a.projectId,a.taskId,a.attemptId);
        if(snapshot.actorId!==a.actorId||snapshot.manifestChecksum!==a.expectedManifestChecksum
            ||checked.bodySha256!==snapshot.bodySha256||checked.task.channel_id!==snapshot.channelId
            ||checked.task.content_revision!==snapshot.revision||String(checked.config.threads_user_id)!==snapshot.userId)
            throw new Error('[THREADS_RECOVERY_CONFLICT]');
        const release=await tx.workflowEvent.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,
            actor_id:a.actorId,command:RELEASE_COMMAND,idempotency_key:snapshot.releaseKey}});
        if(!release||digest(JSON.stringify(release.after_state))!==snapshot.releaseSha256)
            throw new Error('[THREADS_RECOVERY_CONFLICT]');
        assertThreadsOwnerRelease(release,{body_sha256:snapshot.bodySha256,channel_id:snapshot.channelId,
            accepted_revision:snapshot.revision,manifest_checksum:snapshot.manifestChecksum,actor_id:a.actorId,
            approval_reference:String(object(release.before_state).approval_reference||'')});
        const currentUsername=checked.config.channel_username||checked.config.account_ref;
        if(typeof currentUsername!=='string')throw new Error('[THREADS_RECOVERY_PACKAGE_CHANGED]');
        assertThreadsPackageProof(object(release.after_state),{task_id:a.taskId,channel_id:checked.task.channel_id,
            content_revision:checked.task.content_revision,accepted_revision:checked.task.accepted_revision,
            body_sha256:checked.bodySha256,schedule_at:checked.task.schedule_at?.toISOString()||null,
            publish_at:checked.task.publish_at?.toISOString()||null,decision_id:checked.decision?.id,
            visual_state:checked.task.visual_state,selected_asset_id:checked.task.selected_asset_id,placement:checked.task.visual_placement,
            threads_user_id:String(checked.config.threads_user_id),
            username:currentUsername.replace(/^@/,'')});
        return {checked,snapshot,row};
    }

    /** Provider GET-only reconciliation; this operation never creates or publishes a container. */
    async reconcile(input:ThreadsReconcileArgs,callerSignal?:AbortSignal):Promise<Record<string,unknown>>{
        for(let round=0;round<3;round+=1){
            if(callerSignal?.aborted)throw new Error('[THREADS_RECOVERY_INTERRUPTED]');
            try{return await this.reconcileOnce(input,callerSignal);}catch(error:unknown){
                if(callerSignal?.aborted)throw new Error('[THREADS_RECOVERY_INTERRUPTED]');
                if(!(error instanceof Error)||!error.message.startsWith('[THREADS_RECOVERY_LOOKUP_INCOMPLETE]')||round===2)throw error;
                const wait=await this.deps.db.$transaction(async tx=>{
                    await this.manifest(tx,input.projectId,input.actorId,input.expectedManifestChecksum);
                    const {row}=await loadThreadsApiState(tx,input.projectId,input.taskId,input.attemptId);
                    if(!row.deadline_at||!row.next_read_at||row.rounds>=3||this.deps.now()>=row.deadline_at.getTime())
                        throw new Error('[THREADS_RECOVERY_BUDGET_EXHAUSTED]');
                    return Math.max(0,row.next_read_at.getTime()-this.deps.now());
                },apiSerial);
                try{await (this.deps.pause??(async(ms,signal)=>{await pause(ms,undefined,{signal});}))(wait,callerSignal);}
                catch{throw new Error('[THREADS_RECOVERY_INTERRUPTED]');}
            }
        }
        throw new Error('[THREADS_RECOVERY_BUDGET_EXHAUSTED]');
    }

    private async reconcileOnce(input:ThreadsReconcileArgs,callerSignal?:AbortSignal):Promise<Record<string,unknown>>{
        const a=threadsReconcileSchema.parse({projectId:input.projectId,taskId:input.taskId,attemptId:input.attemptId,
            actorId:input.actorId,expectedManifestChecksum:input.expectedManifestChecksum});
        if(!this.deps.recoveryEnabled)throw new Error('[THREADS_RECOVERY_CAPABILITY_UNAVAILABLE]');
        const reserved=await this.deps.db.$transaction(async tx=>{
            await this.manifest(tx,a.projectId,a.actorId,a.expectedManifestChecksum);
            const {row,snapshot}=await loadThreadsApiState(tx,a.projectId,a.taskId,a.attemptId);
            if(snapshot.actorId!==a.actorId||snapshot.manifestChecksum!==a.expectedManifestChecksum)throw new Error('[THREADS_RECOVERY_CONFLICT]');
            if(row.state==='confirmed'){
                const fact=await tx.publicationFact.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,
                    provider_object_id:row.post_id,outcome:'published'}});
                if(!fact)throw new Error('[THREADS_RECOVERY_CONFLICT]');
                return {complete:{mode:'published',provider_object_id:fact.provider_object_id,public_url:fact.public_url,retry_allowed:false}};
            }
            const {checked}=await this.recoveryGuard(tx,a);
            return {read:await reserveThreadsRead(tx,a,this.deps.now()),token:String(checked.config.access_token)};
        },apiSerial);
        if(reserved.complete)return reserved.complete;
        const {read,token}=reserved;
        if(!read||!read.lease||!token)throw new Error('[THREADS_RECOVERY_CONFLICT]');
        const timeout=AbortSignal.timeout(Math.max(1,Math.min(30_000,read.row.deadline_at!.getTime()-this.deps.now())));
        const signal=callerSignal?AbortSignal.any([timeout,callerSignal]):timeout;
        let result:{id:string;url:string;publishedAt:string};
        try{
            const profile=await this.deps.threads.readRecoveryProfile(token,signal);
            assertThreadsRecoveryProfile(profile,read.snapshot);
            if(signal.aborted)throw new Error('[THREADS_RECOVERY_INTERRUPTED]');
            const post=await this.deps.threads.readRecoveryPost(token,read.row.post_id!,signal);
            result=verifyThreadsRecovery(profile,post,read.snapshot,read.row.post_id!,read.row.publish_started_at!,read.row.observed_at!);
        }catch(error:unknown){
            await this.deps.db.$transaction(async tx=>{
                await tx.apiDeliveryRecovery.updateMany({where:{id:read.row.id,project_id:a.projectId,lease_sha256:read.lease},
                    data:{lease_sha256:null,lease_expires_at:null,cause_code:'THREADS_RECOVERY_LOOKUP_INCOMPLETE',row_version:{increment:1}}});
            },apiSerial);
            if(error instanceof Error&&/^\[THREADS_RECOVERY_(ACCOUNT|READBACK)/.test(error.message))throw error;
            throw new Error('[THREADS_RECOVERY_LOOKUP_INCOMPLETE] Existing attempt remains frozen; never resend');
        }
        const response={mode:'published',task_id:a.taskId,provider_object_id:result.id,public_url:result.url,
            published_at:result.publishedAt,retry_allowed:false};
        try{await this.deps.facts.record({projectId:a.projectId,taskId:a.taskId,actorId:a.actorId,artifactKind:'post',outcome:'published',
            confirmationMode:'reconciled',publishedAt:result.publishedAt,providerObjectId:result.id,publicUrl:result.url,
            evidence:{type:'api',ref:result.id},beforeWrite:async tx=>{
                await this.recoveryGuard(tx,a);
                const row=await assertThreadsFinalizer(tx,a,result.id,read.lease,this.deps.now());
                if(signal.aborted)throw new Error('[THREADS_RECOVERY_CONFLICT]');
                const changed=await tx.deliveryAttempt.updateMany({where:{id:a.attemptId,project_id:a.projectId,
                    content_item_id:a.taskId,status:'pending'},data:{status:'delivered',requires_manual_confirmation:false,
                    error_message:null,actual_published_at:new Date(result.publishedAt)}});
                if(changed.count!==1)throw new Error('[THREADS_RECOVERY_CONFLICT]');
                await tx.apiDeliveryRecovery.update({where:{id:row.id},data:{state:'confirmed',row_version:{increment:1},
                    lease_sha256:null,lease_expires_at:null,cause_code:null}});
                await tx.workflowEvent.create({data:{project_id:a.projectId,content_item_id:a.taskId,actor_id:a.actorId,
                    command:'ba_reconcile_threads_publication',idempotency_key:`threads-api:${a.attemptId}`,after_state:response}});
            },beforeCommit:async tx=>{
                const {row}=await loadThreadsApiState(tx,a.projectId,a.taskId,a.attemptId);
                if(signal.aborted||row.state!=='confirmed'||row.post_id!==result.id||row.generation!==read.row.generation
                    ||read.row.deadline_at!.getTime()<=this.deps.now()||read.row.lease_expires_at!.getTime()<=this.deps.now())
                    throw new Error('[THREADS_RECOVERY_CONFLICT]');
            }});}catch(error:unknown){
                if(error instanceof Error&&error.message.startsWith('[THREADS_RECOVERY_'))throw error;
                throw new Error('[THREADS_FACT_COMMIT_PENDING] Reconcile the existing attempt; never resend');
            }
        return response;
    }
}

export default new GenericThreadsReleaseService({ db: prisma, threads: threadsService,
    facts: publicationFactService, manifest: loadAgentWorkspaceManifest, now: () => Date.now(),
    recoveryEnabled: process.env.THREADS_API_RECOVERY_ENABLED === 'true' });
