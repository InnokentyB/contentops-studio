import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {RemotePrincipal} from '../remote-auth';
import {terminalScope} from '../../services/browser_terminal_evidence_contract';
import {terminalReviewIssue,terminalReviewedRequest} from '../../services/browser_terminal_review_contract';
import type {createTerminalPreparationRecovery} from '../../services/browser_terminal_preparation_recovery';
import {browserObservedSchema} from '../../services/browser_publication_guard';
import {publicationDiagnosticResult} from './publication_diagnostic_result';
import {INTERNAL_MUTATION_ANNOTATIONS} from './common';
import {terminalPreparationDiagnostic} from '../../services/browser_terminal_diagnostics';
import {terminalTransportIdentity} from './browser_terminal_transport_identity';
export {terminalPreparationDiagnostic} from '../../services/browser_terminal_diagnostics';
export type TerminalPreparationService=ReturnType<typeof createTerminalPreparationRecovery>;
/** No raw source intake. Owner consumes an already accepted durable record; Publisher only continues its scoped generation. */
export function registerTerminalPreparationTools(server:McpServer,service:TerminalPreparationService,principal?:Readonly<RemotePrincipal>|null):void{
 if(!principal||!['owner','publisher'].includes(principal.profile??'')||principal.actorId!==`user:${principal.userId}`)return;
 if(principal.profile==='publisher'&&principal.projectId===undefined)return;
 const identity=(projectId:number)=>terminalTransportIdentity(principal,projectId);
 if(principal.profile==='owner'){
 server.registerTool('ba_preview_terminal_browser_evidence',{
  description:'Owner-only local read-only source-review bindings and actual verifier file hashes, including separate canonical argument snapshot digest and unchanged legacy package hash. No raw key/lease, nonce, provider request, native proof or mutation; available before admission.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:terminalReviewIssue.shape
 },args=>publicationDiagnosticResult('browser',()=>service.preview(args,identity(args.projectId)),terminalPreparationDiagnostic));
 server.registerTool('ba_begin_terminal_browser_evidence_review',{
  description:'Owner-only request a fresh bounded review of this exact original attempt. Returns the actual deployed local-verifier file hashes and a one-use review nonce; no lease, provider request, attempt or publication authority.',annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:terminalReviewIssue.shape
 },args=>publicationDiagnosticResult('browser',()=>service.issueReview(args,identity(args.projectId)),terminalPreparationDiagnostic));
 server.registerTool('ba_accept_terminal_browser_evidence',{
  description:'Authenticated Owner control accepts its independently checked actual native local-verifier result and Published observation. Validates packaged verifier hashes, exact source/attempt/package, output/control digests and bounded freshness. Raw source and unreviewed/unsupported executions reject. This records an Owner-audited evidence class, never a native-signed stop ACK or Submit permission.',annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:terminalReviewedRequest.shape
 },args=>publicationDiagnosticResult('browser',()=>service.acceptReviewed(args,identity(args.projectId)),terminalPreparationDiagnostic));
 server.registerTool('ba_recover_terminal_browser_preparation',{
  description:'Owner-only atomically consume an independently verified, previously accepted terminal-operation record and rotate the same pre-first-permit attempt lease. No raw-source admission, new attempt, provider request or Submit.',annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:terminalScope.extend({evidenceId:z.number().int().positive()}).shape
 },args=>publicationDiagnosticResult('browser',()=>service.recover(args,identity(args.projectId)),terminalPreparationDiagnostic));
 return;}
 server.registerTool('ba_pickup_terminal_browser_preparation',{
  description:'Authenticated original Publisher pickup of an already adopted same-attempt generation. Returns the private current lease and immutable original attempt idempotencyKey to use unchanged for normal preSubmit/confirm. Never accepts evidence or creates an attempt/permit.',annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:terminalScope.extend({generation:z.number().int().positive()}).shape
 },args=>publicationDiagnosticResult('browser',()=>service.pickup(args,identity(args.projectId)),terminalPreparationDiagnostic));
 server.registerTool('ba_begin_terminal_browser_dispatch',{
  description:'Record one conservative dispatch boundary for the original adopted generation after its normal first permit. Sole Publisher may perform the single UI action; this tool never contacts the provider or asserts delivery.',annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserObservedSchema.extend({generation:z.number().int().positive()}).shape
 },args=>publicationDiagnosticResult('browser',()=>{const {generation,...observed}=args;return service.beginDispatch(observed,generation,identity(args.projectId));},terminalPreparationDiagnostic));
}
