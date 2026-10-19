const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {registerOwnerRepairTools}=require(path.join(base,'mcp/tools/owner_repair_tools.js'));
test('REL05 actual MCP exposes reusable reassessment with internal-only mutation annotations',async()=>{
 const server=new McpServer({name:'synthetic-visual',version:'1'});registerOwnerRepairTools(server);
 const client=new Client({name:'synthetic-operator',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(a);await client.connect(b);const {tools}=await client.listTools();const tool=tools.find(t=>t.name==='ba_request_publication_visual_reassessment');
 assert.ok(tool,'Owner can discover the supported generic reassessment operation');assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.openWorldHint,false);
 const result=await client.callTool({name:tool.name,arguments:{projectId:-1}});assert.equal(result.isError,true);}
 finally{await client.close();await server.close();}
});
test('REL05 remote profile keeps reassessment Owner-only and binds tenant/actor before command',()=>{
 const {isToolAllowedForProfile}=require(path.join(base,'mcp/capabilities.js'));const {scopeRemoteMcpRequest}=require(path.join(base,'mcp/remote-auth.js'));
 const name='ba_request_publication_visual_reassessment';assert.equal(isToolAllowedForProfile('owner',name),true);for(const role of ['writer','editor','publisher','planner','art_director','strategist','growth_analyst','organization_researcher'])assert.equal(isToolAllowedForProfile(role,name),false);
 const principal={userId:2,actorId:'user:2',projectId:7,profile:'owner'};const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{projectId:7,actorId:'user:999'}}};const scoped=scopeRemoteMcpRequest(body,principal);assert.equal(scoped.allowed,true);assert.equal(scoped.body.params.arguments.actorId,'user:2');assert.equal(scopeRemoteMcpRequest({...body,params:{name,arguments:{projectId:10}}},principal).allowed,false);
});
