'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const root=path.resolve(__dirname,'../..');
async function unusedPort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function server(t){const port=await unusedPort();const child=spawn(process.execPath,['-r','ts-node/register/transpile-only','-r',path.join(root,'tests/fixtures/owned-publication-http-preload.cjs'),path.join(root,'src/mcp/remote-server.ts')],{
 env:{PATH:process.env.PATH,NODE_PATH:process.env.NODE_PATH,HOME:'/tmp',TS_NODE_PROJECT:path.join(root,'tsconfig.json'),MCP_HOST:'127.0.0.1',MCP_PORT:String(port),MCP_AUTH_TOKEN:'synthetic-owner-only',MCP_PRINCIPAL_USER_ID:'701',MCP_PUBLISHER_AUTH_TOKEN:'synthetic-publisher-only',MCP_PUBLISHER_USER_ID:'702',MCP_PUBLISHER_PROJECT_ID:'71',TELEGRAM_BOT_TOKEN:'000000:synthetic-test-token-never-used-for-provider-calls'},stdio:['ignore','pipe','pipe']});
 const closed=new Promise(r=>child.once('exit',r));t.after(async()=>{child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await closed;clearTimeout(timer);});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('HTTP_FIXTURE_START_TIMEOUT')),15000);let output='';const read=b=>{output+=b.toString();if(output.includes('listening on')){clearTimeout(timer);resolve();}};child.stdout.on('data',read);child.stderr.on('data',read);child.once('exit',()=>{clearTimeout(timer);reject(Error('HTTP_FIXTURE_START_FAILED '+output.slice(-2000)));});});
 return `http://127.0.0.1:${port}`;
}
async function client(t,url,token){const c=new Client({name:'owned-principal-test',version:'1'});const transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});await c.connect(transport);t.after(()=>c.close());return c;}
function payload(result){assert.notEqual(result.isError,true);return JSON.parse(result.content.find(c=>c.type==='text').text);}
test('DA02 actual HTTP owner and scoped publisher transport retain token principal through registered command',async t=>{
 const url=await server(t);const [owner,publisher]=await Promise.all([client(t,url+'/mcp','synthetic-owner-only'),client(t,url+'/mcp/publisher','synthetic-publisher-only')]);
 const input={projectId:71,taskId:4001,dryRun:true};
 const results=await Promise.all([owner.callTool({name:'ba_publish_publication_task',arguments:input}),publisher.callTool({name:'ba_publish_publication_task',arguments:input})]);
 assert.equal(payload(results[0]).actor_id,'user:701');assert.equal(payload(results[1]).actor_id,'user:702');
 const forged=await publisher.callTool({name:'ba_publish_publication_task',arguments:{...input,actorId:'user:701'}});assert.equal(forged.isError,true);
 await assert.rejects(publisher.callTool({name:'ba_publish_publication_task',arguments:{...input,projectId:72}}));
});
