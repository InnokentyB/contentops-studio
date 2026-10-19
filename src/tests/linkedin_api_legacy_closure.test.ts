import test from 'node:test';
import assert from 'node:assert/strict';
import linkedinService from '../services/linkedin.service';
import {PublicationDispatcher} from '../services/publishers/publication_dispatcher';
test('legacy low-level LinkedIn sender rejects valid content before fetch',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected');};
 try{await assert.rejects(linkedinService.publishPost('urn:li:person:synthetic','private','Accepted body'),/LINKEDIN_API_GOVERNED_ROUTE_REQUIRED/);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('legacy task dispatcher refuses governed LinkedIn work before route rewrite',async()=>{
 const dispatcher=new PublicationDispatcher();await assert.rejects(dispatcher.processPublicationTaskItem({id:91002,project_id:91001,channel:{type:'linkedin'}},{manualTrigger:true}),/LINKEDIN_API_GOVERNED_ROUTE_REQUIRED/);
});
test('browser fallback cannot revive LinkedIn delivery via direct call',async()=>{
 const dispatcher=new PublicationDispatcher();await assert.rejects(dispatcher.routeToBrowserPublication({id:91002,channel:{type:'linkedin'}},{},{}),/LINKEDIN_API_GOVERNED_ROUTE_REQUIRED/);
});
test('legacy LinkedIn hold diagnostic names its actual route and repair',async()=>{
 const {publisherLogDiagnostic}=await import('../services/publishers/publisher_log_diagnostics');
 const result=publisherLogDiagnostic('LINKEDIN_API_GOVERNED_ROUTE_REQUIRED');assert.equal(result.code,'LINKEDIN_API_GOVERNED_ROUTE_REQUIRED');assert.match(result.action,/governed LinkedIn API/);assert.doesNotMatch(result.message,/VK/);
});
