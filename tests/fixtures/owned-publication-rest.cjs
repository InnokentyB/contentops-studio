const {db}=require('./owned-publication-store.cjs');
const logger=require.resolve('../../src/services/publishers/publisher_logger');require.cache[logger]={id:logger,filename:logger,loaded:true,exports:{logToFile:()=>{}}};
process.env.TELEGRAM_BOT_TOKEN='000000000:synthetic-test-token';
async function rest(t,f,options={}){
 const Fastify=require('fastify');const app=Fastify();await app.register(require('@fastify/multipart'));
 const calls={critic:0,fixer:0,storage:0,art:0,generator:0};
 const helpers=require('../../src/routes/api/publication_task_helpers');
 t.mock.method(helpers,'loadPublicationPlanContext',async()=>null);
 t.mock.method(helpers,'runPublicationCriticReview',async(project,item,text)=>{calls.critic++;return {publicationBody:text||item.draft_text,criticReview:{findings:[]},bundle:{resource_files:[]},projectContext:{glossaryYaml:'',contentPolicyMatrixYaml:'',atomaFilesDescription:'',atomaFilesPayload:[]}};});
 const art=require('../../src/services/art_direction.service').default,plan=require('../../src/services/publication_plan.service').default,adapter=require('../../src/services/publication_adapter.service').default;
 t.mock.method(art,'assertPublicationReady',async()=>{calls.art++;});
 t.mock.method(plan,'buildGeneratedContentItemHandoff',()=>({mode:'automatic',publication:{body:f.task.draft_text},resource_files:[]}));
 t.mock.method(adapter,'supportsDirectExecution',()=>true);t.mock.method(adapter,'prefersAutomaticExecution',()=>true);
 t.mock.method(require('../../src/services/multi_agent.service').default,'runPublicationFixer',async()=>{calls.fixer++;await options.beforeFix?.();return {updated_text:'Fixed synthetic body',summary:'synthetic',resolved_findings:[]};});
 t.mock.method(require('../../src/services/storage.service').default,'uploadFileFromBuffer',async()=>{calls.storage++;await options.beforeUpload?.();return 'https://example.invalid/replacement.png';});
 for(const name of ['generateImage','generateImageNanoBanana'])t.mock.method(require('../../src/services/generator.service').default,name,async()=>{calls.generator++;return 'https://example.invalid/generated.png';});
 app.addHook('onRequest',async request=>{request.projectId=f.project.id;request.user={id:f.u.id};});
 await app.register(require('../../src/routes/api/publication_tasks.routes').default);await app.ready();t.after(()=>app.close());
 return {app,calls};
}
function multipart(){const boundary='synthetic-owned-upload';return {headers:{'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\nsynthetic-image\r\n--'+boundary+'--\r\n')};}
module.exports={rest,multipart};
