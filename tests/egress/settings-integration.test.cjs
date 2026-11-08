const {test}=require('node:test'),assert=require('node:assert/strict');
const base=process.env.EGRESS_DIST;
const prisma=require(base+'/db.js').default;
const agent=require(base+'/services/multi_agent.service.js').default;
const routes=require(base+'/routes/api/settings.routes.js').default;
const reader=require(base+'/services/project_settings_reader.js').projectSettingsReader;
test('missing coordination uses fresh DB reads and refuses existing settings PUT before mutation',async()=>{
 const saved={find:prisma.projectSettings.findUnique,update:prisma.projectSettings.update};
 let reads=0;const rows=new Map([['multi_agent_post_creator_prompt',{id:1,value:'old'}],['multi_agent_post_creator_model',{id:2,value:'old-model'}]]);
 prisma.projectSettings.findUnique=async({where})=>{reads++;return {...rows.get(where.project_id_key.key)};};
 prisma.projectSettings.update=async({where,data})=>{const row=[...rows.values()].find(r=>r.id===where.id);row.value=data.value;return {...row};};
 const put=new Map();
 try{
  await routes({get(){},post(){},put(path,fn){put.set(path,fn);},delete(){}});
  const read=()=>agent.getPrompt(77,'multi_agent_post_creator_prompt','default');
  assert.equal(await read(),'old');assert.equal(await read(),'old');assert.equal(reads,2);
  const handler=put.get('/api/settings/agents/:role');assert.ok(handler);
  const reply={code(){return this;},send(x){return x;}};
  await handler({projectId:77,params:{role:'post_creator'},body:{prompt:'new',model:'synthetic-model'}},reply);
  assert.equal(await read(),'old');
  assert.equal(rows.get('multi_agent_post_creator_model').value,'old-model');
 }finally{reader.invalidate(77,'multi_agent_post_creator_prompt');reader.invalidate(77,'multi_agent_post_creator_model');
 prisma.projectSettings.findUnique=saved.find;prisma.projectSettings.update=saved.update;}
});
