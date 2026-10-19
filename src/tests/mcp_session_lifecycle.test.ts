import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { McpSessionRegistry, parseMcpSessionPolicy } from '../mcp/session-lifecycle';
test('idle expiry releases resources and recently active sessions remain',async()=>{
 let now=0,closed=0;const registry=new McpSessionRegistry<{name:string}>({idleTimeoutMs:100,sweepIntervalMs:10,now:()=>now,close:async()=>{closed++;}});
 const idle={name:'private-idle'},recent={name:'private-recent'};registry.set('private-idle',idle);registry.set('private-recent',recent);
 now=90;const response=new EventEmitter();await registry.track(recent,response,async()=>undefined);response.emit('finish');now=110;await registry.sweep();assert.equal(registry.has('private-idle'),false);assert.equal(registry.has('private-recent'),true);assert.equal(closed,1);registry.stop();
});
test('executing requests and open response streams are protected even past idle timeout',async()=>{
 let now=0,closed=0;const registry=new McpSessionRegistry<object>({idleTimeoutMs:100,sweepIntervalMs:10,now:()=>now,close:async()=>{closed++;}});const entry={};registry.set('session',entry);
 const response=new EventEmitter();let release:()=>void=()=>undefined;
 const running=registry.track(entry,response,()=>new Promise<void>(resolve=>{release=resolve;}));now=1000;await registry.sweep();assert.equal(closed,0);
 release();await running;now=2000;await registry.sweep();assert.equal(closed,0);response.emit('close');now=2101;await registry.sweep();assert.equal(closed,1);registry.stop();
});
test('explicit close releases server resources exactly once after active work finishes',async()=>{
 let closed=0;const registry=new McpSessionRegistry<object>({idleTimeoutMs:100,sweepIntervalMs:10,close:async()=>{closed++;}});const entry={};registry.set('session',entry);
 const response=new EventEmitter();let release:()=>void=()=>undefined;const running=registry.track(entry,response,()=>new Promise<void>(resolve=>{release=resolve;}));registry.delete('session');assert.equal(closed,0);response.emit('close');assert.equal(closed,0);release();await running;await registry.flush();assert.equal(closed,1);registry.delete('session');await registry.flush();assert.equal(closed,1);registry.stop();
});
test('cleanup failures are visible without secret or raw error disclosure',async()=>{
 const logs:string[]=[];const original=console.warn;console.warn=(value:unknown)=>{logs.push(String(value));};
 const registry=new McpSessionRegistry<object>({idleTimeoutMs:1,sweepIntervalMs:1,now:()=>100,close:async()=>{throw Error('token=private-secret');}});
 try{registry.set('private-session',{});registry.delete('private-session');await registry.flush();assert.equal(logs.length,1);assert.ok(logs[0]!.includes('MCP_SESSION_CLEANUP_FAILED'));assert.equal(logs[0]!.includes('private'),false);}finally{console.warn=original;registry.stop();}
});
test('policy defaults and invalid overrides are explicit; stopped sweeper performs no work',async()=>{
 assert.deepEqual(parseMcpSessionPolicy({}),{idleTimeoutMs:1800000,sweepIntervalMs:60000});assert.throws(()=>parseMcpSessionPolicy({MCP_SESSION_IDLE_TIMEOUT_MS:'private-invalid'}),/MCP_SESSION_POLICY_INVALID/);
 let closed=0;const registry=new McpSessionRegistry<object>({idleTimeoutMs:1,sweepIntervalMs:5,close:async()=>{closed++;}});registry.set('session',{});registry.start();registry.stop();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,0);registry.delete('session');await registry.flush();
});
test('explicit shutdown closes idle SSE resources without cancelling executing work',async()=>{
 let closed=0;const registry=new McpSessionRegistry<object>({idleTimeoutMs:100,sweepIntervalMs:10,close:async()=>{closed++;}});const streamEntry={};registry.set('stream',streamEntry);await registry.track(streamEntry,new EventEmitter(),async()=>undefined);await registry.close('stream');assert.equal(closed,1);
 const workEntry={};registry.set('working',workEntry);const response=new EventEmitter();let release:()=>void=()=>undefined;const running=registry.track(workEntry,response,()=>new Promise<void>(resolve=>{release=resolve;}));let shutdownFinished=false;const closing=registry.close('working').then(()=>{shutdownFinished=true;});await Promise.resolve();assert.equal(closed,1);assert.equal(shutdownFinished,false);release();await running;await closing;assert.equal(closed,2);registry.stop();
});
test('shutdown drain waits disconnected executing work even after transport removed its session',async()=>{
 let closed=0;const registry=new McpSessionRegistry<object>({idleTimeoutMs:1,sweepIntervalMs:1,close:async()=>{closed++;}});const entry={};registry.set('session',entry);const response=new EventEmitter();let release:()=>void=()=>undefined;
 const running=registry.track(entry,response,()=>new Promise<void>(resolve=>{release=resolve;}));response.emit('close');registry.delete('session');assert.equal(registry.size,0);
 let drained=false;const draining=registry.drain().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);assert.equal(closed,0);release();await running;await draining;assert.equal(drained,true);assert.equal(closed,1);registry.stop();
});
test('response closed before tracking cannot create a permanently retained phantom stream',async()=>{
 let now=0,closed=0;const registry=new McpSessionRegistry<object>({idleTimeoutMs:10,sweepIntervalMs:5,now:()=>now,close:async()=>{closed++;}});const entry={};registry.set('session',entry);const response=Object.assign(new EventEmitter(),{destroyed:true});await registry.track(entry,response,async()=>undefined);now=11;await registry.sweep();assert.equal(closed,1);registry.stop();
});
test('closing admission blocks a new executing operation while drain waits existing work',async()=>{
 const registry=new McpSessionRegistry<object>({idleTimeoutMs:100,sweepIntervalMs:10,close:async()=>undefined});const entry={};registry.set('session',entry);let release:()=>void=()=>undefined;const running=registry.track(entry,new EventEmitter(),()=>new Promise<void>(resolve=>{release=resolve;}));registry.stopAdmission();assert.equal(registry.accepting,false);let executed=false;
 await assert.rejects(()=>registry.track(entry,new EventEmitter(),async()=>{executed=true;}),/MCP_SESSION_CLOSING/);assert.equal(executed,false);let drained=false;const pending=registry.drain().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);release();await running;await pending;assert.equal(drained,true);registry.stop();
});
