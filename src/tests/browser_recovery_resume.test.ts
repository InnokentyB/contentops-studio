import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resumeBrowserRecovery,type BrowserRecoveryResumePort,type BrowserRecoveryResumeState,type BrowserRecoveryResumeProof,type ResumeCommit} from '../services/browser_recovery_resume';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const input={projectId:1,taskId:2,attemptId:3,actorId:'user:4',idempotencyKey:'resume-fixture'};
const state=():BrowserRecoveryResumeState=>({...input,contractVersion:2,rowVersion:2,executionGeneration:1,stage:'PREPARE',deliveryCertainty:'NOT_DISPATCHED',attemptStatus:'pending',ownerAuthorized:true,permissionAllowed:true,approvalActive:true,originalApprovalSha256:digest('approval'),currentApprovalSha256:digest('approval'),packageSha256:digest('package'),currentPackageSha256:digest('package'),workItemId:5,recoveryLeaseExpiresAt:null,recoveryState:'held'});
function fixture(){
    const stored=state();const commits:ResumeCommit[]=[];
    const proof:BrowserRecoveryResumeProof={executorId:'registered-fixture',evidenceRef:'sha256:'+digest('evidence'),issuedPermitCount:0,dispatchCount:0,oldExecutorQuiescent:true,challengeSupersessionSupported:true};
    let replay:{requestSha256:string;generation:number}|null=null;let cas=true;
    const port:BrowserRecoveryResumePort={transaction:async run=>run({load:async()=>stored,findReplay:async()=>replay,commitResume:async commit=>{if(!cas)return false;commits.push(commit);stored.executionGeneration=commit.nextGeneration;stored.rowVersion++;stored.recoveryLeaseExpiresAt=commit.leaseExpiresAt;stored.recoveryState='resumed';replay={requestSha256:commit.requestSha256,generation:commit.nextGeneration};return true;}}),executorFence:{executorId:proof.executorId,proveQuiescence:async()=>proof},now:()=>new Date('2026-10-18T12:00:00Z')};
    return {stored,commits,proof,port,setCas:(value:boolean)=>{cas=value;}};
}
test('same attempt resumes with fenced generation, private new lease and safe idempotent replay',async()=>{
    const f=fixture();const result=await resumeBrowserRecovery(input,f.port);
    assert.equal(result.code,'RECOVERY_PREPARE_RESUMED');assert.equal(result.generation,2);assert.equal(result.submission_permitted,false);
    assert.equal(f.commits.length,1);const commit=f.commits[0]!;
    assert.equal(commit.scope.attemptId,3);assert.equal(commit.expectedGeneration,1);assert.equal(commit.expectedRowVersion,2);
    assert.match(commit.leaseToken,/^recovery-/);assert.equal(commit.leaseSha256,digest(commit.leaseToken));
    for(const secret of [commit.leaseToken,commit.leaseSha256,digest('approval'),f.proof.evidenceRef,f.proof.executorId])assert.ok(!JSON.stringify(result).includes(secret));
    const replay=await resumeBrowserRecovery(input,f.port);assert.equal(replay.replayed,true);assert.equal(f.commits.length,1);
});
for(const [field,value,code] of [
    ['ownerAuthorized',false,'RECOVERY_OWNER_REQUIRED'],['permissionAllowed',false,'PERMISSION_DENIED'],['approvalActive',false,'APPROVAL_REVOKED'],
    ['currentApprovalSha256',digest('changed'),'APPROVAL_REVOKED'],['currentPackageSha256',digest('changed'),'PACKAGE_CHANGED'],
    ['projectId',99,'RECOVERY_SCOPE_MISMATCH'],['attemptStatus','delivered','RECOVERY_CONFLICT'],
    ['stage','PERMIT_ISSUED','POST_SUBMIT_UNKNOWN'],['deliveryCertainty','UNKNOWN','PRE_DISPATCH_PROOF_UNAVAILABLE']
] as const) test(`resume denied ${field}`,async()=>{const f=fixture();Object.assign(f.stored,{[field]:value});const result=await resumeBrowserRecovery(input,f.port);assert.equal(result.code,code);assert.equal(f.commits.length,0);});
test('unsupported executor never mutates',async()=>{const f=fixture();delete f.port.executorFence;assert.equal((await resumeBrowserRecovery(input,f.port)).code,'PRE_DISPATCH_PROOF_UNAVAILABLE');assert.equal(f.commits.length,0);});
test('issued permit or incomplete proof never resumes',async()=>{const f=fixture();f.port.executorFence!.proveQuiescence=async()=>null;assert.equal((await resumeBrowserRecovery(input,f.port)).code,'PRE_DISPATCH_PROOF_UNAVAILABLE');assert.equal(f.commits.length,0);});
test('conflict and changed replay key cannot grant another lease',async()=>{const f=fixture();f.setCas(false);assert.equal((await resumeBrowserRecovery(input,f.port)).code,'RECOVERY_CONFLICT');assert.equal(f.commits.length,0);});
test('untrusted malformed request cannot supply technical evidence',async()=>{const f=fixture();await assert.rejects(()=>resumeBrowserRecovery({...input,trusted:true},f.port));assert.equal(f.commits.length,0);});
for(const proofPatch of [{issuedPermitCount:1},{dispatchCount:1},{oldExecutorQuiescent:false},{challengeSupersessionSupported:false},{executorId:'other'},{evidenceRef:'raw secret'}]) test(`untrusted/incomplete executor proof ${Object.keys(proofPatch)[0]}`,async()=>{
    const f=fixture();Object.assign(f.proof,proofPatch);const result=await resumeBrowserRecovery(input,f.port);
    assert.equal(result.code,'PRE_DISPATCH_PROOF_UNAVAILABLE');assert.equal(f.commits.length,0);assert.doesNotMatch(JSON.stringify(result),/secret/);
});
test('repository exceptions propagate for safe boundary serialization without a false resume',async()=>{
    const f=fixture();f.port.transaction=async()=>{throw new Error('synthetic storage failure');};
    await assert.rejects(()=>resumeBrowserRecovery(input,f.port));assert.equal(f.commits.length,0);
});
test('malformed immutable proof cannot satisfy equal missing values',async()=>{
    const f=fixture();Object.assign(f.stored,{originalApprovalSha256:'',currentApprovalSha256:'',packageSha256:'',currentPackageSha256:''});
    assert.equal((await resumeBrowserRecovery(input,f.port)).code,'PRE_DISPATCH_PROOF_UNAVAILABLE');assert.equal(f.commits.length,0);
});

test('committed replay after permit issuance cannot claim executor pickup',async()=>{const f=fixture();await resumeBrowserRecovery(input,f.port);f.stored.stage='PERMIT_ISSUED';assert.equal((await resumeBrowserRecovery(input,f.port)).code,'POST_SUBMIT_UNKNOWN');assert.equal(f.commits.length,1);});
test('committed replay after generation advances is a held conflict',async()=>{const f=fixture();await resumeBrowserRecovery(input,f.port);f.stored.executionGeneration++;assert.equal((await resumeBrowserRecovery(input,f.port)).code,'RECOVERY_CONFLICT');assert.equal(f.commits.length,1);});

test('committed replay after pickup lease expiry cannot advertise a usable pickup',async()=>{
    const f=fixture();await resumeBrowserRecovery(input,f.port);
    Object.assign(f.stored,{recoveryLeaseExpiresAt:new Date('2026-10-18T11:59:59Z'),recoveryState:'resumed'});
    const result=await resumeBrowserRecovery(input,f.port);
    assert.equal(result.code,'RECOVERY_CONFLICT');assert.equal(result.resumed,false);assert.equal(f.commits.length,1);
});

test('committed replay after state is held cannot advertise pickup',async()=>{const f=fixture();await resumeBrowserRecovery(input,f.port);f.stored.recoveryState='held';const result=await resumeBrowserRecovery(input,f.port);assert.equal(result.code,'RECOVERY_CONFLICT');assert.equal(result.resumed,false);assert.equal(f.commits.length,1);});
