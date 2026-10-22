import test from 'node:test';
import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import { browserErrorDiagnostic, browserResultDiagnostic } from '../services/browser_actionable_diagnostics';
test('snapshot reports all safe fields without values or injected fields',()=>{
 const secret='cookie=secret-approval';
 const d=browserErrorDiagnostic(new Error('[BROWSER_SNAPSHOT_MISMATCH] '+JSON.stringify([{field:'accepted_revision',current:secret},{field:'draft_text.sha256',current:secret},{field:secret}])));
 assert.deepEqual(d.reasons.map(r=>r.field),['accepted_revision','draft_text.sha256']);
 assert.equal(JSON.stringify(d).includes(secret),false);assert.equal(d.retry_allowed,false);
});
test('missing prerequisite and unknown failures do not invent downstream causes',()=>{
 for(const code of ['BROWSER_RELEASE_PROOF_INVALID','BROWSER_ACTIVE_LEASE_REQUIRED','OWNER_REQUIRED']){
 const d=browserErrorDiagnostic(new Error(`[${code}] secret`));assert.equal(d.code,code);assert.equal(d.reasons.length,1);assert.ok(d.reasons[0]!.action);}
 assert.equal(browserErrorDiagnostic(new Error('token=secret')).code,'BROWSER_REQUEST_FAILED');
});
test('uncertainty and replay require reconciliation; success unchanged',()=>{
 assert.equal(browserResultDiagnostic({state:'reconciliation_required'})?.code,'BROWSER_RECONCILIATION_REQUIRED');
 assert.equal(browserResultDiagnostic({replayed:true,submission_permitted:false})?.retry_allowed,false);
 assert.equal(browserResultDiagnostic({submission_permitted:true}),undefined);
 assert.equal(browserResultDiagnostic({status:'started',replayed:false}),undefined);
});

test('registered MCP boundary serializes validation failures without input secrets or mutations',async()=>{
 const { registerBrowserPublicationTools }=await import('../mcp/tools/browser_publication_tools');
 const handlers:Array<(args:unknown)=>Promise<unknown>>=[];
 const server={registerTool(_name:string,_config:unknown,handler:(args:unknown)=>Promise<unknown>){handlers.push(handler);}};
 registerBrowserPublicationTools(server as unknown as Parameters<typeof registerBrowserPublicationTools>[0]);
 assert.equal(handlers.length,11);
 const logs:string[]=[];const original=console.warn;
 console.warn=(line:unknown)=>{logs.push(String(line));};
 try{
 for(const handler of handlers){
  const response=await handler({approvalReference:'secret-private-reference',leaseToken:'secret-private-token'});
  const serialized=JSON.stringify(response);
  assert.equal(serialized.includes('secret-private'),false);
  assert.equal((response as {isError:boolean}).isError,true);
  assert.ok(serialized.includes('reasons'));assert.ok(serialized.includes('action'));
 }
 assert.equal(logs.length,11);assert.equal(logs.some(line=>line.includes('secret-private')),false);
 }finally{console.warn=original;}
});
test('schema rejection explains request correction without raw validation values',()=>{
 const error=new Error('secret input');error.name='ZodError';
 assert.equal(browserErrorDiagnostic(error).code,'BROWSER_REQUEST_INVALID');
});
test('read-only persisted snapshot mismatch returns concrete safe reasons',()=>{
 const d=browserResultDiagnostic({snapshot_check:{valid:false,mismatches:[{field:'text_state',current:'secret'}]}});
 assert.equal(d?.reasons[0]?.field,'text_state');
 assert.equal(JSON.stringify(d).includes('secret'),false);
});
test('X native MCP controls serialize actionable redacted errors and preserve disabled registration',async()=>{
 const {registerXNativeTools}=await import('../mcp/tools/x_native_tools');
 const handlers:Array<(args:unknown)=>Promise<unknown>>=[];
 const server={registerTool(_name:string,_config:unknown,handler:(args:unknown)=>Promise<unknown>){handlers.push(handler);}};
 registerXNativeTools(server as unknown as Parameters<typeof registerXNativeTools>[0],false);assert.equal(handlers.length,0);
 registerXNativeTools(server as unknown as Parameters<typeof registerXNativeTools>[0],true);assert.equal(handlers.length,5);
 const original=console.warn;const logs:string[]=[];console.warn=(value:unknown)=>logs.push(String(value));
 try{for(const handler of handlers){const result=await handler({approvalReference:'private-secret'});const text=JSON.stringify(result);assert.ok(text.includes('reasons'));assert.ok(text.includes('action'));assert.equal(text.includes('private-secret'),false);assert.equal((result as {isError:boolean}).isError,true);}
 assert.equal(logs.length,5);assert.equal(logs.some(line=>line.includes('private-secret')),false);
 }finally{console.warn=original;}
});
test('asset ownership revision and decision mismatches all remain visible without values',()=>{
 const fields=['selected_asset.id','selected_asset.project_id','selected_asset.content_item_id','selected_asset.content_revision','selected_asset.decision_id','decision.id','decision.project_id','decision.content_item_id','decision.source_content_revision','decision.decision_version'];
 const d=browserErrorDiagnostic(new Error('[BROWSER_SNAPSHOT_MISMATCH] '+JSON.stringify(fields.map(field=>({field,current:'private-value',expected:'private-value'})))));
 assert.deepEqual(d.reasons.map(reason=>reason.field),fields);
 assert.equal(JSON.stringify(d).includes('private-value'),false);
});
test('known database serialization conflicts explain refresh without exposing SQL or secrets',()=>{
 for(const options of [{code:'P2034'}, {code:'P2010',meta:{code:'40001'}},
  {code:'P2010',meta:{driverAdapterError:{cause:{originalCode:'40001',originalMessage:'secret-SQL'}}}}]){
  const error=new Prisma.PrismaClientKnownRequestError('secret-token SQL payload',{...options,clientVersion:'synthetic'});
  const result=browserErrorDiagnostic(error);assert.equal(result.code,'BROWSER_STATE_CONFLICT');
  assert.equal(result.retry_allowed,false);assert.match(result.reasons[0]!.action,/reconcil/i);
  assert.ok(!JSON.stringify(result).includes('secret'));
 }
 const unknown=new Prisma.PrismaClientKnownRequestError('secret',{code:'P2010',clientVersion:'synthetic',meta:{code:'99999'}});
 assert.equal(browserErrorDiagnostic(unknown).code,'BROWSER_REQUEST_FAILED');
});
