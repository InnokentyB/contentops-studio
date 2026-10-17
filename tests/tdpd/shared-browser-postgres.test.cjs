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

async function setup(t){
    const source=fixture().state.task,nonce=randomUUID();
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
        decision_version:4,source_content_revision:5,channel:'linkedin',placement:'feed',decision:'GENERATE',
        status:'active',actor_id:actorId,reason:'Synthetic approved visual'}});
    const asset=await db.imageAsset.create({data:{project_id:project.id,content_item_id:task.id,decision_id:decision.id,
        content_revision:5,placement:'feed',prompt:'Synthetic',status:'approved',file_url:source.selected_asset.file_url,
        provenance:source.selected_asset.provenance}});
    await db.contentItem.update({where:{id:task.id},data:{selected_asset_id:asset.id}});
    const current=await manifest(project.id,user.id);
    const snapshot={...template,projectId:project.id,taskId:task.id,channelId:channel.id,selectedAssetId:asset.id,
        decisionId:decision.id,manifestChecksum:current.checksum};
    const args={projectId:project.id,taskId:task.id,actorId,snapshot,approvalReference:'Synthetic exact owner approval',idempotencyKey:'release',apply:true};
    await release.repairBrowserPublicationMetadata({...args,idempotencyKey:'repair'},deps);
    return{args,task,project,user};
}
async function started(t){
    const state=await setup(t),r=await release.releaseBrowserPublication(state.args,deps);
    const workItemId=r.browser_work_item_id;
    const claim=await exec.claimBrowserPublication({...state.args,workItemId,idempotencyKey:'claim'},deps);
    const send={...state.args,apply:false,workItemId,leaseToken:claim.lease_token,idempotencyKey:'send'};
    const start=await exec.startBrowserSubmission(send,deps);
    const observation={...send,attemptId:start.attempt_id,observedProfileUrl:template.identity.profileUrl,
        observedProviderAccountId:template.identity.providerAccountId,observedAccountType:'company_page',
        observedBodySha256:sha(body),observedAssetSha256:template.assetSha256,
        paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:1,
        duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
    return{...state,send,observation};
}
const fulfilled=results=>results.filter(r=>r.status==='fulfilled');
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
