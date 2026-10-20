const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'synthetic-db');assert.equal(url.pathname,'/owner_manual_synthetic');
const source=process.env.OWNER_MANUAL_SOURCE==='true';if(source)require('ts-node/register/transpile-only');
const base=source?'/source/src':process.env.OWNER_MANUAL_DIST||'/opt/planner/dist';
const file=name=>path.join(base,source?name.replace(/\.js$/,'.ts'):name);
const {prisma:db,pool}=require(file('db.js'));
const {registerTaskPublicationTools}=require(file('mcp/tools/task_publication_tools.js'));
const {withPublicationPrincipal}=require(file('mcp/publication-principal.js'));
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'),{Client}=require('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const hash=value=>createHash('sha256').update(value).digest('hex');
test.after(async()=>{await db.$disconnect();await pool.end();});
async function setup(t,provider='dzen'){
 const nonce=randomUUID(),user=await db.user.create({data:{email:`${nonce}@example.invalid`,name:'Synthetic manual Owner',password_hash:'not-a-login'}});
 const project=await db.project.create({data:{name:'Synthetic manual confirmation',slug:nonce}});
 t.after(async()=>{await db.connectorDispatchJob.deleteMany({where:{project_id:project.id}});await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
 await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,type:provider,name:'Synthetic manual channel',config:provider==='vk'?{group_id:'7654321'}:{channel_id:'synthetic-account'}}});
 const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',item_key:nonce,assets:{synthetic_fixture:true},draft_text:'Current unaccepted synthetic edition',content_revision:2,accepted_revision:null,text_state:'draft',visual_state:'STALE',visual_placement:provider==='vk'?'feed':'article_cover',publication_mode:'approval_required',status:'drafted',quality_report:{provider_result_uncertain:true,publication_task_delivery:{state:'provider_result_uncertain'},synthetic_history:'preserve'}}});
 const principal={userId:user.id,actorId:`user:${user.id}`,projectId:project.id,profile:'owner'};
 const server=new McpServer({name:'manual-confirmation-acceptance',version:'1'});registerTaskPublicationTools(server);
 const client=new Client({name:'owner',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 t.after(async()=>{await client.close();await server.close();});
 let network=0;t.mock.method(global,'fetch',async()=>{network++;throw Error('SYNTHETIC_NETWORK_FORBIDDEN');});
 const input={projectId:project.id,taskId:task.id,publicUrl:provider==='vk'?'https://vk.com/wall-7654321_123456':'https://dzen.ru/a/SyntheticObject123',publishedAt:'2026-10-19T12:34:56.123456+01:00',timeBasis:'OWNER_CONFIRMED_MESSAGE_TIME',ownerConfirmationReference:'Synthetic Owner assertion for this exact task and external object'};
 const call=async(name,args,p=principal)=>withPublicationPrincipal(p,()=>client.callTool({name,arguments:args}));
 const payload=result=>result.structuredContent||JSON.parse(result.content[0].text);
 return {user,project,channel,task,principal,input,call,payload,get network(){return network;},async preview(extra={},p=principal){const r=await call('ba_preview_owner_manual_publication_confirmation',{...input,...extra},p);assert.notEqual(r.isError,true,JSON.stringify(r));return payload(r);},commitArgs(preview,extra={}){return {...input,previewHash:preview.preview_hash,expectedManifestChecksum:preview.manifest_checksum,expectedFactSha256:preview.expected_fact_sha256,idempotencyKey:'synthetic-manual-commit',...extra};}};
}
async function custody(taskId){return {
 task:await db.contentItem.findUnique({where:{id:taskId}}),
 attempts:await db.deliveryAttempt.findMany({where:{content_item_id:taskId},orderBy:{id:'asc'}}),
 jobs:await db.connectorDispatchJob.findMany({where:{content_item_id:taskId},orderBy:{id:'asc'}}),
 work:await db.workItem.findMany({where:{content_item_id:taskId},orderBy:{id:'asc'}})
};}
function preservedWork(after,before){
 for(const row of before)assert.deepEqual(after.find(item=>item.id===row.id),row);
 for(const row of after.filter(item=>!before.some(prior=>prior.id===item.id)))assert.equal(row.kind,'metric_capture','only ordinary new metric work may be created');
}
test('026 actual MCP preview exists, reads PostgreSQL and performs no mutation or provider call',async t=>{
 const f=await setup(t),before=await custody(f.task.id),events=await db.workflowEvent.count({where:{project_id:f.project.id}});
 const p=await f.preview();assert.match(p.preview_hash,/^[a-f0-9]{64}$/);assert.equal(p.expected_fact_sha256,null);
 const {loadAgentWorkspaceManifest}=require(file('services/agent_workspace_manifest.service.js'));
 assert.equal(p.manifest_checksum,(await loadAgentWorkspaceManifest(f.project.id,f.user.id)).checksum,'preview must bind the actual current shared manifest');
 assert.equal(p.canonical_identity.provider,'dzen');assert.equal(p.revision_binding,'external_object_only');
 assert.ok(!JSON.stringify(p).includes(f.task.draft_text));
 assert.deepEqual(await custody(f.task.id),before);assert.equal(await db.workflowEvent.count({where:{project_id:f.project.id}}),events);assert.equal(f.network,0);
});
test('026 actual MCP commit exists and records manual fact without accepting current edition or rewriting UNKNOWN custody',async t=>{
 const f=await setup(t,'vk');await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,mode:'manual',status:'verification_required',idempotency_key:'synthetic-old-unknown',attempt_number:1,requires_manual_confirmation:true,error_message:'Synthetic UNKNOWN evidence'}});
 await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:randomUUID(),kind:'browser_publish',state:'claimed',assignee_role:'publisher',input_context_version:1,lease_token:'synthetic-private-lease',lease_actor_id:'synthetic-worker',lease_expires_at:new Date(Date.now()+60000)}});
 const before=await custody(f.task.id),p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const fact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}});assert.equal(fact.confirmation_mode,'manual');assert.equal(fact.outcome,'published');assert.equal(fact.published_at.toISOString(),'2026-10-19T11:34:56.123Z');
 const after=await custody(f.task.id);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.jobs,before.jobs);preservedWork(after.work,before.work);
 for(const field of ['draft_text','content_revision','accepted_revision','text_state','selected_asset_id','visual_state','quality_report'])assert.deepEqual(after.task[field],before.task[field],field);
 assert.equal(f.network,0);assert.equal(f.payload(r).provenance.revision_binding,'external_object_only');
 assert.ok(!JSON.stringify({p,r}).includes('synthetic-private-lease'));assert.ok(!JSON.stringify({p,r}).includes(f.task.draft_text));
});
async function denied(f,args,principal=f.principal,name='ba_preview_owner_manual_publication_confirmation'){
 const before=await custody(f.task.id),facts=await db.publicationFact.count({where:{project_id:f.project.id}});
 const r=await f.call(name,args,principal);assert.equal(r.isError,true,JSON.stringify(r));
 const p=f.payload(r);assert.match(p.code,/^MANUAL_PUBLICATION_/);assert.equal(p.retry_allowed,false);assert.ok(p.action||p.reasons?.some(reason=>reason.action));
 assert.deepEqual(await custody(f.task.id),before);assert.equal(await db.publicationFact.count({where:{project_id:f.project.id}}),facts);assert.equal(f.network,0);return p;
}
for(const profile of ['publisher','writer','planner','researcher'])test(`026 ${profile} principal cannot obtain Owner accounting authority`,async t=>{
 const f=await setup(t);await denied(f,f.input,{...f.principal,profile});
});
test('026 absent principal cannot obtain authority from URL/reference/input actor',async t=>{const f=await setup(t);await denied(f,f.input,null);});
test('026 actual demo Owner and revoked membership fail closed',async t=>{
 const f=await setup(t);await db.user.update({where:{id:f.user.id},data:{is_demo:true}});await denied(f,f.input);
 await db.user.update({where:{id:f.user.id},data:{is_demo:false}});const p=await f.preview();
 await db.projectMember.update({where:{project_id_user_id:{project_id:f.project.id,user_id:f.user.id}},data:{role:'editor'}});
 await denied(f,f.commitArgs(p),f.principal,'ba_confirm_owner_manual_publication');
});
test('026 cross-tenant principal cannot access a valid task or its preview',async t=>{const f=await setup(t);await denied(f,f.input,{...f.principal,projectId:f.project.id+100000});});
test('026 inactive channel cannot obtain historical accounting authority',async t=>{const f=await setup(t);await db.socialChannel.update({where:{id:f.channel.id},data:{is_active:false}});await denied(f,f.input);});
for(const publicUrl of ['http://dzen.ru/a/SyntheticObject123','https://user:password@dzen.ru/a/SyntheticObject123','https://dzen.ru/a/SyntheticObject123?token=private','https://dzen.ru/a/SyntheticObject123#fragment','https://dzen.ru/profile/editor','https://localhost/a/SyntheticObject123','https://vk.com/wall-7654321_123456'])test(`026 Dzen invalid permalink ${publicUrl.split('/')[2]} is refused without a fetch`,async t=>{const f=await setup(t);await denied(f,{...f.input,publicUrl});});
for(const publishedAt of ['2026-10-19T12:34:56','invalid','2999-10-19T12:34:56+01:00','2026-02-30T12:00:00+01:00','2026-10-19T24:00:00+01:00'])test(`026 ambiguous malformed or future time is refused: ${publishedAt}`,async t=>{const f=await setup(t);await denied(f,{...f.input,publishedAt});});
test('026 unretained revision cannot be labelled the published edition',async t=>{const f=await setup(t);await denied(f,{...f.input,publishedRevision:{revision:2,bodySha256:hash(f.task.draft_text)}});});
test('026 preview tampering, stale task and stale expected fact do not write',async t=>{
 const f=await setup(t),p=await f.preview();await denied(f,f.commitArgs(p,{previewHash:'f'.repeat(64)}),f.principal,'ba_confirm_owner_manual_publication');
 await denied(f,f.commitArgs(p,{expectedFactSha256:'f'.repeat(64)}),f.principal,'ba_confirm_owner_manual_publication');
 await db.contentItem.update({where:{id:f.task.id},data:{draft_text:'Different unaccepted edition'}});await denied(f,f.commitArgs(p),f.principal,'ba_confirm_owner_manual_publication');
});
test('026 exact replay returns the same fact with zero additional audit/checkpoints; changed key payload conflicts',async t=>{
 const f=await setup(t),p=await f.preview(),args=f.commitArgs(p),r=await f.call('ba_confirm_owner_manual_publication',args);assert.notEqual(r.isError,true,JSON.stringify(r));
 const fact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),events=await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}}),work=await db.workItem.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}});
 const replay=await f.call('ba_confirm_owner_manual_publication',args);assert.notEqual(replay.isError,true,JSON.stringify(replay));assert.equal(f.payload(replay).replayed,true);
 assert.deepEqual(await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),fact);assert.deepEqual(await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}}),events);assert.deepEqual(await db.workItem.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}}),work);
 await denied(f,{...args,ownerConfirmationReference:'Changed attestation under the same key'},f.principal,'ba_confirm_owner_manual_publication');
 await denied(f,{...args,idempotencyKey:'different-key-with-stale-null-fact'},f.principal,'ba_confirm_owner_manual_publication');
 const serialized=JSON.stringify({result:f.payload(r),events});assert.ok(serialized.includes(f.input.publishedAt),'original offset and microseconds remain in provenance');assert.ok(!JSON.stringify(r).includes(f.task.draft_text));
});
for(const provider of ['dzen','vk'])test(`026 same canonical ${provider} object cannot be concurrently assigned to different tasks`,async t=>{
 const f=await setup(t,provider),second=await db.contentItem.create({data:{project_id:f.project.id,channel_id:f.channel.id,item_key:randomUUID(),type:'publication',draft_text:'Other synthetic edition',content_revision:1,text_state:'draft',status:'drafted',visual_placement:provider==='vk'?'feed':'article_cover'}});
 const publicUrl=provider==='vk'?f.input.publicUrl.replace('vk.com','vk.ru'):f.input.publicUrl;
 const p1=await f.preview(),p2=await f.preview({taskId:second.id,publicUrl});
 const results=await Promise.all([f.call('ba_confirm_owner_manual_publication',f.commitArgs(p1)),f.call('ba_confirm_owner_manual_publication',f.commitArgs(p2,{taskId:second.id,publicUrl,idempotencyKey:'synthetic-other-task'}))]);
 assert.equal(results.filter(r=>!r.isError).length,1,JSON.stringify(results));assert.equal(await db.publicationFact.count({where:{project_id:f.project.id}}),1);assert.equal(f.network,0);
});
test('026 VK ru/com aliases bind the same canonical identity without following links',async t=>{
 const f=await setup(t,'vk'),canonical=await f.preview(),alias=await f.preview({publicUrl:f.input.publicUrl.replace('vk.com','vk.ru')});
 assert.deepEqual(alias.canonical_identity,canonical.canonical_identity);assert.equal(alias.canonical_identity.public_url,f.input.publicUrl);assert.equal(f.network,0);
});
for(const [label,table] of [['audit','workflow_events'],['checkpoint','metric_snapshots']])test(`026 actual PostgreSQL ${label} write failure rolls back fact, projection and audit`,async t=>{
 const f=await setup(t),p=await f.preview(),before=await custody(f.task.id),events=await db.workflowEvent.findMany({where:{project_id:f.project.id}});
 const name=`manual_fault_${f.project.id}`;
 await db.$executeRawUnsafe(`CREATE FUNCTION planner.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.project_id = ${f.project.id} THEN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_STORAGE_FAILURE'; END IF; RETURN NEW; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON planner.${table} FOR EACH ROW EXECUTE FUNCTION planner.${name}()`);
 try{const r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.equal(r.isError,true,JSON.stringify(r));assert.ok(!JSON.stringify(r).includes('SYNTHETIC_PRIVATE_STORAGE_FAILURE'));
  assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);assert.deepEqual(await custody(f.task.id),before);assert.deepEqual(await db.workflowEvent.findMany({where:{project_id:f.project.id}}),events);
 }finally{await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON planner.${table}`);await db.$executeRawUnsafe(`DROP FUNCTION planner.${name}()`);}
});
test('026 manual fact fences generic writer and rolls back a late callback attempt mutation',async t=>{
 const f=await setup(t),p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const before=await custody(f.task.id),fact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),facts=require(file('services/publication_fact.service.js')).default;
 const args={projectId:f.project.id,taskId:f.task.id,actorId:f.principal.actorId,artifactKind:'article',outcome:'published',confirmationMode:'automatic',publishedAt:'2026-10-19T12:00:00Z',publicUrl:'https://dzen.ru/a/OtherSyntheticObject',providerObjectId:'OtherSyntheticObject',correctionReason:'Synthetic late provider confirmation'};
 await assert.rejects(facts.record(args));
 await assert.rejects(facts.record({...args,beforeWrite:async tx=>{await tx.contentItem.update({where:{id:f.task.id},data:{quality_report:{fake_provider_confirmed:true}}});}}));
 assert.deepEqual(await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),fact);assert.deepEqual(await custody(f.task.id),before);
});
test('026 blocked connector custody and old audit rows remain byte-identical',async t=>{
 const f=await setup(t,'vk'),work=await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:randomUUID(),kind:'browser_publish',state:'blocked',assignee_role:'publisher',input_context_version:1,lease_token:'synthetic-retained-lease'}});
 const asset=await db.imageAsset.create({data:{project_id:f.project.id,content_item_id:f.task.id,prompt:'Synthetic old asset',status:'candidate',content_revision:1,file_url:'https://example.invalid/synthetic.png'}});
 const oldApproval=await db.approvalDecision.create({data:{work_item_id:work.id,result_version:1,decision:'approved',actor_id:f.principal.actorId,comment:'Synthetic retained approval, not current edition authority'}});
 const oldMetric=await db.metricSnapshot.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,checkpoint:'synthetic_old_checkpoint',collection_status:'partial',metrics:{retained_value:123},evidence_ref:'synthetic-old-metric-evidence'}});
 await db.connectorDispatchJob.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,work_item_id:work.id,content_revision:1,selected_asset_id:asset.id,package_sha256:'a'.repeat(64),binding:{protocol:'synthetic-old-protocol',uncertain:true},idempotency_key:randomUUID(),state:'blocked',generation:3,blocker_code:'SYNTHETIC_OLD_BLOCKER',canonical_lease_sha256:'b'.repeat(64)}});
 const oldAudit=await db.workflowEvent.create({data:{project_id:f.project.id,content_item_id:f.task.id,actor_id:'synthetic-old-actor',command:'synthetic.old_uncertainty',after_state:{uncertain:true,retained_reference:'synthetic-history'}}});
 const before=await custody(f.task.id),p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const after=await custody(f.task.id);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.jobs,before.jobs);preservedWork(after.work,before.work);assert.deepEqual(await db.workflowEvent.findUnique({where:{id:oldAudit.id}}),oldAudit);
 assert.deepEqual(after.task.quality_report,before.task.quality_report);assert.equal(after.task.accepted_revision,null);assert.equal(after.task.selected_asset_id,null);assert.equal(f.network,0);
 assert.deepEqual(await db.approvalDecision.findUnique({where:{id:oldApproval.id}}),oldApproval);assert.deepEqual(await db.metricSnapshot.findUnique({where:{id:oldMetric.id}}),oldMetric);assert.deepEqual(await db.imageAsset.findUnique({where:{id:asset.id}}),asset);
});
test('026 concurrent same-task same-key requests create one fact and one provenance authority',async t=>{
 const f=await setup(t),p=await f.preview(),args=f.commitArgs(p);
 const results=await Promise.all([f.call('ba_confirm_owner_manual_publication',args),f.call('ba_confirm_owner_manual_publication',args)]);
 assert.ok(results.some(r=>!r.isError),JSON.stringify(results));assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),1);
 const before=await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}}),replay=await f.call('ba_confirm_owner_manual_publication',args);
 assert.notEqual(replay.isError,true,JSON.stringify(replay));assert.equal(f.payload(replay).replayed,true);assert.deepEqual(await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}}),before);assert.equal(f.network,0);
});
test('026 correction requires fresh exact fact digest and reason, appends provenance and preserves prior audit',async t=>{
 const f=await setup(t),p=await f.preview();const initial=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(initial.isError,true,JSON.stringify(initial));
 const before=await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}}),oldFact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}});
 const changed={publishedAt:'2026-10-19T12:35:56.654321+01:00'},fresh=await f.preview(changed);assert.match(fresh.expected_fact_sha256,/^[a-f0-9]{64}$/);
 const args=f.commitArgs(fresh,{...changed,idempotencyKey:'synthetic-correction'});await denied(f,args,f.principal,'ba_confirm_owner_manual_publication');
 const corrected=await f.call('ba_confirm_owner_manual_publication',{...args,correctionReason:'Synthetic Owner corrects the originally declared message time'});assert.notEqual(corrected.isError,true,JSON.stringify(corrected));
 const fact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}});assert.equal(fact.id,oldFact.id);assert.equal(fact.published_at.toISOString(),'2026-10-19T11:35:56.654Z');
 const after=await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}});for(const row of before)assert.deepEqual(after.find(e=>e.id===row.id),row);assert.ok(after.length>before.length);assert.equal(f.network,0);
});
for(const target of ['user','membership'])test(`026 real ${target} authority remains locked through fact/audit commit`,async t=>{
 const f=await setup(t),p=await f.preview(),name=`manual_pause_${f.project.id}`,marker=1000000+f.project.id;
 await db.$executeRawUnsafe(`CREATE FUNCTION planner.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.project_id = ${f.project.id} THEN PERFORM pg_advisory_xact_lock(${marker}); PERFORM pg_sleep(1); END IF; RETURN NEW; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON planner.workflow_events FOR EACH ROW EXECUTE FUNCTION planner.${name}()`);
 let commit;try{
  commit=f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));let paused=false;
  for(let i=0;i<150;i++){const rows=await db.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=${marker} AND granted) AS held`);if(rows[0].held){paused=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(paused,true,'actual audit insertion must reach the controlled transaction pause');
  const connection=await pool.connect();try{await connection.query('BEGIN');await connection.query("SET LOCAL lock_timeout='75ms'");
   const sql=target==='user'?'UPDATE planner.users SET is_demo=true WHERE id=$1':'UPDATE planner.project_members SET role=\'editor\' WHERE user_id=$1 AND project_id=$2';
   await assert.rejects(connection.query(sql,target==='user'?[f.user.id]:[f.user.id,f.project.id]),error=>error.code==='55P03');
  }finally{await connection.query('ROLLBACK');connection.release();}
  const r=await commit;assert.notEqual(r.isError,true,JSON.stringify(r));
 }finally{if(commit)await commit;await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON planner.workflow_events`);await db.$executeRawUnsafe(`DROP FUNCTION planner.${name}()`);}
});
test('026 existing fact/get-task/list-task MCP readbacks expose manual origin and unknown published revision',async t=>{
 const f=await setup(t),p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const factResult=await f.call('ba_get_publication_fact',{projectId:f.project.id,taskId:f.task.id,actorId:f.principal.actorId});assert.notEqual(factResult.isError,true,JSON.stringify(factResult));
 const taskResult=await f.call('ba_get_publication_task',{projectId:f.project.id,taskId:f.task.id});assert.notEqual(taskResult.isError,true,JSON.stringify(taskResult));
 const listResult=await f.call('ba_list_publication_tasks',{projectId:f.project.id});assert.notEqual(listResult.isError,true,JSON.stringify(listResult));
 for(const fact of [f.payload(factResult).publication_fact,f.payload(taskResult).task.publication_fact,f.payload(listResult).tasks.find(task=>task.id===f.task.id).publication_fact]){
  assert.equal(fact.publication_origin,'owner_attested_v1');assert.equal(fact.transport_history_preserved,true);assert.equal(fact.manual_confirmation.revision_binding,'external_object_only');assert.equal(fact.manual_confirmation.published_revision,null);assert.equal(fact.manual_confirmation.time_basis,'OWNER_CONFIRMED_MESSAGE_TIME');assert.equal(fact.manual_confirmation.published_at_original,f.input.publishedAt);
 }
 assert.equal(f.network,0);
});
test('026 existing channel repair refuses a manual fact before any reassignment or audit change',async t=>{
 const f=await setup(t),p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const target=await db.socialChannel.create({data:{project_id:f.project.id,type:'dzen',name:'Other synthetic channel',is_active:true,config:{}}}),fact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),snapshots=await db.metricSnapshot.findMany({where:{content_item_id:f.task.id}}),before=await custody(f.task.id),events=await db.workflowEvent.findMany({where:{project_id:f.project.id}});
 const repair=require(file('services/published_channel_repair.service.js')).default;
 await assert.rejects(repair.apply({projectId:f.project.id,actorId:f.principal.actorId,taskId:f.task.id,expectedCurrentChannelId:f.channel.id,targetChannelId:target.id,expectedPublicationFactId:fact.id,expectedPublicUrl:fact.public_url,expectedSnapshots:snapshots.map(row=>({id:row.id,channelId:row.channel_id})),previewHash:'a'.repeat(64),reason:'Synthetic channel repair attempt',idempotencyKey:'synthetic-channel-repair'}),/MANUAL_PUBLICATION_TRANSPORT_PRESERVED/);
 assert.deepEqual(await custody(f.task.id),before);assert.deepEqual(await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),fact);assert.deepEqual(await db.workflowEvent.findMany({where:{project_id:f.project.id}}),events);
});
test('026 ordinary canonical writer cannot adopt another task manual object, including VK alias',async t=>{
 const f=await setup(t,'vk'),p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const other=await db.contentItem.create({data:{project_id:f.project.id,channel_id:f.channel.id,type:'publication',item_key:randomUUID(),status:'drafted',draft_text:'Another synthetic task',visual_placement:'feed'}}),before=await custody(f.task.id),otherBefore=await custody(other.id),fact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),events=await db.workflowEvent.findMany({where:{project_id:f.project.id}});
 const facts=require(file('services/publication_fact.service.js')).default;
 for(const publicUrl of [f.input.publicUrl,f.input.publicUrl.replace('vk.com','vk.ru')])await assert.rejects(facts.record({projectId:f.project.id,taskId:other.id,actorId:f.principal.actorId,artifactKind:'post',outcome:'published',publishedAt:f.input.publishedAt,publicUrl,providerObjectId:p.canonical_identity.object_id,confirmationMode:'manual',evidence:{type:'manual_note',ref:'Synthetic different generic accounting request'}}));
 assert.deepEqual(await custody(f.task.id),before);assert.deepEqual(await custody(other.id),otherBefore);assert.deepEqual(await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),fact);assert.equal(await db.publicationFact.count({where:{content_item_id:other.id}}),0);assert.deepEqual(await db.workflowEvent.findMany({where:{project_id:f.project.id}}),events);
});
test('026 concurrent ordinary writer and Owner command cannot establish two authorities for one object',async t=>{
 const f=await setup(t),other=await db.contentItem.create({data:{project_id:f.project.id,channel_id:f.channel.id,type:'publication',item_key:randomUUID(),status:'drafted',draft_text:'Concurrent synthetic task',visual_placement:'article_cover'}}),p=await f.preview(),facts=require(file('services/publication_fact.service.js')).default;
 const results=await Promise.allSettled([f.call('ba_confirm_owner_manual_publication',f.commitArgs(p)),facts.record({projectId:f.project.id,taskId:other.id,actorId:f.principal.actorId,artifactKind:'article',outcome:'published',publishedAt:f.input.publishedAt,publicUrl:f.input.publicUrl,providerObjectId:p.canonical_identity.object_id,confirmationMode:'manual',evidence:{type:'manual_note',ref:'Synthetic concurrent ordinary fact'}})]);
 const successes=results.filter(result=>result.status==='fulfilled'&&!result.value.isError);assert.equal(successes.length,1,JSON.stringify(results));assert.equal(await db.publicationFact.count({where:{project_id:f.project.id}}),1);assert.equal(f.network,0);
});
test('026 ordinary writer rejects a forged opaque policy and reserved provenance prefix',async t=>{
 const f=await setup(t),before=await custody(f.task.id),facts=require(file('services/publication_fact.service.js')).default;
 const args={projectId:f.project.id,taskId:f.task.id,actorId:f.principal.actorId,artifactKind:'article',outcome:'published',publishedAt:f.input.publishedAt,publicUrl:f.input.publicUrl,confirmationMode:'manual',evidence:{type:'manual_note',ref:'Synthetic generic assertion'}};
 await assert.rejects(facts.record({...args,ownerManualPolicy:{}}),/MANUAL_PUBLICATION_POLICY_INVALID/);
 await assert.rejects(facts.record({...args,evidence:{type:'manual_note',ref:'owner-manual:v1:forged-json-policy'}}),/MANUAL_PUBLICATION_POLICY_REQUIRED/);
 assert.deepEqual(await custody(f.task.id),before);assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);assert.equal(f.network,0);
});
test('026 corrupted manual audit readback exposes repair_required and never verified provenance',async t=>{
 const f=await setup(t),p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const event=await db.workflowEvent.findFirst({where:{project_id:f.project.id,content_item_id:f.task.id,command:'owner_manual_publication.confirmed'},orderBy:{id:'desc'}});assert.ok(event);
 await db.workflowEvent.update({where:{id:event.id},data:{after_state:{...event.after_state,publication_fact_sha256:'f'.repeat(64)}}});
 const result=await f.call('ba_get_publication_fact',{projectId:f.project.id,taskId:f.task.id,actorId:f.principal.actorId});assert.notEqual(result.isError,true,JSON.stringify(result));
 const fact=f.payload(result).publication_fact;assert.equal(fact.publication_origin,'owner_attested_v1');assert.equal(fact.provenance_state,'repair_required');assert.equal(fact.retry_allowed,false);assert.equal(fact.transport_history_preserved,true);assert.equal(fact.published_revision,null);assert.equal(fact.manual_confirmation,undefined);assert.equal(f.network,0);
});
test('026 Owner command cannot adopt a URL-only legacy ordinary fact through VK host/protocol aliases',async t=>{
 for(const publicUrl of ['https://vk.ru/wall-7654321_123456','http://vk.com/wall-7654321_123456?legacy_tracking=synthetic','https://vk.com/wall-7654321_123456']){
  const f=await setup(t,'vk'),other=await db.contentItem.create({data:{project_id:f.project.id,channel_id:f.channel.id,type:'publication',item_key:randomUUID(),status:'published',draft_text:'Legacy synthetic task',visual_placement:'feed'}});
  const oldFact=await db.publicationFact.create({data:{project_id:f.project.id,content_item_id:other.id,channel_id:f.channel.id,artifact_kind:'post',outcome:'published',published_at:new Date('2026-10-18T11:00:00Z'),public_url:publicUrl,provider_object_id:null,confirmation_mode:'manual',evidence_type:'manual_note',evidence_ref:'Synthetic legacy ordinary confirmation',confirmed_by:f.principal.actorId}});
  const p=await f.preview(),before=await custody(f.task.id);await denied(f,f.commitArgs(p),f.principal,'ba_confirm_owner_manual_publication');assert.deepEqual(await custody(f.task.id),before);assert.deepEqual(await db.publicationFact.findUnique({where:{id:oldFact.id}}),oldFact);assert.equal(await db.publicationFact.count({where:{project_id:f.project.id}}),1);
 }
});
for(const kind of ['browser_publish','provider_publish'])for(const operation of ['claim','complete','block','release','reschedule'])test(`026 generic queue ${operation} cannot change preserved ${kind} work or replay lease authority`,async t=>{
 const f=await setup(t),queue=require(file('services/work_queue/lifecycle_operations.js'));
 const work=await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:randomUUID(),kind,state:'available',assignee_role:'publisher',input_context_version:1}});
 const common={projectId:f.project.id,actorId:f.principal.actorId,workItemId:work.id},claimKey='synthetic-original-claim';
 const lease=await queue.claimWorkItem({...common,idempotencyKey:claimKey});
 const p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const before=await custody(f.task.id),events=await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}});
 const methods={claim:()=>queue.claimWorkItem({...common,idempotencyKey:claimKey}),complete:()=>queue.completeWorkItem({...common,leaseToken:lease.lease_token,result:{body:'Synthetic late execution'},idempotencyKey:'synthetic-late-complete'}),block:()=>queue.blockWorkItem({...common,leaseToken:lease.lease_token,reasonCode:'SYNTHETIC_LATE_BLOCK',idempotencyKey:'synthetic-late-block'}),release:()=>queue.releaseWorkItem({...common,leaseToken:lease.lease_token,idempotencyKey:'synthetic-late-release'}),reschedule:()=>queue.rescheduleWorkItem({...common,dueAt:new Date(Date.now()+60000).toISOString(),reason:'Synthetic late reschedule',idempotencyKey:'synthetic-late-reschedule'})};
 await assert.rejects(methods[operation](),/MANUAL_PUBLICATION_TRANSPORT_PRESERVED/);
 assert.deepEqual(await custody(f.task.id),before);assert.deepEqual(await db.workflowEvent.findMany({where:{project_id:f.project.id},orderBy:{id:'asc'}}),events);assert.equal(f.network,0);
});
test('026 ordinary metric_capture queue work remains claimable and completable after manual confirmation',async t=>{
 const f=await setup(t),queue=require(file('services/work_queue/lifecycle_operations.js'));
 const work=await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:randomUUID(),kind:'metric_capture',state:'available',assignee_role:'metrics_operator',input_context_version:1}});
 const p=await f.preview(),r=await f.call('ba_confirm_owner_manual_publication',f.commitArgs(p));assert.notEqual(r.isError,true,JSON.stringify(r));
 const common={projectId:f.project.id,actorId:f.principal.actorId,workItemId:work.id},fact=await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),lease=await queue.claimWorkItem({...common,idempotencyKey:'synthetic-metric-claim'});
 await queue.completeWorkItem({...common,leaseToken:lease.lease_token,result:{body:'Synthetic ordinary metric capture'},idempotencyKey:'synthetic-metric-complete'});
 assert.equal((await db.workItem.findUnique({where:{id:work.id}})).state,'completed');assert.deepEqual(await db.publicationFact.findUnique({where:{content_item_id:f.task.id}}),fact);assert.equal(f.network,0);
});
