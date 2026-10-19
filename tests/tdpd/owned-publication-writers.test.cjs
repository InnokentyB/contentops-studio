require('ts-node/register/transpile-only');const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const item={id:4001,project_id:71,content_revision:1,accepted_revision:1,text_state:'accepted',status:'ready_for_execution',publication_mode:'manual_handoff',quality_report:{},draft_text:'original',channel:{type:'dzen'},channel_id:811};
const db={projectMember:{findUnique:async()=>({id:1})},contentItem:{findFirst:async()=>({...item})},workflowEvent:{findFirst:async()=>({id:901,command:'owned_publication.release'})},connectorDispatchJob:{findFirst:async()=>null},deliveryAttempt:{findFirst:async()=>null},$transaction:async()=>{throw Error('UNEXPECTED_MUTATION');}};
const load=Module._load;Module._load=function(name,parent,...rest){if((name==='../db'||name==='../../db')&&parent?.filename.includes('/src/services/'))return {__esModule:true,default:db};return load.call(this,name,parent,...rest);};
const {updatePublicationContent,preparePublicationTask}=require('../../src/services/mcp_publication/tasks.ts');
const {guardManualPublicationFact}=require('../../src/services/publication_manual_fact_guard.ts');
const {readPublicationAdapterStatus}=require('../../src/services/publication_adapter_status.ts');Module._load=load;
test('DA21 actual content edit rejects durable ownership after marker/status replacement',async()=>{await assert.rejects(updatePublicationContent({projectId:71,taskId:4001,expectedRevision:1,body:'changed'}),/OWNED_LIFECYCLE_IMMUTABLE/);});
test('DA21 actual task preparation cannot overwrite lifecycle despite removed quality marker',async()=>{await assert.rejects(preparePublicationTask(71,4001),/OWNED_LIFECYCLE_IMMUTABLE/);});
test('DA20 actual generic manual/automatic/imported fact guard rejects durable lifecycle ownership',async()=>{await assert.rejects(guardManualPublicationFact(db,{projectId:71,taskId:4001,internalConfirmation:false}),/OWNED_LIFECYCLE_IMMUTABLE/);});

test('DA20 status projection cannot offer manual confirmation after durable ownership marker removal',async()=>{const result=await readPublicationAdapterStatus({projectId:71,taskId:4001,actorId:'user:701'});assert.equal(result.manualRecordAllowed,false);assert.equal(result.canExecute,false);});
