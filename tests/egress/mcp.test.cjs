const {test}=require('node:test');const assert=require('node:assert/strict');
const prisma=require(process.env.EGRESS_DIST+'/db.js').default;
const auth=require(process.env.EGRESS_DIST+'/services/mcp_access_token.service.js').default;
test('real authentication keeps fresh token/membership checks and throttles metadata atomically',async()=>{
 const saved={find:prisma.mcpAccessToken.findUnique,update:prisma.mcpAccessToken.update,
 updateMany:prisma.mcpAccessToken.updateMany,member:prisma.projectMember.findUnique};
 let revoked=false,member=true,updates=0,reads=0,last=null;
 prisma.mcpAccessToken.findUnique=async args=>{
  reads++;assert.ok(args.select,'must select minimum credential fields');
  assert.equal(args.select.token_hash,undefined);
  return {id:1,profile:'publisher',project_id:7,organization_id:null,user_id:2,expires_at:null,revoked_at:revoked?new Date():null};
 };
 prisma.projectMember.findUnique=async()=>member?{role:'publisher'}:null;
 prisma.mcpAccessToken.update=async()=>assert.fail('full-row UPDATE returns credential material');
 prisma.mcpAccessToken.updateMany=async args=>{
  assert.ok(args.where.OR);assert.equal(args.where.revoked_at,null);
  if(!last||last<args.where.OR[1].last_used_at.lt){last=args.data.last_used_at;updates++;return {count:1};}return {count:0};
 };
 try{
  const a=await auth.authenticate('synthetic','publisher');assert.equal(a.principal.projectId,7);
  await auth.authenticate('synthetic','publisher');assert.equal(updates,1);
  revoked=true;assert.equal(await auth.authenticate('synthetic','publisher'),null);
  revoked=false;member=false;assert.equal(await auth.authenticate('synthetic','publisher'),null);
  assert.equal(reads,4);
 }finally{prisma.mcpAccessToken.findUnique=saved.find;prisma.mcpAccessToken.update=saved.update;
 prisma.mcpAccessToken.updateMany=saved.updateMany;prisma.projectMember.findUnique=saved.member;}
});
test('usage coalesces concurrent calls, retries failures and expires without caching authorization',async()=>{
 const {createMcpUsageTouch}=require(process.env.EGRESS_DIST+'/services/mcp_usage_touch.js');
 let now=0,calls=0;const touch=createMcpUsageTouch(()=>now);
 await Promise.all(Array.from({length:100},()=>touch(1,async()=>{calls++;})));assert.equal(calls,1);
 now=60000;await touch(1,async()=>{calls++;});assert.equal(calls,2);
 await assert.rejects(touch(2,async()=>{throw Error('audit-store');}),/audit-store/);
 await touch(2,async()=>{calls++;});assert.equal(calls,3);
});
