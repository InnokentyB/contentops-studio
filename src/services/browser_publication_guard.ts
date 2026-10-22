import {instructionForRequest} from './browser_owner_instruction_state';
import {assertBrowserRecoveryWriter,type PreparationWriterPurpose} from './browser_recovery_guard';
import { timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { BrowserDb, BrowserDependencies, BrowserRequest, browserRequestSchema,
    checkedBrowserContext, browserFingerprint, snapshotHash, object, checksum, paragraphHashes, hash,
    isBrowserTextOnlySnapshot } from './browser_publication_contract';

export const browserClaimSchema=browserRequestSchema.safeExtend({workItemId:z.number().int().positive(),
    leaseSeconds:z.number().int().min(30).max(1800).optional()});
export const browserBoundarySchema=browserClaimSchema.safeExtend({leaseToken:z.string().min(16).max(200)});
export const browserObservedSchema=browserBoundarySchema.safeExtend({attemptId:z.number().int().positive(),
    observedProfileUrl:z.string().url(),observedProviderAccountId:z.string().min(1).max(100),
    observedAccountType:z.enum(['company_page','personal']),observedBodySha256:checksum,observedAssetSha256:checksum.nullable(),
    paragraphBlockSha256:z.array(checksum).min(1).max(1000),attachedImageCount:z.number().int().min(0).max(10),
    duplicateAbsent:z.boolean(),evidenceSha256:checksum});
export type BrowserBoundary=z.infer<typeof browserBoundarySchema>;
export type BrowserObserved=z.infer<typeof browserObservedSchema>;
/** Compare tokens without leaking their values to audit or errors. */
export function equalBrowserLease(stored:string|null,supplied:string):boolean {
    if(!stored)return false;const a=Buffer.from(stored),b=Buffer.from(supplied);
    return a.length===b.length&&timingSafeEqual(a,b);
}
export async function checkedBrowserRelease(tx:BrowserDb,args:BrowserRequest&{workItemId:number},deps:BrowserDependencies,purpose?:PreparationWriterPurpose) {
    await assertBrowserRecoveryWriter(tx,args,purpose);
    const task=await checkedBrowserContext(tx,args,deps);
    if(task.publication_fact||task.published_link||task.publication_mode!=='browser_required')throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
    const work=await tx.workItem.findFirst({where:{id:args.workItemId,project_id:args.projectId,content_item_id:args.taskId,
        kind:'browser_publish',assignee_role:'browser_publisher',input_context_version:args.snapshot.contentRevision}});
    const proof=object(work?.result_payload),ownerProof=object(object(task.quality_report).browser_release);
    if(!work||!isDeepStrictEqual(proof,ownerProof)||proof.lifecycle!=='shared_browser_v1'
        ||proof.publication_authorized!==true||proof.approval_reference!==args.approvalReference
        ||proof.snapshot_sha256!==snapshotHash(args.snapshot)||proof.fingerprint!==browserFingerprint(task,args.snapshot))
        throw new Error('[BROWSER_RELEASE_PROOF_INVALID]');
    const audit=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
        work_item_id:work.id,actor_id:String(proof.actor_id),command:'ba_release_browser_publication',idempotency_key:String(proof.release_key)}});
    if(object(audit?.after_state).browser_work_item_id!==work.id||object(audit?.after_state).publication_authorized!==true
        ||!isDeepStrictEqual(object(audit?.after_state).snapshot,args.snapshot))throw new Error('[BROWSER_RELEASE_AUDIT_REQUIRED]');
    return{task,work,proof};
}
export function assertBrowserLease(work:{state:string;lease_actor_id:string|null;lease_token:string|null;lease_expires_at:Date|null},args:BrowserBoundary):void {
    if(work.state!=='claimed'||work.lease_actor_id!==args.actorId||!equalBrowserLease(work.lease_token,args.leaseToken)
        ||!work.lease_expires_at||work.lease_expires_at<=new Date())throw new Error('[BROWSER_ACTIVE_LEASE_REQUIRED]');
}
export async function checkedBrowserAttempt(tx:BrowserDb,args:BrowserRequest&{attemptId:number}) {
    const attempt=await tx.deliveryAttempt.findFirst({where:{id:args.attemptId,project_id:args.projectId,
        content_item_id:args.taskId,channel_id:args.snapshot.channelId,idempotency_key:args.idempotencyKey,status:'pending'}});
    const instruction=await instructionForRequest(tx,args),through=instruction?.historicalThroughAttemptId??0;
    if(!attempt||(instruction&&attempt.id<=through)||await tx.deliveryAttempt.count({where:{project_id:args.projectId,content_item_id:args.taskId,...(instruction?{id:{gt:through}}:{})}})!==1)
        throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
    return attempt;
}
/** Actual executor observations are necessary, but not independently signed provider proof. */
export function assertBrowserObserved(body:string,args:Omit<BrowserObserved,'leaseToken'>,ownerAllowsDuplicate=false):void {
    const s=args.snapshot,i=s.identity;
    if(args.observedProfileUrl.replace(/\/$/,'')!==i.profileUrl.replace(/\/$/,'')
        ||args.observedProviderAccountId!==i.providerAccountId||args.observedAccountType!==i.accountType
        ||args.observedBodySha256!==s.bodySha256||args.observedAssetSha256!==s.assetSha256
        ||args.attachedImageCount!==(isBrowserTextOnlySnapshot(s)?0:1)||(!args.duplicateAbsent&&!ownerAllowsDuplicate)
        ||!isDeepStrictEqual(args.paragraphBlockSha256,paragraphHashes(body)))throw new Error('[BROWSER_OBSERVATION_MISMATCH]');
}
export function browserObservationHash(args:Omit<BrowserObserved,'leaseToken'>):string {
    return hash(JSON.stringify({profile:args.observedProfileUrl.replace(/\/$/,''),account:args.observedProviderAccountId,
        type:args.observedAccountType,body:args.observedBodySha256,asset:args.observedAssetSha256,
        blocks:args.paragraphBlockSha256,count:args.attachedImageCount}));
}
