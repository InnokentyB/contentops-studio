const {test}=require('node:test'),assert=require('node:assert/strict');
const base=process.env.EGRESS_DIST;
const db=require(base+'/db.js').default;
const auth=require(base+'/services/auth.service.js').default;
const routes=require(base+'/routes/project.routes.js').default;
const reader=require(base+'/services/project_settings_reader.js').projectSettingsReader;
const Fastify=require('fastify');
test('generic Owner settings route cannot bypass missing invalidation coordination; denied actor never writes',async()=>{
 const saved={verify:auth.verifyToken,access:auth.hasProjectAccess,upsert:db.projectSettings.upsert};
 let writes=0,allowed=true;const app=Fastify();
 auth.verifyToken=()=>({id:77});auth.hasProjectAccess=async()=>allowed;
 db.projectSettings.upsert=async()=>{writes++;return {value:'new'};};
 try{
  await app.register(routes);
  const save=()=>app.inject({method:'POST',url:'/api/projects/77/settings',headers:{authorization:'Bearer synthetic'},payload:{key:'multi_agent_post_creator_model',value:'synthetic'}});
  allowed=false;assert.equal((await save()).statusCode,403);assert.equal(writes,0);
  allowed=true;const result=await save();assert.equal(result.statusCode,500);assert.equal(result.json().code,'SETTINGS_CACHE_SYNC_UNAVAILABLE');assert.match(result.json().message,/Settings were not saved/);assert.equal(writes,0);
 }finally{await app.close();auth.verifyToken=saved.verify;auth.hasProjectAccess=saved.access;db.projectSettings.upsert=saved.upsert;await reader.close();}
});
