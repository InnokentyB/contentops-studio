import {checkedOwnedResources,closeOwnedProcessResources,type OwnedNativeResource} from './owned_publication_adapter_resources';
import {fork} from 'child_process';
import {isAbsolute} from 'path';
import {randomBytes} from 'crypto';
import type {OwnedPublicationPackage,OwnedPublicationClaim,OwnedPublicationReceipt,OwnedPublicationInventory} from './owned_publication_contract';
import {ownedReceiptSchema} from './owned_publication_contract';
import {boundedNative,nativeChildSchema,nativeInvocationSchema,nativeSecretSchema,nativeInventorySchema,type OwnedNativeInvocation} from './owned_publication_native_protocol';

export interface OwnedProcessRegistration{executable:string;modulePath:string;browserPath?:string}
export interface OwnedNativeHooks{beforeMutation:()=>Promise<void>;beforeSubmit:(observation?:{objectId:string;accountId:string})=>Promise<void>}
export interface OwnedProcessInput{operation:'inventory'|'publish'|'readback';package:OwnedPublicationPackage;claim?:OwnedPublicationClaim}
/** Internal fixed-registration transport. It accepts no user request executable or permission flags. */
export function invokeOwnedPublicationProcess(registration:OwnedProcessRegistration,input:OwnedProcessInput,secret:{cookies:string},
    hooks:OwnedNativeHooks,signal?:AbortSignal,deadline=Date.now()+230000):Promise<OwnedPublicationReceipt|OwnedPublicationInventory|null>{
    if(!Number.isFinite(deadline)||Date.now()>=deadline||signal?.aborted)return Promise.reject(Error('OWNED_NATIVE_CANCELLED'));
    const now=Date.now(),workDeadline=Math.min(deadline,now+230000);
    const nonce=randomBytes(32).toString('hex');
    const invocation:OwnedNativeInvocation=nativeInvocationSchema.parse({version:'owned-native-v1',nonce,deadline:workDeadline,...input});
    boundedNative(invocation);nativeSecretSchema.parse(secret);boundedNative(secret,1048576);
    if(!isAbsolute(registration.executable)||!isAbsolute(registration.modulePath))throw Error('OWNED_NATIVE_REGISTRATION_INVALID');
    if(signal?.aborted)return Promise.reject(Error('OWNED_NATIVE_CANCELLED'));
    return new Promise((resolve,reject)=>{
        const env:NodeJS.ProcessEnv={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TZ:'UTC',NODE_PATH:registration.modulePath};
        if(registration.browserPath)env.PLAYWRIGHT_BROWSERS_PATH=registration.browserPath;
        const child=fork(registration.executable,[],{env,execArgv:[],stdio:['ignore','ignore','pipe','ipc'],detached:true,serialization:'json'});
        let resources=new Map<number,OwnedNativeResource>();let cleaning=false;const pendingWork=new Set<Promise<void>>();
        let completed=false;let sequence=0;let phaseBusy=false;let submittedObjectId:string|undefined;let outcome:OwnedPublicationReceipt|OwnedPublicationInventory|null|undefined;
        let failure:Error|undefined;let stderrBytes=0;let stopTimer:NodeJS.Timeout|undefined;let stoppedAt:number|undefined;
        const stop=()=>{stoppedAt??=Date.now();void closeOwnedProcessResources(child.pid!,resources,nonce,Math.min(stoppedAt+8500,workDeadline+8500)).catch(()=>{failure=Error('OWNED_NATIVE_CLEANUP_FAILED');});if(child.connected)child.disconnect();if(!stopTimer)stopTimer=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{failure=Error('OWNED_NATIVE_CLEANUP_FAILED');}},Math.max(1,Math.min(9000,workDeadline+9000-Date.now())));try{process.kill(-child.pid!,'SIGTERM');}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))failure=Error('OWNED_NATIVE_CLEANUP_FAILED');}};
        const timer=setTimeout(()=>{failure=Error('OWNED_NATIVE_TIMEOUT');stop();},Math.max(1,Math.min(220000,workDeadline-now)));
        const hard=setTimeout(()=>{failure=Error('OWNED_NATIVE_TIMEOUT');try{process.kill(-child.pid!,'SIGKILL');}catch{failure=Error('OWNED_NATIVE_CLEANUP_FAILED');}},Math.max(1,Math.min(229000,workDeadline-now+9000)));
        const abort=()=>{failure=Error('OWNED_NATIVE_CANCELLED');stop();};signal?.addEventListener('abort',abort,{once:true});
        const finish=()=>{if(completed)return;completed=true;clearTimeout(timer);clearTimeout(hard);if(stopTimer)clearTimeout(stopTimer);signal?.removeEventListener('abort',abort);
            if(failure)reject(failure);else if(outcome!==undefined)resolve(outcome);else reject(Error('OWNED_NATIVE_UNCERTAIN'));};
        child.stderr?.on('data',(bytes:Buffer)=>{stderrBytes+=bytes.length;if(stderrBytes>16384){failure=Error('OWNED_NATIVE_OUTPUT_LIMIT');stop();}});
        const end=()=>{if(cleaning)return;cleaning=true;
            const cleanup=closeOwnedProcessResources(child.pid!,resources,nonce,stoppedAt===undefined?undefined:Math.min(stoppedAt+8500,workDeadline+8500)).catch(()=>{failure=Error('OWNED_NATIVE_CLEANUP_FAILED');});
            void Promise.allSettled([...pendingWork,cleanup]).then(()=>finish());
        };
        child.once('error',()=>{failure=Error('OWNED_NATIVE_PROCESS_FAILED');stop();end();});
        child.once('exit',end);
        child.on('message',(raw:unknown)=>{if(cleaning||completed)return; // Shutdown is terminal; late IPC cannot run another fence.
            const work=(async()=>{
            boundedNative(raw);const message=nativeChildSchema.parse(raw);if(message.nonce!==nonce)throw Error('OWNED_NATIVE_BINDING_INVALID');
            if(message.kind==='resources'){if(resources.size)throw Error('OWNED_NATIVE_RESOURCE_INVALID');resources=checkedOwnedResources(child.pid!,message.resources);
                child.send({kind:'resource_ack',nonce});return;}
            if(message.kind==='failure'){failure=Error(message.code);stop();return;}
            if(message.kind==='result'){
                if(outcome!==undefined||phaseBusy||!resources.size)throw Error('OWNED_NATIVE_PROTOCOL_INVALID');
                if(input.operation==='inventory'){
                    const result=nativeInventorySchema.parse(message.result);
                    if(result.accountId!==input.package.accountId||result.packageDigest!==input.package.digest)throw Error('OWNED_NATIVE_BINDING_INVALID');outcome=result;
                }else if(message.result===null&&input.operation==='readback')outcome=null;
                else{
                    const result=ownedReceiptSchema.parse(message.result),claim=input.claim;
                    if(!claim||input.operation==='publish'&&sequence!==2||result.attemptId!==claim.attemptId||result.key!==claim.key
                        ||result.generation!==claim.generation||result.accountId!==input.package.accountId||result.packageDigest!==input.package.digest
                        ||result.bodySha256!==input.package.bodySha256||result.assetSha256!==input.package.assetSha256||result.title!==input.package.title
                        ||result.objectId!==(input.operation==='publish'?submittedObjectId:claim.nativeObjectId)||result.url!==`https://dzen.ru/a/${result.objectId}`)throw Error('OWNED_NATIVE_BINDING_INVALID');outcome=result;
                }
                child.disconnect();return;
            }
            if(Date.now()>=workDeadline||signal?.aborted||!resources.size||input.operation!=='publish'||phaseBusy||message.sequence!==sequence+1
                ||message.operation!==(sequence===0?'mutation':'submit')||sequence>=2)throw Error('OWNED_NATIVE_PHASE_INVALID');
            phaseBusy=true;
            if(message.operation==='mutation')await hooks.beforeMutation();else{
                if(!message.observation||message.observation.accountId!==input.package.accountId)throw Error('OWNED_NATIVE_BINDING_INVALID');
                await hooks.beforeSubmit(message.observation);submittedObjectId=message.observation.objectId;
            }
            sequence++;phaseBusy=false;
            if(child.connected)child.send({kind:'phase_ack',nonce,sequence},error=>{if(error){failure=Error('OWNED_NATIVE_IPC_FAILED');stop();}});
        })();pendingWork.add(work);void work.catch(()=>{failure??=Error('OWNED_NATIVE_UNCERTAIN');stop();}).finally(()=>pendingWork.delete(work));});
        child.send({kind:'invoke',invocation,secret},error=>{if(error){failure=Error('OWNED_NATIVE_IPC_FAILED');stop();}});
    });
}
