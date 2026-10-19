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
module.exports={setup,started,deps,db,pool};
