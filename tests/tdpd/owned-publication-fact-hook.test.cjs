require('ts-node/register/transpile-only');const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),load=Module._load;const db={projectMember:{findUnique:async()=>null},$transaction:async()=>{throw Error('transaction not configured');}};
Module._load=function(name,parent,...rest){if(name==='../db'&&parent?.filename.includes('/src/services/'))return {__esModule:true,default:db};return load.call(this,name,parent,...rest);};
const {PublicationFactService}=require('../../src/services/publication_fact.service.ts');Module._load=load;
const args={projectId:71,taskId:4001,actorId:'user:701',artifactKind:'article',outcome:'restricted',confirmationMode:'reconciled'};
function fixture(t,replay){const calls=[],fact={id:4002,project_id:71,content_item_id:4001,channel_id:null,artifact_kind:'article',outcome:'restricted',published_at:null,public_url:null,provider_object_id:null,confirmation_mode:'reconciled',evidence_type:null,evidence_ref:null,target_url:null,utm_status:'not_applicable',confirmed_at:new Date(),updated_at:new Date()};
const item={id:4001,project_id:71,channel_id:null,content_revision:1,accepted_revision:1,text_state:'accepted',status:'ready_for_execution',channel:null,publication_fact:replay?fact:null,quality_report:{},metrics:{}};
const tx={projectMember:db.projectMember,contentItem:{findFirst:async()=>item,update:async()=>{calls.push('item');}},publicationFact:{create:async()=>{calls.push('fact');return fact;}},workflowEvent:{create:async()=>{calls.push('audit');}}};
t.mock.method(db.projectMember,'findUnique',async()=>({id:1}));t.mock.method(db,'$transaction',async run=>run(tx));return {calls,tx,fact};}
for(const replay of [false,true])test('DA15 internal afterWrite binds actual fact identity in same transaction '+(replay?'on replay':'on create'),async t=>{const f=fixture(t,replay);let linked=false;
await new PublicationFactService().record({...args,beforeWrite:async tx=>{assert.equal(tx,f.tx);f.calls.push('guard');},afterWrite:async(tx,id)=>{assert.equal(tx,f.tx);assert.equal(id,f.fact.id);linked=true;f.calls.push('link');}});
assert.equal(linked,true);assert.equal(f.calls[0],'guard');assert.equal(f.calls.at(-1),'link');});
test('DA15 unguarded internal afterWrite is rejected before access',async t=>{let reads=0;t.mock.method(db.projectMember,'findUnique',async()=>{reads++;return {id:1};});await assert.rejects(new PublicationFactService().record({...args,afterWrite:async()=>{}}),/COMPLETION_REQUIRES_GUARD/);assert.equal(reads,0);});
