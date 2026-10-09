import test from 'node:test';
import assert from 'node:assert/strict';
import publisher from '../services/puppeteer_publisher.service';

test('native search image link retains sibling article title instead of deduplicating an empty heading',async t=>{
    const title='Microsoft ThinkingBox: почему успешный ответ AI-агента не доказывает результат';
    const heading={textContent:title};
    const card={textContent:`Автор ${title} Фактический сниппет.`,querySelector:(selector:string)=>selector.includes('card-article-title-link') ? heading : null};
    const anchors=[{href:'https://dzen.ru/a/asJAvMmQ8zlRn8CV?secdata=PRIVATE',textContent:'',closest:()=>card,parentElement:card},
        {href:'https://dzen.ru/a/asJAvMmQ8zlRn8CV',textContent:title,closest:()=>card,parentElement:card},
        {href:'https://dzen.ru.attacker.test/a/unsafe',textContent:title,closest:()=>card,parentElement:card}];
    const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
    Object.defineProperty(globalThis,'document',{value:{querySelectorAll:()=>anchors},configurable:true});
    t.after(()=>{if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');});
    let closed=false;
    const page={goto:async()=>null,evaluate:async(fn:unknown,input:unknown)=>{if(typeof fn !== 'function')throw new Error('EVALUATOR_REQUIRED');return Reflect.apply(fn,null,[input]);}};
    const replacements:Record<string,()=>Promise<unknown>>={launchBrowser:async()=>({newPage:async()=>page,close:async()=>{closed=true;}}),prepareDzenPage:async()=>undefined,assertDzenAuthenticated:async()=>undefined};
    for(const [name,value]of Object.entries(replacements)){
        const original=Reflect.get(publisher,name);Object.defineProperty(publisher,name,{value,configurable:true,writable:true});
        t.after(()=>Object.defineProperty(publisher,name,{value:original,configurable:true,writable:true}));
    }
    const result=await publisher.searchDzenPosts({cookies:'SYNTHETIC_ONLY=1'},'приемка результата агента',2);
    assert.equal(result.length,1);assert.equal(result[0].url,'https://dzen.ru/a/asJAvMmQ8zlRn8CV');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|secdata|attacker/);assert.equal(result[0].title,title);assert.ok(result[0].snippet.includes('Фактический сниппет'));assert.equal(closed,true);
});
