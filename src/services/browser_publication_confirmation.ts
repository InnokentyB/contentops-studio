import { z } from 'zod';
import publicationFactService,{ RecordPublicationFactArgs } from './publication_fact.service';
import { BrowserDependencies,browserDefaults,object,hash,browserPrior,requireBrowserOwner } from './browser_publication_contract';
import { browserObservedSchema,checkedBrowserRelease,checkedBrowserAttempt,assertBrowserLease,
    assertBrowserObserved,browserObservationHash } from './browser_publication_guard';

export const browserConfirmSchema=browserObservedSchema.safeExtend({publicUrl:z.string().url().max(2000),
    providerObjectId:z.string().min(1).max(200),publishedAt:z.string().datetime({offset:true})});
const {leaseToken:omittedLease,...reconcileShape}=browserConfirmSchema.shape;
export const browserReconcileSchema=z.object(reconcileShape).strict()
    .refine(v=>v.projectId===v.snapshot.projectId&&v.taskId===v.snapshot.taskId,{message:'SCOPE_MISMATCH'});
type Confirmation=z.infer<typeof browserConfirmSchema>;
type Reconciliation=z.infer<typeof browserReconcileSchema>;
type FactWriter=(args:RecordPublicationFactArgs)=>Promise<unknown>;
/** Native publication time must belong to this attempt, not its historical schedule. */
export function assertBrowserPublicationTime(attempt:{created_at:Date},publishedAt:string,now=new Date()):void {
    const timestamp=new Date(publishedAt).getTime(),started=attempt.created_at.getTime();
    if(!Number.isFinite(timestamp)||!Number.isFinite(started)||timestamp<started-120000||timestamp>now.getTime()+30000)
        throw new Error('[BROWSER_PUBLICATION_TIME_MISMATCH]');
}
/** Preserve provider namespaces; Registry/profile equality alone does not prove author ownership. */
export function browserProviderIdentity(args:Reconciliation) {
    const url=new URL(args.publicUrl),identity=args.snapshot.identity;
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash)throw new Error('[PROVIDER_IDENTITY_INVALID]');
    if(identity.platform==='linkedin'){
        const match=/^\/feed\/update\/(urn:li:(?:activity|share):[1-9]\d*)\/?$/.exec(url.pathname);
        if(url.hostname!=='www.linkedin.com'||!match||match[1]!==args.providerObjectId
            ||[...url.searchParams].some(([key,value])=>key!=='actorCompanyId'||identity.accountType!=='company_page'||value!==identity.providerAccountId))
            throw new Error('[PROVIDER_IDENTITY_INVALID]');
        return `https://www.linkedin.com/feed/update/${args.providerObjectId}/`;
    }
    const author=new URL(identity.profileUrl).pathname.replace(/\/$/,'');
    const pathPattern=new RegExp(`^${author}/[a-z0-9-]+/?$`);
    if(url.hostname!=='dev.to'||url.search||!pathPattern.test(url.pathname)||!/^\d+$/.test(args.providerObjectId))
        throw new Error('[PROVIDER_IDENTITY_INVALID]');
    return `https://dev.to${url.pathname.replace(/\/$/,'')}`;
}
async function completeBrowser(input:unknown,reconcile:boolean,deps:BrowserDependencies,writeFact:FactWriter) {
    const args=reconcile?browserReconcileSchema.parse(input):browserConfirmSchema.parse(input);
    const command=reconcile?'ba_reconcile_browser_submission':'ba_confirm_browser_submission';
    const publicUrl=browserProviderIdentity(args);
    // Committed replay is read-only. Never call the fact writer again or manufacture send permission.
    const prior=await deps.db.$transaction(async tx=>{
        await requireBrowserOwner(tx,args);const replay=await browserPrior(tx,args,command);if(!replay)return null;
        const fact=await tx.publicationFact.findUnique({where:{content_item_id:args.taskId}});
        if(!fact||fact.project_id!==args.projectId||fact.channel_id!==args.snapshot.channelId||fact.public_url!==publicUrl
            ||fact.provider_object_id!==args.providerObjectId||fact.evidence_ref!==`sha256:${args.evidenceSha256}`)
            throw new Error('[BROWSER_FACT_RECONCILIATION_REQUIRED]');
        return{...replay,replayed:true,retry_allowed:false,submission_permitted:false};
    });
    if(prior)return prior;
    const result={project_id:args.projectId,task_id:args.taskId,public_url:publicUrl,
        provider_object_id:args.providerObjectId,attempt_id:args.attemptId,retry_allowed:false,
        submission_permitted:false,replayed:false,assurance:'executor_readback_not_independent_provider_query'};
    const fact=await writeFact({projectId:args.projectId,taskId:args.taskId,actorId:args.actorId,
        artifactKind:args.snapshot.identity.platform==='devto'?'article':'post',outcome:'published',
        browserWorkItemId:args.workItemId,publicUrl,providerObjectId:args.providerObjectId,publishedAt:args.publishedAt,
        confirmationMode:reconcile?'reconciled':'automatic',evidence:{type:'screenshot',ref:`sha256:${args.evidenceSha256}`},
        utmStatus:'not_applicable',beforeWrite:async tx=>{
            const {task,work}=await checkedBrowserRelease(tx,args,deps);
            if(task.status!=='publishing')throw new Error('[BROWSER_NOT_STARTED]');
            const attempt=await checkedBrowserAttempt(tx,args);assertBrowserObserved(task.draft_text!,args);
            assertBrowserPublicationTime(attempt,args.publishedAt);
            if(!reconcile){
                const leased=browserConfirmSchema.parse(input);assertBrowserLease(work,leased);
                if(attempt.error_message)throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
                const pre=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
                    work_item_id:args.workItemId,actor_id:args.actorId,command:'ba_pre_submit_browser_submission',idempotency_key:args.idempotencyKey}});
                const proof=object(pre?.after_state);
                if(proof.attempt_id!==args.attemptId||proof.lease_sha256!==hash(leased.leaseToken)
                    ||proof.observation_sha256!==browserObservationHash(args))throw new Error('[BROWSER_PRE_SUBMIT_REQUIRED]');
            }
            const changed=await tx.deliveryAttempt.updateMany({where:{id:args.attemptId,project_id:args.projectId,
                content_item_id:args.taskId,channel_id:args.snapshot.channelId,status:'pending',idempotency_key:args.idempotencyKey},
                data:{status:'delivered',actual_published_at:new Date(args.publishedAt),requires_manual_confirmation:false,error_message:null}});
            if(changed.count!==1)throw new Error('[BROWSER_CONFIRM_CAS_CONFLICT]');
            await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,
                actor_id:args.actorId,command,idempotency_key:args.idempotencyKey,
                before_state:{request_hash:hash(JSON.stringify(args))},after_state:result}});
        }});
    return{...object(fact),...result};
}
/** All checks, attempt completion and audit run inside the canonical fact transaction. */
export function confirmBrowserSubmission(input:unknown,deps:BrowserDependencies=browserDefaults,
    writeFact:FactWriter=args=>publicationFactService.record(args)) {
    return completeBrowser(input,false,deps,writeFact);
}
/** Owner readback of an existing object after UNKNOWN/expired lease, never release/retry. */
export function reconcileBrowserSubmission(input:unknown,deps:BrowserDependencies=browserDefaults,
    writeFact:FactWriter=args=>publicationFactService.record(args)) {
    return completeBrowser(input,true,deps,writeFact);
}
