const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');
const {request,snapshot,fixture,sha,body}=require('./shared-browser.fixture.cjs');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const load=name=>{const file=path.join(base,'services',name+'.js');return fs.existsSync(file)?require(file):{};};
const release=load('browser_publication_release'),svc=load('browser_publication_execution');
const observation={observedProfileUrl:snapshot.identity.profileUrl,observedProviderAccountId:snapshot.identity.providerAccountId,
    observedAccountType:'company_page',observedBodySha256:snapshot.bodySha256,observedAssetSha256:snapshot.assetSha256,
    paragraphBlockSha256:body.split(/\n\s*\n/).map(block=>sha(block.trim())),attachedImageCount:1,
    duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
test('S3 shared claim/start/pre-submit/uncertain controls exist',()=>{
    for(const name of ['claimBrowserPublication','startBrowserSubmission','preSubmitBrowserSubmission','markBrowserSubmissionUncertain'])
        assert.equal(typeof svc[name],'function',name+' missing');
});
async function leased(){const f=fixture();await release.repairBrowserPublicationMetadata({...request,apply:true,idempotencyKey:'repair'},f);
    await release.releaseBrowserPublication({...request,apply:true},f);
    const claim={...request,workItemId:f.state.work[0].id,idempotencyKey:'claim'};
    const lease=await svc.claimBrowserPublication(claim,f);
    return{f,claim,send:{...request,workItemId:claim.workItemId,leaseToken:lease.lease_token,idempotencyKey:'one-send'}};
}
test('S3 claim replay returns only same current lease; durable audit never contains raw lease',async()=>{
    const {f,claim,send}=await leased();assert.ok(send.leaseToken);
    assert.equal((await svc.claimBrowserPublication(claim,f)).lease_token,send.leaseToken);
    assert.equal(JSON.stringify(f.state.events).includes(send.leaseToken),false);
    await assert.rejects(svc.claimBrowserPublication({...claim,idempotencyKey:'other-claim'},f));
});
test('S3 an expired claim key cannot retrieve a newer lease generation from the same actor',async()=>{
    const {f,claim,send}=await leased();f.state.work[0].lease_expires_at=new Date(0);
    const next=await svc.claimBrowserPublication({...claim,idempotencyKey:'reclaim'},f);
    assert.notEqual(next.lease_token,send.leaseToken);
    await assert.rejects(svc.claimBrowserPublication(claim,f),/BROWSER_ACTIVE_LEASE_REQUIRED/);
});
test('S3 start creates exactly one attempt; replay and UNKNOWN never issue another send permit',async()=>{
    const {f,send}=await leased();const started=await svc.startBrowserSubmission(send,f);
    assert.equal(started.submission_permitted,false);assert.equal(f.state.attempts.length,1);
    assert.equal((await svc.startBrowserSubmission(send,f)).submission_permitted,false);
    await svc.markBrowserSubmissionUncertain({...send,attemptId:started.attempt_id,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},f);
    assert.equal((await svc.startBrowserSubmission(send,f)).submission_permitted,false);
    await assert.rejects(svc.startBrowserSubmission({...send,idempotencyKey:'another-send'},f));
    assert.equal(f.state.attempts.length,1);assert.equal(f.state.fact,null);
});
test('S4 pre-submit rejects actual company/text/image/block mismatch and only first valid call permits submit',async()=>{
    const {f,send}=await leased();const start=await svc.startBrowserSubmission(send,f);
    const args={...send,...observation,attemptId:start.attempt_id};
    for(const patch of [{observedProviderAccountId:'79633032'},{observedAccountType:'personal'},
        {observedBodySha256:'0'.repeat(64)},{observedAssetSha256:'0'.repeat(64)},
        {paragraphBlockSha256:[sha(body)]},{attachedImageCount:0},{duplicateAbsent:false},{leaseToken:'wrong'}])
        await assert.rejects(svc.preSubmitBrowserSubmission({...args,...patch},f));
    assert.equal((await svc.preSubmitBrowserSubmission(args,f)).submission_permitted,true);
    assert.equal((await svc.preSubmitBrowserSubmission(args,f)).submission_permitted,false);
    f.state.work[0].lease_expires_at=new Date(0);
    await assert.rejects(svc.preSubmitBrowserSubmission({...args,idempotencyKey:'new'},f));
});
module.exports={leased,observation};
