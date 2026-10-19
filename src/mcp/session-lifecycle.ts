/** Idle-session ownership only; never cancels a tool request or changes its authenticated scope. */
export type McpSessionPolicy={idleTimeoutMs:number;sweepIntervalMs:number};
type ResponseEvents={destroyed?:boolean;writableEnded?:boolean;once(event:'finish'|'close',listener:()=>void):unknown;removeListener(event:'finish'|'close',listener:()=>void):unknown};
type Activity={lastActivityAt:number;inFlight:number;openResponses:number;closing:boolean;cleanupStarted:boolean;closeStreams:boolean;cleaned:boolean;done?:Promise<void>;finish?:()=>void};
type Options<T> = McpSessionPolicy & {now?:()=>number;close:(entry:T)=>Promise<void>};
const cleanupFailure=():void=>console.warn(JSON.stringify({event:'mcp_session_cleanup',code:'MCP_SESSION_CLEANUP_FAILED',message:'An MCP session could not release all server resources.',action:'Ask engineering to inspect session cleanup and service health. Do not retry an executing or uncertain publication because its connection closed.'}));
/** Validated deployment knobs; invalid configuration never echoes its raw value. */
export function parseMcpSessionPolicy(env:Record<string,string|undefined>=process.env):McpSessionPolicy {
 const integer=(key:string,fallback:number,max:number):number=>{
  const value=env[key]?.trim();const number=value?Number(value):fallback;
  if(!Number.isInteger(number)||number<100||number>max)throw new Error('[MCP_SESSION_POLICY_INVALID] Session lifecycle configuration must use supported integer millisecond limits.');
  return number;
 };
 return {idleTimeoutMs:integer('MCP_SESSION_IDLE_TIMEOUT_MS',1800000,86400000),sweepIntervalMs:integer('MCP_SESSION_SWEEP_INTERVAL_MS',60000,3600000)};
}
/** Map-compatible authenticated metadata plus weak activity accounting and exactly-once server cleanup. */
export class McpSessionRegistry<T extends object> {
 private readonly entries=new Map<string,T>();
 private readonly activity=new WeakMap<T,Activity>();
 private readonly pending=new Set<Promise<void>>();
 private readonly running=new Set<Promise<void>>();
 private readonly now:()=>number;
 private timer?:NodeJS.Timeout;
 private sweeping=false;
 private admissionOpen=true;
 private responses=0;
 constructor(private readonly options:Options<T>){
  if(!Number.isFinite(options.idleTimeoutMs)||options.idleTimeoutMs<=0||!Number.isFinite(options.sweepIntervalMs)||options.sweepIntervalMs<=0)throw new Error('[MCP_SESSION_POLICY_INVALID] Positive lifecycle intervals are required.');
  this.now=options.now??Date.now;
 }
 private state(entry:T):Activity {
  let state=this.activity.get(entry);
  if(!state){state={lastActivityAt:this.now(),inFlight:0,openResponses:0,closing:false,cleanupStarted:false,closeStreams:false,cleaned:false};this.activity.set(entry,state);}
  return state;
 }
 private cleanup(entry:T,state:Activity):void {
  if(!state.closing||state.cleanupStarted||state.inFlight>0||(state.openResponses>0&&!state.closeStreams))return;
  state.cleanupStarted=true;
  const task=Promise.resolve().then(()=>this.options.close(entry)).catch(cleanupFailure).finally(()=>{this.pending.delete(task);state.cleaned=true;state.finish?.();});
  this.pending.add(task);
 }
 get executingRequests():number{return this.running.size;}
 get openResponses():number{return this.responses;}
 get accepting():boolean{return this.admissionOpen;}
 get size():number{return this.entries.size;}
 has(id:string):boolean{return this.entries.has(id);}
 get(id:string):T|undefined{return this.entries.get(id);}
 keys():IterableIterator<string>{return this.entries.keys();}
 set(id:string,entry:T):this {
  if(this.entries.has(id)&&this.entries.get(id)!==entry)this.delete(id);
  this.state(entry);this.entries.set(id,entry);return this;
 }
 delete(id:string):boolean {
  const entry=this.entries.get(id);if(!entry)return false;
  this.entries.delete(id);const state=this.state(entry);state.closing=true;this.cleanup(entry,state);return true;
 }
 /** Protect request execution independently from response/socket closure; protect SSE after handler return. */
 async track<R>(entry:T,response:ResponseEvents,run:()=>Promise<R>,kind:'request'|'stream'='request'):Promise<R>{
  if(!this.admissionOpen)throw new Error('[MCP_SESSION_CLOSING] Gateway is draining; reconnect after restart without replaying uncertain operations.');
  const state=this.state(entry);if(kind==='request')state.inFlight++;state.openResponses++;this.responses++;state.lastActivityAt=this.now();
  let finish:()=>void=()=>undefined;const running=new Promise<void>(resolve=>{finish=resolve;});if(kind==='request')this.running.add(running);
  let ended=false;
  const end=()=>{if(ended)return;ended=true;response.removeListener('finish',end);response.removeListener('close',end);state.openResponses--;this.responses--;state.lastActivityAt=this.now();this.cleanup(entry,state);};
  response.once('finish',end);response.once('close',end);if(response.destroyed||response.writableEnded)end();
  try{return await run();}
  finally{if(kind==='request')state.inFlight--;state.lastActivityAt=this.now();this.cleanup(entry,state);if(kind==='request')this.running.delete(running);finish();}
 }
 /** Non-overlapping sweeps expire only quiescent sessions; retained work is never cancelled. */
 async sweep():Promise<void>{
  if(this.sweeping)return;this.sweeping=true;
  try{const now=this.now();for(const [id,entry] of this.entries){const state=this.state(entry);if(state.inFlight===0&&state.openResponses===0&&now-state.lastActivityAt>=this.options.idleTimeoutMs)this.delete(id);}await this.flush();}
  finally{this.sweeping=false;}
 }
 /** Unreferenced timer cannot keep process shutdown alive. */
 start():void{if(this.timer)return;this.timer=setInterval(()=>{void this.sweep().catch(cleanupFailure);},this.options.sweepIntervalMs);this.timer.unref();}
 stop():void{if(this.timer)clearInterval(this.timer);this.timer=undefined;}
 async flush():Promise<void>{await Promise.all([...this.pending]);}
 /** Explicit process shutdown closes response streams after executing work finishes; idle expiry never does. */
 async close(id:string):Promise<void>{const entry=this.entries.get(id);if(!entry)return;this.entries.delete(id);await this.dispose(entry);}
 /** Release a connected but not yet initialized transport rejected during shutdown admission. */
 async dispose(entry:T):Promise<void>{
  const state=this.state(entry);if(state.cleaned)return;state.closeStreams=true;state.closing=true;
  if(!state.done)state.done=new Promise<void>(resolve=>{state.finish=resolve;});
  this.cleanup(entry,state);await state.done;
 }
 /** Stop new requests synchronously before draining already executing operations. */
 stopAdmission():void{this.admissionOpen=false;this.stop();}
 /** Drain actual executions, including disconnected sessions already removed from the retained map. */
 async drain():Promise<void>{while(this.running.size)await Promise.all([...this.running]);await this.flush();}
}
