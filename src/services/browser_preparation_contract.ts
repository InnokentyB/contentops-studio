import {z} from 'zod';
import type {BrowserDb,BrowserRequest} from './browser_publication_contract';
export const preparationRequest=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),attemptId:z.number().int().positive(),actorId:z.string().regex(/^user:[1-9]\d*$/),idempotencyKey:z.string().trim().min(1).max(120)}).strict();
export type PreparationRequest=z.infer<typeof preparationRequest>;
export const preparationPickup=preparationRequest.extend({generation:z.number().int().nonnegative()}).strict();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const preparationLedger=z.object({version:z.literal(1),projectId:z.number().int().positive(),taskId:z.number().int().positive(),attemptId:z.number().int().positive(),workItemId:z.number().int().positive(),executorSha256:hash,generation:z.number().int().nonnegative(),revision:z.number().int().nonnegative(),state:z.enum(['preparing','quiescing','quiescent','queued','permit_issued','dispatch_started','awaiting_result','complete','held']),resumptions:z.number().int().min(0).max(3),startedAtMs:z.number().finite().nullable(),deadlineMs:z.number().finite().nullable(),operationSha256:hash.nullable(),challengeSha256:hash.nullable(),proofSha256:hash.nullable(),outbox:z.enum(['none','pending','claimed']),permitIssued:z.boolean(),dispatchStarted:z.boolean()}).strict();
export type PreparationLedger=z.infer<typeof preparationLedger>;
/** Application-owned supervisor must exclusively fence EVERY dispatch, including old/offline workers; no caller data can register it. */
export type PreparationSupervisor={executorId:string;supports:(snapshot:BrowserRequest['snapshot'])=>boolean;quiesce:(request:{projectId:number;taskId:number;attemptId:number;generation:number;challenge:string;deadlineMs:number;signal:AbortSignal})=>Promise<{executorId:string;generation:number;challengeSha256:string;oldExecutorQuiescent:true;evidenceRef:string;failureKind:'NETWORK_TEMPORARY'|'EXECUTOR_RESTART'}>};
export type PreparationAdmission=(tx:BrowserDb,args:BrowserRequest&{workItemId:number;leaseToken:string},attemptId:number)=>Promise<void>;
export type PreparationPermit=(tx:BrowserDb,args:BrowserRequest&{attemptId:number;workItemId:number;leaseToken:string},run:()=>Promise<Record<string,unknown>>)=>Promise<Record<string,unknown>>;
export type PreparationUncertainty=(input:unknown)=>Promise<Record<string,unknown>|undefined>;
