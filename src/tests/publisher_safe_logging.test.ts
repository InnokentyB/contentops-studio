import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {logToFile} from '../services/publishers/publisher_logger';
const file=path.join(__dirname,'../../logs/publisher.log');
test('publisher console and actual async file share safe envelope without raw data',async()=>{
 const lines:string[]=[];const original=console.error;console.error=(...args:unknown[])=>{lines.push(JSON.stringify(args));};
 try{
 logToFile('ERROR','[Publisher] Failed to process publication task 999 secret-cookie',{token:'private-token',body:'private-body',approvalReference:'private-reference'});
 await new Promise(resolve=>setTimeout(resolve,50));
 const content=await fs.promises.readFile(file,'utf8');
 for(const secret of ['secret-cookie','private-token','private-body','private-reference']){assert.equal(content.includes(secret),false);assert.equal(lines.join('').includes(secret),false);}
 const row=JSON.parse(content.trim().split('\n').slice(-1)[0]!);assert.deepEqual(row,JSON.parse(JSON.parse(lines[0]!)[0]));assert.equal(row.level,'ERROR');assert.ok(row.code);assert.ok(row.action);assert.equal(row.retry_allowed,false);
 }finally{console.error=original;}
});
test('successful started/published/waiting events remain distinct and unknown events are honest',async()=>{
 const lines:string[]=[];const original=console.log;console.log=(line:string)=>{lines.push(line);};
 try{
 logToFile('INFO','[Publisher] Publishing to Threads for post 123');
 logToFile('INFO','[Publisher] Successfully published post 123 to Threads: https://secret.example/private');
 logToFile('INFO','[Publisher] Task 123 is waiting on visual readiness.',{secret:'private'});
 logToFile('INFO','new unclassified private body');
 const codes=lines.map(line=>JSON.parse(line).code);assert.equal(new Set(codes).size,4);
 assert.equal(lines.join('').includes('secret.example'),false);assert.equal(lines.join('').includes('post 123'),false);assert.equal(lines.join('').includes('private'),false);
 assert.ok(JSON.parse(lines[3]!).action);
 }finally{console.log=original;}
 await new Promise(resolve=>setTimeout(resolve,50));
});
test('async file failure does not expose filesystem errors or paths',async()=>{
 const originalAppend=fs.promises.appendFile, originalError=console.error,originalInfo=console.log;
 const lines:string[]=[];console.error=(...args:unknown[])=>{lines.push(JSON.stringify(args));};console.log=()=>undefined;
 fs.promises.appendFile=async()=>{throw new Error('/private/path token=private-secret');};
 try{logToFile('INFO','unknown private message');await new Promise(resolve=>setTimeout(resolve,10));assert.equal(lines.length,1);assert.equal(lines[0]!.includes('private'),false);assert.ok(lines[0]!.includes('PUBLISHER_LOG_WRITE_FAILED'));}
 finally{fs.promises.appendFile=originalAppend;console.error=originalError;console.log=originalInfo;}
});
test('WARN sink preserves severity and safe known guard actions without serializing error payload',async()=>{
 const original=console.warn;const lines:string[]=[];console.warn=(line:string)=>{lines.push(line);};
 try{
 const error=new Error('[OWNER_RELEASE_REQUIRED] approvalReference=private-reference');
 logToFile('WARN','arbitrary private raw message',error);
 assert.equal(lines.length,1);const row=JSON.parse(lines[0]!);assert.equal(row.level,'WARN');assert.equal(row.code,'OWNER_RELEASE_REQUIRED');assert.ok(row.action.includes('owner'));assert.equal(lines[0]!.includes('private'),false);
 }finally{console.warn=original;}
 await new Promise(resolve=>setTimeout(resolve,30));
});
test('unknown circular provider data cannot escape or crash safe logging',async()=>{
 const original=console.log;const lines:string[]=[];console.log=(line:string)=>{lines.push(line);};
 try{const data:{secret:string;self?:unknown}={secret:'private-provider-token'};data.self=data;
 assert.doesNotThrow(()=>logToFile('INFO','private unclassified event',data));
 assert.equal(JSON.parse(lines[0]!).code,'PUBLISHER_EVENT_UNCLASSIFIED');assert.equal(lines[0]!.includes('private'),false);
 }finally{console.log=original;}
 await new Promise(resolve=>setTimeout(resolve,30));
});
