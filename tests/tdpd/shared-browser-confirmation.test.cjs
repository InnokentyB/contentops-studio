const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');
const {request,snapshot,fixture,body,sha}=require('./shared-browser.fixture.cjs');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const load=name=>{const file=path.join(base,'services',name+'.js');return fs.existsSync(file)?require(file):{};};
const release=load('browser_publication_release'),exec=load('browser_publication_execution'),svc=load('browser_publication_confirmation');
test('S5 shared atomic confirmation and reconciliation controls exist',()=>{
    assert.equal(typeof svc.confirmBrowserSubmission,'function');assert.equal(typeof svc.reconcileBrowserSubmission,'function');
});
async function submitted(){const f=fixture();await release.repairBrowserPublicationMetadata({...request,apply:true,idempotencyKey:'repair'},f);
    await release.releaseBrowserPublication({...request,apply:true},f);
    const workItemId=f.state.work[0].id;
    const lease=await exec.claimBrowserPublication({...request,workItemId,idempotencyKey:'claim'},f);
    const send={...request,workItemId,leaseToken:lease.lease_token,idempotencyKey:'send'};
    const start=await exec.startBrowserSubmission(send,f);
    const observed={...send,attemptId:start.attempt_id,observedProfileUrl:snapshot.identity.profileUrl,
        observedProviderAccountId:snapshot.identity.providerAccountId,observedAccountType:'company_page',
        observedBodySha256:snapshot.bodySha256,observedAssetSha256:snapshot.assetSha256,
        paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:1,
        duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
    await exec.preSubmitBrowserSubmission(observed,f);
    return{f,send,args:{...observed,publicUrl:'https://www.linkedin.com/feed/update/urn:li:activity:987654321/',
        providerObjectId:'urn:li:activity:987654321',publishedAt:new Date().toISOString()}};
}
const writer=(f,fail=false)=>async args=>f.db.$transaction(async tx=>{
    await args.beforeWrite(tx);if(fail)throw Error('synthetic fact unavailable');
    const fact={id:500,project_id:args.projectId,content_item_id:args.taskId,channel_id:snapshot.channelId,
        public_url:args.publicUrl,provider_object_id:args.providerObjectId,published_at:new Date(args.publishedAt),
        evidence_ref:args.evidence.ref};f.state.fact=fact;f.state.task.publication_fact=fact;
    f.state.task.status='published';f.state.work[0].state='completed';return{publication_fact:fact};
});
test('S5 fact+attempt+audit commit together; exact replay is read-only',async()=>{
    const {f,args}=await submitted();const result=await svc.confirmBrowserSubmission(args,f,writer(f));
    assert.equal(result.public_url,args.publicUrl);assert.equal(f.state.attempts[0].status,'delivered');
    const before=structuredClone(f.state);assert.equal((await svc.confirmBrowserSubmission(args,f,writer(f))).replayed,true);
    assert.deepEqual(f.state,before);
});
test('S5 failed fact write rolls back completion audit and attempt state',async()=>{
    const {f,args}=await submitted(),before=structuredClone(f.state);
    await assert.rejects(svc.confirmBrowserSubmission(args,f,writer(f,true)),/fact unavailable/);
    assert.deepEqual(f.state,before);
});
test('S5 forged identity, wrong company, image, attempt or body never writes a fact',async()=>{
    const {f,args}=await submitted();for(const patch of [{providerObjectId:'urn:li:share:987654321'},
        {publicUrl:args.publicUrl+'?actorCompanyId=79633032'},{observedProviderAccountId:'79633032'},
        {observedAssetSha256:'0'.repeat(64)},{attemptId:777},{observedBodySha256:'0'.repeat(64)},
        {publishedAt:'2020-01-01T00:00:00.000Z'},{publishedAt:new Date(Date.now()+3600000).toISOString()}])
        await assert.rejects(svc.confirmBrowserSubmission({...args,...patch},f,writer(f)));
    assert.equal(f.state.fact,null);
});
test('S5 UNKNOWN + expired lease reconcile only existing provider object, never reopen send',async()=>{
    const {f,args,send}=await submitted();await exec.markBrowserSubmissionUncertain({...send,attemptId:args.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},f);
    f.state.work[0].lease_expires_at=new Date(0);
    await assert.rejects(svc.confirmBrowserSubmission(args,f,writer(f)));
    const {leaseToken,...readback}=args;
    const result=await svc.reconcileBrowserSubmission(readback,f,writer(f));
    assert.equal(result.retry_allowed,false);assert.equal(f.state.attempts.length,1);assert.ok(f.state.fact);
});
