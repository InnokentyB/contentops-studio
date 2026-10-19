const test=require('node:test');const assert=require('node:assert/strict');
const path=require('node:path');const base=process.env.THREADS_SOURCE||'/source/src';
require('ts-node/register/transpile-only');
const {ThreadsService}=require(path.join(base,'services/threads.service.ts'));
const identity={id:'123',username:'tester',text:'accepted',permalink:'https://www.threads.net/@tester/post/abc',timestamp:'2026-10-19T10:00:01Z',media_type:'TEXT_POST',is_reply:false};
function mock(events){let count=0;const saved=global.fetch;global.fetch=async(url,init={})=>{events.push(init.method==='POST'?'POST '+(++count):'GET');return new Response(JSON.stringify(init.method==='POST'?{id:count===1?'456':'123'}:identity));};return()=>{global.fetch=saved;};}
test('T02 durable phase fences and provider IDs precede subsequent calls',async()=>{
 const events=[],restore=mock(events);try{await new ThreadsService().publishVerifiedText('789','synthetic-token','accepted','tester',{
  beforeCreate:async()=>events.push('create-fenced'),containerCreated:async id=>events.push('container '+id),
  beforePublish:async()=>events.push('publish-fenced'),published:async id=>events.push('post '+id)});
 assert.deepEqual(events.slice(0,6),['create-fenced','POST 1','container 456','publish-fenced','POST 2','post 123']);
 }finally{restore();}
});
test('T03 container persistence failure prevents publication POST',async()=>{
 const events=[],restore=mock(events);try{await assert.rejects(new ThreadsService().publishVerifiedText('789','synthetic-token','accepted','tester',{
 beforeCreate:async()=>{},containerCreated:async()=>{throw Error('DB unavailable');},beforePublish:async()=>{},published:async()=>{}}),/DB unavailable/);
 assert.equal(events.filter(x=>x.startsWith('POST')).length,1);}finally{restore();}
});
test('T03 post persistence failure prevents readback GET',async()=>{
 const events=[],restore=mock(events);try{await assert.rejects(new ThreadsService().publishVerifiedText('789','synthetic-token','accepted','tester',{
 beforeCreate:async()=>{},containerCreated:async()=>{},beforePublish:async()=>{},published:async()=>{throw Error('DB unavailable');}}),/DB unavailable/);
 assert.equal(events.filter(x=>x==='GET').length,0);}finally{restore();}
});
test('T06 recovery reader rejects a valid JSON body above 1MiB before parsing',async()=>{
 const saved=global.fetch;let cancelled=false;global.fetch=async()=>new Response(new ReadableStream({start(controller){
 controller.enqueue(new TextEncoder().encode(JSON.stringify({id:'789',username:'tester',padding:'x'.repeat(1024*1024)})));controller.close();},cancel(){cancelled=true;}}));
 try{await assert.rejects(new ThreadsService().readRecoveryProfile('synthetic-token',AbortSignal.timeout(1000)),error=>error.code==='THREADS_PROVIDER_RESPONSE_TOO_LARGE');}
 finally{global.fetch=saved;}
});
test('T06 recovery reader refuses redirects and never discloses response bodies',async()=>{
 const saved=global.fetch;let options;global.fetch=async(url,init)=>{options=init;return new Response('synthetic-secret',{status:302,headers:{location:'https://untrusted.invalid/secret'}});};
 try{await assert.rejects(new ThreadsService().readRecoveryPost('synthetic-token','123',AbortSignal.timeout(1000)),error=>!error.message.includes('synthetic-secret'));
 assert.equal(options.redirect,'error');}finally{global.fetch=saved;}
});
