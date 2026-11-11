import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,ApiRequestError} from '../../frontend/src/api';
import {agentSaveError} from '../../frontend/src/utils/agentSaveError';

test('structured save error survives fetch without copying secret details',async()=>{
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null},configurable:true});
 const saved=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Save needs attention',code:'SETTINGS_CACHE_SYNC_UNAVAILABLE',save_state:'partially_saved',fields:{prompt:'saved',model:'not_saved',api_key:'not_attempted',secret:'PRIVATE'},action:'Restore Redis',details:'PRIVATE'}),{status:503});
 try{
  await assert.rejects(api.put('/api/settings/agents/post_creator',{}),error=>{
   assert.ok(error instanceof Error);assert.ok(error instanceof ApiRequestError);assert.equal(error.status,503);assert.equal(error.code,'SETTINGS_CACHE_SYNC_UNAVAILABLE');assert.equal(error.action,'Restore Redis');
   assert.deepEqual(error.fields,{prompt:'saved',model:'not_saved',api_key:'not_attempted'});
   assert.match(agentSaveError(error,'ru').message,/частично/);assert.match(agentSaveError(error,'en').details,/Prompt: saved/);assert.doesNotMatch(JSON.stringify(error),/PRIVATE/);return true;
  });
 }finally{globalThis.fetch=saved;}
});
test('legacy error stays Error-compatible and unknown network error never invents save certainty',async()=>{
 const saved=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Legacy failure'}),{status:400});
 try{await assert.rejects(api.get('/api/test'),error=>error instanceof Error&&error.message==='Legacy failure');}
 finally{globalThis.fetch=saved;}
 assert.match(agentSaveError(new Error('PRIVATE'),'ru').message,/неизвестен/);assert.doesNotMatch(JSON.stringify(agentSaveError(new Error('PRIVATE'),'en')),/PRIVATE/);
});
