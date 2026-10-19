import test from 'node:test';
import assert from 'node:assert/strict';
import {registerBrowserPublicationTools} from '../mcp/tools/browser_publication_tools';
import type * as Execution from '../services/browser_publication_execution';
const execution=require('../services/browser_publication_execution') as typeof Execution;
test('LI-09 actual registered uncertainty handler supplies safe application recovery to operation',async()=>{
 const original=execution.markBrowserSubmissionUncertain;let invoked=false;
 const handlers=new Map<string,(input:unknown)=>Promise<unknown>>();
 const server={registerTool(name:string,_config:unknown,handler:(input:unknown)=>Promise<unknown>){handlers.set(name,handler);}};
 execution.markBrowserSubmissionUncertain=async(_input,_deps,_native,recovery)=>{
  assert.equal(typeof recovery,'function');invoked=true;
  return {state:'reconciliation_required',attempt_id:3,submission_permitted:false,retry_allowed:false,recovery:await recovery!({})};
 };
 const {recoveryOutcome}=await import('../services/browser_recovery_coordinator');
 try{registerBrowserPublicationTools(server as unknown as Parameters<typeof registerBrowserPublicationTools>[0],async()=>recoveryOutcome('READBACK_CAPABILITY_UNAVAILABLE'));
 const result=await handlers.get('ba_mark_browser_submission_uncertain')!({});const serialized=JSON.stringify(result);
 assert.equal(invoked,true);assert.ok(serialized.includes('READBACK_CAPABILITY_UNAVAILABLE'));assert.ok(serialized.includes('action'));assert.ok(serialized.includes('do not resend'));assert.equal(serialized.includes('private'),false);
 }finally{execution.markBrowserSubmissionUncertain=original;}
});
