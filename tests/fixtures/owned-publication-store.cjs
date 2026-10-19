const {randomUUID,createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(x).digest('hex');
const {PrismaClient}=require('@prisma/client');const {PrismaPg}=require('@prisma/adapter-pg');const {Pool}=require('pg');
const url=new URL(process.env.DATABASE_URL||'http://invalid');
if(url.hostname!=='synthetic-db'||url.pathname!=='/shared_browser_synthetic'||url.username!=='synthetic')throw Error('isolated container-local PostgreSQL required');
const pool=new Pool({connectionString:String(url)});const db=new PrismaClient({adapter:new PrismaPg(pool)});
require('ts-node/register/transpile-only');
const dbPath=require.resolve('../../src/db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{__esModule:true,default:db,prisma:db,pool}};
const factService=require('../../src/services/publication_fact.service').default;
const manifest=async()=>({checksum:'sha256:'+hash('synthetic-current-manifest')});
async function setup(){
 const nonce=randomUUID();const u=await db.user.create({data:{email:`${nonce}@example.invalid`,name:'Synthetic',password_hash:'not-a-login'}});
 const project=await db.project.create({data:{name:'Synthetic owned lifecycle',slug:nonce}});
 await db.projectMember.create({data:{project_id:project.id,user_id:u.id,role:'owner'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,type:'dzen',name:nonce,config:{channel_id:nonce.replaceAll('-','')}}});
 const body=`Synthetic ${nonce}`,assetHash=hash(nonce);
 const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'zen_article',draft_text:body,title:'Synthetic '+nonce,content_revision:4,accepted_revision:4,text_state:'accepted',visual_state:'APPROVED',visual_placement:'article_cover',visual_decision_version:2,handoff_state:'ready',status:'ready_for_execution',publication_mode:'approval_required',schedule_at:new Date('2026-10-01T10:00:00Z'),publish_at:new Date('2026-10-01T10:00:00Z')}});
 const actorId=`user:${u.id}`;const decision=await db.artDirectionDecision.create({data:{project_id:project.id,content_item_id:task.id,decision_version:2,source_content_revision:4,channel:'dzen',placement:'article_cover',decision:'GENERATE',reason:'synthetic',actor_id:actorId}});
 const asset=await db.imageAsset.create({data:{project_id:project.id,content_item_id:task.id,decision_id:decision.id,content_revision:4,placement:'article_cover',prompt:'synthetic',status:'approved',file_url:'https://example.invalid/'+nonce+'.png',provenance:{planner_storage:{sha256:assetHash}}}});
 await db.contentItem.update({where:{id:task.id},data:{selected_asset_id:asset.id}});
 const principal={projectId:project.id,actorId,userId:u.id,profile:'owner'};
 const request={projectId:project.id,taskId:task.id,operation:'release',dryRun:false,idempotencyKey:'release-'+nonce,approvalReference:'Synthetic exact approval '+nonce};
 const dependencies={db,manifest,facts:factService};
 let store;const getStore=()=>store||=new(require('../../src/services/owned_publication_store').OwnedPublicationStore)(dependencies);
 const calls={inventory:0,publish:0,readback:0,authorize:[]};
 const adapter={authorize:async op=>{calls.authorize.push(op);},inventory:async p=>{calls.inventory++;return {complete:true,absent:true,accountId:p.accountId,packageDigest:p.digest,checkedAt:new Date().toISOString()};},publish:async(c,hooks)=>{calls.publish++;await hooks.beforeMutation();await hooks.beforeSubmit({objectId:'Synthetic'+c.attemptId,accountId:c.package.accountId});return receipt(c);},readback:async()=>{calls.readback++;return null;}};
 const service=()=>new(require('../../src/services/owned_publication_service').OwnedPublicationService)({store:getStore(),adapter});
 async function bound(operation='release'){
  const input={...request,operation};const p=await getStore().inspect(input,principal);
  return {...input,expectedAcceptedRevision:p.revision,expectedPackageSha256:p.digest,expectedManifestChecksum:p.manifest};
 }
 return {db,u,project,channel,task,asset,principal,request,dependencies,adapter,calls,getStore,service,bound};
}
function receipt(c){return {schemaVersion:'owned-provider-receipt-v1',attemptId:c.attemptId,key:c.key,packageDigest:c.package.digest,generation:c.generation,accountId:c.package.accountId,objectId:'Synthetic'+c.attemptId,url:'https://dzen.ru/a/Synthetic'+c.attemptId,publishedAt:new Date().toISOString(),observedAt:new Date().toISOString(),bodySha256:c.package.bodySha256,assetSha256:c.package.assetSha256,title:c.package.title};}
module.exports={db,pool,setup,receipt,hash};
async function legacy(f,withReceipt=false){
 const body=(await db.contentItem.findUnique({where:{id:f.task.id}})).draft_text,namespace='ba_publish_dzen_task'+f.task.id;
 const release=await db.workflowEvent.create({data:{project_id:f.project.id,content_item_id:f.task.id,actor_id:f.principal.actorId,command:'ba_release_dzen_task'+f.task.id,idempotency_key:'legacy-release-'+f.task.id,before_state:{approval_reference:f.request.approvalReference,manifest_checksum:(await manifest()).checksum},after_state:{task_id:f.task.id,channel_id:f.channel.id,content_revision:4,accepted_revision:4,body_sha256:hash(body),visual_decision_id:f.asset.decision_id,visual_decision_version:2,selected_asset_id:f.asset.id,asset_sha256:f.asset.provenance.planner_storage.sha256,schedule_at:f.task.schedule_at.toISOString(),publish_at:f.task.publish_at.toISOString(),publication_mode:'owner_released'}}});
 await db.contentItem.update({where:{id:f.task.id},data:{publication_mode:'owner_released'}});
 const material={projectId:f.project.id,taskId:f.task.id,channelId:f.channel.id,revision:4,decisionId:f.asset.decision_id,decisionVersion:2,selectedAssetId:f.asset.id,bodySha256:hash(body),assetSha256:f.asset.provenance.planner_storage.sha256,schedule:f.task.schedule_at.toISOString(),manifest:(await manifest()).checksum,releaseId:release.id,accountId:f.channel.config.channel_id,body,title:f.task.title,assetUrl:f.asset.file_url};
 const p={...material,digest:hash(JSON.stringify(material))};
 const createAttempt=async()=>{
  const attempt=await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,mode:'automatic',status:withReceipt?'verification_required':'pending',idempotency_key:'legacy-send-'+f.task.id,created_at:new Date(Date.now()-60000)}});
  await db.contentItem.update({where:{id:f.task.id},data:{status:'publishing'}});
  await db.workflowEvent.create({data:{project_id:f.project.id,content_item_id:f.task.id,actor_id:'system:planner-mcp:dzen-task'+f.task.id,command:namespace+':claim',idempotency_key:attempt.idempotency_key,after_state:{actor_id:f.principal.actorId,attempt_id:attempt.id,package:p,release_id:release.id}}});
  await db.workflowEvent.create({data:{project_id:f.project.id,content_item_id:f.task.id,actor_id:'system:planner-mcp:dzen-task'+f.task.id,command:namespace+':started',idempotency_key:String(attempt.id),after_state:{attempt_id:attempt.id,package_digest:p.digest}}});
  if(withReceipt){const generic=receipt({attemptId:attempt.id,key:attempt.idempotency_key,package:p,generation:0});const {generation,...raw}=generic;const old={schemaVersion:'dzen'+f.task.id+'-native-v1',attemptId:raw.attemptId,key:raw.key,packageDigest:raw.packageDigest,accountId:raw.accountId,objectId:raw.objectId,url:raw.url,publishedAt:raw.publishedAt,observedAt:raw.observedAt,bodySha256:raw.bodySha256,assetSha256:raw.assetSha256,title:raw.title};await db.workflowEvent.create({data:{project_id:f.project.id,content_item_id:f.task.id,actor_id:'system:planner-mcp:dzen-task'+f.task.id,command:namespace+':receipt',idempotency_key:String(attempt.id),after_state:{receipt:old,receipt_digest:hash(JSON.stringify(old))}}});}
  return attempt;
 };
 return {release,p,createAttempt};
}
module.exports.legacy=legacy;
