import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {RemotePrincipal} from '../remote-auth';
import {currentPublicationPrincipal} from '../publication-principal';
import {createPreparationHeartbeat,preparationHeartbeatRequest} from '../../services/browser_preparation_heartbeat';
import type {PublicationDiagnostic} from '../../services/publication_diagnostics';
import {publicationDiagnosticResult} from './publication_diagnostic_result';
import {INTERNAL_MUTATION_ANNOTATIONS} from './common';

export const PREPARATION_HEARTBEAT_COMMAND='ba_heartbeat_browser_preparation';
const request=preparationHeartbeatRequest.omit({actorId:true}).strict();
const response=z.object({generation:z.number().int().nonnegative(),leaseExpiresAtMs:z.number().finite().positive(),
 submission_permitted:z.literal(false),retry_allowed:z.literal(false)});
type Service=Pick<ReturnType<typeof createPreparationHeartbeat>,'renew'>;
function scopedPublisher(p:Readonly<RemotePrincipal>|null|undefined):p is Readonly<RemotePrincipal>&{projectId:number}{
 return !!p&&p.profile==='publisher'&&Number.isSafeInteger(p.userId)&&p.userId>0
  &&Number.isSafeInteger(p.projectId)&&Number(p.projectId)>0&&p.actorId===`user:${p.userId}`;
}
const explanations:Record<string,readonly[string,string]>={
 HEARTBEAT_PUBLISHER_REQUIRED:['Only the authenticated original project-scoped Publisher can renew preparation.','Use the existing same-project Publisher connection and current private attempt binding; do not supply another profile or actor.'],
 HEARTBEAT_DISABLED:['Preparation heartbeat admission is not enabled.','Preserve the existing attempt and ask the release controller to verify its admitted preparation runtime.'],
 HEARTBEAT_LEASE_EXPIRED:['The original live preparation lease has expired.','Preserve the same attempt and use supported fenced recovery; heartbeat cannot revive an expired lease.'],
 HEARTBEAT_NOT_PREPARING:['The attempt is not in an admitted live preparation generation.','Read the existing preparation state and generation. Do not renew dispatch, uncertainty or a historical unsupervised attempt.'],
 HEARTBEAT_POSSIBLY_SENT:['A permit or possible dispatch prevents preparation renewal.','Reconcile the existing attempt read-only; do not renew its lease or send again.'],
 APPROVAL_REVOKED:['The original publication approval is no longer current.','Read the current approval and preserve the same attempt; do not renew or dispatch against revoked authority.'],
 PACKAGE_CHANGED:['The accepted publication package changed.','Read the current package and preserve the original attempt; do not renew a stale revision.'],
 BROWSER_ATTEMPT_KEY_MISMATCH:['The heartbeat does not match the original attempt key.','Use the immutable original start key through the same private Publisher context; never create a replacement attempt.'],
 RECOVERY_CONFLICT:['The preparation state or lease changed concurrently.','Read the current same-attempt generation and lease before continuing; do not overwrite or reset recovery.'],
 OWNER_REQUIRED:['Current project ownership no longer permits preparation.','Ask the existing project Owner to inspect current access; a Publisher session cannot grant ownership.']
};
function diagnostic(error:unknown):PublicationDiagnostic{
 const found=error instanceof Error?/^\[([A-Z_]+)\]/.exec(error.message)?.[1]:undefined;
 const code=found&&Object.prototype.hasOwnProperty.call(explanations,found)?found:'HEARTBEAT_INPUT_OR_STATE_INVALID';
 const [message,action]=explanations[code]??['The heartbeat input or preparation state could not be validated.','Read the current private same-attempt binding and retry only with its exact supported fields; do not reset or send.'];
 return{code,message,retry_allowed:false,reasons:[{code,field:'preparation_heartbeat',message,action}]};
}
/** Private liveness only; no actor/profile authority is accepted from input. */
export function registerPreparationHeartbeatTools(server:McpServer,session?:Readonly<RemotePrincipal>|null,service:Service=createPreparationHeartbeat()):void{
 if(!scopedPublisher(session))return;
 server.registerTool(PREPARATION_HEARTBEAT_COMMAND,{
  description:'Original project-scoped Publisher heartbeat for an admitted LIVE pre-permit preparation generation. Renews only the same lease before expiry; never revives historical/expired attempts, creates a permit, proves native stop or sends. Input has no caller-selected actor/profile; output contains only generation and expiry.',
  annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:request
 },args=>publicationDiagnosticResult('browser',async()=>{
  const input=request.parse(args),current=currentPublicationPrincipal();
  if(!scopedPublisher(current)||current.projectId!==input.projectId||current.projectId!==session.projectId
   ||current.userId!==session.userId||current.actorId!==session.actorId)throw new Error('[HEARTBEAT_PUBLISHER_REQUIRED]');
  return response.parse(await service.renew({...input,actorId:current.actorId}));
 },diagnostic));
}
