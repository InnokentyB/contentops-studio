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

const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
const instruction=()=>require(path.join(base,'services/browser_owner_instruction.js'));
const asOwner=(s,run)=>withPublicationPrincipal({userId:s.user.id,actorId:s.args.actorId,projectId:s.project.id,profile:'owner'},run);
const command=s=>({...s.args,idempotencyKey:'explicit-owner-order',allowDuplicate:true});

test('Owner order authorizes new attempt despite UNKNOWN, old manifest and provider duplicate; replay never sends twice',async t=>{
 const s=await started(t,'setka');
 await db.deliveryAttempt.update({where:{id:s.observation.attemptId},data:{error_message:'PROVIDER_RESULT_UNCERTAIN'}});
 const old=await db.deliveryAttempt.findUnique({where:{id:s.observation.attemptId}});
 await assert.rejects(exec.preSubmitBrowserSubmission(s.observation,deps),/BROWSER_RECONCILIATION_REQUIRED/);
 await db.socialChannel.update({where:{id:s.args.snapshot.channelId},data:{name:'Updated display label'}});
 s.args.snapshot={...s.args.snapshot,manifestChecksum:(await manifest(s.project.id,s.user.id)).checksum};
 const r=await asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps));
 assert.equal(r.applied,true);assert.notEqual(r.browser_work_item_id,s.send.workItemId);
 const replay=await asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps));
 assert.equal(replay.browser_work_item_id,r.browser_work_item_id);assert.equal(replay.replayed,true);
 assert.deepEqual(await db.deliveryAttempt.findUnique({where:{id:old.id}}),old);
 await assert.rejects(exec.preSubmitBrowserSubmission(s.observation,deps));
 const workItemId=r.browser_work_item_id;
 const lease=await exec.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'new-claim'},deps);
 const send={...s.args,workItemId,leaseToken:lease.lease_token,idempotencyKey:'new-send'};
 const next=await exec.startBrowserSubmission(send,deps);assert.notEqual(next.attempt_id,old.id);
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:next.attempt_id}})).attempt_number,2);
 const observed={...s.observation,...send,attemptId:next.attempt_id,duplicateAbsent:false};
 const permit=await exec.preSubmitBrowserSubmission(observed,deps);assert.equal(permit.submission_permitted,true);
 assert.equal((await exec.preSubmitBrowserSubmission(observed,deps)).submission_permitted,false);
 await assert.rejects(exec.preSubmitBrowserSubmission({...observed,idempotencyKey:'another-permit-key'},deps),/BROWSER_RECONCILIATION_REQUIRED/);
 const objectId='019c0000-0000-7000-8000-000000000099';
 await confirm.confirmBrowserSubmission({...observed,providerObjectId:objectId,publicUrl:'https://setka.ru/posts/'+objectId,publishedAt:new Date().toISOString()},deps);
 assert.equal((await db.publicationFact.findUnique({where:{content_item_id:s.args.taskId}})).provider_object_id,objectId);
 assert.deepEqual(await db.deliveryAttempt.findUnique({where:{id:old.id}}),old);
});
test('Publisher cannot mint Owner instructions even when actor owns project',async t=>{
 const s=await started(t,'setka');const before=await db.workItem.count({where:{project_id:s.project.id}});
 await assert.rejects(withPublicationPrincipal({userId:s.user.id,actorId:s.args.actorId,projectId:s.project.id,profile:'publisher'},()=>instruction().authorizeBrowserPublication(command(s),deps)),/OWNER_INSTRUCTION_REQUIRED/);
 assert.equal(await db.workItem.count({where:{project_id:s.project.id}}),before);
});
test('Owner preview is read-only; wrong package and audit failure cannot create authority',async t=>{
 const s=await started(t,'setka');const before=await db.contentItem.findUnique({where:{id:s.args.taskId}});
 const preview=await asOwner(s,()=>instruction().authorizeBrowserPublication({...command(s),apply:false},deps));assert.equal(preview.applied,false);
 assert.deepEqual(await db.contentItem.findUnique({where:{id:s.args.taskId}}),before);
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication({...command(s),snapshot:{...s.args.snapshot,bodySha256:'f'.repeat(64)}},deps)));
 const fail={...deps,db:{$transaction:run=>db.$transaction(async tx=>run(new Proxy(tx,{get(target,key){if(key==='workflowEvent')return{...target.workflowEvent,create:async()=>{throw Error('synthetic audit failure');}};return target[key];}})))}};
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),fail)),/synthetic audit failure/);
 assert.deepEqual(await db.contentItem.findUnique({where:{id:s.args.taskId}}),before);
});

test('Owner command rejects foreign actor, demo and revoked membership',async t=>{
 const s=await started(t,'setka');
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication({...command(s),actorId:'user:999999'},deps)),/OWNER_INSTRUCTION_REQUIRED/);
 await db.user.update({where:{id:s.user.id},data:{is_demo:true}});
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps)),/OWNER_INSTRUCTION_REQUIRED/);
 await db.user.update({where:{id:s.user.id},data:{is_demo:false}});
 await db.projectMember.update({where:{project_id_user_id:{project_id:s.project.id,user_id:s.user.id}},data:{role:'editor'}});
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps)),/OWNER_REQUIRED/);
});
test('racing identical Owner orders create at most one instruction and work',async t=>{
 const s=await started(t,'setka');
 const results=await Promise.allSettled([1,2].map(()=>asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps))));
 assert.ok(results.some(r=>r.status==='fulfilled'));
 assert.equal(await db.workflowEvent.count({where:{project_id:s.project.id,command:'ba_authorize_browser_publication'}}),1);
 assert.equal(await db.workItem.count({where:{project_id:s.project.id,reason_code:'OWNER_EXPLICIT_PUBLICATION'}}),1);
 const replay=await asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps));assert.equal(replay.replayed,true);
});
test('persisted old recovery hold cannot veto Owner instruction and is preserved',async t=>{
 const s=await started(t,'setka'),a=s.observation;
 const {snapshotHash,hash}=require(path.join(base,'services/browser_publication_contract.js'));
 const held=await db.browserDeliveryRecovery.create({data:{project_id:a.projectId,content_item_id:a.taskId,attempt_id:a.attemptId,work_item_id:a.workItemId,package_sha256:snapshotHash(a.snapshot),approval_sha256:hash(a.approvalReference),original_snapshot:a.snapshot,stage:'RECONCILING',delivery_certainty:'UNKNOWN',cause_code:'POST_SUBMIT_UNKNOWN',recovery_action:'READ_ONLY_RECONCILIATION'}});
 const r=await asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps));
 await assert.rejects(factService.record({projectId:a.projectId,taskId:a.taskId,actorId:a.actorId,artifactKind:'post',outcome:'published',publicUrl:'https://setka.ru/posts/019c0000-0000-7000-8000-000000000088',providerObjectId:'019c0000-0000-7000-8000-000000000088',publishedAt:new Date().toISOString(),confirmationMode:'automatic',evidence:{type:'screenshot',ref:'sha256:'+a.evidenceSha256},beforeWrite:async()=>{}}),/BROWSER_RECOVERY_V2_HELD/);
 assert.equal(await db.publicationFact.findUnique({where:{content_item_id:a.taskId}}),null);
 const workItemId=r.browser_work_item_id;
 const lease=await exec.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'held-claim'},deps);
 const preparation=require(path.join(base,'services/browser_preparation_recovery.js')).createPreparationRecovery({deps});
 const send={...s.args,workItemId,leaseToken:lease.lease_token,idempotencyKey:'held-send'};
 const next=await preparation.start(send);
 const observed={...a,...send,attemptId:next.attempt_id,duplicateAbsent:false};
 assert.equal((await exec.preSubmitBrowserSubmission(observed,deps)).submission_permitted,true);
 const objectId='019c0000-0000-7000-8000-000000000098';
 await confirm.confirmBrowserSubmission({...observed,providerObjectId:objectId,publicUrl:'https://setka.ru/posts/'+objectId,publishedAt:new Date().toISOString()},deps);
 assert.deepEqual(await db.browserDeliveryRecovery.findUnique({where:{id:held.id}}),held);
});
test('a command cannot be enlarged on replay; current package drift still rejects',async t=>{
 const s=await started(t,'setka');
 await asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps));
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication({...command(s),approvalReference:'different command binding'},deps)),/IDEMPOTENCY_CONFLICT/);
 await db.contentItem.update({where:{id:s.args.taskId},data:{draft_text:body+' changed'}});
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication({...command(s),idempotencyKey:'new-owner-command'},deps)),/BROWSER_SNAPSHOT_MISMATCH/);
});
test('revoked or demo issuer cannot leave a consumable instruction behind',async t=>{
 const s=await started(t,'setka');const r=await asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps));
 const claim={...s.args,workItemId:r.browser_work_item_id,idempotencyKey:'revoked-claim'};
 await db.user.update({where:{id:s.user.id},data:{is_demo:true}});
 await assert.rejects(exec.claimBrowserPublication(claim,deps),/OWNER_INSTRUCTION_REQUIRED/);
 await db.user.update({where:{id:s.user.id},data:{is_demo:false}});
 await db.projectMember.update({where:{project_id_user_id:{project_id:s.project.id,user_id:s.user.id}},data:{role:'editor'}});
 await assert.rejects(exec.claimBrowserPublication(claim,deps),/OWNER_REQUIRED/);
 assert.equal((await db.workItem.findUnique({where:{id:r.browser_work_item_id}})).state,'available');
});
test('an existing canonical fact is preserved and requires a separate publication instance',async t=>{
 const s=await started(t,'setka'),a=s.observation;
 await exec.preSubmitBrowserSubmission(a,deps);
 const objectId='019c0000-0000-7000-8000-000000000097';
 await confirm.confirmBrowserSubmission({...a,providerObjectId:objectId,publicUrl:'https://setka.ru/posts/'+objectId,publishedAt:new Date().toISOString()},deps);
 const before=await db.publicationFact.findUnique({where:{content_item_id:s.args.taskId}});
 await assert.rejects(asOwner(s,()=>instruction().authorizeBrowserPublication(command(s),deps)),/OWNER_NEW_PUBLICATION_INSTANCE_REQUIRED/);
 assert.deepEqual(await db.publicationFact.findUnique({where:{content_item_id:s.args.taskId}}),before);
});
