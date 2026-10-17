const test=require('node:test'),assert=require('node:assert/strict');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const diagnostics=require(base+'/services/browser_publication_diagnostics.js');
const release=require(base+'/services/browser_publication_release.js');
const {fixture,request,body,sha}=require('./shared-browser.fixture.cjs');
function missingSetkaBundle(){
    const f=fixture(),args=structuredClone(request),s=args.snapshot,t=f.state.task;
    s.identity={...s.identity,platform:'setka',accountType:'personal',accountRef:'synthetic_setka',
        providerAccountId:'019c0000-0000-7000-8000-000000000001',
        profileUrl:'https://setka.ru/users/019c0000-0000-7000-8000-000000000001'};
    s.contentRevision=2;t.content_revision=2;t.accepted_revision=2;t.selected_asset.content_revision=2;
    t.art_direction_decisions[0].source_content_revision=2;t.art_direction_decisions[0].channel='setka';
    t.channel.type='setka';t.channel.config={account_type:'unknown',account_ref:s.identity.accountRef,
        profile_url:s.identity.profileUrl,execution_modes:['manual'],capability_flags:{manual_handoff:true}};
    delete t.quality_report.handoff_bundle;
    return{f,args};
}
test('Setka r2 diagnosis reads actual missing persisted bundle without mutation or snapshot requirement',async()=>{
    const{f,args}=missingSetkaBundle(),before=structuredClone(f.state);
    const result=await diagnostics.diagnoseBrowserPublication({projectId:args.projectId,taskId:args.taskId,actorId:args.actorId},f);
    assert.deepEqual(result.persisted_handoff,{bundle_present:false,publication_body_present:false,publication_body_sha256:null});
    assert.equal(result.snapshot_check,null);assert.equal(result.mutates_state,false);
    assert.deepEqual(f.state,before);
});
test('Setka-shaped expected package reports exact missing body field with hash-only evidence',async()=>{
    const{f,args}=missingSetkaBundle(),before=structuredClone(f.state);
    const result=await diagnostics.diagnoseBrowserPublication({projectId:args.projectId,taskId:args.taskId,
        actorId:args.actorId,expectedSnapshot:args.snapshot},f);
    assert.deepEqual(result.snapshot_check,{valid:false,mismatches:[{
        field:'quality_report.handoff_bundle.publication.body',expected:sha(body),current:null,
        representation:'sha256',current_present:false}]});
    assert.equal(JSON.stringify(result).includes(body),false);assert.deepEqual(f.state,before);
    await assert.rejects(release.inspectBrowserPublication(args,f),error=>{
        assert.match(error.message,/BROWSER_SNAPSHOT_MISMATCH/);
        assert.match(error.message,/quality_report.handoff_bundle.publication.body/);
        assert.match(error.message,new RegExp(sha(body)));return true;
    });
    assert.deepEqual(f.state,before);
});
test('missing legacy bundle previews then repairs atomically before normal exact release',async()=>{
    const{f,args}=missingSetkaBundle(),before=structuredClone(f.state);
    const preview=await release.repairBrowserPublicationMetadata(args,f);
    assert.equal(preview.handoff_materialization.eligible,true);
    assert.equal(preview.handoff_materialization.applied,false);assert.deepEqual(f.state,before);
    const applied=await release.repairBrowserPublicationMetadata({...args,apply:true},f);
    assert.equal(applied.handoff_materialization.applied,true);
    const bundle=f.state.task.quality_report.handoff_bundle;
    assert.equal(bundle.publication.body,body);assert.equal(bundle.publication.image_url,f.state.task.selected_asset.file_url);
    assert.equal(bundle.task.account_ref,args.snapshot.identity.accountRef);assert.equal(bundle.content_language,args.snapshot.contentLanguage);
    const after=structuredClone(f.state);
    assert.equal((await release.repairBrowserPublicationMetadata({...args,apply:true},f)).replayed,true);
    assert.deepEqual(f.state,after);
    await release.releaseBrowserPublication({...args,idempotencyKey:'release-after-repair',apply:true},f);
    assert.equal(f.state.work.length,1);assert.equal(f.state.attempts.length,0);
    assert.equal(f.state.task.draft_text,before.task.draft_text);assert.equal(f.state.task.accepted_revision,2);
    assert.equal(f.state.task.selected_asset_id,before.task.selected_asset_id);
    assert.equal(f.state.events[0].after_state.handoff_materialization.basis,'verified_accepted_durable_fields');
});
test('legacy repair rejects partial/divergent bundles, changed binding and every browser delivery history',async()=>{
    const variants=[
        f=>f.state.task.quality_report.handoff_bundle={},
        f=>f.state.task.quality_report.handoff_bundle=null,
        f=>f.state.task.quality_report.handoff_bundle={publication:{}},
        f=>f.state.task.quality_report.handoff_bundle={publication:{body:'divergent'}},
        f=>f.state.task.draft_text+=' changed',
        f=>f.state.task.channel.config.profile_url+='?wrong=profile',
        f=>f.state.task.selected_asset.provenance.planner_storage.sha256='0'.repeat(64),
        f=>f.state.task.schedule_at=new Date(0),
        f=>f.state.task.art_direction_decisions[0].source_content_revision=1,
        f=>f.state.task.publication_fact={id:900},
        f=>f.state.work.push({id:900,project_id:request.projectId,content_item_id:request.taskId,kind:'browser_publish',state:'completed'}),
        f=>f.state.work.push({id:900,project_id:request.projectId,content_item_id:request.taskId,kind:'browser_publish',state:'cancelled'}),
        f=>f.state.attempts.push({id:900,project_id:request.projectId,content_item_id:request.taskId,status:'failed'}),
        f=>f.db.connectorDispatchJob.findFirst=async()=>({id:900,state:'confirmed'})
    ];
    for(const change of variants){const{f,args}=missingSetkaBundle();change(f);const before=structuredClone(f.state);
        await assert.rejects(release.repairBrowserPublicationMetadata({...args,apply:true},f));assert.deepEqual(f.state,before);}
    const{f,args}=missingSetkaBundle();f.state.failAudit=true;const before=structuredClone(f.state);
    await assert.rejects(release.repairBrowserPublicationMetadata({...args,apply:true},f),/audit unavailable/);
    assert.deepEqual(f.state,before);
});
test('diagnostic mismatches redact unexpected strings and reject owner/tenant changes without writes',async()=>{
    const{f,args}=missingSetkaBundle();
    const secret='synthetic-secret-never-echo';
    f.state.task.quality_report.handoff_bundle={publication:{body:secret}};
    f.state.task.channel.config.account_ref=secret;f.state.task.channel.type=secret;
    const result=await diagnostics.diagnoseBrowserPublication({projectId:args.projectId,taskId:args.taskId,
        actorId:args.actorId,expectedSnapshot:args.snapshot},f);
    assert.equal(JSON.stringify(result).includes(secret),false);
    assert.ok(result.snapshot_check.mismatches.some(m=>m.field==='channel.config.account_ref'&&m.current===sha(secret)));
    const before=structuredClone(f.state);
    await assert.rejects(diagnostics.diagnoseBrowserPublication({projectId:args.projectId,taskId:args.taskId,
        actorId:args.actorId,expectedSnapshot:{...args.snapshot,projectId:999}},f),/SCOPE_MISMATCH/);
    assert.deepEqual(f.state,before);f.state.owner=false;
    await assert.rejects(diagnostics.diagnoseBrowserPublication({projectId:args.projectId,taskId:args.taskId,actorId:args.actorId},f),/OWNER_REQUIRED/);
});
test('legacy materialization never replaces a malformed metadata container or its history',async()=>{
    for(const value of ['synthetic-preserved-history',[],false,42,null]){
        const{f,args}=missingSetkaBundle();f.state.task.quality_report=value;const before=structuredClone(f.state);
        await assert.rejects(release.repairBrowserPublicationMetadata({...args,apply:true},f),/BROWSER_HANDOFF_METADATA_INVALID/);
        assert.deepEqual(f.state,before);
    }
});
