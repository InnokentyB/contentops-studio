const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {isToolAllowedForProfile}=require(path.join(base,'mcp/capabilities.js'));
const {scopeRemoteMcpRequest}=require(path.join(base,'mcp/remote-auth.js'));
const commands=['ba_inspect_browser_publication','ba_repair_browser_publication_metadata','ba_release_browser_publication',
    'ba_claim_browser_publication','ba_start_browser_submission','ba_pre_submit_browser_submission',
    'ba_confirm_browser_submission','ba_reconcile_browser_submission','ba_mark_browser_submission_uncertain','ba_diagnose_browser_publication'];
test('S6 shared controls are publisher-only; project and actor remain token-principal bound',()=>{
    for(const command of commands){assert.equal(isToolAllowedForProfile('publisher',command),true,command);
        for(const role of ['writer','editor','planner','art_director','strategist','growth_analyst','organization_researcher'])
            assert.equal(isToolAllowedForProfile(role,command),false,role+':'+command);}
    const principal={userId:2,actorId:'user:2',projectId:7,profile:'publisher'};
    const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:commands[2],arguments:{projectId:7,taskId:1136,actorId:'user:999'}}};
    const scoped=scopeRemoteMcpRequest(request,principal);assert.equal(scoped.allowed,true);
    assert.equal(scoped.body.params.arguments.actorId,'user:2');
    assert.equal(scopeRemoteMcpRequest({...request,params:{...request.params,arguments:{projectId:10}}},principal).allowed,false);
});
test('S6 registered MCP surface matches capabilities and mutations never claim read-only',()=>{
    const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
    const {registerBrowserPublicationTools}=require(path.join(base,'mcp/tools/browser_publication_tools.js'));
    const server=new McpServer({name:'synthetic-browser-contract',version:'1'});
    registerBrowserPublicationTools(server);
    assert.deepEqual(Object.keys(server._registeredTools).sort(),[...commands,'ba_authorize_browser_publication'].sort());
    assert.equal(server._registeredTools.ba_authorize_browser_publication.annotations.readOnlyHint,false);
    assert.equal(isToolAllowedForProfile('publisher','ba_authorize_browser_publication'),false);
    assert.equal(isToolAllowedForProfile('owner','ba_authorize_browser_publication'),true);
    for(const name of commands){const tool=server._registeredTools[name];
        const readonly=['ba_inspect_browser_publication','ba_diagnose_browser_publication'].includes(name);
        assert.equal(tool.annotations.readOnlyHint,readonly,name);}
});
test('Owner instruction replay retains usable work and package at the MCP serialization boundary',async()=>{
 const service=require(path.join(base,'services/browser_owner_instruction.js'));
 const original=service.authorizeBrowserPublication;
 const result={version:1,applied:true,replayed:true,browser_work_item_id:77,snapshot_sha256:'a'.repeat(64),submission_permitted:false};
 const handlers=new Map();const server={registerTool(name,_config,handler){handlers.set(name,handler);}};
 service.authorizeBrowserPublication=async()=>result;
 try{
  require(path.join(base,'mcp/tools/browser_publication_tools.js')).registerBrowserPublicationTools(server);
  const response=await handlers.get('ba_authorize_browser_publication')({});
  const payload=JSON.parse(response.content[0].text);
  assert.equal(response.isError,false);assert.equal(payload.browser_work_item_id,77);
  assert.equal(payload.applied,true);assert.equal(payload.snapshot_sha256,result.snapshot_sha256);
  assert.equal(payload.code,undefined);
 }finally{service.authorizeBrowserPublication=original;}
});
