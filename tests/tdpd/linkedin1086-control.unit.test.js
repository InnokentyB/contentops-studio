const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const manifest = require('../../dist/services/agent_workspace_manifest.service');
const guard = require('../../dist/services/linkedin1086_guard');
const release = require('../../dist/services/linkedin1086_release');
const { preserve1086Handoff } = require('../../dist/services/linkedin1086_projection');
const { LINKEDIN1086: p } = require('../../dist/services/linkedin1086_contract');
const body = require('../fixtures/linkedin1086-body');
const args = { projectId:7, taskId:1086, channelId:5, actorId:'user:2', approvalReference:'synthetic exact owner approval',
    expectedManifestChecksum:p.manifest, idempotencyKey:'synthetic-repair', contentRevision:1, textSha256:p.body,
    selectedAssetId:null, imageSha256:null };

function fixture(t) {
    const events = []; const writes = []; let work = null; let attempt = null; let owner = 'owner';
    const task = { id:1086, project_id:7, channel_id:5, channel:{is_active:true,type:'linkedin',name:'innokentiy_linkedin',config:{
        account_ref:p.profile,channel_url:p.profile,identity_ref:'personal_innokenty',profile_ref:'profile_personal_innokenty_linkedin',
        account_type:'personal',workflow_mode:'browser_required',connector_mode:'browser_assisted',capability_flags:{browser_publish:true},execution_modes:['manual']}},
    status:'ready_for_execution',publication_mode:'approval_required',content_revision:1,accepted_revision:1,text_state:'accepted',
    draft_text:body,schedule_at:new Date(p.schedule),publish_at:new Date(p.schedule),visual_state:'NO_VISUAL_NEEDED',visual_decision_version:1,
    visual_placement:'feed',selected_asset_id:null,handoff_state:'ready',updated_at:new Date(),quality_report:{handoff_bundle:{
        task:{content_item_id:1086},publication:{body},mode:'automated',content_language:'ru'}},publication_fact:null,published_link:null };
    const tx = {
        projectMember:{findUnique:async()=>({role:owner})},contentItem:{findFirst:async()=>task,
            updateMany:async({data})=>{writes.push('task');Object.assign(task,data);return {count:1};}},
        artDirectionDecision:{findFirst:async()=>({id:249})},
        workItem:{findFirst:async({where})=>where.kind==='content_review'?{id:1597}:work,
            create:async({data})=>{writes.push('work');work={id:9001,...data};return work;}},
        deliveryAttempt:{findFirst:async()=>attempt},workflowEvent:{
            findFirst:async({where})=>events.find(e=>e.command===where.command&&e.actor_id===where.actor_id&&e.idempotency_key===where.idempotency_key)||null,
            create:async({data})=>{writes.push('audit');events.push(data);return data;}}
    };
    t.mock.method(manifest,'loadAgentWorkspaceManifest',async()=>({checksum:p.manifest,project:{slug:'seturon'}}));
    const original=db.default.$transaction;
    db.default.$transaction=async(run,options)=>{assert.equal(options.isolationLevel,'Serializable');return run(tx);};
    t.after(()=>{db.default.$transaction=original;});
    return {task,tx,writes,events,get work(){return work;},set attempt(value){attempt=value;},set owner(value){owner=value;}};
}

test('metadata preview has zero writes and apply preserves all accepted bytes and both dates',async t=>{
    const f=fixture(t);const snapshot=JSON.stringify({...f.task,quality_report:undefined});
    assert.equal((await release.controlLinkedIn1086(args,false)).mode,'preview');assert.deepEqual(f.writes,[]);
    const applied=await release.controlLinkedIn1086({...args,apply:true},false);
    assert.equal(applied.mode,'repaired');assert.equal(f.task.quality_report.handoff_bundle.mode,'manual');
    assert.equal(f.task.quality_report.content_language,'en');assert.equal(f.task.quality_report.handoff_bundle.publication.body,body);
    assert.equal(JSON.stringify({...f.task,quality_report:undefined}),snapshot);
    assert.equal((await release.controlLinkedIn1086({...args,apply:true},false)).replayed,true);
    assert.deepEqual(f.writes,['task','audit']);
});
test('release requires audited repair then creates one WI, replays and cannot broaden a key',async t=>{
    const f=fixture(t);await assert.rejects(release.controlLinkedIn1086({...args,apply:true},true),/METADATA_REPAIR_REQUIRED/);
    await release.controlLinkedIn1086({...args,apply:true},false);
    const a={...args,idempotencyKey:'synthetic-release',apply:true};
    const first=await release.controlLinkedIn1086(a,true);const second=await release.controlLinkedIn1086(a,true);
    assert.equal(first.browser_work_item_id,9001);assert.equal(second.browser_work_item_id,9001);assert.equal(second.replayed,true);
    assert.equal(f.writes.filter(w=>w==='work').length,1);assert.equal(f.work.result_payload.target_profile_url,p.profile);
    assert.equal(f.task.publication_mode,'browser_required');
    await assert.rejects(release.controlLinkedIn1086({...a,approvalReference:'different scoped approval'},true),/IDEMPOTENCY_CONFLICT/);
});
test('foreign owner, changed body/date/profile/visual/review and existing attempt fail without writes',async t=>{
    for(const mutate of [f=>{f.owner='editor';},f=>{f.task.draft_text+='changed';},f=>{f.task.publish_at=new Date();},
        f=>{f.task.channel.config.account_ref='https://www.linkedin.com/company/seturon/';},f=>{f.task.selected_asset_id=1;},
        f=>{f.tx.artDirectionDecision.findFirst=async()=>null;},f=>{f.tx.workItem.findFirst=async()=>null;},
        f=>{f.attempt={id:7,status:'pending'};},f=>{f.task.publication_fact={id:4};},f=>{f.task.quality_report.publication_hold=true;}]) {
        const f=fixture(t);mutate(f);await assert.rejects(release.controlLinkedIn1086({...args,apply:true},false));
        assert.deepEqual(f.writes,[]);
    }
});
test('expired same fence admits reconciliation but never start/Submit; changed actor/fence rejected',async t=>{
    const f=fixture(t);await release.controlLinkedIn1086({...args,apply:true},false);
    await release.controlLinkedIn1086({...args,apply:true,idempotencyKey:'synthetic-release'},true);
    Object.assign(f.work,{state:'claimed',lease_actor_id:'user:2',lease_token:'synthetic-fence',lease_expires_at:new Date('2026-10-14T00:00Z')});
    const a={...args,workItemId:9001,leaseToken:'synthetic-fence',releaseIdempotencyKey:'synthetic-release',
        observedProfileUrl:p.profile,authorEvidenceSha256:'a'.repeat(64),duplicateCheckReference:'synthetic native history'};
    await assert.rejects(guard.check1086(f.tx,a),/LEASE_REQUIRED/);
    assert.equal((await guard.check1086(f.tx,a,true)).work.id,9001);
    await assert.rejects(guard.check1086(f.tx,{...a,leaseToken:'wrong'},true),/LEASE_REQUIRED/);
    await assert.rejects(guard.check1086(f.tx,{...a,actorId:'user:3'},true));
});
test('prepare preserves repaired manual English projection only for exact1086 body',()=>{
    const q={linkedin1086_metadata_repair:p.body};const bundle={task:{content_item_id:1086},mode:'automated',publication:{body}};
    assert.equal(preserve1086Handoff(bundle,q).mode,'manual');
    assert.equal(preserve1086Handoff(bundle,q).content_language,'en');
    assert.throws(()=>preserve1086Handoff({...bundle,publication:{body:'changed'}},q),/PROJECTION_BODY_MISMATCH/);
    const other={...bundle,task:{content_item_id:1128}};assert.equal(preserve1086Handoff(other,q),other);
});
test('generic manual fact cannot claim1086 publication',async()=>{
    const {guardManualPublicationFact}=require('../../dist/services/publication_manual_fact_guard');
    await assert.rejects(guardManualPublicationFact({}, {projectId:7,taskId:1086,internalConfirmation:false}),/LINKEDIN1086_EXACT_CONFIRMATION_REQUIRED/);
});
test.after(async()=>{await db.default.$disconnect();await db.pool.end();});
