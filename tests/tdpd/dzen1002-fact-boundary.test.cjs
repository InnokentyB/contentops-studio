const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
require('ts-node').register({transpileOnly:true});
const root=path.resolve(__dirname,'../..');const {z}=require('zod');
test('R10 actual MCP and REST canonical fact/confirmation handlers refuse1002 at all lifecycle stages',async()=>{
 const dbModule=require(path.join(root,'src/db.ts'));const original=dbModule.default;const originalNamed=dbModule.prisma;
 let state='ready_for_execution';let transactions=0;
 const forbidden=new Proxy({}, {get(){throw Error('FACT_WRITE_OR_READ_FORBIDDEN');}});
 dbModule.default={
  projectMember:{findUnique:async()=>({id:1}),findFirst:async()=>({user_id:2})},
  contentItem:{findFirst:async()=>({id:1002,project_id:10,type:'article',status:state,published_link:null})},
  $transaction:async callback=>{transactions++;return callback(forbidden);}
 };
 dbModule.prisma=dbModule.default;
 try{
  const tools=new Map();require(path.join(root,'src/mcp/tools/task_publication_tools.ts')).registerTaskPublicationTools({registerTool(n,c,h){tools.set(n,{schema:z.object(c.inputSchema),handler:h});}});
  const routes=new Map();const fastify=new Proxy({}, {get(_t,method){return (name,...rest)=>{if(method==='post')routes.set(name,rest.at(-1));};}});
  await require(path.join(root,'src/routes/api/publication_tasks.routes.ts')).default(fastify);
  const fact={projectId:10,taskId:1002,actorId:'user:2',artifactKind:'article',outcome:'published',publishedAt:'2026-10-16T12:00:00.000Z',publicUrl:'https://dzen.ru/a/fixture',confirmationMode:'automatic',providerObjectId:'fixture'};
  for(const phase of ['ready_for_execution','publishing','publishing']){
   state=phase;
   for(const [name,input] of [['ba_record_publication_fact',fact],['ba_confirm_publication',{projectId:10,taskId:1002,publishedLink:fact.publicUrl}]]){
    const t=tools.get(name);await assert.rejects(t.handler(t.schema.parse(input)),/DZEN1002_EXACT_CONFIRMATION_REQUIRED/);
   }
   let response;const reply={code(status){assert.equal(status,400);return this;},send(body){response=body;return body;}};
   const request={projectId:10,user:{id:2},params:{id:'1002'},body:fact};
   await routes.get('/api/publication-tasks/:id/publication-fact')(request,reply);
   assert.match(response.error,/DZEN1002_EXACT_CONFIRMATION_REQUIRED/);
   await assert.rejects(routes.get('/api/publication-tasks/:id/confirm-publication')({...request,body:{publishedLink:fact.publicUrl}},reply),/DZEN1002_EXACT_CONFIRMATION_REQUIRED/);
  }
  assert.equal(transactions,12);
 }finally{dbModule.default=original;dbModule.prisma=originalNamed;}
});
