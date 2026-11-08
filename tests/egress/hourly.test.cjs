const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSettingsCache}=require(process.env.EGRESS_DIST+'/services/settings_cache.js');
test('model stays cached through 59 minutes and refreshes lazily at one hour',async()=>{
 let now=0,calls=0;
 const c=createSettingsCache(async()=>({value:String(++calls)}),()=>now);
 assert.equal((await c.read(1,'multi_agent_post_creator_model')).value,'1');
 now=3599999;assert.equal((await c.read(1,'multi_agent_post_creator_model')).value,'1');assert.equal(calls,1);
 now=3600000;assert.equal((await c.read(1,'multi_agent_post_creator_model')).value,'2');
});
const {createCoordinatedSettingsReader}=require(process.env.EGRESS_DIST+'/services/coordinated_settings_reader.js');
test('two readers reject a stale fill after another process saves; failed coordination bypasses cache',async()=>{
 let value='old',generation='a',blocked=false,available=true,finish;
 const port={state:async()=>{if(!available)throw Error('lost');return {version:generation,blocked};}};
 const c1=createCoordinatedSettingsReader(async()=>({value}),port);
 let first=true;const c2=createCoordinatedSettingsReader(async()=>{
  if(first){first=false;return new Promise(r=>finish=r);}return {value};
 },port);
 const pending=c2.read(1,'multi_agent_post_creator_model');
 while(!finish)await new Promise(r=>setImmediate(r));
 value='new';generation='b';finish({value:'old'});
 assert.equal((await pending).value,'new');
 assert.equal((await c1.read(1,'multi_agent_post_creator_model')).value,'new');
 available=false;value='after-disconnect';
 assert.equal((await c2.read(1,'multi_agent_post_creator_model')).value,'after-disconnect');
});
test('new scopes at capacity bypass caching without flushing existing hot scopes',async()=>{
 let calls=0;const c=createCoordinatedSettingsReader(async()=>({value:String(++calls)}),{state:async()=>({version:'stable',blocked:false})});
 for(let p=1;p<=1001;p++)await c.read(p,'multi_agent_post_creator_model');
 assert.equal(calls,1001);assert.equal((await c.read(1,'multi_agent_post_creator_model')).value,'1');assert.equal(calls,1001);
});
