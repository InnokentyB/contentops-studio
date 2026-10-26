const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {registerTerminalPreparationTools}=require(path.join(base,'mcp/tools/browser_terminal_preparation_tools.js'));
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
const owner={userId:17,actorId:'user:17',projectId:10,profile:'owner'},publisher={...owner,profile:'publisher'};
function boundary(principal){const tools=new Map(),calls=[];const service=new Proxy({},{get:(_t,method)=>async(args,identity)=>{calls.push({method,args,identity});return{ok:true}}});registerTerminalPreparationTools({registerTool(name,_schema,handler){tools.set(name,handler)}},service,principal);return{tools,calls};}
test('null request context cannot fall back to a captured Owner identity',async()=>{
 const s=boundary(owner),result=await withPublicationPrincipal(null,()=>s.tools.get('ba_preview_terminal_browser_evidence')({projectId:10}));
 assert.equal(result.isError,true);assert.equal(s.calls.length,0);
});
test('changed request actor, project or profile cannot reuse captured Publisher custody',async()=>{
 const s=boundary(publisher);for(const identity of [{...publisher,userId:18,actorId:'user:18'},{...publisher,projectId:11},{...publisher,profile:'owner'},{...publisher,projectId:undefined}]){
  const result=await withPublicationPrincipal(identity,()=>s.tools.get('ba_pickup_terminal_browser_preparation')({projectId:10}));assert.equal(result.isError,true);
 }assert.equal(s.calls.length,0);
});
test('matching authenticated request reaches only its scoped service identity',async()=>{
 const s=boundary(publisher),result=await withPublicationPrincipal(publisher,()=>s.tools.get('ba_pickup_terminal_browser_preparation')({projectId:10}));
 assert.equal(result.isError,false);assert.deepEqual(s.calls[0].identity,publisher);
});
