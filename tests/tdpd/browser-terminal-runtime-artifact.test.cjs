const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist',db=require(path.join(base,'db.js'));
test.after(async()=>{await db.prisma.$disconnect();await db.pool.end()});
test('actual MCP runtime COPY closure loads all pinned producer dependencies and agrees with Owner review',()=>{
 const {terminalProgramHashes}=require(path.join(base,'services/browser_terminal_owner_review.js'));
 const producer=require(path.join(base,'../ops/terminal-operation-review/review.cjs'));
 const hashes=terminalProgramHashes();assert.equal(Object.keys(hashes).length,8);assert.deepEqual(producer.programHashes(),hashes);
 for(const value of Object.values(hashes))assert.match(value,/^[a-f0-9]{64}$/);
});
