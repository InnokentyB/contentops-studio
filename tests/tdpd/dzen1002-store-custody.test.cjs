const {test}=require('node:test');
const assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
// No global DB, environment, sessions or network are available to this focused test.
const dbPath=require.resolve('../../src/db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{__esModule:true,default:{},prisma:{}}};
const {Dzen1002RuntimeStore}=require('../../src/services/dzen1002_runtime_store');
const {DZEN1002_RUNTIME:p,dzen1002Hash}=require('../../src/services/dzen1002_runtime_contract');
function fixture(){
 const data={projectId:10,taskId:1002,channelId:116,revision:3,decisionId:300,decisionVersion:2,selectedAssetId:151,bodySha256:p.bodySha256,assetSha256:p.assetSha256,schedule:p.schedule,manifest:p.manifest,releaseId:3126,accountId:p.providerChannelId,body:'synthetic body',title:'Synthetic',assetUrl:'https://example.invalid/cover.png'};
 const c={attemptId:41,key:'synthetic-key',package:{...data,digest:dzen1002Hash(JSON.stringify(data))}};
 const a={projectId:10,taskId:1002,actorId:'user:2',idempotencyKey:c.key,expectedManifestChecksum:p.manifest};
 const receipt={schemaVersion:'dzen1002-native-v1',attemptId:c.attemptId,key:c.key,packageDigest:c.package.digest,accountId:p.providerChannelId,objectId:'Synthetic1002',url:'https://dzen.ru/a/Synthetic1002',publishedAt:'2026-10-16T11:59:00.000Z',observedAt:'2026-10-16T12:00:00.000Z',bodySha256:p.bodySha256,assetSha256:p.assetSha256,title:c.package.title};
 let writes=0;
 const tx={workflowEvent:{findFirst:async x=>x.where.command.endsWith(':claim')?{after_state:{actor_id:a.actorId,attempt_id:c.attemptId,package:c.package,release_id:3126}}:x.where.command.endsWith(':started')?{after_state:{package_digest:c.package.digest}}:null,create:async()=>{writes++;}},deliveryAttempt:{findFirst:async()=>({id:c.attemptId,status:'pending'}),updateMany:async()=>({count:1})},projectMember:{findUnique:async()=>{throw Error('current owner drift');}},contentItem:{findFirst:async()=>{throw Error('current package drift');}}};
 const store=new Dzen1002RuntimeStore({db:{$transaction:fn=>fn(tx)},loadManifest:async()=>{throw Error('current manifest drift');},facts:{record:async()=>{throw Error('fact unavailable');}},now:()=>new Date('2026-10-16T12:00:00.000Z'),hashBody:()=>p.bodySha256});
 return {a,c,receipt,store,writes:()=>writes};
}
test('R07 immutable post-submit receipt custody ignores current mutable eligibility',async()=>{const f=fixture();await f.store.saveReceipt(f.a,f.c,f.receipt);assert.equal(f.writes(),1);await assert.rejects(f.store.confirm(f.a,f.c),/current owner drift/);});
test('R08 immutable custody still rejects foreign actor and altered package',async()=>{const f=fixture();await assert.rejects(f.store.saveReceipt({...f.a,actorId:'user:3'},f.c,f.receipt),/CLAIM_MISMATCH/);await assert.rejects(f.store.saveReceipt(f.a,{...f.c,package:{...f.c.package,title:'altered'}},f.receipt));assert.equal(f.writes(),0);});
