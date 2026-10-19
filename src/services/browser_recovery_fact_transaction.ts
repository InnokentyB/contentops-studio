import type {Prisma} from '@prisma/client';
import type {prisma as CanonicalPrisma} from '../db';
import type {RecordPublicationFactArgs} from './publication_fact.service';
import {assertBrowserRecoveryFactWriter} from './browser_recovery_guard';
import {assertThreadsApiFactWriter} from './threads_api_fact_guard';
type TransactionOptions={maxWait?:number;timeout?:number;isolationLevel?:Prisma.TransactionIsolationLevel};
/** Preserve the canonical transaction body/options while enforcing every caller at its commit boundary. */
export function withRecoveryFactTransactions(client:typeof CanonicalPrisma,args:RecordPublicationFactArgs){
 return {$transaction:<T>(run:(tx:Prisma.TransactionClient)=>Promise<T>,options?:TransactionOptions):Promise<T>=>client.$transaction(async tx=>{
  const result=await run(tx);
  // All prior writes are in this transaction and roll back if an unrelated callback bypassed the hold.
  await assertBrowserRecoveryFactWriter(tx,args);
  await assertThreadsApiFactWriter(tx,args);
  if(args.beforeCommit)await args.beforeCommit(tx);
  return result;
 },args.beforeCommit?{...options,maxWait:2000,timeout:10000}:options)};
}
