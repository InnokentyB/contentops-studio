require('ts-node/register/transpile-only');
const test=require('node:test');const assert=require('node:assert/strict');
const {fixture}=require('../fixtures/dzen1002-native.cjs');
const {runDzen1002NativeSequence}=require('../../src/services/puppeteer/dzen1002_publisher_page.ts');
function ports(e,log){return {identity:async()=>{log.push('identity');},compose:async()=>{log.push('compose');return e.primary.objectId;},readPrimary:async()=>{log.push('primary');return e.primary;},readCover:async()=>{log.push('cover');return e.coverBytes;},openDialog:async()=>{log.push('dialog');},submit:async()=>{log.push('submit');return e.submit;},readStudio:async()=>{log.push('studio');return e.studio;},now:()=>e.observedAt};}
test('R01 native sequence fences mutation and submit, verifies native readback',async()=>{const {claim,evidence}=fixture();const log=[];const receipt=await runDzen1002NativeSequence(claim,{beforeMutation:async()=>{log.push('start');},beforeSubmit:async()=>{log.push('fence');}},ports(evidence,log));assert.equal(receipt.objectId,evidence.studio.id);assert.deepEqual(log,['identity','start','compose','primary','cover','dialog','primary','cover','fence','submit','studio','primary','cover']);});
test('R05 drift at submit boundary performs zero final clicks',async()=>{const {claim,evidence}=fixture();const log=[];await assert.rejects(runDzen1002NativeSequence(claim,{beforeMutation:async()=>{},beforeSubmit:async()=>{throw Error('DRIFT');}},ports(evidence,log)),/DRIFT/);assert.ok(!log.includes('submit'));});
test('R05 wrong native pre-submit body never submits',async()=>{const {claim,evidence}=fixture();evidence.primary.body+='extra';const log=[];await assert.rejects(runDzen1002NativeSequence(claim,{beforeMutation:async()=>{},beforeSubmit:async()=>{}},ports(evidence,log)),/DZEN1002_NATIVE_UNCERTAIN/);assert.ok(!log.includes('submit'));});
test('R01 fake Puppeteer Page runs real fixed native route, editor and submit extraction',async()=>{
 const {claim,evidence:e}=fixture();const log=[];let location='about:blank';
 const {dzen1002PagePorts}=require('../../src/services/puppeteer/dzen1002_publisher_page.ts');
 const page={goto:async url=>{location=url;log.push(['goto',url]);},url:()=>location,
  waitForSelector:async()=>({evaluate:async()=>false,type:async text=>{log.push(['type',text]);}}),
  click:async selector=>{log.push(['click',selector]);if(selector.includes('Написать'))location=`https://dzen.ru/profile/editor/id/${e.primary.accountId}/${e.primary.objectId}/edit`;},
  waitForFunction:async()=>{},$$:async()=>[{evaluate:async()=>true,click:async()=>log.push(['click','[data-testid="publish-btn"]'])}],
  evaluate:async(fn,input)=>{
   if(input.title)return {title:e.primary.title,body:e.primary.body};
   if(input.binary)return Array.from(e.coverBytes);
   if(input.url.includes('/publishers/'))return JSON.stringify({publisher:{id:e.primary.accountId},accessData:{canWrite:true}});
   if(input.url.includes('/publication/'))return JSON.stringify({publications:[{id:e.primary.objectId,publisherId:e.primary.accountId,content:{preview:{image:{id:e.primary.cover.imageId,sizes:{orig:{url:e.primary.cover.url}}}}}}]});
   return JSON.stringify({publications:[e.studio]});
  },waitForResponse:async predicate=>{const response={url:()=>`https://dzen.ru/editor-api/v2/publisher/${e.primary.accountId}/publication/${e.primary.objectId}/publish`,request:()=>({method:()=> 'POST'}),status:()=>200,headers:()=>({'content-length':String(Buffer.byteLength(JSON.stringify({publication:e.submit})))}),text:async()=>JSON.stringify({publication:e.submit})};assert.equal(predicate(response),true);return response;}
 };
 const native=dzen1002PagePorts(page,claim,async()=>{log.push(['upload']);});native.now=()=>e.observedAt;
 const receipt=await runDzen1002NativeSequence(claim,{beforeMutation:async()=>log.push(['fence','start']),beforeSubmit:async()=>log.push(['fence','submit'])},native);
 assert.equal(receipt.url,e.studio.commonUrl);assert.ok(log.some(x=>x[0]==='upload'));assert.equal(log.filter(x=>x[0]==='click'&&x[1]==='[data-testid="publish-btn"]').length,1);
 assert.ok(log.every(x=>x[0]!=='goto'||!x[1].includes('/a/')));
});
function dialogPage(t){
 class Button{constructor(){this.innerText='Опубликовать';this.isConnected=true;this.disabled=false;this.hidden=false;}getBoundingClientRect(){return {width:this.hidden?0:100,height:30};}getAttribute(){return null;}closest(){return {};}}
 const nodes=[new Button()];const state={clicks:0,waits:0,nodes};
 for(const [key,value]of Object.entries({HTMLButtonElement:Button,document:{querySelectorAll:()=>state.nodes},getComputedStyle:()=>({display:'block',visibility:'visible'})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 const page={click:async()=>{},waitForSelector:async()=>{},$$:async()=>state.nodes.map(node=>({evaluate:async fn=>fn(node),click:async()=>{state.clicks++;}})),waitForResponse:async()=>{state.waits++;throw Error('must not wait for rejected final control');}};
 const {dzen1002PagePorts}=require('../../src/services/puppeteer/dzen1002_publisher_page.ts');
 return {...state,get nodes(){return state.nodes;},set nodes(value){state.nodes=value;},state,Button,native:dzen1002PagePorts(page,fixture().claim,async()=>{})};
}
test('R08 duplicate visible enabled final dialog controls reject before submit',async t=>{const f=dialogPage(t);f.nodes.push(new f.Button());await assert.rejects(f.native.openDialog(),/DZEN1002_NATIVE_UNCERTAIN/);assert.equal(f.state.clicks,0);});
for(const [name,change]of Object.entries({replaced:f=>{f.nodes[0].isConnected=false;f.nodes=[new f.Button()];},disconnected:f=>{f.nodes[0].isConnected=false;},disabled:f=>{f.nodes[0].disabled=true;},hidden:f=>{f.nodes[0].hidden=true;}}))test('R08 retained final control '+name+' rejects without reselect or click',async t=>{const f=dialogPage(t);await f.native.openDialog();change(f);await assert.rejects(f.native.submit('synthetic1002'),/DZEN1002_NATIVE_UNCERTAIN/);assert.equal(f.state.clicks,0);assert.equal(f.state.waits,0);});
