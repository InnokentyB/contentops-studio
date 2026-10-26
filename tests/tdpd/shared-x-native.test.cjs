const test=require('node:test'),assert=require('node:assert/strict');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const release=require(base+'/services/browser_publication_release.js');
const exec=require(base+'/services/browser_publication_execution.js');
const confirm=require(base+'/services/browser_publication_confirmation.js');
const {browserSnapshotSchema}=require(base+'/services/browser_publication_contract.js');
const {request,fixture,body}=require('./shared-browser.fixture.cjs');
const {xFixture,xObserved}=require('./shared-x-native.fixture.cjs');
async function ready(taskId,handle){const{f,args}=xFixture(taskId,handle);
    await release.repairBrowserPublicationMetadata({...args,idempotencyKey:'repair',apply:true},f);
    await release.releaseBrowserPublication({...args,apply:true},f);
    const workItemId=f.state.work[0].id;
    const lease=await exec.claimBrowserPublication({...args,workItemId,idempotencyKey:'claim'},f);
    const send={...args,workItemId,leaseToken:lease.lease_token,idempotencyKey:'send'};
    // Internal server seam only. Cryptographic authenticity is verified by the
    // native receipt suite; this suite proves transactional gate placement.
    const gate=async(tx,phase,input)=>{assert.equal(tx,f.db);assert.equal(input.taskId,args.taskId);
        f.state.events.push({command:'synthetic-native-consumed',phase});};
    return{f,args,send,gate};}
const writer=f=>async a=>f.db.$transaction(async tx=>{await a.beforeWrite(tx);
    const fact={id:600,project_id:a.projectId,channel_id:f.state.task.channel_id,content_item_id:a.taskId,
        public_url:a.publicUrl,provider_object_id:a.providerObjectId,evidence_ref:a.evidence.ref};
    f.state.fact=fact;f.state.task.publication_fact=fact;f.state.task.status='published';return fact;});
test('X no-visual package is data-driven; existing image routes cannot omit their approved image',async()=>{
    for(const [id,handle] of [[2401,'synthetic_owner'],[3402,'second_owner']]){
        const {f,args}=xFixture(id,handle),before=structuredClone(f.state);
        assert.equal(browserSnapshotSchema.safeParse(args.snapshot).success,true);
        assert.equal((await release.inspectBrowserPublication(args,f)).publication_authorized,false);
        assert.deepEqual(f.state,before);
    }
    for(const platform of ['devto','setka']){
        const s=structuredClone(request.snapshot);s.identity.platform=platform;s.selectedAssetId=null;s.assetSha256=null;
        assert.equal(browserSnapshotSchema.safeParse(s).success,false);
    }
    const s=structuredClone(request.snapshot);s.selectedAssetId=null;s.assetSha256=null;
    assert.equal(browserSnapshotSchema.safeParse(s).success,true);
    const imageRequired=fixture();imageRequired.state.task.selected_asset_id=null;imageRequired.state.task.selected_asset=null;
    await assert.rejects(release.inspectBrowserPublication({...request,snapshot:s},imageRequired),/BROWSER_SNAPSHOT_MISMATCH/);
});
test('X acceptance requires exact active no-visual decision and no selected asset',async()=>{
    for(const mutate of [f=>f.state.task.visual_state='APPROVED',f=>f.state.task.selected_asset_id=166,
        f=>f.state.task.art_direction_decisions[0].decision='GENERATE',
        f=>f.state.task.art_direction_decisions[0].status='superseded',
        f=>f.state.task.channel.config.account_ref='@other',f=>f.state.task.draft_text=body+' drift']){
        const{f,args}=xFixture();mutate(f);const before=structuredClone(f.state);
        await assert.rejects(release.inspectBrowserPublication(args,f));assert.deepEqual(f.state,before);
    }
});
test('X mixed-case identity disagreement is rejected before release or provider action',async()=>{
    const{f,args}=xFixture();args.snapshot.identity.providerAccountId='Synthetic_owner';
    const before=structuredClone(f.state);
    await assert.rejects(release.inspectBrowserPublication(args,f),/BROWSER_IDENTITY_INVALID/);
    assert.deepEqual(f.state,before);assert.equal(f.state.attempts.length,0);
});
test('optional X signed gate failure still rolls back its own writes',async()=>{
    const{f,send}=await ready();const before=structuredClone(f.state);
    await assert.rejects(exec.startBrowserSubmission(send,f,async()=>{
        f.state.events.push({command:'must-rollback'});throw Error('synthetic signature rejected');}),/signature rejected/);
    assert.deepEqual(f.state,before);assert.equal(f.state.attempts.length,0);
});
test('X internal signed gate precedes one attempt; only first native permit grants <=15 seconds',async t=>{
    const{f,send,gate}=await ready();const start=await exec.startBrowserSubmission(send,f,gate);
    assert.equal(f.state.attempts.length,1);assert.equal(start.submission_permitted,false);
    const observed=xObserved(send,start.attempt_id);
    await assert.rejects(exec.preSubmitBrowserSubmission(observed,f),/BROWSER_NATIVE_RECEIPT_REQUIRED/);
    const issuedAt=Date.now();t.mock.method(Date,'now',()=>issuedAt);
    const permit=await exec.preSubmitBrowserSubmission(observed,f,gate);
    assert.equal(permit.submission_permitted,true);assert.equal(Date.parse(permit.permit_expires_at),issuedAt+15000);
    assert.equal((await exec.preSubmitBrowserSubmission(observed,f,gate)).submission_permitted,false);
    for(const patch of [{attachedImageCount:1},{observedAssetSha256:'0'.repeat(64)},
        {observedProviderAccountId:'other'},{duplicateAbsent:false}])
        await assert.rejects(exec.preSubmitBrowserSubmission({...observed,...patch},f,gate));
});
test('X confirm/reconcile reject raw caller observations; signed result keeps native object namespace',async()=>{
    const{f,send,gate}=await ready();const start=await exec.startBrowserSubmission(send,f,gate);
    const observed=xObserved(send,start.attempt_id);await exec.preSubmitBrowserSubmission(observed,f,gate);
    const a={...observed,publicUrl:send.snapshot.identity.profileUrl+'/status/987654321',
        providerObjectId:'987654321',publishedAt:new Date().toISOString()};
    const before=structuredClone(f.state);
    await assert.rejects(confirm.confirmBrowserSubmission(a,f,writer(f)),/BROWSER_NATIVE_RECEIPT_REQUIRED/);
    const{leaseToken,...r}=a;
    await assert.rejects(confirm.reconcileBrowserSubmission(r,f,writer(f)),/BROWSER_RECONCILIATION_NOT_REQUIRED/);
    assert.deepEqual(f.state,before);
    const result=await confirm.confirmBrowserSubmission(a,f,writer(f),gate);
    assert.equal(result.public_url,a.publicUrl);assert.equal(f.state.attempts[0].status,'delivered');
});
test('X UNKNOWN remains same-attempt reconciliation after lease expiry, with no fresh permit',async()=>{
    const{f,send,gate}=await ready();const start=await exec.startBrowserSubmission(send,f,gate);
    const observed=xObserved(send,start.attempt_id);await exec.preSubmitBrowserSubmission(observed,f,gate);
    await exec.markBrowserSubmissionUncertain({...send,attemptId:start.attempt_id,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},f,gate);
    f.state.work[0].lease_expires_at=new Date(0);
    await assert.rejects(exec.preSubmitBrowserSubmission(observed,f,gate));
    const{leaseToken,...a}={...observed,publicUrl:send.snapshot.identity.profileUrl+'/status/987654321',
        providerObjectId:'987654321',publishedAt:new Date().toISOString()};
    assert.equal((await confirm.reconcileBrowserSubmission(a,f,writer(f),gate)).retry_allowed,false);
    assert.equal(f.state.attempts.length,1);
});
