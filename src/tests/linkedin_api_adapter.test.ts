import test from 'node:test';
import assert from 'node:assert/strict';
import {LinkedInApiAdapter} from '../services/linkedin_api_adapter';
const author='urn:li:person:synthetic',token='synthetic-private-token';
const post='urn:li:share:123456';
test('public send uses REST Posts and retains trusted response object ID',async()=>{
 const calls:Array<{url:string;init:RequestInit|undefined}>=[];
 const adapter=new LinkedInApiAdapter({request:async(url,init)=>{calls.push({url:String(url),init});return new Response(null,{status:201,headers:{'x-restli-id':post}});}});
 assert.equal(await adapter.publish({author,token,text:'Approved body',signal:AbortSignal.timeout(1000)}),post);
 assert.equal(calls[0].url,'https://api.linkedin.com/rest/posts');assert.equal(calls[0].init?.redirect,'error');
 assert.equal(JSON.parse(String(calls[0].init?.body)).commentary,'Approved body');
});
test('accepted image upload failure cannot downgrade into public text send',async()=>{
 let posts=0;const adapter=new LinkedInApiAdapter({request:async(url)=>{if(String(url).includes('/posts'))posts++;return new Response('sensitive-body-'+token,{status:500});}});
 await assert.rejects(adapter.initializeImage({author,token,signal:AbortSignal.timeout(1000)}),error=>error instanceof Error&&!error.message.includes(token));assert.equal(posts,0);
});
test('malicious upload destination never receives accepted bytes',async()=>{
 let calls=0;const adapter=new LinkedInApiAdapter({request:async()=>{calls++;return new Response(null,{status:201});}});
 for(const url of ['http://localhost/a','https://api.linkedin.com.attacker.example/a','https://127.0.0.1/a','https://user:pass@www.linkedin.com/a'])await assert.rejects(adapter.uploadImage(url,Buffer.from('accepted'),AbortSignal.timeout(1000)));
 assert.equal(calls,0);
});
test('missing identity after accepted public send is UNKNOWN without retry',async()=>{
 let calls=0;const adapter=new LinkedInApiAdapter({request:async()=>{calls++;return new Response(null,{status:201});}});
 await assert.rejects(adapter.publish({author,token,text:'Approved body',signal:AbortSignal.timeout(1000)}),/LINKEDIN_API_UNKNOWN/);assert.equal(calls,1);
});
test('image readiness requires correct owner and AVAILABLE',async()=>{
 const adapter=new LinkedInApiAdapter({request:async()=>Response.json({id:'urn:li:image:abc',owner:'urn:li:person:other',status:'AVAILABLE'})});
 await assert.rejects(adapter.readImage('urn:li:image:abc',{author,token,signal:AbortSignal.timeout(1000)}),/LINKEDIN_API/);
});
test('ordinary accepted punctuation is escaped as literal LittleText and decoded on GET',async()=>{
 const body='Accepted (plain) #tag and under_score @literal | pipe \\ slash';let sent='';
 const adapter=new LinkedInApiAdapter({request:async(url,init)=>{if(init?.method==='POST'){sent=JSON.parse(String(init.body)).commentary;return new Response(null,{status:201,headers:{'x-restli-id':post}});}return Response.json({id:post,author,commentary:sent,lifecycleState:'PUBLISHED',visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED'},publishedAt:1});}});
 await adapter.publish({author,token,text:body,signal:AbortSignal.timeout(1000)});assert.equal(sent,'Accepted \\(plain\\) \\#tag and under\\_score \\@literal \\| pipe \\\\ slash');
 assert.equal((await adapter.readPost(post,{author,token,signal:AbortSignal.timeout(1000)})).commentary,body);
});
test('unapproved rich LittleText mention cannot be verified as plain accepted body',async()=>{
 const adapter=new LinkedInApiAdapter({request:async()=>Response.json({id:post,author,commentary:'Hello @[Other](urn:li:person:other)',lifecycleState:'PUBLISHED',visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED'},publishedAt:1})});
 await assert.rejects(adapter.readPost(post,{author,token,signal:AbortSignal.timeout(1000)}),/LINKEDIN_API_CONFLICT/);
});
test('documented text-only GET may return empty content object',async()=>{
 const adapter=new LinkedInApiAdapter({request:async()=>Response.json({id:post,author,commentary:'Accepted body',content:{},lifecycleState:'PUBLISHED',visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED'},publishedAt:1})});
 assert.equal((await adapter.readPost(post,{author,token,signal:AbortSignal.timeout(1000)})).commentary,'Accepted body');
});
