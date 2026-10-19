const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const path=require('node:path');const {fixture,snapshot:template,body,sha}=require('./shared-browser.fixture.cjs');
const url=new URL(process.env.DATABASE_URL||'http://invalid');
assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'synthetic-db');
assert.equal(url.pathname,'/shared_browser_synthetic');assert.equal(url.username,'synthetic');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {prisma:db,pool}=require(path.join(base,'db.js'));
const release=require(path.join(base,'services/browser_publication_release.js'));
const exec=require(path.join(base,'services/browser_publication_execution.js'));
const confirm=require(path.join(base,'services/browser_publication_confirmation.js'));
const {loadAgentWorkspaceManifest:manifest}=require(path.join(base,'services/agent_workspace_manifest.service.js'));
const factService=require(path.join(base,'services/publication_fact.service.js')).default;
const deps={db,manifest};
test.after(async()=>{await db.$disconnect();await pool.end();});

async function setup(t,platform='linkedin',missingBundle=false){
    const source=fixture().state.task,nonce=randomUUID();
    const profileId='019c0000-0000-7000-8000-000000000001';
    const identity=platform==='setka'?{...template.identity,platform:'setka',accountType:'personal',
        accountRef:'synthetic_setka',profileUrl:'https://setka.ru/users/'+profileId,providerAccountId:profileId}:template.identity;
    if(platform==='setka'){
        source.channel.type=platform;source.channel.name=identity.accountRef;
        source.channel.config={account_ref:identity.accountRef,account_type:'unknown',execution_modes:['manual'],
            profile_url:identity.profileUrl,capability_flags:{manual_handoff:true}};
        source.quality_report.handoff_bundle.task.account_ref=identity.accountRef;
    }
    if(missingBundle)delete source.quality_report.handoff_bundle;
    const user=await db.user.create({data:{email:`synthetic-${nonce}@example.invalid`,name:'Synthetic',password_hash:'not-a-login'}});
    const project=await db.project.create({data:{name:'Synthetic browser lifecycle',slug:`synthetic-${nonce}`}});
    t.after(async()=>{await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
    await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
    const channel=await db.socialChannel.create({data:{project_id:project.id,name:source.channel.name,
        type:source.channel.type,is_active:true,config:source.channel.config}});
    const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',
        item_key:`synthetic-${nonce}`,content_revision:5,accepted_revision:5,draft_text:body,text_state:'accepted',
        status:'ready_for_execution',publication_mode:'approval_required',handoff_state:'ready',visual_state:'APPROVED',
        visual_placement:'feed',visual_decision_version:4,schedule_at:source.schedule_at,publish_at:source.publish_at,
        quality_report:source.quality_report}});
    const actorId=`user:${user.id}`;
    const decision=await db.artDirectionDecision.create({data:{project_id:project.id,content_item_id:task.id,
        decision_version:4,source_content_revision:5,channel:platform,placement:'feed',decision:'GENERATE',
        status:'active',actor_id:actorId,reason:'Synthetic approved visual'}});
    const asset=await db.imageAsset.create({data:{project_id:project.id,content_item_id:task.id,decision_id:decision.id,
        content_revision:5,placement:'feed',prompt:'Synthetic',status:'approved',file_url:source.selected_asset.file_url,
        provenance:source.selected_asset.provenance}});
    await db.contentItem.update({where:{id:task.id},data:{selected_asset_id:asset.id}});
    const current=await manifest(project.id,user.id);
    const snapshot={...template,projectId:project.id,taskId:task.id,channelId:channel.id,selectedAssetId:asset.id,
        decisionId:decision.id,manifestChecksum:current.checksum,identity};
    const args={projectId:project.id,taskId:task.id,actorId,snapshot,approvalReference:'Synthetic exact owner approval',idempotencyKey:'release',apply:true};
    if(!missingBundle)await release.repairBrowserPublicationMetadata({...args,idempotencyKey:'repair'},deps);
    return{args,task,project,user};
}
async function started(t,platform='linkedin'){
    const state=await setup(t,platform),r=await release.releaseBrowserPublication(state.args,deps);
    const workItemId=r.browser_work_item_id;
    const claim=await exec.claimBrowserPublication({...state.args,workItemId,idempotencyKey:'claim'},deps);
    const send={...state.args,apply:false,workItemId,leaseToken:claim.lease_token,idempotencyKey:'send'};
    const start=await exec.startBrowserSubmission(send,deps);
    const observation={...send,attemptId:start.attempt_id,observedProfileUrl:state.args.snapshot.identity.profileUrl,
        observedProviderAccountId:state.args.snapshot.identity.providerAccountId,observedAccountType:state.args.snapshot.identity.accountType,
        observedBodySha256:sha(body),observedAssetSha256:template.assetSha256,
        paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:1,
        duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
    return{...state,send,observation};
}
const fulfilled=results=>results.filter(r=>r.status==='fulfilled');
test('legacy Setka PostgreSQL bundle materialization rolls back audit failure, then repairs/releases once',async t=>{
    const{args,user}=await setup(t,'setka',true),repair={...args,idempotencyKey:'legacy-repair'};
    await db.socialChannel.update({where:{id:args.snapshot.channelId},data:{name:'Synthetic display label'}});
    args.snapshot.manifestChecksum=(await manifest(args.projectId,user.id)).checksum;
    const before=await db.contentItem.findUnique({where:{id:args.taskId}});
    assert.equal((await release.repairBrowserPublicationMetadata({...repair,apply:false},deps)).handoff_materialization.eligible,true);
    assert.deepEqual(await db.contentItem.findUnique({where:{id:args.taskId}}),before);
    const fail={...deps,db:{$transaction:run=>db.$transaction(async tx=>run(new Proxy(tx,{get(target,key){
        if(key==='workflowEvent')return{...target.workflowEvent,create:async()=>{throw Error('synthetic legacy audit failure');}};
        return target[key];}})))}};
    await assert.rejects(release.repairBrowserPublicationMetadata(repair,fail),/legacy audit failure/);
    assert.deepEqual(await db.contentItem.findUnique({where:{id:args.taskId}}),before);
    await release.repairBrowserPublicationMetadata(repair,deps);
    const repaired=await db.contentItem.findUnique({where:{id:args.taskId}});
    assert.equal(repaired.quality_report.handoff_bundle.publication.body,body);
    assert.ok(repaired.quality_report.handoff_bundle.checklist.includes('Post from account: '+args.snapshot.identity.accountRef));
    assert.equal((await db.socialChannel.findUnique({where:{id:args.snapshot.channelId}})).name,'Synthetic display label');
    assert.equal(repaired.accepted_revision,before.accepted_revision);assert.equal(repaired.selected_asset_id,before.selected_asset_id);
    assert.equal(repaired.schedule_at.toISOString(),before.schedule_at.toISOString());
    assert.equal((await release.repairBrowserPublicationMetadata(repair,deps)).replayed,true);
    await release.releaseBrowserPublication({...args,idempotencyKey:'release-after-legacy'},deps);
    assert.equal(await db.workItem.count({where:{content_item_id:args.taskId,kind:'browser_publish'}}),1);
    assert.equal(await db.deliveryAttempt.count({where:{content_item_id:args.taskId}}),0);
});
test('legacy Setka PostgreSQL repair rejects completed browser history and partial persisted bundle',async t=>{
    const{args}=await setup(t,'setka',true);
    await db.workItem.create({data:{project_id:args.projectId,content_item_id:args.taskId,item_key:'synthetic-history',
        kind:'browser_publish',state:'completed',assignee_role:'browser_publisher'}});
    const before=await db.contentItem.findUnique({where:{id:args.taskId}});
    await assert.rejects(release.repairBrowserPublicationMetadata({...args,idempotencyKey:'history-repair'},deps),/RECONCILIATION_REQUIRED/);
    assert.deepEqual(await db.contentItem.findUnique({where:{id:args.taskId}}),before);
    await db.contentItem.update({where:{id:args.taskId},data:{quality_report:{...before.quality_report,handoff_bundle:{publication:{}}}}});
    await assert.rejects(release.repairBrowserPublicationMetadata({...args,idempotencyKey:'partial-repair'},deps),/BROWSER_SNAPSHOT_MISMATCH/);
});
test('Setka PostgreSQL confirmation is atomic, canonical and same-attempt replay only',async t=>{
    const{args,observation}=await started(t,'setka');await exec.preSubmitBrowserSubmission(observation,deps);
    const id='019d0000-0000-7000-8000-000000000002';
    const a={...observation,publicUrl:'https://setka.ru/posts/'+id,providerObjectId:id,publishedAt:new Date().toISOString()};
    const fail=record=>factService.record({...record,beforeWrite:async tx=>{
        await record.beforeWrite(tx);throw Error('synthetic Setka rollback');}});
    await assert.rejects(confirm.confirmBrowserSubmission(a,deps,fail),/synthetic Setka rollback/);
    assert.equal(await db.publicationFact.count({where:{content_item_id:args.taskId}}),0);
    assert.equal((await db.deliveryAttempt.findUnique({where:{id:observation.attemptId}})).status,'pending');
    const results=await Promise.allSettled([confirm.confirmBrowserSubmission(a,deps),confirm.confirmBrowserSubmission(a,deps)]);
    assert.ok(fulfilled(results).length>=1);
    const fact=await db.publicationFact.findUnique({where:{content_item_id:args.taskId}});
    assert.equal(fact.public_url,a.publicUrl);assert.equal(fact.provider_object_id,id);
    assert.equal(fact.published_at.toISOString(),a.publishedAt);assert.equal(fact.evidence_ref,'sha256:'+a.evidenceSha256);
    assert.equal(await db.deliveryAttempt.count({where:{content_item_id:args.taskId}}),1);
    assert.equal((await confirm.confirmBrowserSubmission(a,deps)).replayed,true);
});
test('Setka PostgreSQL UNKNOWN freezes sending and reconciles the original attempt',async t=>{
    const{args,send,observation}=await started(t,'setka');await exec.preSubmitBrowserSubmission(observation,deps);
    await exec.markBrowserSubmissionUncertain({...send,attemptId:observation.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps);
    await assert.rejects(exec.preSubmitBrowserSubmission(observation,deps),/BROWSER_RECONCILIATION_REQUIRED/);
    await db.workItem.update({where:{id:send.workItemId},data:{lease_expires_at:new Date(0)}});
    const{leaseToken,...readback}=observation,id='019d0000-0000-7000-8000-000000000003';
    const a={...readback,publicUrl:'https://setka.ru/posts/'+id,providerObjectId:id,publishedAt:new Date().toISOString()};
    assert.equal((await confirm.reconcileBrowserSubmission(a,deps)).submission_permitted,false);
    assert.equal(await db.deliveryAttempt.count({where:{content_item_id:args.taskId}}),1);
});
test('S1/S2 PostgreSQL concurrent releases create exactly one WI and preserve accepted bytes',async t=>{
    const {args}=await setup(t);
    const results=await Promise.allSettled([release.releaseBrowserPublication(args,deps),
        release.releaseBrowserPublication({...args,idempotencyKey:'competing-release'},deps)]);
    assert.equal(fulfilled(results).length,1);
    assert.equal(await db.workItem.count({where:{project_id:args.projectId,content_item_id:args.taskId,kind:'browser_publish'}}),1);
    const task=await db.contentItem.findUnique({where:{id:args.taskId}});
    assert.equal(task.draft_text,body);assert.equal(task.accepted_revision,5);assert.equal(task.channel_id,args.snapshot.channelId);
    assert.equal(task.schedule_at.toISOString(),template.scheduleAt);assert.equal(task.selected_asset_id,args.snapshot.selectedAssetId);
});
test('S3 PostgreSQL concurrent start/permit never authorizes two attempts or two clicks',async t=>{
    const {args}=await setup(t),r=await release.releaseBrowserPublication(args,deps),workItemId=r.browser_work_item_id;
    const claims=await Promise.allSettled([exec.claimBrowserPublication({...args,workItemId,idempotencyKey:'claim-a'},deps),
        exec.claimBrowserPublication({...args,workItemId,idempotencyKey:'claim-b'},deps)]);
    assert.equal(fulfilled(claims).length,1);const lease=fulfilled(claims)[0].value;
    const send={...args,apply:false,workItemId,leaseToken:lease.lease_token,idempotencyKey:'send'};
    const starts=await Promise.allSettled([exec.startBrowserSubmission(send,deps),exec.startBrowserSubmission({...send,idempotencyKey:'other-send'},deps)]);
    assert.equal(fulfilled(starts).length,1);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:args.taskId}}),1);
    const winner=starts[0].status==='fulfilled'?send:{...send,idempotencyKey:'other-send'};
    assert.equal((await exec.startBrowserSubmission(winner,deps)).submission_permitted,false);
});
test('S4 PostgreSQL concurrent pre-submit returns one permit; replay and UNKNOWN are read-only',async t=>{
    const {args,observation}=await started(t);
    const results=await Promise.allSettled([exec.preSubmitBrowserSubmission(observation,deps),exec.preSubmitBrowserSubmission(observation,deps)]);
    assert.equal(fulfilled(results).filter(r=>r.value.submission_permitted).length,1);
    assert.equal((await exec.preSubmitBrowserSubmission(observation,deps)).submission_permitted,false);
    const {observedProfileUrl,observedProviderAccountId,observedAccountType,observedBodySha256,observedAssetSha256,
        paragraphBlockSha256,attachedImageCount,duplicateAbsent,evidenceSha256,...boundary}=observation;
    await exec.markBrowserSubmissionUncertain({...boundary,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps);
    await assert.rejects(exec.preSubmitBrowserSubmission(observation,deps),/BROWSER_RECONCILIATION_REQUIRED/);
    assert.equal(await db.publicationFact.count({where:{content_item_id:args.taskId}}),0);
});
test('S5 canonical fact transaction rolls back hook failures, then concurrent confirms persist one fact',async t=>{
    const {args,observation}=await started(t);await exec.preSubmitBrowserSubmission(observation,deps);
    const confirmation={...observation,publicUrl:'https://www.linkedin.com/feed/update/urn:li:activity:987654321/',
        providerObjectId:'urn:li:activity:987654321',publishedAt:new Date().toISOString()};
    const failedWriter=record=>factService.record({...record,beforeWrite:async tx=>{
        await record.beforeWrite(tx);throw Error('synthetic atomic fact failure');}});
    await assert.rejects(confirm.confirmBrowserSubmission(confirmation,deps,failedWriter),/synthetic atomic fact failure/);
    assert.equal(await db.publicationFact.count({where:{content_item_id:args.taskId}}),0);
    assert.equal((await db.deliveryAttempt.findUnique({where:{id:observation.attemptId}})).status,'pending');
    assert.equal(await db.workflowEvent.count({where:{content_item_id:args.taskId,command:'ba_confirm_browser_submission'}}),0);
    const results=await Promise.allSettled([confirm.confirmBrowserSubmission(confirmation,deps),confirm.confirmBrowserSubmission(confirmation,deps)]);
    assert.ok(fulfilled(results).length>=1);
    assert.equal(await db.publicationFact.count({where:{content_item_id:args.taskId}}),1);
    assert.equal((await db.deliveryAttempt.findUnique({where:{id:observation.attemptId}})).status,'delivered');
    assert.equal((await confirm.confirmBrowserSubmission(confirmation,deps)).replayed,true);
});
test('004 Telegram review recovery is atomic and never accepts or releases a draft',async t=>{
    const review=require(path.join(base,'services/review_handoff_repair.js'));
    const nonce=randomUUID();
    const user=await db.user.create({data:{email:`review-${nonce}@example.invalid`,name:'Synthetic',password_hash:'not-a-login'}});
    const project=await db.project.create({data:{name:'Synthetic review recovery',slug:`review-${nonce}`}});
    t.after(async()=>{await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
    await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
    const channel=await db.socialChannel.create({data:{project_id:project.id,name:'synthetic_tg',type:'telegram',
        config:{execution_modes:['automated']}}});
    const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',
        content_revision:2,draft_text:body,text_state:'draft',status:'drafted',publication_mode:'approval_required',
        visual_state:'STALE',visual_placement:'feed',schedule_at:new Date(template.scheduleAt),publish_at:new Date(template.publishAt),
        quality_report:{preserved:'history',handoff_bundle:{mode:'manual'}}}});
    await db.socialChannel.update({where:{id:channel.id},data:{type:'zen_article'}});
    const {ArtDirectionService}=require(path.join(base,'services/art_direction.service.js'));
    await assert.rejects(db.$transaction(tx=>new ArtDirectionService().acceptContentRevision(tx,task.id,`user:${user.id}`)),/TARGET_PLACEMENT_MISMATCH/);
    const rejected=await db.contentItem.findUnique({where:{id:task.id}});
    assert.equal(rejected.accepted_revision,null);assert.equal(rejected.status,'drafted');
    assert.equal(rejected.draft_text,body);assert.equal(await db.workItem.count({where:{content_item_id:task.id}}),0);
    await db.socialChannel.update({where:{id:channel.id},data:{type:'telegram'}});
    const work=await db.workItem.create({data:{project_id:project.id,content_item_id:task.id,item_key:`review-${nonce}`,
        kind:'content_review',state:'waiting_approval',assignee_role:'content_reviewer',input_context_version:2,
        result_version:2,result_payload:{content_revision:2},note:'Historical note'}});
    const actorId=`user:${user.id}`;
    const approval=await db.approvalDecision.create({data:{work_item_id:work.id,result_version:2,decision:'approved',actor_id:actorId}});
    for(const placement of ['video_cover',null,'']){
        await db.contentItem.update({where:{id:task.id},data:{visual_placement:placement}});
        await assert.rejects(review.getReviewRepairSnapshot({projectId:project.id,taskId:task.id,workItemId:work.id,actorId},db),/REVIEW_PLACEMENT_UNSUPPORTED/);
        assert.deepEqual((await db.contentItem.findUnique({where:{id:task.id}})).quality_report,task.quality_report);
        assert.equal(await db.workItem.count({where:{content_item_id:task.id}}),1);
    }
    await db.contentItem.update({where:{id:task.id},data:{visual_placement:'feed'}});
    await db.socialChannel.update({where:{id:channel.id},data:{type:'reddit',config:{canonical_placements:['feed'],execution_modes:['manual']}}});
    const dataDeclared=await review.getReviewRepairSnapshot({projectId:project.id,taskId:task.id,workItemId:work.id,actorId},db);
    assert.equal(dataDeclared.publication_authorized,false);
    assert.deepEqual((await db.contentItem.findUnique({where:{id:task.id}})).quality_report,task.quality_report);
    assert.equal(await db.workItem.count({where:{content_item_id:task.id}}),1);
    await db.socialChannel.update({where:{id:channel.id},data:{type:'telegram',config:{execution_modes:['automated']}}});
    const snap=await review.getReviewRepairSnapshot({projectId:project.id,taskId:task.id,workItemId:work.id,actorId},db);
    const args={...snap.expected_snapshot,reason:'Approved transport-neutral review recovery',idempotencyKey:'review-recovery',apply:true};
    const failDb=new Proxy(db,{get(target,key){if(key!=='$transaction')return Reflect.get(target,key);
        return (run,options)=>db.$transaction(tx=>run(new Proxy(tx,{get(client,field){
            if(field==='workflowEvent')return{...client.workflowEvent,create:async()=>{throw Error('synthetic review audit failure');}};
            return Reflect.get(client,field);}})),options);}});
    await assert.rejects(review.repairReviewHandoff(args,failDb),/synthetic review audit failure/);
    assert.equal((await db.workItem.findUnique({where:{id:work.id}})).state,'waiting_approval');
    assert.equal(await db.workItem.count({where:{content_item_id:task.id}}),1);
    const results=await Promise.allSettled([review.repairReviewHandoff(args,db),review.repairReviewHandoff(args,db)]);
    assert.ok(fulfilled(results).length>=1);
    const replay=await review.repairReviewHandoff(args,db);
    assert.equal(replay.publication_authorized,false);assert.equal(replay.handoff_mode,'automated');
    assert.equal(replay.connector_authority,'configured');assert.equal(replay.replayed,true);
    assert.equal(await db.workItem.count({where:{content_item_id:task.id,state:'available',input_context_version:2,result_version:0}}),1);
    const current=await db.contentItem.findUnique({where:{id:task.id}});
    for(const key of ['draft_text','accepted_revision','content_revision','status','text_state','visual_state','selected_asset_id','publication_mode','channel_id'])
        assert.deepEqual(current[key],task[key],key);
    assert.deepEqual(current.schedule_at,task.schedule_at);assert.deepEqual(current.publish_at,task.publish_at);
    assert.deepEqual(await db.approvalDecision.findUnique({where:{id:approval.id}}),approval);
    assert.equal(await db.deliveryAttempt.count({where:{content_item_id:task.id}}),0);
    assert.equal(await db.publicationFact.count({where:{content_item_id:task.id}}),0);
});
