const test=require('node:test');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
const svc=require('../../dist/services/linkedin1135_browser');const {body}=require('./linkedin1135.fixture');
const {guardManualPublicationFact}=require('../../dist/services/publication_manual_fact_guard');
const p=svc.LINKEDIN1135,sha=v=>createHash('sha256').update(v).digest('hex');
const releaseArgs={projectId:10,taskId:1135,actorId:'user:2',expectedManifestChecksum:p.manifest,
    expectedBodySha256:p.bodySha256,expectedScheduleAt:p.schedule,approvalReference:'Owner: publish exact1135',
    duplicateCheckReference:'Planner scoped fingerprint scan, provider absence must be checked before Submit',idempotencyKey:'release1135'};
function fixture(){
    let state={owner:true,attempts:[],events:[],work:null,fact:null,failAudit:false,
        task:{id:1135,project_id:10,channel_id:179,content_revision:2,accepted_revision:2,text_state:'accepted',
            draft_text:body,status:'ready_for_execution',publication_mode:'approval_required',handoff_state:'ready',
            visual_state:'APPROVED',visual_placement:'feed',visual_decision_version:2,selected_asset_id:163,
            schedule_at:new Date(p.schedule),publish_at:new Date(p.schedule),published_link:null,publication_fact:null,
            quality_report:{content_language:'en',handoff_bundle:{content_language:'en'},history:'preserve'},
            channel:{id:179,project_id:10,type:'linkedin',is_active:true,config:{account_ref:p.targetProfileUrl,
                channel_url:p.targetProfileUrl,account_type:'company_page',workflow_mode:'browser_required',capability_flags:{browser_publish:true}}},
            selected_asset:{id:163,status:'approved',content_revision:2,decision_id:323,file_url:'https://media.synthetic.invalid/image163.jpg',
                provenance:{planner_storage:{sha256:p.assetSha256,managed:true,provider:'r2',mime_type:'image/jpeg'}}},
            art_direction_decisions:[{id:323,decision_version:2,source_content_revision:2,placement:'feed',status:'active',decision:'GENERATE'}]}};
    const db={projectMember:{findUnique:async()=>({role:state.owner?'owner':'editor'})},
        contentItem:{findFirst:async()=>state.task,updateMany:async({where,data})=>{
            if(where.status!==state.task.status)return{count:0};Object.assign(state.task,data);return{count:1};}},
        workItem:{findFirst:async()=>state.work,findMany:async()=>state.work?[state.work]:[],
            updateMany:async({data})=>{if(state.work.state!=='available')return{count:0};Object.assign(state.work,data);return{count:1};},
            create:async({data})=>{state.work={id:500,...data};return state.work;}},
        deliveryAttempt:{findFirst:async({where})=>state.attempts.find(a=>(!where.id||where.id===a.id)&&(!where.status||where.status===a.status)&&(!where.idempotency_key||where.idempotency_key===a.idempotency_key))||null,
            findMany:async()=>state.attempts,count:async()=>state.attempts.length,
            create:async({data})=>{const a={id:70,...data};state.attempts.push(a);return a;},
            updateMany:async({where,data})=>{const a=state.attempts.find(a=>a.id===where.id&&a.status===where.status&&a.idempotency_key===where.idempotency_key);
                if(!a)return{count:0};Object.assign(a,data);return{count:1};}},
        publicationFact:{findUnique:async()=>state.fact},
        workflowEvent:{findUnique:async({where})=>{const k=where.project_id_actor_id_command_idempotency_key;
            return state.events.find(e=>e.actor_id===k.actor_id&&e.command===k.command&&e.idempotency_key===k.idempotency_key)||null;},
            findFirst:async({where})=>state.events.find(e=>(!where.command||where.command===e.command)&&(!where.idempotency_key||where.idempotency_key===e.idempotency_key))||null,
            create:async({data})=>{if(state.failAudit)throw Error('audit unavailable');const e={id:100+state.events.length,...data};state.events.push(e);return e;}},
        $transaction:async run=>{const before=structuredClone(state);try{return await run(db);}catch(e){state=before;throw e;}}};
    const dependencies={db,manifest:async()=>({checksum:p.manifest})};
    return{db,dependencies,get state(){return state;}};
}
const boundary={projectId:10,taskId:1135,channelId:179,actorId:'user:2',workItemId:500,leaseToken:'synthetic-unit-lease',
    approvalReference:releaseArgs.approvalReference,idempotencyKey:'publish1135',contentRevision:2,
    textSha256:p.bodySha256,selectedAssetId:163,imageSha256:p.assetSha256};
const observed={observedAuthorUrl:p.targetProfileUrl,observedAccountType:'company_page',observedTextSha256:p.bodySha256,
    observedImageSha256:p.assetSha256,attachedImageCount:1,paragraphBlockSha256:svc.linkedin1135Paragraphs(body),duplicateAbsent:true,
    evidenceSha256:'1'.repeat(64)};
const confirmation={...boundary,...observed,attemptId:70,publicUrl:'https://www.linkedin.com/feed/update/urn:li:activity:777/',
    providerObjectId:'urn:li:activity:777',publishedAt:'2026-10-16T15:00:00.000Z'};
async function started(){const f=fixture();await svc.releaseLinkedIn1135(releaseArgs,f.dependencies);
    Object.assign(f.state.work,{state:'claimed',lease_actor_id:'user:2',lease_token:boundary.leaseToken,lease_expires_at:new Date(Date.now()+600000)});
    await svc.startLinkedIn1135(boundary,f.db);return f;}
function writer(f,fail=false){return async args=>f.db.$transaction(async tx=>{await args.beforeWrite(tx);if(fail)throw Error('fact unavailable');
    assert.equal(args.browserWorkItemId,500);
    const fact={id:900,project_id:10,channel_id:179,public_url:args.publicUrl,provider_object_id:args.providerObjectId,
        published_at:new Date(args.publishedAt),evidence_ref:args.evidence.ref};f.state.fact=fact;f.state.task.publication_fact=fact;f.state.task.status='published';
    return{publication_fact:fact};});}

test('exact1135 owner copy fixture and ordered blocks remain immutable',()=>{assert.equal(sha(body),p.bodySha256);assert.equal(observed.paragraphBlockSha256.length,15);});
test('owner release creates one revision-bound WI, no attempt or provider call, exact replay keeps one item',async()=>{
    const f=fixture(),copy=f.state.task.draft_text;const r=await svc.releaseLinkedIn1135(releaseArgs,f.dependencies);
    assert.equal(r.browser_work_item_id,500);assert.equal(f.state.work.input_context_version,2);
    assert.equal(f.state.task.draft_text,copy);assert.equal(f.state.attempts.length,0);
    assert.equal((await svc.releaseLinkedIn1135(releaseArgs,f.dependencies)).replayed,true);assert.equal(f.state.events.length,1);
});
test('committed release replay remains available during manifest outage, but revoked owner is denied',async()=>{
    const f=fixture();await svc.releaseLinkedIn1135(releaseArgs,f.dependencies);
    f.dependencies.manifest=async()=>{throw Error('manifest unavailable');};
    assert.equal((await svc.releaseLinkedIn1135(releaseArgs,f.dependencies)).replayed,true);
    f.state.owner=false;await assert.rejects(svc.releaseLinkedIn1135(releaseArgs,f.dependencies),/OWNER_REQUIRED/);
});
test('claim returns its lease only to owning executor; durable audit contains only its hash',async()=>{
    const f=fixture();await svc.releaseLinkedIn1135(releaseArgs,f.dependencies);
    const input={projectId:10,actorId:'user:2',workItemId:500,idempotencyKey:'claim1135'};
    const r=await svc.claimLinkedIn1135(input,f.db);assert.ok(r.lease_token);
    assert.equal(JSON.stringify(f.state.events).includes(r.lease_token),false);
    assert.equal((await svc.claimLinkedIn1135(input,f.db)).replayed,true);
});
test('wrong owner/company/image/revision, any prior attempt, fact or active WI blocks release',async()=>{
    for(const mutate of [f=>f.state.owner=false,f=>f.state.task.channel_id=6,
        f=>f.state.task.channel.config.account_ref='https://www.linkedin.com/in/innokentyb/',
        f=>f.state.task.selected_asset.content_revision=1,f=>f.state.task.selected_asset.decision_id=285,
        f=>f.state.task.accepted_revision=1,f=>f.state.task.draft_text+='drift',
        f=>f.state.attempts.push({id:1,status:'failed',requires_manual_confirmation:false,error_message:'[BROWSER_PRE_PROVIDER_ABORT_CONFIRMED]'}),
        f=>f.state.task.publication_fact={id:1},f=>f.state.work={id:1,state:'available'}]){
        const f=fixture();mutate(f);const before=structuredClone(f.state);
        await assert.rejects(svc.releaseLinkedIn1135(releaseArgs,f.dependencies));assert.deepEqual(f.state,before);
    }
});
test('release audit failure atomically rolls back task and newly created WI',async()=>{
    const f=fixture();f.state.failAudit=true;const before=structuredClone(f.state);
    await assert.rejects(svc.releaseLinkedIn1135(releaseArgs,f.dependencies),/audit unavailable/);assert.deepEqual(f.state,before);
});
test('start creates one durable attempt; UNKNOWN and different keys never create another',async()=>{
    const f=await started();assert.equal(f.state.attempts.length,1);assert.equal(f.state.task.status,'publishing');
    await svc.markLinkedIn1135Uncertain({...boundary,attemptId:70,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},f.db);
    assert.equal(f.state.attempts[0].requires_manual_confirmation,true);
    const replay=await svc.startLinkedIn1135(boundary,f.db);assert.equal(replay.attempt_id,70);
    assert.equal(replay.retry_allowed,false);assert.equal(replay.submission_permitted,false);
    await assert.rejects(svc.startLinkedIn1135({...boundary,idempotencyKey:'other'},f.db));
    await assert.rejects(svc.startLinkedIn1135({...boundary,approvalReference:'different owner reference'},f.db),/IDEMPOTENCY_CONFLICT/);
    assert.equal(f.state.attempts.length,1);assert.equal(f.state.fact,null);
});
test('pre-submit rejects collapsed paragraphs, wrong author, wrong image or missing attachment',async()=>{
    const f=await started();for(const patch of [{paragraphBlockSha256:[sha(body)]},{observedAuthorUrl:'https://www.linkedin.com/company/97416172/'},
        {observedImageSha256:'0'.repeat(64)},{attachedImageCount:0},{duplicateAbsent:false},{leaseToken:'wrong'}]){
        await assert.rejects(svc.preSubmitLinkedIn1135({...boundary,...observed,attemptId:70,...patch},f.db));
    }
    assert.equal(f.state.events.filter(e=>e.command.includes('pre_submit')).length,0);
    await svc.preSubmitLinkedIn1135({...boundary,...observed,attemptId:70},f.db);
    assert.equal((await svc.preSubmitLinkedIn1135({...boundary,...observed,attemptId:70},f.db)).replayed,true);
});
test('source URL or channel configuration drift after release cannot reach pre-submit',async()=>{
    for(const mutate of [f=>f.state.task.selected_asset.file_url='https://media.synthetic.invalid/changed.jpg',
        f=>f.state.task.channel.config.additional_binding='changed']){
        const f=await started();mutate(f);
        await assert.rejects(svc.preSubmitLinkedIn1135({...boundary,...observed,attemptId:70},f.db),/RELEASE_PROOF_INVALID/);
        assert.equal(f.state.fact,null);
    }
});
test('confirmation requires pre-submit; failure rolls back attempt/audit with no fact',async()=>{
    const f=await started();await assert.rejects(svc.confirmLinkedIn1135(confirmation,f.db,writer(f)),/PRE_SUBMIT_REQUIRED/);
    await svc.preSubmitLinkedIn1135({...boundary,...observed,attemptId:70},f.db);
    await assert.rejects(svc.confirmLinkedIn1135(confirmation,f.db,writer(f,true)),/fact unavailable/);
    assert.equal(f.state.fact,null);assert.equal(f.state.attempts[0].status,'pending');
    assert.equal(f.state.events.filter(e=>e.command.includes('ba_confirm')).length,0);
    const r=await svc.confirmLinkedIn1135(confirmation,f.db,writer(f));assert.equal(r.publication_fact.id,900);
    assert.equal(f.state.attempts[0].status,'delivered');assert.equal((await svc.confirmLinkedIn1135(confirmation,f.db,writer(f))).replayed,true);
});
test('expired-lease recovery requires owner and exact public readback; reconciliation never creates a new attempt',async()=>{
    const f=await started();f.state.work.lease_expires_at=new Date(0);
    await assert.rejects(svc.confirmLinkedIn1135(confirmation,f.db,writer(f)),/LEASE_REQUIRED/);
    const {leaseToken,...input}=confirmation;f.state.owner=false;
    await assert.rejects(svc.reconcileLinkedIn1135(input,f.db,writer(f)),/OWNER_REQUIRED/);f.state.owner=true;
    await svc.reconcileLinkedIn1135(input,f.db,writer(f));assert.equal(f.state.attempts.length,1);assert.equal(f.state.fact.id,900);
});
test('generic manual fact cannot bypass exact lifecycle',async()=>{await assert.rejects(guardManualPublicationFact({},
    {projectId:10,taskId:1135,internalConfirmation:false}),/EXACT_CONFIRMATION_REQUIRED/);});
module.exports={fixture,releaseArgs,boundary,observed,confirmation};
