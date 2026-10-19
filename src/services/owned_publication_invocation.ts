import {AsyncLocalStorage} from 'async_hooks';
import type {Prisma} from '@prisma/client';
import type {OwnedPublicationBudget} from './owned_publication_contract';
const execution=new AsyncLocalStorage<OwnedPublicationBudget>();
export function ownedBudget(){return execution.getStore();}
export function ownedCheck(budget:OwnedPublicationBudget|undefined=ownedBudget()){
    if(budget&&(budget.signal.aborted||Date.now()>=budget.deadline))throw Error('OWNED_INVOCATION_TIMED_OUT');
}
export function runOwnedInvocation<T>(budget:OwnedPublicationBudget,run:()=>Promise<T>){return execution.run(budget,run);}
/** SQL is cancelled server-side at the remaining deadline, then the transaction rolls back. */
function guardedTransaction(tx:Prisma.TransactionClient,budget:OwnedPublicationBudget):Prisma.TransactionClient{
    async function invoke(target:object,method:Function,args:unknown[]){
        ownedCheck(budget);
        const remaining=String(Math.max(1,budget.deadline-Date.now()));
        await tx.$queryRaw`SELECT set_config('statement_timeout',${remaining},true)`;
        ownedCheck(budget);const result:unknown=await Reflect.apply(method,target,args);ownedCheck(budget);return result;
    }
    return new Proxy(tx,{get(target,key){
        const value:unknown=Reflect.get(target,key);
        if(typeof value==='function')return(...args:unknown[])=>invoke(target,value,args);
        if(value&&typeof value==='object')return new Proxy(value,{get(delegate,methodKey){const method:unknown=Reflect.get(delegate,methodKey);
            return typeof method==='function'?((...args:unknown[])=>invoke(delegate,method,args)):method;}});
        return value;
    }});
}
type Options={isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number};
/** Unrelated provider calls keep their original transaction semantics outside this private context. */
export async function ownedTransaction<T>(db:{$transaction<T>(run:(tx:Prisma.TransactionClient)=>Promise<T>,options?:Options):Promise<T>},run:(tx:Prisma.TransactionClient)=>Promise<T>,options?:Options):Promise<T>{
    const budget=ownedBudget();if(!budget)return db.$transaction(run,options);
    ownedCheck(budget);const remaining=Math.max(1,budget.deadline-Date.now());
    try{return await db.$transaction(async tx=>{ownedCheck(budget);const result=await run(guardedTransaction(tx,budget));ownedCheck(budget);return result;},
        {...options,timeout:Math.min(options?.timeout||remaining,remaining),maxWait:Math.min(options?.maxWait||remaining,remaining)});
    }catch(error:unknown){if(budget.signal.aborted||Date.now()>=budget.deadline-2)throw Error('OWNED_INVOCATION_TIMED_OUT');throw error;}
}
