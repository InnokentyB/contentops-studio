const {test,after}=require('node:test'),assert=require('node:assert/strict');
const base=process.env.EGRESS_DIST;
const {default:db,pool}=require(base+'/db.js');
const {default:auth,hashMcpToken}=require(base+'/services/mcp_access_token.service.js');
after(async()=>{await db.$disconnect();await pool.end();});
test('actual PostgreSQL keeps revocation and membership current while throttling last-use',async()=>{
 const tag=Date.now()+'-'+Math.random().toString(16).slice(2);
 const u=await db.user.create({data:{name:'synthetic',email:tag+'@test.invalid',password_hash:'not-a-password'}});
 const p=await db.project.create({data:{name:'synthetic',slug:tag}});
 try{
  const member=await db.projectMember.create({data:{user_id:u.id,project_id:p.id,role:'editor'}});
  const token='synthetic-'+tag;
  const t=await db.mcpAccessToken.create({data:{project_id:p.id,user_id:u.id,profile:'writer',label:'synthetic',token_hash:hashMcpToken(token)}});
  await Promise.all(Array.from({length:20},()=>auth.authenticate(token,'writer')));
  const first=await db.mcpAccessToken.findUniqueOrThrow({where:{id:t.id}});
  assert.ok(first.last_used_at);
  await auth.authenticate(token,'writer');
  assert.equal((await db.mcpAccessToken.findUniqueOrThrow({where:{id:t.id}})).last_used_at.getTime(),first.last_used_at.getTime());
  await db.mcpAccessToken.update({where:{id:t.id},data:{revoked_at:new Date()}});
  assert.equal(await auth.authenticate(token,'writer'),null);
  await db.mcpAccessToken.update({where:{id:t.id},data:{revoked_at:null}});
  await db.projectMember.delete({where:{id:member.id}});
  assert.equal(await auth.authenticate(token,'writer'),null);
  assert.equal(await auth.authenticate(token,'editor'),null);
 }finally{await db.project.delete({where:{id:p.id}});await db.user.delete({where:{id:u.id}});}
});
test('backup structural fingerprint changes for a real DDL change, not a row change',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const sql=fs.readFileSync(path.resolve(__dirname,'../../ops/egress/schema-fingerprint.sql'),'utf8');
 const [{name}]=await db.$queryRawUnsafe('SELECT current_database() AS name');
 assert.equal(name,'shared_browser_synthetic');
 const fingerprint=async()=>JSON.stringify(await db.$queryRawUnsafe(sql));
 const before=await fingerprint();
 try{
  await db.$executeRawUnsafe('CREATE TABLE planner.egress_synthetic_probe (value integer)');
  const changed=await fingerprint();assert.notEqual(changed,before);
  await db.$executeRawUnsafe('INSERT INTO planner.egress_synthetic_probe VALUES (1)');
  assert.equal(await fingerprint(),changed);
 }finally{await db.$executeRawUnsafe('DROP TABLE IF EXISTS planner.egress_synthetic_probe');}
 assert.equal(await fingerprint(),before);
});
