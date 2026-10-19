import {readFileSync,readdirSync,openSync,readSync,closeSync} from 'fs';
import {z} from 'zod';
export const ownedResourceSchema=z.object({pid:z.number().int().positive(),start:z.string().regex(/^\d+$/)}).strict();
export type OwnedNativeResource=z.infer<typeof ownedResourceSchema>&{group?:number;groupStart?:string};
function state(pid:number):{parent:number;group:number;start:string;dead:boolean}|null{
    try{const text=readFileSync(`/proc/${pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');
        return {parent:Number(fields[1]),group:Number(fields[2]),start:fields[19],dead:fields[0]==='Z'};
    }catch(error){if(error instanceof Error&&'code'in error&&['ENOENT','ESRCH'].includes(String(error.code)))return null;throw Error('OWNED_NATIVE_CLEANUP_FAILED');}
}
/** Private fork leader identity, captured before the invocation is sent. */
export function checkedOwnedProcessGroup(pid:number):OwnedNativeResource{
    const current=state(pid);
    if(!Number.isSafeInteger(pid)||pid<1||pid===process.pid||!current||current.dead
        ||current.parent!==process.pid||current.group!==pid)throw Error('OWNED_NATIVE_RESOURCE_INVALID');
    return {pid,start:current.start};
}
/** A dead or replaced leader cannot reopen process-group signal authority. */
export function signalOwnedProcessGroup(resource:OwnedNativeResource,signal:NodeJS.Signals):void{
    const current=state(resource.pid);if(!current||current.dead)return;
    if(current.start!==resource.start||current.group!==resource.pid||current.parent!==process.pid)throw Error('OWNED_NATIVE_RESOURCE_INVALID');
    try{process.kill(-resource.pid,signal);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw Error('OWNED_NATIVE_CLEANUP_FAILED');}
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
            retained.set(pid,{pid,start:after.start,group:after.group,groupStart:state(after.group)?.start});
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
        retained.set(resource.pid,{...resource,group:observed.group,groupStart:state(observed.group)?.start});
    }return retained;
}
export async function closeOwnedResources(rootPid:number,resources:Map<number,OwnedNativeResource>,deadline=Date.now()+8500):Promise<void>{
    // Group identity is retained before browser custody ACK. A reused group leader
    // invalidates cleanup authority; an observed empty group is never reopened.
    const retained=new Map(resources),groups=new Map<number,{start:string;closed:boolean}>();
    for(const resource of resources.values()){
        const current=state(resource.pid);
        const group=resource.group??(current?.start===resource.start?current.group:undefined);
        const start=resource.groupStart??(group===undefined?undefined:state(group)?.start);
        if(group===undefined||!start||![rootPid,resource.pid].includes(group))throw Error('OWNED_NATIVE_RESOURCE_INVALID');
        groups.set(group,{start,closed:false});
    }
    const uid=process.getuid?.();if(uid===undefined)throw Error('OWNED_NATIVE_RESOURCE_UNSUPPORTED');
    const scan=()=>{
        const pids=readdirSync('/proc').filter(name=>/^\d+$/.test(name));
        if(pids.length>256)throw Error('OWNED_NATIVE_RESOURCE_LIMIT');
        for(const [group,identity] of groups){
            if(identity.closed)continue;
            const leader=state(group);if(leader&&leader.start!==identity.start)throw Error('OWNED_NATIVE_RESOURCE_INVALID');
            let members=0;
            for(const name of pids){
                const pid=Number(name),current=state(pid);if(!current||current.dead||current.group!==group)continue;
                const status=boundedProcFile(`/proc/${pid}/status`),owner=status?.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
                if(!owner||owner.slice(1).some(value=>Number(value)!==uid))throw Error('OWNED_NATIVE_RESOURCE_INVALID');
                retained.set(pid,{pid,start:current.start});members++;
            }
            if(members===0)identity.closed=true;
        }
    };
    const alive=()=>{scan();return [...retained.values()].some(resource=>{const current=state(resource.pid);return current&&!current.dead&&current.start===resource.start;});};
    const signal=(sig:NodeJS.Signals)=>{scan();for(const resource of retained.values()){
        const current=state(resource.pid);if(!current||current.dead||current.start!==resource.start)continue;
        if(!groups.has(current.group)||groups.get(current.group)!.closed)throw Error('OWNED_NATIVE_RESOURCE_INVALID');
        try{process.kill(resource.pid,sig);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw Error('OWNED_NATIVE_CLEANUP_FAILED');}
    }};
    signal('SIGTERM');
    while(alive()&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,25));scan();}
    if(alive()){signal('SIGKILL');await new Promise(resolve=>setTimeout(resolve,100));scan();}
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
