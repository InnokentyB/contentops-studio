import {boundedNative,nativeInvocationSchema,nativeSecretSchema,type OwnedNativeInvocation} from './owned_publication_native_protocol';
import type {OwnedNativeHooks} from './owned_publication_adapter_process';
import {runDzenAdapterNative} from './dzen_adapter_native';

type NativeRunner=(invocation:OwnedNativeInvocation,secret:{cookies:string},hooks:OwnedNativeHooks,signal:AbortSignal)=>Promise<unknown>;
/** Private process IPC only. Fixture composition roots call this reusable wire with their own offline runner. */
export function serveOwnedNativeChild(run:NativeRunner):void{
    let started=false;let done=false;let sequence=0;let nonce='';let pending:((value:void)=>void)|null=null;
    const abort=new AbortController();
    const send=(value:unknown)=>{boundedNative(value);if(process.send&&process.connected)process.send(value,error=>{if(error)abort.abort();});};
    const phase=async(operation:'mutation'|'submit',observation?:{objectId:string;accountId:string})=>{
        if(pending||abort.signal.aborted)throw Error('OWNED_NATIVE_CANCELLED');sequence++;
        await new Promise<void>((resolve,reject)=>{pending=resolve;send({kind:'phase',nonce,sequence,operation,...(observation?{observation}:{})});
            abort.signal.addEventListener('abort',()=>reject(Error('OWNED_NATIVE_CANCELLED')),{once:true});});
    };
    process.on('message',(raw:unknown)=>{void(async()=>{
        if(!raw||typeof raw!=='object')throw Error('OWNED_NATIVE_INVALID');boundedNative(raw,1048576);
        if('kind'in raw&&raw.kind==='resource_ack')return;
        if('kind'in raw&&raw.kind==='phase_ack'){
            if(!('nonce'in raw)||raw.nonce!==nonce||!('sequence'in raw)||raw.sequence!==sequence||!pending)throw Error('OWNED_NATIVE_INVALID');
            const resolve=pending;pending=null;resolve();return;
        }
        if(started||!('kind'in raw)||raw.kind!=='invoke'||!('invocation'in raw)||!('secret'in raw))throw Error('OWNED_NATIVE_INVALID');
        const invocation=nativeInvocationSchema.parse(raw.invocation);boundedNative(invocation);const secret=nativeSecretSchema.parse(raw.secret);
        started=true;nonce=invocation.nonce;
        const result=await run(invocation,secret,{beforeMutation:()=>phase('mutation'),beforeSubmit:observation=>phase('submit',observation)},abort.signal);
        done=true;send({kind:'result',nonce,result});
    })().catch(()=>{done=true;send({kind:'failure',nonce,code:abort.signal.aborted?'OWNED_NATIVE_CANCELLED':'OWNED_NATIVE_UNCERTAIN'});if(process.connected)process.disconnect?.();});});
    process.once('SIGTERM',()=>{abort.abort();if(done&&process.connected)process.disconnect?.();});process.once('SIGINT',()=>abort.abort());
    process.on('disconnect',()=>{if(!done)abort.abort();process.exitCode=done?0:1;});
}
if(require.main===module)serveOwnedNativeChild(runDzenAdapterNative);
