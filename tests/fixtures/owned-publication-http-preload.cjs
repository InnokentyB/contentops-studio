'use strict';
// Private fixture replaces data ports only; the actual HTTP entry, SDK, tool schema
// and publication command callback remain in use. No provider or database opens.
const Module=require('node:module'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),load=Module._load;
Module._load=function(name,parent,...args){
 if(name==='./shared'&&parent?.filename.endsWith('/src/mcp/remote-server.ts'))return {
  createPlannerMcpServer:()=>{const {McpServer}=load.call(this,'@modelcontextprotocol/sdk/server/mcp.js',parent);
   const server=new McpServer({name:'owned-http-fixture',version:'1'});
   require(path.join(root,'src/mcp/tools/task_publication_tools.ts')).registerTaskPublicationTools(server);return server;},
  shutdownMcpResources:async()=>{}
 };
 if(name.endsWith('publication_owned_route'))return {tryOwnedPublicationTask:async input=>{
  const p=require(path.join(root,'src/mcp/publication-principal.ts')).requirePublicationPrincipal(input.projectId);
  return {state:'preview',actor_id:p.actorId,profile:p.profile,project_id:input.projectId,task_id:input.taskId};
 }};
 if(name.endsWith('mcp_access_token.service')&&parent?.filename.endsWith('/src/mcp/remote-server.ts'))return {default:{authenticate:async()=>null}};
 return load.call(this,name,parent,...args);
};
