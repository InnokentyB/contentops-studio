const base=process.env.EGRESS_DIST;
const {default:db,pool}=require(base+'/db.js');
const {createSettingsCacheRuntime}=require(base+'/services/settings_cache_runtime.js');
const {createSettingsRedis}=require(base+'/services/settings_cache_redis.js');
const redis=createSettingsRedis(process.env.EGRESS_REDIS_URL);
let pause=null,resume=null,readCount=0;
const find=db.projectSettings.findUnique.bind(db.projectSettings);
db.projectSettings.findUnique=async args=>{
 readCount++;const row=await find(args);
 if(pause==='load'){pause=null;process.send({signal:'load'});await new Promise(r=>resume=r);}
 return row;
};
const original=redis.finish;
redis.finish=async e=>{
 if(pause==='afterCommit'){
  pause=null;process.send({signal:'afterCommit'});
  await new Promise(r=>resume=r);
 }
 return original(e);
};
const runtime=process.env.EGRESS_PRODUCTION_READER==='1'?require(base+'/services/project_settings_reader.js').projectSettingsReader:createSettingsCacheRuntime(db,redis);
process.on('message',async m=>{
 try{
  let result;
  if(m.action==='read'){if(m.pause)pause=m.pause;result=await runtime.read(m.projectId,m.key);}
  else if(m.action==='put'){
   const routes=require(base+'/routes/api/settings.routes.js').default,handlers=new Map();
   await routes({get(){},post(){},delete(){},put(path,fn){handlers.set(path,fn);}});
   let status=200;const reply={code(s){status=s;return this;},send(body){return body;}};
   result=await handlers.get('/api/settings/agents/:role')({projectId:m.projectId,params:{role:'post_creator'},body:{prompt:'synthetic prompt',model:m.value}},reply);
   if(status!==200)throw Error(result.error);
  }
  else if(m.action==='genericPut'){
   const auth=require(base+'/services/auth.service.js').default;
   const saved={verify:auth.verifyToken,access:auth.hasProjectAccess};
   const app=require('fastify')();
   auth.verifyToken=()=>({id:77});
   auth.hasProjectAccess=async(userId,projectId,role)=>userId===77&&projectId===m.projectId&&role==='owner';
   try{
    await app.register(require(base+'/routes/project.routes.js').default);
    const response=await app.inject({method:'POST',url:`/api/projects/${m.projectId}/settings`,headers:{authorization:'Bearer synthetic'},payload:{key:m.key,value:m.value}});
    if(response.statusCode!==200)throw Error('synthetic generic save failed: '+response.statusCode);
    result=response.json();
   }finally{await app.close();auth.verifyToken=saved.verify;auth.hasProjectAccess=saved.access;}
  }
  else if(m.action==='stats')result={readCount};
  else if(m.action==='deliver')await runtime.deliver();
  else if(m.action==='resume'){resume?.();resume=null;}
  else if(m.action==='write'){
   pause=m.pause||null;
   result=await runtime.write(m.projectId,m.key,async tx=>{
    const row=await tx.projectSettings.upsert({where:{project_id_key:{project_id:m.projectId,key:m.key}},
     update:{value:m.value},create:{project_id:m.projectId,key:m.key,value:m.value},select:{value:true}});
    if(pause==='beforeCommit'){pause=null;process.send({signal:'beforeCommit'});await new Promise(r=>resume=r);}
    return row;
   });
  }else if(m.action==='close'){
   await runtime.close();await db.$disconnect();await pool.end();
   process.send({id:m.id,ok:true},()=>process.exit(0));return;
  }else throw Error('unsupported synthetic command');
  process.send({id:m.id,ok:true,result});
 }catch(e){process.send({id:m.id,ok:false,error:e.message});}
});
