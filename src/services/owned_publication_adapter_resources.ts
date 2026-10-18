import {readFileSync,readdirSync,openSync,readSync,closeSync} from 'fs';
import {z} from 'zod';
export const ownedResourceSchema=z.object({pid:z.number().int().positive(),start:z.string().regex(/^\d+$/)}).strict();
export type OwnedNativeResource=z.infer<typeof ownedResourceSchema>;
function state(pid:number):{parent:number;group:number;start:string;dead:boolean}|null{
    try{const text=readFileSync(`/proc/${pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');
        return {parent:Number(fields[1]),group:Number(fields[2]),start:fields[19],dead:fields[0]==='Z'};
    }catch(error){if(error instanceof Error&&'code'in error&&['ENOENT','ESRCH'].includes(String(error.code)))return null;throw Error('OWNED_NATIVE_CLEANUP_FAILED');}
}
/** Correlation marker only: no package, cookie or action authority is encoded in this fixed argument. */
export function ownedNativeResourceArgument(nonce:string):string{
    if(!/^[a-f0-9]{64}$/.test(nonce))throw Error('OWNED_NATIVE_RESOURCE_INVALID');return `--owned-publication-resource=${nonce}`;
}
function boundedProcFile(path:string):string|null{
    let fd:number|undefined;
    try{fd=openSync(path,'r');const bytes=Buffer.alloc(65537),length=readSync(fd,bytes,0,bytes.length,0);if(length>65536)throw Error('OWNED_NATIVE_RESOURCE_LIMIT');return bytes.subarray(0,length).toString('utf8');}
    catch(error){if(error instanceof Error&&'code'in error&&['ENOENT','ESRCH'].includes(String(error.code)))return null;throw Error('OWNED_NATIVE_CLEANUP_FAILED');}
    finally{if(fd!==undefined)closeSync(fd);}
}
async function findOwnedStartupResources(rootPid:number,nonce:string,deadline:number):Promise<Map<number,OwnedNativeResource>>{
    const marker=ownedNativeResourceArgument(nonce),uid=process.getuid?.();if(uid===undefined)throw Error('OWNED_NATIVE_RESOURCE_UNSUPPORTED');
    const retained=new Map<number,OwnedNativeResource>(),scanDeadline=Math.min(Date.now()+750,deadline-150);
    do{
        const pids=readdirSync('/proc').filter(name=>/^\d+$/.test(name));if(pids.length>256)throw Error('OWNED_NATIVE_RESOURCE_LIMIT');
        for(const name of pids){const pid=Number(name),before=state(pid);if(!before||before.dead||![rootPid,pid].includes(before.group))continue;
            const status=boundedProcFile(`/proc/${pid}/status`),identity=status?.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
            if(!identity||identity.slice(1).some(value=>Number(value)!==uid))continue;
            const command=boundedProcFile(`/proc/${pid}/cmdline`);if(!command?.split('\0').includes(marker))continue;
            const after=state(pid);if(!after||after.dead||after.start!==before.start||after.group!==before.group)continue;
            retained.set(pid,{pid,start:after.start});
        }
        if(retained.size)return retained;
        if(Date.now()<scanDeadline)await new Promise(resolve=>setTimeout(resolve,25));
    }while(Date.now()<scanDeadline);
    return retained;
}
/** Pre-ACK crash repair uses only this invocation's exact private marker and revalidates PID/start-time before every kill. */
export async function closeOwnedProcessResources(rootPid:number,resources:Map<number,OwnedNativeResource>,nonce:string,deadline=Date.now()+9000):Promise<void>{
    const retained=resources.size?resources:await findOwnedStartupResources(rootPid,nonce,deadline);
    await closeOwnedResources(rootPid,retained,deadline-100);
}
/** Bind native browser child identity before any session/provider operation. No arbitrary PID input is trusted. */
export function checkedOwnedResources(rootPid:number,resources:OwnedNativeResource[]):Map<number,OwnedNativeResource>{
    const retained=new Map<number,OwnedNativeResource>();
    for(const resource of resources){const observed=state(resource.pid);
        if(!observed||observed.dead||observed.parent!==rootPid||observed.start!==resource.start
            ||![rootPid,resource.pid].includes(observed.group))throw Error('OWNED_NATIVE_RESOURCE_INVALID');
        retained.set(resource.pid,resource);
    }return retained;
}
export async function closeOwnedResources(rootPid:number,resources:Map<number,OwnedNativeResource>,deadline=Date.now()+8500):Promise<void>{
    const signal=(sig:NodeJS.Signals)=>{for(const resource of resources.values()){
        const current=state(resource.pid);if(!current||current.dead||current.start!==resource.start)continue;
        if(![rootPid,resource.pid].includes(current.group))throw Error('OWNED_NATIVE_RESOURCE_INVALID');
        try{process.kill(-current.group,sig);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw Error('OWNED_NATIVE_CLEANUP_FAILED');}
    }};
    const alive=()=>[...resources.values()].some(r=>{const current=state(r.pid);return current&&!current.dead&&current.start===r.start;});
    signal('SIGTERM');
    while(alive()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    if(alive()){signal('SIGKILL');await new Promise(resolve=>setTimeout(resolve,100));}
    if(alive())throw Error('OWNED_NATIVE_CLEANUP_FAILED');
}
/** Child-side private IPC resource custody; no browser handle or endpoint is returned to caller. */
export async function retainOwnedNativeResources(nonce:string,signal:AbortSignal):Promise<void>{
    const children=readFileSync(`/proc/self/task/${process.pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
    const resources=children.map(pid=>{const observed=state(pid);if(!observed)throw Error('OWNED_NATIVE_RESOURCE_INVALID');return {pid,start:observed.start};});
    if(!resources.length||resources.length>8||!process.connected||!process.send)throw Error('OWNED_NATIVE_RESOURCE_INVALID');
    await new Promise<void>((resolve,reject)=>{
        const clean=()=>{process.removeListener('message',message);signal.removeEventListener('abort',abort);clearTimeout(timer);};
        const abort=()=>{clean();reject(Error('OWNED_NATIVE_CANCELLED'));};
        const message=(raw:unknown)=>{if(raw&&typeof raw==='object'&&'kind'in raw&&raw.kind==='resource_ack'&&'nonce'in raw&&raw.nonce===nonce){clean();resolve();}};
        const timer=setTimeout(abort,5000);process.on('message',message);signal.addEventListener('abort',abort,{once:true});
        process.send!({kind:'resources',nonce,resources},error=>{if(error)abort();});
    });
}
