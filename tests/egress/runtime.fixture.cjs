const assert=require('node:assert/strict'),{fork}=require('node:child_process'),path=require('node:path');
const base=process.env.EGRESS_DIST;
const {default:db,pool}=require(base+'/db.js');
const Redis=require('ioredis');
const {createSettingsCacheRuntime}=require(base+'/services/settings_cache_runtime.js');
const {createSettingsRedis}=require(base+'/services/settings_cache_redis.js');
const {SETTINGS_CACHE_EVENT}=require(base+'/services/settings_cache_events.js');
const tracker=require(base+'/services/task_tracker.service.js').default;
const key='multi_agent_post_creator_model',children=new Set();
assert.equal(process.env.EGRESS_REDIS_URL,'redis://redis:6379','only the isolated test Redis is allowed');
const admin=new Redis(process.env.EGRESS_REDIS_URL,{maxRetriesPerRequest:0});
admin.on('error',()=>{ /* Expected synthetic service outage; command failures and recovery are asserted. */ });
function worker(production=false){
 const child=fork(path.join(__dirname,'reader-child.cjs'),[],{stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,...(production?{EGRESS_PRODUCTION_READER:'1',REDIS_URL:process.env.EGRESS_REDIS_URL,SETTINGS_CACHE_ENABLED:production==='off'?'false':'true'}:{})}});
 children.add(child);let seq=0;
 const pending=new Map(),signals=new Map();
 child.on('message',m=>{
  if(m.signal){signals.get(m.signal)?.();signals.delete(m.signal);return;}
  const p=pending.get(m.id);if(p){pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(Error(m.error));}
 });
 child.on('exit',()=>{children.delete(child);for(const p of pending.values())p.reject(Error('synthetic child exited'));pending.clear();});
 return {
  child,
  signal:name=>new Promise(r=>signals.set(name,r)),
  call(action,data={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.send({id,action,...data});});},
  async close(){if(child.connected)await this.call('close');}
 };
}
async function project(){
 const [{name}]=await db.$queryRawUnsafe('SELECT current_database() AS name');assert.equal(name,'shared_browser_synthetic');
 const p=await db.project.create({data:{name:'synthetic cache',slug:'cache-'+Date.now()+'-'+Math.random().toString(16).slice(2)}});
 await db.projectSettings.create({data:{project_id:p.id,key,value:'old'}});return p;
}
async function dispose(){for(const c of children)c.kill('SIGKILL');admin.disconnect();await db.$disconnect();await pool.end();}
module.exports={db,pool,admin,worker,project,dispose,key,SETTINGS_CACHE_EVENT,tracker,createSettingsCacheRuntime,createSettingsRedis};
