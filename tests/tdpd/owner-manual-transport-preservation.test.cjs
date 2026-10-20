const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const compiled=Boolean(process.env.OWNER_MANUAL_DIST);
if(!compiled)require('ts-node/register/transpile-only');
const base=process.env.OWNER_MANUAL_DIST||process.env.OWNER_MANUAL_SOURCE||'/source/src';
const file=name=>path.join(base,compiled?name.replace(/\.ts$/,'.js'):name);
const manual={confirmation_mode:'manual',evidence_ref:'owner-manual:v1:synthetic'};
const {OwnedPublicationStore}=require(file('services/owned_publication_store.ts'));
const ownedState=require(file('services/owned_publication_store_state.ts'));
const dzenGuard=require(file('services/dzen1002_runtime_store_guard.ts'));
const {Dzen1002RuntimeStore}=require(file('services/dzen1002_runtime_store.ts'));
const dbModule=require(file('db.ts'));
const {vkConnectorRepository}=require(file('services/vk_connector_repository.ts'));
const {PublicationDispatcher}=require(file('services/publishers/publication_dispatcher.ts'));
function fixture(){let writes=0;const trace=[];
 const tx={$queryRaw:async()=>{trace.push('lock');return[{id:2}];},publicationFact:{findFirst:async()=>{trace.push('fact');return manual;}},
  deliveryAttempt:{findFirst:async()=>({id:3,status:'pending'}),update:async()=>{writes++;},updateMany:async()=>{writes++;return{count:1};}},
  connectorDispatchJob:{findFirst:async()=>({project_id:1,content_item_id:2}),updateMany:async()=>{writes++;return{count:1};}},
  workflowEvent:{findFirst:async()=>null,create:async()=>{writes++;}}};
 return{tx,trace,db:{$transaction:async run=>run(tx)},get writes(){return writes;}};
}
test('late owned freeze preserves manual fact and original attempt/job byte-for-byte',async t=>{
 const f=fixture();t.mock.method(ownedState,'ownedCommitted',async()=>({attempt:{status:'pending'}}));
 const store=new OwnedPublicationStore({db:f.db});
 await assert.rejects(store.freeze({attemptId:3,key:'original',jobId:'old',package:{projectId:1,taskId:2,digest:'x'}},'OWNED_PROVIDER_OUTCOME_UNCERTAIN'),/MANUAL_PUBLICATION_TRANSPORT_PRESERVED/);
 assert.equal(f.writes,0);assert.deepEqual(f.trace.slice(0,2),['lock','fact']);
});
test('late legacy uncertainty preserves original attempt without synthesizing delivery',async t=>{
 const f=fixture();t.mock.method(dzenGuard,'dzen1002Owner',async()=>{});
 const store=new Dzen1002RuntimeStore({db:f.db});
 await assert.rejects(store.uncertain({projectId:10,taskId:1002,actorId:'user:1',idempotencyKey:'original'},
  {attemptId:3,key:'original',package:{projectId:10,taskId:1002}}),/MANUAL_PUBLICATION_TRANSPORT_PRESERVED/);
 assert.equal(f.writes,0);assert.deepEqual(f.trace.slice(0,2),['lock','fact']);
});
test('VK job projection cannot reinterpret Owner manual fact as adapter confirmation',async t=>{
 const f=fixture();const prior=dbModule.default.$transaction;Reflect.set(dbModule.default,'$transaction',async run=>run(f.tx));
 t.after(()=>Reflect.set(dbModule.default,'$transaction',prior));
 await assert.rejects(vkConnectorRepository.transaction(store=>store.updateJob('original',3,'blocked',{state:'confirmed',factId:5,updatedAt:new Date()})),/MANUAL_PUBLICATION_TRANSPORT_PRESERVED/);
 assert.equal(f.writes,0);assert.deepEqual(f.trace.slice(0,2),['lock','fact']);
});
test('late projection rechecks the manual fact after acquiring its task lock',async()=>{
 const {withManualTransportMutation}=require(file('services/manual_publication_transport_projection.ts'));
 let fact=null,writes=0;const trace=[];
 const tx={$queryRaw:async()=>{trace.push('lock');fact=manual;return[{id:2}];},
  publicationFact:{findFirst:async()=>{trace.push('fact');return fact;}}};
 const db={$transaction:async run=>run(tx)};
 await assert.rejects(withManualTransportMutation(db,{projectId:1,taskId:2},async()=>{writes++;}),/MANUAL_PUBLICATION_TRANSPORT_PRESERVED/);
 assert.equal(writes,0);assert.deepEqual(trace,['lock','fact']);
});
test('ordinary transport facts retain the existing projection path',async()=>{
 const {withManualTransportMutation}=require(file('services/manual_publication_transport_projection.ts'));
 let writes=0;const tx={$queryRaw:async()=>[{id:2}],publicationFact:{findFirst:async()=>({confirmation_mode:'automatic',evidence_ref:'provider-proof'})}};
 const result=await withManualTransportMutation({$transaction:async run=>run(tx)},{projectId:1,taskId:2},async()=>{writes++;return'unchanged';});
 assert.equal(result,'unchanged');assert.equal(writes,1);
});
test('actual direct dispatcher fallback cannot replace a manual projection or reopen browser work',async t=>{
 const f=fixture();f.tx.contentItem={update:async()=>{throw Error('manual task projection must be preserved');}};
 f.tx.workItem={upsert:async()=>{throw Error('manual confirmation cannot reopen browser work');}};
 const prior=dbModule.default.$transaction;Reflect.set(dbModule.default,'$transaction',async run=>run(f.tx));
 t.after(()=>Reflect.set(dbModule.default,'$transaction',prior));
 await assert.rejects(new PublicationDispatcher().routeToBrowserPublication(
  {id:2,project_id:1,channel:{type:'medium'},content_revision:1,quality_report:{}},{},
  {code:'CONNECTOR_NOT_AVAILABLE',message:'synthetic transport failure'}),/MANUAL_PUBLICATION_TRANSPORT_PRESERVED/);
 assert.equal(f.writes,0);assert.deepEqual(f.trace.slice(0,2),['lock','fact']);
});
