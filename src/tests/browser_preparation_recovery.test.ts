import test from 'node:test';
import assert from 'node:assert/strict';
import * as resume from '../services/browser_recovery_resume';
const api=resume as unknown as {createPreparationRecovery?: (options:unknown)=>{recover:(input:unknown)=>Promise<Record<string,unknown>>}};
test('PREP-04 unsupported application executor stays held with actionable explanation and no store mutation',async()=>{
 assert.equal(typeof api.createPreparationRecovery,'function','missing durable preparation recovery application');
 let calls=0;const service=api.createPreparationRecovery!({repository:{load:async()=>{calls++;}},supervisor:undefined});
 const result=await service.recover({projectId:1,taskId:2,attemptId:3,actorId:'user:4',idempotencyKey:'same-attempt'});
 assert.equal(result.code,'PRE_DISPATCH_PROOF_UNAVAILABLE');assert.equal(result.submission_permitted,false);assert.equal(result.retry_allowed,false);assert.equal(calls,0);assert.ok(String(result.action).includes('executor'));
});
test('PREP-06 first-permit admission cannot bypass generic writers or canonical fact guards in the same transaction',async()=>{
 const guard=await import('../services/browser_recovery_guard');const prior=process.env.BROWSER_RECOVERY_V2_ENABLED;process.env.BROWSER_RECOVERY_V2_ENABLED='true';
 const tx={$queryRaw:async()=>[{available:true}],browserDeliveryRecovery:{findFirst:async()=>({stage:'PREPARE'})}} as unknown as Parameters<typeof guard.withBrowserPreparationPermit>[0];
 const scope={projectId:1,taskId:2,attemptId:3,generation:0,packageSha256:'a'.repeat(64),leaseSha256:'b'.repeat(64)};
 try{await guard.withBrowserPreparationPermit(tx,scope,async()=>{
  await assert.rejects(guard.assertBrowserRecoveryWriter(tx,scope),/BROWSER_RECOVERY_V2_HELD/);
  await assert.rejects(guard.assertBrowserRecoveryFactWriter(tx,scope),/BROWSER_RECOVERY_V2_HELD/);
  await assert.rejects(guard.assertBrowserRecoveryWriter(tx,scope,{kind:'first_permit',attemptId:4,generation:0}),/BROWSER_RECOVERY_V2_HELD/);
  await assert.rejects(guard.assertBrowserRecoveryWriter(tx,scope,{kind:'first_permit',attemptId:3,generation:1}),/BROWSER_RECOVERY_V2_HELD/);
  await guard.assertBrowserRecoveryWriter(tx,scope,{kind:'first_permit',attemptId:3,generation:0});
 });}finally{if(prior===undefined)delete process.env.BROWSER_RECOVERY_V2_ENABLED;else process.env.BROWSER_RECOVERY_V2_ENABLED=prior;}
});
test('PREP-10 actual registered uncertainty handler wires preparation ahead of generic recovery serialization',async()=>{
 const {registerBrowserPublicationTools}=await import('../mcp/tools/browser_publication_tools');
 const execution=require('../services/browser_publication_execution') as typeof import('../services/browser_publication_execution');
 const original=execution.markBrowserSubmissionUncertain,handlers=new Map<string,(input:unknown)=>Promise<unknown>>();let invoked=false;
 const server={registerTool(name:string,_configuration:unknown,handler:(input:unknown)=>Promise<unknown>){handlers.set(name,handler);}};
 const preparation=resume.createPreparationRecovery();
 preparation.operation=async()=>{invoked=true;return {state:'reconciliation_required',submission_permitted:false,retry_allowed:false,recovery:{code:'PRE_DISPATCH_PROOF_UNAVAILABLE'}};};
 execution.markBrowserSubmissionUncertain=async(input,_deps,_native,_reader,prepare)=>{assert.equal(typeof prepare,'function');return (await prepare!(input))!;};
 try{registerBrowserPublicationTools(server as unknown as Parameters<typeof registerBrowserPublicationTools>[0],undefined,preparation);const result=await handlers.get('ba_mark_browser_submission_uncertain')!({});const serialized=JSON.stringify(result);assert.equal(invoked,true);assert.ok(serialized.includes('PRE_DISPATCH_PROOF_UNAVAILABLE'));assert.ok(serialized.includes('action'));assert.equal(serialized.includes('leaseToken'),false);}finally{execution.markBrowserSubmissionUncertain=original;}
});
test('PREP-04 unclassified dependency failure has a safe investigation path without inventing a conflict',async()=>{
 const service=resume.createPreparationRecovery({deps:{db:{$transaction:async()=>{throw Error('private-database-token');}}} as unknown as NonNullable<Parameters<typeof resume.createPreparationRecovery>[0]>['deps'],supervisor:{executorId:'synthetic-supervisor',supports:()=>true,quiesce:async()=>{throw Error('must-not-quiesce');}}});
 const result=await service.recover({projectId:1,taskId:2,attemptId:3,actorId:'user:4',idempotencyKey:'same'});
 assert.equal(result.code,'PREPARATION_RECOVERY_FAILED');assert.equal(String(result.message).includes('concurrently'),false);assert.ok(String(result.action).includes('engineering'));assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(result.submission_permitted,false);
});
