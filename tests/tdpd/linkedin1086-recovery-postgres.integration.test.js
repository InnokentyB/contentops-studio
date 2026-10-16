const test=require('node:test');const assert=require('node:assert/strict');
const target=process.env.TDPD_TEST_DATABASE_URL;if(!target)throw Error('Explicit isolated test database required');
const url=new URL(target);
if(process.env.CI!=='true'||url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'
    ||url.pathname!=='/codex_lifecycle_ci'||url.search||url.hash)throw Error('Ephemeral CI database only');
process.env.DATABASE_URL=target;require('../../dist/bootstrap-env');
const effective=new URL(process.env.DATABASE_URL);
if(effective.hostname!==url.hostname||effective.port!==url.port||effective.pathname!==url.pathname
    ||effective.username!==url.username||effective.password!==url.password||effective.hash
    ||effective.searchParams.get('schema')!=='planner'
    ||effective.searchParams.get('options')!=='-c search_path=planner'
    ||[...effective.searchParams.keys()].some(k=>!['schema','options'].includes(k)))throw Error('Isolated target changed');
const {default:db,pool}=require('../../dist/db');
const manifest=require('../../dist/services/agent_workspace_manifest.service');
const guard=require('../../dist/services/linkedin1086_guard');
const service=require('../../dist/services/linkedin1086_recovery');
const lifecycle=require('../../dist/services/linkedin1086_lifecycle');
const lease=require('../../dist/services/linkedin1086_lease');
const fence=require('../../dist/services/linkedin1086_recovery_fence');
const fact=require('../../dist/services/publication_fact.service').default;
const p=require('../../dist/services/linkedin1086_contract').LINKEDIN1086;
const body=require('../fixtures/linkedin1086-body');const {fixture}=require('../fixtures/linkedin1086-recovery.cjs');
const old='synthetic-original-lease-not-a-production-credential';
const actorId='user:2', key='attempt-linkedin-p7-1086-r1-20261015-v1';
const a={projectId:7,taskId:1086,channelId:5,workItemId:1946,actorId,releaseIdempotencyKey:'synthetic-release1086',
    approvalReference:'synthetic original owner publication approval',idempotencyKey:key,expectedManifestChecksum:p.manifest,
    contentRevision:1,textSha256:p.body,selectedAssetId:null,imageSha256:null,observedProfileUrl:p.profile,
    authorEvidenceSha256:'a'.repeat(64),duplicateCheckReference:'synthetic fresh native readback',observedEditorText:body};
const f=fixture();const recovery={...a,attemptId:41,apply:false,expectedExpiredLeaseSha256:guard.submissionHash(old),
    expectedExpiredLeaseAt:f.current.oldLeaseExpiresAt,localEvidence:f.localEvidence,ownerObservation:f.ownerObservation};
const slug='seturon';let created=false,createdUser=false;
test('real PG same41 recovery rollback/races, original-fence isolation, one permit, uncertainty and atomic factual reconcile',
    {timeout:60000},async t=>{
    assert.equal(await db.project.findUnique({where:{id:7}}),null);
    assert.equal(await db.user.findUnique({where:{id:2}}),null);
    await db.user.create({data:{id:2,email:'linkedin1086@synthetic.invalid',name:'Synthetic owner',password_hash:'not-login'}});createdUser=true;
    await db.project.create({data:{id:7,name:'Synthetic1086 fixture',slug}});created=true;
    await db.projectMember.create({data:{project_id:7,user_id:2,role:'owner'}});
    await db.socialChannel.create({data:{id:5,project_id:7,name:'innokentiy_linkedin',type:'linkedin',is_active:true,config:{
        account_ref:p.profile,channel_url:p.profile,identity_ref:'personal_innokenty',profile_ref:'profile_personal_innokenty_linkedin',
        account_type:'personal',workflow_mode:'browser_required',connector_mode:'browser_assisted',capability_flags:{browser_publish:true},execution_modes:['manual']}}});
    const proof={publication_authorized:true,actor_id:actorId,body_sha256:p.body,content_revision:1,channel_id:5,
        approval_reference:a.approvalReference,release_idempotency_key:a.releaseIdempotencyKey,target_profile_url:p.profile};
    await db.contentItem.create({data:{id:1086,project_id:7,channel_id:5,type:'publication',draft_text:body,content_revision:1,
        accepted_revision:1,text_state:'accepted',visual_state:'NO_VISUAL_NEEDED',visual_decision_version:1,visual_placement:'feed',
        handoff_state:'ready',status:'browser_required',publication_mode:'browser_required',schedule_at:new Date(p.schedule),
        publish_at:new Date(p.schedule),quality_report:{content_language:'en',handoff_bundle:{content_language:'en',mode:'manual'},owner_release:proof}}});
    await db.artDirectionDecision.create({data:{id:249,project_id:7,content_item_id:1086,decision_version:1,source_content_revision:1,
        channel:'linkedin',placement:'feed',decision:'NO_VISUAL_NEEDED',reason:'Synthetic no visual',status:'active',actor_id:actorId}});
    await db.workItem.create({data:{id:1946,project_id:7,content_item_id:1086,item_key:'synthetic-browser1086',kind:'browser_publish',
        state:'claimed',assignee_role:'browser_publisher',input_context_version:1,result_payload:proof,
        lease_actor_id:actorId,lease_token:old,lease_expires_at:new Date(f.current.oldLeaseExpiresAt)}});
    await db.workItem.create({data:{project_id:7,content_item_id:1086,item_key:'synthetic-review1086',kind:'content_review',
        state:'completed',assignee_role:'chief_editor',input_context_version:1}});
    await db.deliveryAttempt.create({data:{id:41,project_id:7,content_item_id:1086,channel_id:5,mode:'assisted',status:'pending',
        attempt_number:1,idempotency_key:key,requires_manual_confirmation:true,created_at:new Date('2026-10-15T19:19:42.329Z')}});
    for(const data of [{id:3263,command:p.command,idempotency_key:a.releaseIdempotencyKey,after_state:{browser_work_item_id:1946}},
        {id:3264,command:'ba_claim_linkedin_task1086_browser',idempotency_key:'synthetic-claim',after_state:{lease_sha256:guard.submissionHash(old),lease_expires_at:f.current.oldLeaseExpiresAt}},
        {id:3265,command:'ba_start_linkedin_task1086_browser_submission',idempotency_key:key,
            before_state:{request_hash:guard.submissionRequestHash({...a,leaseToken:old})},after_state:{attempt_id:41}}]) {
        await db.workflowEvent.create({data:{project_id:7,content_item_id:1086,work_item_id:1946,actor_id:actorId,...data}});
    }
    t.mock.method(manifest,'loadAgentWorkspaceManifest',async()=>({checksum:p.manifest,project:{slug}}));
    const history=await db.workflowEvent.findMany({where:{id:{in:[3263,3264,3265]}}});
    const initial=await db.workItem.findUnique({where:{id:1946}});
    // Exercise the FULL canonical fact transaction before any recovery/permit,
    // then deliberately roll it back to retain this fixture for dispatch races.
    const originalTx=db.$transaction.bind(db);
    const restoreTransaction=()=>{db.$transaction=originalTx;};t.after(restoreTransaction);
    let sawPreRecoveryFact=false;
    db.$transaction=async(callback,opts)=>originalTx(async tx=>{
        const value=await callback(tx);
        if(value?.publication_fact){
            sawPreRecoveryFact=true;
            assert.equal((await tx.deliveryAttempt.findUnique({where:{id:41}})).status,'delivered');
            assert.equal((await tx.workItem.findUnique({where:{id:1946}})).state,'completed');
            assert.equal(await tx.workflowEvent.count({where:{command:fence.LI1086_RECOVERY_COMMAND}}),0);
            assert.equal(await tx.workflowEvent.count({where:{command:'ba_pre_submit_linkedin_task1086_browser_submission'}}),0);
            assert.equal(await tx.deliveryAttempt.count({where:{content_item_id:1086}}),1);
            throw Error('synthetic discovered-object fact rollback');
        }
        return value;
    },opts);
    const discoveredTime='2026-10-15T19:20:00.000Z';
    await assert.rejects(lifecycle.confirmLinkedIn1086({...a,leaseToken:old,attemptId:41,
        publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:7001086/',providerObjectId:'urn:li:share:7001086',
        publishedAt:discoveredTime,observedPublishedAt:discoveredTime,evidenceSha256:'b'.repeat(64),
        observedPostText:body,observedAuthorProfileUrl:p.profile},true),/synthetic discovered-object fact rollback/);
    restoreTransaction();assert.equal(sawPreRecoveryFact,true);
    assert.equal(await db.publicationFact.count({where:{content_item_id:1086}}),0);
    const preview=await service.recoverLinkedIn1086Attempt41(recovery);assert.equal(preview.mode,'preview');
    assert.equal(await db.workflowEvent.count({where:{content_item_id:1086}}),3);
    const apply={...recovery,apply:true,riskAcceptance:preview.risk_acceptance_audit};
    await assert.rejects(service.recoverLinkedIn1086Attempt41(apply),/AUDITED_RISK_APPROVAL_REQUIRED/);
    for(const patch of [{actorId:'user:3'},{idempotencyKey:'another-key'},{expectedExpiredLeaseSha256:'f'.repeat(64)},
        {riskAcceptance:{...apply.riskAcceptance,humanMessageSha256:'f'.repeat(64)}}]) {
        await assert.rejects(service.recoverLinkedIn1086Attempt41({...apply,...patch},true));
    }
    assert.equal((await service.recoverLinkedIn1086Attempt41(apply,true)).mode,'owner_risk_approval_recorded');
    assert.equal((await service.recoverLinkedIn1086Attempt41(apply,true)).replayed,true);
    db.$transaction=async(callback,opts)=>originalTx(async tx=>{await callback(tx);throw Error('synthetic rollback');},opts);
    await assert.rejects(service.recoverLinkedIn1086Attempt41(apply),/synthetic rollback/);restoreTransaction();
    assert.deepEqual(await db.workItem.findUnique({where:{id:1946}}),initial);
    assert.equal(await db.workflowEvent.count({where:{command:fence.LI1086_RECOVERY_COMMAND}}),0);
    const race=await Promise.allSettled([service.recoverLinkedIn1086Attempt41(apply),service.recoverLinkedIn1086Attempt41(apply)]);
    const winners=race.filter(r=>r.status==='fulfilled'&&r.value.mode==='recovery_prepared');assert.equal(winners.length,1);
    const rotated=winners[0].value;assert.notEqual(rotated.lease_token,old);
    const replay=await service.recoverLinkedIn1086Attempt41(apply);assert.equal(replay.lease_token,undefined);assert.equal(replay.submission_permitted,false);
    assert.equal(await db.deliveryAttempt.count({where:{content_item_id:1086}}),1);
    assert.equal(await db.workItem.count({where:{content_item_id:1086,kind:'browser_publish'}}),1);
    await assert.rejects(db.$transaction(tx=>guard.check1086(tx,{...a,leaseToken:old})),/LEASE_REQUIRED/);
    assert.ok(await db.$transaction(tx=>guard.check1086(tx,{...a,leaseToken:old},true)));
    await assert.rejects(lease.leaseLinkedIn1086({...a,apply:true},true),/RECONCILIATION_REQUIRED/);
    const observed={...a,leaseToken:rotated.lease_token,attemptId:41,recoveryGeneration:1,
        actionTimeConfirmationReference:fence.LI1086_HUMAN_REF,recoveryObservedAt:new Date().toISOString()};
    await assert.rejects(lifecycle.preSubmitLinkedIn1086({...observed,recoveryObservedAt:'2026-10-15T00:00:00Z'}),/FRESH_READBACK_REQUIRED/);
    const current=await db.workItem.findUnique({where:{id:1946}});
    await db.workItem.update({where:{id:1946},data:{lease_expires_at:new Date(Date.now()-1000)}});
    await assert.rejects(lifecycle.preSubmitLinkedIn1086(observed),/LEASE_REQUIRED/);
    await db.workItem.update({where:{id:1946},data:{lease_expires_at:current.lease_expires_at}});
    const permits=await Promise.allSettled([lifecycle.preSubmitLinkedIn1086(observed),lifecycle.preSubmitLinkedIn1086(observed)]);
    assert.equal(permits.filter(r=>r.status==='fulfilled'&&r.value.submission_permitted===true).length,1);
    assert.equal((await lifecycle.preSubmitLinkedIn1086(observed)).submission_permitted,false);
    assert.equal(await db.workflowEvent.count({where:{command:'ba_pre_submit_linkedin_task1086_browser_submission'}}),1);
    await lifecycle.uncertainLinkedIn1086(observed);
    await assert.rejects(lifecycle.preSubmitLinkedIn1086(observed),/RECONCILE_ONLY/);
    assert.equal((await service.recoverLinkedIn1086Attempt41(apply)).submission_permitted,false);
    const time=new Date().toISOString(), confirmation={...observed,leaseToken:old,
        publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:7001086/',providerObjectId:'urn:li:share:7001086',
        publishedAt:time,observedPublishedAt:time,evidenceSha256:'b'.repeat(64),observedPostText:body,observedAuthorProfileUrl:p.profile};
    const originalRecord=fact.record.bind(fact);
    const failFact=t.mock.method(fact,'record',async input=>originalTx(async tx=>{await input.beforeWrite(tx);throw Error('synthetic fact rollback');}));
    await assert.rejects(lifecycle.confirmLinkedIn1086(confirmation,true),/synthetic fact rollback/);failFact.mock.restore();
    assert.equal((await db.deliveryAttempt.findUnique({where:{id:41}})).status,'verification_required');
    assert.equal(await db.publicationFact.count({where:{content_item_id:1086}}),0);
    await lifecycle.confirmLinkedIn1086(confirmation,true);assert.equal((await lifecycle.confirmLinkedIn1086(confirmation,true)).mode,'published');
    assert.equal((await db.deliveryAttempt.findUnique({where:{id:41}})).status,'delivered');
    assert.equal((await db.workItem.findUnique({where:{id:1946}})).state,'completed');
    assert.equal(await db.deliveryAttempt.count({where:{content_item_id:1086}}),1);
    assert.deepEqual(await db.workflowEvent.findMany({where:{id:{in:[3263,3264,3265]}}}),history);
    const preserved=await db.contentItem.findUnique({where:{id:1086}});assert.equal(preserved.draft_text,body);
    assert.equal(preserved.accepted_revision,1);assert.equal(preserved.selected_asset_id,null);
    assert.equal(preserved.schedule_at.toISOString(),p.schedule);assert.equal(preserved.publish_at.toISOString(),p.schedule);
    const serialized=JSON.stringify(await db.workflowEvent.findMany({where:{content_item_id:1086}}));
    assert.equal(serialized.includes(old),false);assert.equal(serialized.includes(rotated.lease_token),false);
    assert.ok(serialized.includes(service.LI1086_VERDICT));assert.ok(serialized.includes(fence.LI1086_HUMAN_REF));
    assert.equal(typeof originalRecord,'function');
});
test.after(async()=>{try{if(created)await db.project.deleteMany({where:{id:7,slug}});if(createdUser)await db.user.deleteMany({where:{id:2,email:'linkedin1086@synthetic.invalid'}});}
    finally{await db.$disconnect();await pool.end();}});
