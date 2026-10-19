import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpSessionRegistry } from '../mcp/session-lifecycle';
type Entry={server:McpServer;transport:StreamableHTTPServerTransport;credential:string;endpoint:string};
async function syntheticServer(execution?:()=>Promise<void>){
 let now=0,closed=0;
 const sessions=new McpSessionRegistry<Entry>({idleTimeoutMs:100,sweepIntervalMs:10,now:()=>now,close:async entry=>{closed++;await entry.server.close();}});
 const server=http.createServer(async(req,res)=>{
  try{
   const credential=req.headers.authorization;
   if(credential!=='Bearer synthetic-a'&&credential!=='Bearer synthetic-b'){res.writeHead(401).end();return;}
   if(!sessions.accepting){res.writeHead(503).end();return;}
   const sessionId=String(req.headers['mcp-session-id']??'');let entry=sessions.get(sessionId);
   if(sessionId&&!entry){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'Unknown MCP session'},id:null}));return;}
   if(entry&&(entry.credential!==credential||entry.endpoint!==req.url)){res.writeHead(403).end();return;}
   let body:unknown; if(req.method==='POST'){const buffers:Buffer[]=[];for await(const chunk of req)buffers.push(Buffer.from(chunk));body=JSON.parse(Buffer.concat(buffers).toString());}
   if(!entry){
    if(req.method!=='POST'){res.writeHead(404).end();return;}
    const mcp=new McpServer({name:'synthetic-memory',version:'1'});let created:Entry;
    if(execution)mcp.registerTool('synthetic_wait',{inputSchema:{}},async()=>{await execution();return {content:[]};});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true,onsessioninitialized:id=>{sessions.set(id,created);}});
    created={server:mcp,transport,credential,endpoint:req.url??''};transport.onclose=()=>{if(transport.sessionId)sessions.delete(transport.sessionId);};await mcp.connect(transport);entry=created;
   }
   const current=entry;await sessions.track(current,res,()=>current.transport.handleRequest(req,res,body),req.method==='GET'?'stream':'request');
  }catch{if(!res.headersSent)res.writeHead(500).end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('test listener unavailable');
 const endpoint=new URL(`http://127.0.0.1:${address.port}/mcp`);
 return {sessions,endpoint,advance:(ms:number)=>{now+=ms;},closed:()=>closed,shutdown:async()=>{sessions.stopAdmission();await sessions.drain();for(const id of sessions.keys())await sessions.close(id);await sessions.flush();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
async function waitDisconnected(sessions:McpSessionRegistry<Entry>):Promise<void>{
 for(let round=0;round<100;round++){if(sessions.openResponses===0&&sessions.executingRequests===0)return;await new Promise(resolve=>setTimeout(resolve,5));}
 throw Error('Synthetic HTTP connections did not quiesce within bounded wait.');
}
function sdkClient(endpoint:URL,token='synthetic-a'){
 const transport=new StreamableHTTPClientTransport(endpoint,{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
 const client=new Client({name:'memory-synthetic-client',version:'1'});return {transport,client};
}
test('real SDK expires idle session, returns 404 and reconnects by initialize; credentials/endpoint remain bound',async()=>{
 const h=await syntheticServer();const first=sdkClient(h.endpoint);const second=sdkClient(h.endpoint);
 try{
  await first.client.connect(first.transport);assert.equal(h.sessions.size,1);const id=first.transport.sessionId;assert.ok(id);
  const headers={Authorization:'Bearer synthetic-b','Mcp-Session-Id':id!,'MCP-Protocol-Version':'2025-03-26',Accept:'application/json, text/event-stream','Content-Type':'application/json'};
  const wrong=await fetch(h.endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'ping',id:2})});assert.equal(wrong.status,403);
  const unauthorized=await fetch(h.endpoint,{method:'POST',headers:{...headers,Authorization:'Bearer wrong'},body:JSON.stringify({jsonrpc:'2.0',method:'ping',id:3})});assert.equal(unauthorized.status,401);
  const wrongEndpoint=await fetch(new URL('/other',h.endpoint),{method:'POST',headers:{...headers,Authorization:'Bearer synthetic-a'},body:JSON.stringify({jsonrpc:'2.0',method:'ping',id:4})});assert.equal(wrongEndpoint.status,403);
  h.advance(101);await h.sessions.sweep();assert.equal(h.sessions.size,1); // live SDK SSE is protected
  await first.client.close();await waitDisconnected(h.sessions);
  h.advance(101);await h.sessions.sweep();assert.equal(h.sessions.size,0);assert.equal(h.closed(),1);
  const expired=await fetch(h.endpoint,{method:'POST',headers:{...headers,Authorization:'Bearer synthetic-a'},body:JSON.stringify({jsonrpc:'2.0',method:'ping',id:5})});assert.equal(expired.status,404);
  await second.client.connect(second.transport);await second.client.ping();assert.equal(h.sessions.size,1);assert.notEqual(second.transport.sessionId,id);
  await second.transport.terminateSession();await h.sessions.flush();assert.equal(h.sessions.size,0);
 }finally{await first.client.close();await second.client.close();await h.shutdown();}
});
test('real SDK synthetic session soak returns retained count to baseline and records measured RSS',async()=>{
 const h=await syntheticServer();const clients:Array<ReturnType<typeof sdkClient>>=[];
 try{
  const before=process.memoryUsage().rss;
  for(let i=0;i<60;i++){const client=sdkClient(h.endpoint);await client.client.connect(client.transport);clients.push(client);}
  const retained=h.sessions.size,peak=process.memoryUsage().rss;assert.equal(retained,60);
  for(const client of clients)await client.client.close();await waitDisconnected(h.sessions);
  h.advance(101);await h.sessions.sweep();const after=process.memoryUsage().rss;assert.equal(h.sessions.size,0);assert.equal(h.closed(),60);
  console.log(JSON.stringify({event:'memory_001_synthetic_soak',sessions_before:0,sessions_peak:retained,sessions_after:h.sessions.size,rss_before_bytes:before,rss_peak_bytes:peak,rss_after_bytes:after,savings_claim:false}));
 }finally{for(const client of clients)await client.client.close();await h.shutdown();}
});
test('real SDK disconnected tool execution remains protected until callback actually completes',async()=>{
 let release:()=>void=()=>undefined,started:()=>void=()=>undefined;const began=new Promise<void>(resolve=>{started=resolve;});
 const h=await syntheticServer(async()=>{started();await new Promise<void>(resolve=>{release=resolve;});});const client=sdkClient(h.endpoint);
 try{
  await client.client.connect(client.transport);const pending=client.client.callTool({name:'synthetic_wait',arguments:{}}).catch(()=>undefined);await began;
  await client.client.close();await new Promise(resolve=>setTimeout(resolve,30));h.advance(101);await h.sessions.sweep();assert.equal(h.sessions.size,1);assert.equal(h.closed(),0);
  let drained=false;const draining=h.sessions.drain().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);
  release();await draining;await pending;h.advance(101);await h.sessions.sweep();assert.equal(h.sessions.size,0);
 }finally{release();await client.client.close();await h.shutdown();}
});
test('real SDK shutdown rejects new initialization and can drain with a connected idle SSE',async()=>{
 const h=await syntheticServer();const client=sdkClient(h.endpoint);try{
  await client.client.connect(client.transport);await new Promise(resolve=>setTimeout(resolve,20));h.sessions.stopAdmission();
  const rejected=await fetch(h.endpoint,{method:'POST',headers:{Authorization:'Bearer synthetic-a','Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',method:'initialize',id:1,params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic',version:'1'}}})});assert.equal(rejected.status,503);assert.equal(h.sessions.size,1);
  const drained=await Promise.race([h.sessions.drain().then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),100))]);assert.equal(drained,true);
 }finally{await client.client.close();await h.shutdown();}
});
