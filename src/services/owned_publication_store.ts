import {assertManualPublicationTransportMutable} from './owner_manual_publication_fence';
import {lockOwnedPublicationTask} from './publication_owned_guard';
import {ownedTransaction} from './owned_publication_invocation';
import {Prisma} from '@prisma/client';
import {randomUUID} from 'crypto';
import {ownedObject as object,ownedHash,ownedPackageSchema,ownedClaimSchema,checkedOwnedReceipt} from './owned_publication_contract';
import type {OwnedPublicationRequest as Request,OwnedPublicationPrincipal as Principal,OwnedPublicationPackage as Package,
    OwnedPublicationClaim as Claim,OwnedPublicationReceipt as Receipt,OwnedPublicationInventory as Inventory,OwnedPublicationResult as Result} from './owned_publication_contract';
import {ownedSerial as serial,ownedActor,ownedAudit,ownedLock,ownedPrincipal,ownedExpected,ownedSnapshot,ownedReleaseEvent,ownedJobWhere} from './owned_publication_guard';
import type {OwnedPublicationDependencies as Dependencies} from './owned_publication_guard';
import {ownedLegacyClaim,ownedLegacyReleaseProof} from './owned_publication_legacy';
import {ownedCommitted,ownedCurrent,ownedStage,ownedReceipt,ownedCanonical,ownedComplete,ownedLinkFact,ownedUniqueHistory} from './owned_publication_store_state';
export type {OwnedPublicationDependencies} from './owned_publication_guard';
/** All mutations share ContentItem locking with legacy CAS producers. No provider I/O in transactions. */
export class OwnedPublicationStore{
    constructor(readonly dependencies:Dependencies){}
    private now(){return this.dependencies.now?.()||new Date();}
    inspect(r:Request,p:Principal){return ownedTransaction(this.dependencies.db,async tx=>{await ownedPrincipal(tx,r,p);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);return ownedSnapshot(tx,r,p,this.dependencies);},serial);}
    /** An exact release replay returns its immutable identity without creating authorization again. */
    async releaseReplay(r:Request,p:Principal):Promise<Result|null>{
        return ownedTransaction(this.dependencies.db,async tx=>{
            await ownedPrincipal(tx,r,p,true);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);const release=await ownedReleaseEvent(tx,r);
            if(!release||release.command!=='owned_publication.release'||release.idempotency_key!==r.idempotencyKey)return null;
            const pkg=ownedPackageSchema.parse(object(release.after_state).package);ownedExpected(r,pkg);
            if(r.approvalReference!==pkg.approvalReference||p.actorId!==pkg.releaseActorId)throw Error('OWNED_RELEASE_CONFLICT');
            if((await this.dependencies.manifest(r.projectId,p.userId,tx)).checksum!==pkg.manifest)throw Error('OWNED_PACKAGE_CONFLICT');
            const jobs=await tx.connectorDispatchJob.findMany({where:{project_id:r.projectId,content_item_id:r.taskId}});
            if(jobs.length!==1||object(jobs[0].binding).protocol!=='owned_provider_v1'||object(jobs[0].binding).release_id!==release.id)throw Error('OWNED_HISTORY_AMBIGUOUS');
            const attempts=await tx.deliveryAttempt.findMany({where:{project_id:r.projectId,content_item_id:r.taskId}});
            if(attempts.length>1||attempts.length===1&&jobs[0].attempt_id!==attempts[0].id)throw Error('OWNED_HISTORY_AMBIGUOUS');
            const task=await tx.contentItem.findUnique({where:{id:r.taskId}});
            if(task?.published_link){
                if(attempts.length!==1)return null;
                const e=await tx.workflowEvent.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,actor_id:ownedActor,command:'owned_publication.claim',idempotency_key:attempts[0].idempotency_key}});
                const c=ownedClaimSchema.parse(object(e?.after_state).claim);await ownedUniqueHistory(tx,c);
                const receipt=await ownedReceipt(tx,c,this.now());if(!receipt||!await ownedCanonical(tx,c,receipt))return null;
            }
            return {state:'released',project_id:r.projectId,task_id:r.taskId,retry_allowed:false,release_id:release.id,job_id:jobs[0].id};
        },serial);
    }
    async release(r:Request,p:Principal):Promise<Result>{
        return ownedTransaction(this.dependencies.db,async tx=>{
            await ownedPrincipal(tx,r,p,true);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);const pkg=await ownedSnapshot(tx,r,p,this.dependencies);ownedExpected(r,pkg);
            if(!r.idempotencyKey||!r.approvalReference)throw Error('OWNED_RELEASE_BINDING_REQUIRED');
            const attempts=await tx.deliveryAttempt.count({where:{project_id:r.projectId,content_item_id:r.taskId}});
            const facts=await tx.publicationFact.count({where:{project_id:r.projectId,content_item_id:r.taskId}});
            const prior=await ownedReleaseEvent(tx,r);
            const jobs=await tx.connectorDispatchJob.findMany({where:{project_id:r.projectId,content_item_id:r.taskId}});
            const keyCollision=await tx.connectorDispatchJob.findFirst({where:{project_id:r.projectId,idempotency_key:r.idempotencyKey}});
            if(keyCollision&&keyCollision.content_item_id!==r.taskId)throw Error('OWNED_QUEUE_KEY_CONFLICT');
            if(prior){
                const old=ownedPackageSchema.parse(object(prior.after_state).package);
                if(old.digest!==pkg.digest||prior.idempotency_key!==r.idempotencyKey||prior.actor_id!==p.actorId||jobs.length!==1
                    ||attempts>1||object(jobs[0].binding).protocol!=='owned_provider_v1')throw Error('OWNED_RELEASE_CONFLICT');
                return {state:'released',project_id:r.projectId,task_id:r.taskId,retry_allowed:false,release_id:prior.id,job_id:jobs[0].id};
            }
            if(attempts||facts)throw Error('OWNED_RECONCILIATION_REQUIRED');
            const work=await tx.workItem.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,kind:{in:['browser_publish','provider_publish']}}});
            const events=await tx.workflowEvent.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,OR:[{command:{contains:'_claim'}},{command:{endsWith:':claim'}}]}});
            if(jobs.length||work||events)throw Error('OWNED_HISTORY_CONFLICT');
            const release=await tx.workflowEvent.create({data:{project_id:r.projectId,content_item_id:r.taskId,actor_id:p.actorId,
                command:'owned_publication.release',idempotency_key:r.idempotencyKey,after_state:{package:{...pkg},approval_reference:r.approvalReference}}});
            pkg.releaseId=release.id;
            const wi=await tx.workItem.create({data:{project_id:r.projectId,content_item_id:r.taskId,item_key:`owned-provider:${r.taskId}:${pkg.digest}`,
                kind:'provider_publish',state:'available',assignee_role:'publisher',input_context_version:pkg.revision,
                result_payload:{protocol:'owned_provider_v1',provider:pkg.provider,package_digest:pkg.digest,release_id:release.id}}});
            const job=await tx.connectorDispatchJob.create({data:{project_id:r.projectId,content_item_id:r.taskId,channel_id:pkg.channelId,work_item_id:wi.id,
                content_revision:pkg.revision,selected_asset_id:pkg.selectedAssetId,package_sha256:pkg.digest,binding:{protocol:'owned_provider_v1',provider:pkg.provider,package:{...pkg},release_id:release.id},idempotency_key:r.idempotencyKey,state:'released'}});
            await tx.contentItem.update({where:{id:r.taskId},data:{publication_mode:'owner_released'}});
            return {state:'released',project_id:r.projectId,task_id:r.taskId,retry_allowed:false,release_id:release.id,job_id:job.id};
        },serial);
    }
    async claim(r:Request,p:Principal,inventory:Inventory):Promise<Claim>{
        return ownedTransaction(this.dependencies.db,async tx=>{
            await ownedPrincipal(tx,r,p);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);const pkg=await ownedSnapshot(tx,r,p,this.dependencies);ownedExpected(r,pkg);
            const task=await tx.contentItem.findUnique({where:{id:r.taskId}});
            const release=await ownedReleaseEvent(tx,r);
            if(!release)throw Error('OWNED_RELEASE_REQUIRED');
            if(release.command==='owned_publication.release'){const original=ownedPackageSchema.parse(object(release.after_state).package);if(original.digest!==pkg.digest)throw Error('OWNED_RELEASE_CONFLICT');}
            else ownedLegacyReleaseProof(release,pkg);
            if(!release||!r.idempotencyKey||task?.status!=='ready_for_execution'||task.publication_mode!=='owner_released'
                ||Date.parse(pkg.schedule)>this.now().getTime())throw Error('OWNED_RELEASE_REQUIRED');
            const [attempts,facts,jobs,legacy,work]=await Promise.all([
                tx.deliveryAttempt.count({where:{project_id:r.projectId,content_item_id:r.taskId}}),tx.publicationFact.count({where:{project_id:r.projectId,content_item_id:r.taskId}}),
                tx.connectorDispatchJob.findMany({where:{project_id:r.projectId,content_item_id:r.taskId}}),
                tx.workflowEvent.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,OR:[{command:{contains:'_claim'}},{command:{endsWith:':claim'}},{command:'owned_publication.claim'}]}}),
                tx.workItem.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,kind:'browser_publish'}})]);
            if(attempts||facts||legacy||work||jobs.length>1)throw Error('OWNED_RECONCILIATION_REQUIRED');
            if(jobs.length===0){
                if(release.command==='owned_publication.release'||!release.idempotency_key)throw Error('OWNED_JOB_MISSING');
                const collision=await tx.connectorDispatchJob.findFirst({where:{project_id:r.projectId,idempotency_key:release.idempotency_key}});
                if(collision)throw Error('OWNED_QUEUE_KEY_CONFLICT');
                const wi=await tx.workItem.create({data:{project_id:r.projectId,content_item_id:r.taskId,item_key:`owned-provider:${r.taskId}:${pkg.digest}`,kind:'provider_publish',state:'available',assignee_role:'publisher',input_context_version:pkg.revision,result_payload:{protocol:'owned_provider_v1',provider:pkg.provider,package_digest:pkg.digest,release_id:release.id}}});
                jobs.push(await tx.connectorDispatchJob.create({data:{project_id:r.projectId,content_item_id:r.taskId,channel_id:pkg.channelId,work_item_id:wi.id,content_revision:pkg.revision,selected_asset_id:pkg.selectedAssetId,package_sha256:pkg.digest,binding:{protocol:'owned_provider_v1',provider:pkg.provider,package:{...pkg},release_id:release.id},idempotency_key:release.idempotency_key,state:'released'}}));
                await ownedAudit(tx,pkg,'adopt_release',String(release.id),{release_id:release.id,package_digest:pkg.digest});
            }
            const job=jobs[0];if(object(job.binding).protocol!=='owned_provider_v1'||object(job.binding).provider!==pkg.provider||job.package_sha256!==pkg.digest
                ||job.state!=='released'||job.attempt_id||object(job.binding).release_id!==release.id
                ||JSON.stringify(ownedPackageSchema.parse(object(job.binding).package))!==JSON.stringify(pkg))throw Error('OWNED_JOB_CONFLICT');
            const age=this.now().getTime()-Date.parse(inventory.checkedAt);
            if(!inventory.complete||!inventory.absent||inventory.accountId!==pkg.accountId||inventory.packageDigest!==pkg.digest||!Number.isFinite(age)||age<0||age>60000)throw Error('OWNED_INVENTORY_INCOMPLETE');
            const generation=job.generation+1,leaseSha256=ownedHash(randomUUID());
            const changed=await tx.contentItem.updateMany({where:{id:r.taskId,project_id:r.projectId,status:'ready_for_execution',updated_at:task.updated_at},data:{status:'publishing'}});
            if(changed.count!==1)throw Error('OWNED_CAS_CONFLICT');
            const attempt=await tx.deliveryAttempt.create({data:{project_id:r.projectId,content_item_id:r.taskId,channel_id:pkg.channelId,mode:'automatic',status:'pending',attempt_number:1,
                idempotency_key:r.idempotencyKey,scheduled_at:new Date(pkg.schedule),created_at:this.now(),requires_manual_confirmation:true}});
            const claim:Claim={attemptId:attempt.id,key:r.idempotencyKey,package:pkg,generation,jobId:job.id,workItemId:job.work_item_id,leaseSha256};
            const patched=await tx.connectorDispatchJob.updateMany({where:{id:job.id,...ownedJobWhere(pkg),generation:job.generation,state:'released',attempt_id:null},data:{state:'claimed',attempt_id:attempt.id,generation,
                canonical_lease_sha256:leaseSha256,canonical_lease_expires_at:new Date(this.now().getTime()+240000)}});
            if(patched.count!==1)throw Error('OWNED_JOB_CONFLICT');
            await tx.workItem.update({where:{id:job.work_item_id},data:{state:'claimed',lease_actor_id:p.actorId,lease_expires_at:new Date(this.now().getTime()+240000)}});
            await ownedAudit(tx,pkg,'claim',claim.key,{claim:{...claim,package:{...pkg}},inventory:{...inventory},actor_id:p.actorId});return claim;
        },serial);
    }
    async start(r:Request,p:Principal,c:Claim){
        await ownedTransaction(this.dependencies.db,async tx=>{
            const {attempt,job}=await ownedCurrent(tx,r,p,this.dependencies,c);
            if(attempt.status!=='pending'||attempt.error_message||!job||job.state!=='claimed'||!job.canonical_lease_expires_at||job.canonical_lease_expires_at<this.now())throw Error('OWNED_ATTEMPT_FROZEN');
            await ownedAudit(tx,c.package,'started',String(c.attemptId),{package_digest:c.package.digest,generation:c.generation,actor_id:p.actorId});
            await tx.connectorDispatchJob.update({where:{id:job.id},data:{state:'started'}});
        },serial);
    }
    async submit(r:Request,p:Principal,c:Claim,observation?:{objectId:string;accountId:string}){
        await ownedTransaction(this.dependencies.db,async tx=>{
            const {attempt,job}=await ownedCurrent(tx,r,p,this.dependencies,c);await ownedStage(tx,c,'started');
            if(!observation||observation.accountId!==c.package.accountId||!/^[\w-]{1,200}$/.test(observation.objectId))throw Error('OWNED_OBJECT_REQUIRED');
            if(attempt.status!=='pending'||attempt.error_message||!job||job.state!=='started'||!job.canonical_lease_expires_at||job.canonical_lease_expires_at<this.now())throw Error('OWNED_ATTEMPT_FROZEN');
            await ownedAudit(tx,c.package,'submit_consumed',String(c.attemptId),{package_digest:c.package.digest,generation:c.generation,object_id:observation.objectId,account_id:observation.accountId,actor_id:p.actorId});
            await tx.connectorDispatchJob.update({where:{id:job.id},data:{state:'submit_consumed'}});
        },serial);
    }
    async saveReceipt(c:Claim,value:Receipt){
        for(let retry=0;retry<3;retry++){
            try{return await this.saveReceiptOnce(c,value);}catch(error:unknown){
                if(!(error instanceof Prisma.PrismaClientKnownRequestError)||error.code!=='P2034'||retry===2)throw error;
            }
        }
    }
    private async saveReceiptOnce(c:Claim,value:Receipt){
        await ownedTransaction(this.dependencies.db,async tx=>{
            await lockOwnedPublicationTask(tx,c.package);await assertManualPublicationTransportMutable(tx,c.package);
            const {attempt}=await ownedCommitted(tx,c);await ownedStage(tx,c,'submit_consumed');
            const receipt=checkedOwnedReceipt(value,c,attempt.created_at,this.now());
            const submit=await tx.workflowEvent.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:ownedActor,command:'owned_publication.submit_consumed',idempotency_key:String(c.attemptId)}});
            if(object(submit?.after_state).object_id!==receipt.objectId||object(submit?.after_state).account_id!==receipt.accountId)throw Error('OWNED_OBJECT_CONFLICT');
            const prior=await ownedReceipt(tx,c,this.now());
            if(prior){if(JSON.stringify(prior)!==JSON.stringify(receipt))throw Error('OWNED_RECEIPT_CONFLICT');return;}
            const changed=await tx.deliveryAttempt.updateMany({where:{id:c.attemptId,project_id:c.package.projectId,content_item_id:c.package.taskId,idempotency_key:c.key,status:'pending'},data:{status:'verification_required',requires_manual_confirmation:true}});
            if(changed.count!==1)throw Error('OWNED_ATTEMPT_CONFLICT');
            await ownedAudit(tx,c.package,'receipt',String(c.attemptId),{receipt:{...receipt},receipt_digest:ownedHash(JSON.stringify(receipt))});
            if(c.jobId)await tx.connectorDispatchJob.updateMany({where:{id:c.jobId,...ownedJobWhere(c.package),attempt_id:c.attemptId,generation:c.generation},data:{state:'receipt_retained',receipt_at:this.now()}});
        },serial);
    }
    async loadClaim(r:Request,p:Principal):Promise<Claim>{
        return ownedTransaction(this.dependencies.db,async tx=>{
            await ownedPrincipal(tx,r,p);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);
            if(!r.attemptId||!r.idempotencyKey)throw Error('OWNED_ORIGINAL_ATTEMPT_REQUIRED');
            const event=await tx.workflowEvent.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,actor_id:ownedActor,command:'owned_publication.claim',idempotency_key:r.idempotencyKey}});
            const c=event?ownedClaimSchema.parse(object(event.after_state).claim):await ownedLegacyClaim(tx,r);
            if(!c)throw Error('OWNED_LEGACY_HISTORY_UNSUPPORTED');
            if(c.attemptId!==r.attemptId)throw Error('OWNED_ATTEMPT_CONFLICT');await ownedCommitted(tx,c);await ownedUniqueHistory(tx,c);
            if((r.expectedPackageSha256&&r.expectedPackageSha256!==c.package.digest)||(r.expectedAcceptedRevision&&r.expectedAcceptedRevision!==c.package.revision)
                ||(r.expectedManifestChecksum&&r.expectedManifestChecksum!==c.package.manifest))throw Error('OWNED_PACKAGE_CONFLICT');
            const submit=await tx.workflowEvent.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,actor_id:ownedActor,command:'owned_publication.submit_consumed',idempotency_key:String(c.attemptId)}});
            const objectId=object(submit?.after_state).object_id;return typeof objectId==='string'?{...c,nativeObjectId:objectId}:c;
        },serial);
    }
    async assertRecovery(r:Request,p:Principal,c:Claim){
        await ownedTransaction(this.dependencies.db,async tx=>{await ownedPrincipal(tx,r,p);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);await ownedCommitted(tx,c);await ownedUniqueHistory(tx,c);},serial);
    }
    async replay(r:Request,p:Principal):Promise<Result|null>{
        return ownedTransaction(this.dependencies.db,async tx=>{
            await ownedPrincipal(tx,r,p);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);
            const attempts=await tx.deliveryAttempt.findMany({where:{project_id:r.projectId,content_item_id:r.taskId},orderBy:{id:'asc'}});
            const fact=await tx.publicationFact.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId}});
            if(!attempts.length)return fact?this.held(r):null;
            if(attempts.length!==1)return this.held(r,attempts[0].id);
            const attempt=attempts[0];const event=await tx.workflowEvent.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,actor_id:ownedActor,
                command:'owned_publication.claim',idempotency_key:attempt.idempotency_key}});
            const c=event?ownedClaimSchema.parse(object(event.after_state).claim):await ownedLegacyClaim(tx,{...r,attemptId:attempt.id,idempotencyKey:attempt.idempotency_key||undefined});
            if(!c)return this.held(r,attempt.id);
            try{await ownedUniqueHistory(tx,c);}catch(error:unknown){if(error instanceof Error&&error.message==='OWNED_HISTORY_AMBIGUOUS')return this.held(r,attempt.id);throw error;}
            if((r.expectedPackageSha256&&r.expectedPackageSha256!==c.package.digest)||(r.expectedAcceptedRevision&&r.expectedAcceptedRevision!==c.package.revision)
                ||(r.expectedManifestChecksum&&r.expectedManifestChecksum!==c.package.manifest))throw Error('OWNED_PACKAGE_CONFLICT');
            const receipt=await ownedReceipt(tx,c,this.now());return receipt?await ownedCanonical(tx,c,receipt)||this.held(r,c.attemptId):this.held(r,c.attemptId);
        },serial);
    }
    held(r:Request,id?:number):Result{return{state:'verification_required',project_id:r.projectId,task_id:r.taskId,attempt_id:id,retry_allowed:false,blocker:'OWNED_RECONCILIATION_REQUIRED'};}
    /** Internal uncertainty custody records a bounded reason; it never reopens dispatch. */
    async freeze(c:Claim,reason:'OWNED_PROVIDER_OUTCOME_UNCERTAIN'|'OWNED_COMPLETION_REQUIRES_RECONCILIATION'){
        await ownedTransaction(this.dependencies.db,async tx=>{
            await lockOwnedPublicationTask(tx,c.package);await assertManualPublicationTransportMutable(tx,c.package);
            const {attempt}=await ownedCommitted(tx,c);if(attempt.status==='delivered')return;
            await tx.deliveryAttempt.updateMany({where:{id:c.attemptId,project_id:c.package.projectId,content_item_id:c.package.taskId,status:{in:['pending','verification_required']}},data:{requires_manual_confirmation:true,error_message:reason}});
            if(c.jobId)await tx.connectorDispatchJob.updateMany({where:{id:c.jobId,...ownedJobWhere(c.package),attempt_id:c.attemptId,generation:c.generation,state:{not:'confirmed'}},data:{blocker_code:reason}});
            const command=c.origin==='legacy_native_v1'?`${c.eventNamespace}:uncertain`:'owned_publication.uncertain';
            const actor=c.origin==='legacy_native_v1'?`system:planner-mcp:dzen-task${c.package.taskId}`:ownedActor;
            const prior=await tx.workflowEvent.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:actor,command,idempotency_key:String(c.attemptId)}});
            if(!prior)await tx.workflowEvent.create({data:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:actor,command,idempotency_key:String(c.attemptId),after_state:{reason_code:reason,attempt_id:c.attemptId,package_digest:c.package.digest}}});
        },serial);
    }
    async retained(c:Claim){return ownedTransaction(this.dependencies.db,tx=>ownedReceipt(tx,c,this.now()),serial);}
    async confirm(r:Request,p:Principal,c:Claim):Promise<Result>{
        const receipt=await this.retained(c);if(!receipt)return this.held(r,c.attemptId);
        for(let retry=0;retry<3;retry++){
            try{
                await this.dependencies.facts.record({projectId:r.projectId,taskId:r.taskId,actorId:p.actorId,artifactKind:'article',outcome:'published',confirmationMode:'automatic',
                    publicUrl:receipt.url,providerObjectId:receipt.objectId,publishedAt:receipt.publishedAt,evidence:{type:'api',ref:receipt.objectId},
                    beforeWrite:tx=>ownedComplete(tx,r,p,this.dependencies,c,receipt),afterWrite:(tx,factId)=>ownedLinkFact(tx,c,factId)});
                const result=await this.replay(r,p);if(result?.state!=='published')throw Error('OWNED_COMPLETION_MISSING');return result;
            }catch(error:unknown){
                const result=await this.replay(r,p);if(result?.state==='published')return result;
                if(!(error instanceof Prisma.PrismaClientKnownRequestError)||error.code!=='P2034'||retry===2)throw error;
            }
        }return this.held(r,c.attemptId);
    }
}
