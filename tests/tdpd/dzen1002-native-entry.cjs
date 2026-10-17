require('ts-node/register/transpile-only');
const test=require('node:test');const assert=require('node:assert/strict');
const {fixture}=require('../fixtures/dzen1002-native.cjs');
const {publishDzen1002Native,dzen1002NativeRequest}=require('../../src/services/puppeteer/dzen1002_publisher.ts');
test('R03 unresolved operation never accesses claimed package or secrets',async()=>{const {claim}=fixture();Object.defineProperty(claim,'package',{get(){throw Error('SECRET_OR_PACKAGE_READ');}});await assert.rejects(publishDzen1002Native(claim,{beforeMutation:async()=>{throw Error('MUTATION');},beforeSubmit:async()=>{throw Error('SUBMIT');}}),/DZEN1002_ACTION_SCOPE_UNRESOLVED/);});
test('R08 native request policy blocks forbidden network, mutations before fence and public article navigation',()=>{
 for(const url of ['http://dzen.ru/','https://localhost/','https://evil.test/','https://dzen.ru/a/anything','https://dzen.ru/editor-api/v2/delete','https://dzen.ru/profile/editor/id/foreign/publications'])assert.equal(dzen1002NativeRequest('GET',url,'readonly'),false,url);
 assert.equal(dzen1002NativeRequest('POST','https://dzen.ru/editor-api/v2/add-image','readonly'),false);
 assert.equal(dzen1002NativeRequest('POST','https://dzen.ru/editor-api/v2/add-image','editing'),true);
 assert.equal(dzen1002NativeRequest('POST','https://dzen.ru/editor-api/v2/publisher/6a8029aba055ec36033bf81c/publication/x/publish','editing'),false);
 assert.equal(dzen1002NativeRequest('POST','https://dzen.ru/editor-api/v2/publisher/6a8029aba055ec36033bf81c/publication/x/publish','submitting','x'),true);
});
function offlineServer(t,{failConfig=false}={}){
 const Module=require('node:module');const original=Module._load;const state={closed:0,launched:0};
 const guard=require('../../src/services/dzen1002_action_restriction.ts');
 t.mock.method(guard,'requireDzen1002Action',()=>{}); // synthetic internal test only, production has no permission seam
 t.mock.method(Module,'_load',function(request,parent,...rest){
  if(parent?.filename.endsWith('/puppeteer/dzen1002_publisher.ts')){
   if(request==='../../db')return {__esModule:true,default:{socialChannel:{findFirst:async()=>({type:'dzen',config:{}})}}};
   if(request==='../../utils/channel.utils')return {__esModule:true,resolveEffectiveChannelConfig:()=>{if(failConfig)throw Error('synthetic-secret-must-not-leak');return {channel_id:'6a8029aba055ec36033bf81c',cookies:'synthetic=offline-only'};}};
   if(request==='puppeteer')return {__esModule:true,default:{launch:async options=>{state.launched++;state.options=options;return {newPage:async()=>{throw Error('synthetic-native-failure');},close:async()=>{state.closed++;}};}}};
  }
  return original.call(this,request,parent,...rest);
 });
 const bytes=require('../fixtures/dzen1002-native.cjs').fixture().evidence.coverBytes;
 t.mock.method(globalThis,'fetch',async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));
 return state;
}
test('R06 server browser closes when new Page fails; errors are sanitized',async t=>{const state=offlineServer(t);await assert.rejects(publishDzen1002Native(fixture().claim,{beforeMutation:async()=>{},beforeSubmit:async()=>{}}),error=>error.message.includes('DZEN1002_NATIVE_UNCERTAIN')&&!error.message.includes('synthetic-native-failure'));assert.equal(state.launched,1);assert.equal(state.closed,1);});
test('R03 decrypted config errors cannot expose secret or launch browser',async t=>{const state=offlineServer(t,{failConfig:true});await assert.rejects(publishDzen1002Native(fixture().claim,{beforeMutation:async()=>{},beforeSubmit:async()=>{}}),error=>error.message.includes('DZEN1002_NATIVE_UNCERTAIN')&&!error.message.includes('synthetic-secret'));assert.equal(state.launched,0);});
function assertSandboxEnabled(options){
 assert.equal(options.headless,true);
 assert.equal((options.args||[]).some(arg=>/^--(?:no-sandbox|disable-setuid-sandbox)(?:=|$)/.test(arg)),false);
}
test('native publisher preserves Chromium sandbox defaults',async t=>{
 const state=offlineServer(t);
 await assert.rejects(publishDzen1002Native(fixture().claim,{beforeMutation:async()=>{},beforeSubmit:async()=>{}}),/DZEN1002_NATIVE_UNCERTAIN/);
 assertSandboxEnabled(state.options);
 assert.equal(state.closed,1);
});
test('native inventory preserves Chromium sandbox defaults and closes failed page',async t=>{
 const puppeteer=require('puppeteer').default;
 let options;let closed=0;
 t.mock.method(puppeteer,'launch',async value=>{options=value;return {newPage:async()=>{throw Error('synthetic-page-failed');},close:async()=>{closed++;}};});
 const {readDzen1002Inventory}=require('../../src/services/dzen1002_inventory_browser.ts');
 await assert.rejects(readDzen1002Inventory({cookies:'synthetic=offline-only',channel_id:fixture().claim.package.accountId}),/synthetic-page-failed/);
 assertSandboxEnabled(options);
 assert.equal(closed,1);
});
