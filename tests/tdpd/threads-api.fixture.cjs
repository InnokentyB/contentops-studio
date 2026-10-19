const path=require('node:path');const base=process.env.THREADS_SOURCE||'/source/src';require('ts-node/register/transpile-only');
const {GenericThreadsReleaseService}=require(path.join(base,'services/threads_generic_release.service.ts'));
const {digest}=require(path.join(base,'services/threads_api_contract.ts'));
function fixture(){
 let clock=Date.parse('2026-10-19T10:00:00Z'),calls=0,reads=0,failRead=false,failFact=false;
 const task={id:62,project_id:61,channel_id:63,content_revision:1,accepted_revision:1,draft_text:'accepted',text_state:'accepted',
 visual_state:'NO_VISUAL_NEEDED',visual_placement:'feed',visual_mode:'auto_assess',visual_decision_version:1,selected_asset_id:null,
 selected_asset:null,handoff_state:'ready',publication_mode:'approval_required',status:'ready_for_execution',schedule_at:new Date(clock-1000),
 publish_at:new Date(clock-1000),publication_fact:null,published_link:null,quality_report:{},updated_at:new Date(clock-2000),
 channel:{id:63,type:'threads',is_active:true,config:{access_token:'synthetic-secret',threads_user_id:'789',channel_username:'tester'}}};
 const rows=[],attempts=[],events=[];let owner=true;
 const matches=(row,where)=>Object.entries(where).every(([k,v])=>v===undefined||row[k]===v);
 const update=(rows,where,data)=>{const row=rows.find(r=>matches(r,where));if(!row)return{count:0};for(const[k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+v.increment:v;return{count:1};};
 const tx={projectMember:{findUnique:async()=>({role:owner?'owner':'viewer'})},contentItem:{findFirst:async()=>task,
 updateMany:async({where,data})=>update([task],where,data)},artDirectionDecision:{findFirst:async()=>({id:66,decision:'NO_VISUAL_NEEDED',channel:'threads',source_content_revision:1,decision_version:1})},
 workItem:{findFirst:async({where})=>where.kind==='browser_publish'?null:{id:67}},deliveryAttempt:{findFirst:async()=>attempts[0]||null,
 create:async({data})=>{const r={id:65,...data};attempts.push(r);return r;},updateMany:async({where,data})=>update(attempts,where,data)},
 workflowEvent:{findFirst:async({where})=>events.find(r=>matches(r,where))||null,create:async({data})=>{const r={id:events.length+1,...data};events.push(r);return r;}},
 apiDeliveryRecovery:{create:async({data})=>{const r={id:68,row_version:0,generation:1,state:'claimed',transport:'threads_api',contract_version:1,rounds:0,requests_used:0,lease_sha256:null,lease_expires_at:null,deadline_at:null,next_read_at:null,...data};rows.push(r);return r;},
 findFirst:async({where})=>rows.find(r=>matches(r,where))||null,updateMany:async({where,data})=>update(rows,where,data),
 update:async({where,data})=>{update(rows,where,data);return rows[0];}},publicationFact:{findFirst:async({where})=>where.content_item_id&&typeof where.content_item_id==='object'?null:task.publication_fact}};
 const db={...tx,$transaction:async run=>run(tx)};
 const manifestChecksum='sha256:'+'a'.repeat(64);
 const threads={testConnection:async()=>({success:true,details:{id:'789',username:'tester'}}),getOwnPosts:async()=>({items:[],after:null}),
 publishVerifiedText:async(user,token,body,name,journal)=>{await journal.beforeCreate();calls++;await journal.containerCreated('456');await journal.beforePublish();calls++;await journal.published('123');if(failRead)throw Error('synthetic-secret');return{id:'123',url:'https://www.threads.net/@tester/post/abc',publishedAt:new Date(clock).toISOString()};},
 readRecoveryProfile:async()=>{reads++;return{id:'789',username:'tester'};},readRecoveryPost:async()=>{reads++;if(failRead)throw Error('synthetic-secret');return{id:'123',text:'accepted',username:'tester',media_type:'TEXT_POST',is_reply:false,permalink:'https://www.threads.net/@tester/post/abc',timestamp:'2026-10-19T10:00:00Z'};}};
 const facts={record:async a=>{if(failFact)throw Error('synthetic-secret');await a.beforeWrite(tx);task.publication_fact={outcome:'published',provider_object_id:a.providerObjectId,public_url:a.publicUrl};await a.beforeCommit?.(tx);task.status='published';}};
 const deps={db,threads,facts,manifest:async()=>({project:{id:61,slug:'arbitrary-tenant'},checksum:manifestChecksum}),now:()=>clock,recoveryEnabled:true,pause:async ms=>{clock+=ms;}};
 const service=new GenericThreadsReleaseService(deps);
 const release={projectId:61,taskId:62,actorId:'user:64',approvalReference:'synthetic owner approval',expectedManifestChecksum:manifestChecksum,
 expectedAcceptedRevision:1,expectedContentRevision:1,expectedBodySha256:digest('accepted'),expectedChannelId:63,expectedScheduleAt:task.schedule_at.toISOString(),
 expectedVisualState:'NO_VISUAL_NEEDED',expectedSelectedAssetId:null,expectedPlacement:'feed',expectedThreadsUserId:'789',expectedUsername:'tester',idempotencyKey:'release'};
 const send={projectId:61,taskId:62,actorId:'user:64',approvalReference:release.approvalReference,expectedManifestChecksum:manifestChecksum,releaseIdempotencyKey:'release',idempotencyKey:'send'};
 const reconcile={projectId:61,taskId:62,attemptId:65,actorId:'user:64',expectedManifestChecksum:manifestChecksum};
 return{service,deps,rows,attempts,events,task,release,send,reconcile,advance:ms=>{clock+=ms;},get calls(){return calls;},get reads(){return reads;},set failRead(v){failRead=v;},set failFact(v){failFact=v;},set owner(v){owner=v;}};
}
module.exports={fixture,base};
