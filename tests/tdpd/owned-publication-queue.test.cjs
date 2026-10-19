require('ts-node/register/transpile-only');
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {connectorPackageHash}=require('../../src/services/vk_connector_contract.ts');
const binding={projectId:10,taskId:1048,channelId:117,communityId:-240051152,revision:1,selectedAssetId:130,placement:'feed',bodySha256:'a'.repeat(64),assetSha256:'b'.repeat(64),releaseSha256:'c'.repeat(64)};
const row=(id,b,provider)=>({id,project_id:10,content_item_id:b.taskId||6001,channel_id:b.channelId||811,channel:{type:provider},work_item_id:1699,package_sha256:provider==='vk'?connectorPackageHash(b):id.padEnd(64,'f'),content_revision:b.revision,selected_asset_id:b.selectedAssetId,idempotency_key:id,state:'queued',binding:b,generation:0,updated_at:new Date(),created_at:new Date(),host_id:null,consumer_instance_id:null,receipt_at:null,blocker_code:null,attempt_id:null,publication_fact_id:null,canonical_lease_sha256:null,canonical_lease_expires_at:null});
function match(r,w){if(!w)return true;return Object.entries(w).every(([k,v])=>{
 if(k==='AND')return (Array.isArray(v)?v:[v]).every(x=>match(r,x));if(k==='OR')return v.some(x=>match(r,x));if(k==='NOT')return !match(r,v);
 if(k==='project_id_idempotency_key')return match(r,v);
 if(k==='binding'){const value=v.path?.reduce((o,p)=>o?.[p],r.binding);if(v.equals?.constructor?.name==='DbNull'||v.equals?.constructor?.name==='JsonNull')return value==null;return value===v.equals;}
 if(k==='channel')return match(r.channel,v);
 if(v&&typeof v==='object'){if(v.in)return v.in.includes(r[k]);if(v.not!==undefined)return r[k]!==v.not;if(v.equals!==undefined)return r[k]===v.equals;}
 return r[k]===v;
});}
async function fixture(t){const rows=[row('owned',{protocol:'owned_provider_v1',provider:'dzen',package:{}},'dzen'),row('legacy',binding,'vk')];const db={$transaction:async run=>run({connectorDispatchJob:{findMany:async q=>rows.filter(r=>match(r,q.where)).slice(0,q.take||100),findFirst:async q=>rows.find(r=>match(r,q.where))||null,findUnique:async q=>rows.find(r=>match(r,q.where))||null,updateMany:async q=>{const changed=rows.filter(r=>match(r,q.where));changed.forEach(r=>Object.assign(r,q.data));return {count:changed.length};}}})};
 const load=Module._load;t.mock.method(Module,'_load',function(name,parent,...rest){if(name==='../db'&&parent?.filename.endsWith('vk_connector_repository.ts'))return {__esModule:true,default:db};return load.call(this,name,parent,...rest);});
 const file=require.resolve('../../src/services/vk_connector_repository.ts');delete require.cache[file];return {rows,repo:require(file).vkConnectorRepository};}
test('DA07 mixed queue selects legacy VK without decoding or starving on Dzen rows',async t=>{const {repo}=await fixture(t);const jobs=await repo.transaction(s=>s.candidates(10));assert.deepEqual(jobs.map(j=>j.jobId),['legacy']);});
test('DA07 VK lookup and CAS cannot interpret or change a Dzen job',async t=>{const {repo,rows}=await fixture(t);assert.equal(await repo.transaction(s=>s.job(10,'owned')),null);assert.equal(await repo.transaction(s=>s.jobByPackage(10,rows[0].package_sha256)),null);assert.equal(await repo.transaction(s=>s.updateJob('owned',0,'queued',{state:'accepted',updatedAt:new Date()})),false);assert.equal(rows[0].state,'queued');});
test('DA07 cross-provider idempotency collision is explicit, not foreign decode or new job',async t=>{const {repo}=await fixture(t);await assert.rejects(repo.transaction(s=>s.jobByKey(10,'owned')),/PROVIDER_IDEMPOTENCY_CONFLICT/);});
