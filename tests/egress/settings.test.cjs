const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSettingsCache}=require(process.env.EGRESS_DIST+'/services/settings_cache.js');
test('100 simultaneous reads use one load, TTL and project isolation hold',async()=>{
 let calls=0,now=0;
 const cache=createSettingsCache(async(p,k)=>{calls++;return {value:p+':'+k};},()=>now);
 const read=()=>cache.read(1,'multi_agent_post_creator_prompt');
 const out=await Promise.all(Array.from({length:100},read));
 assert.equal(calls,1);out[0].value='changed';assert.notEqual((await read()).value,'changed');
 await cache.read(2,'multi_agent_post_creator_prompt');assert.equal(calls,2);
 now=3600000;await read();assert.equal(calls,3);
});
test('successful write invalidation fences a pending stale fill and its callers',async()=>{
 let finish,calls=0;
 const cache=createSettingsCache(async()=>++calls===1?new Promise(r=>finish=r):{value:'new'},()=>0);
 const pending=cache.read(1,'multi_agent_post_creator_prompt');
 await Promise.resolve();cache.invalidate(1,'multi_agent_post_creator_prompt');finish({value:'old'});
 assert.equal((await pending).value,'new');assert.equal((await cache.read(1,'multi_agent_post_creator_prompt')).value,'new');
});
test('secrets and authority bypass cache; expired errors never return stale data',async()=>{
 let calls=0,now=0,fail=false;
 const cache=createSettingsCache(async()=>{calls++;if(fail)throw Error('db');return {value:'v'};},()=>now);
 for(const key of ['multi_agent_post_creator_key','x_native:challenge','publication_plan_meta']){
  await cache.read(1,key);await cache.read(1,key);
 }assert.equal(calls,6);
 await cache.read(1,'multi_agent_post_creator_prompt');now=3600000;fail=true;
 await assert.rejects(cache.read(1,'multi_agent_post_creator_prompt'),/db/);
});
test('bounded cache and bypass do not poison live cached value',async()=>{
 let calls=0;const cache=createSettingsCache(async()=>({value:String(++calls)}),()=>0,2);
 await cache.read(1,'multi_agent_post_creator_prompt');await cache.read(2,'multi_agent_post_creator_prompt');
 await cache.read(3,'multi_agent_post_creator_prompt');await cache.read(1,'multi_agent_post_creator_prompt');assert.equal(calls,4);
 await cache.read(1,'multi_agent_post_creator_prompt',true);assert.equal(calls,5);
});
test('capacity pressure never evicts a pending invalidation fence or causes reload storms',async()=>{
 let finish,calls=0;const cache=createSettingsCache(async p=>{calls++;return p===1&&calls===1?new Promise(r=>finish=r):{value:'new'};},()=>0,1);
 const pending=cache.read(1,'multi_agent_post_creator_prompt');await Promise.resolve();
 await cache.read(2,'multi_agent_post_creator_prompt');cache.invalidate(1,'multi_agent_post_creator_prompt');finish({value:'old'});
 assert.equal((await pending).value,'new');assert.equal(calls,3);
});
