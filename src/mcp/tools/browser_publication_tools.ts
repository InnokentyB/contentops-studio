import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserRequestSchema } from '../../services/browser_publication_contract';
import { browserClaimSchema,browserBoundarySchema,browserObservedSchema } from '../../services/browser_publication_guard';
import { inspectBrowserPublication,repairBrowserPublicationMetadata,releaseBrowserPublication } from '../../services/browser_publication_release';
import { claimBrowserPublication,startBrowserSubmission,preSubmitBrowserSubmission,
    markBrowserSubmissionUncertain,browserUncertainSchema } from '../../services/browser_publication_execution';
import { confirmBrowserSubmission,reconcileBrowserSubmission,browserConfirmSchema,browserReconcileSchema } from '../../services/browser_publication_confirmation';
import { diagnoseBrowserPublication,browserDiagnoseSchema } from '../../services/browser_publication_diagnostics';
import { asToolResult,INTERNAL_MUTATION_ANNOTATIONS } from './common';
/** Shared owner-bound controls; no tool drives a browser or makes a provider call. */
export function registerBrowserPublicationTools(server:McpServer):void {
    server.registerTool('ba_inspect_browser_publication',{
        description:'Read-only owner preview of a dynamic accepted LinkedIn/Setka image post or DEV.to article-cover package. No release, send or independent provider verification.',
        annotations:{readOnlyHint:true},inputSchema:browserRequestSchema.shape
    },async args=>asToolResult(await inspectBrowserPublication(args)));
    server.registerTool('ba_repair_browser_publication_metadata',{
        description:'Owner-only audited metadata preview/apply: language, Registry identity and canonical materialization of an entirely absent legacy handoff bundle after exact durable checks and no delivery history. Partial/divergent bundles reject. Preserves accepted copy/revision/dates/channel/art/assets; never releases or publishes.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserRequestSchema.shape
    },async args=>asToolResult(await repairBrowserPublicationMetadata(args)));
    server.registerTool('ba_release_browser_publication',{
        description:'Owner-only preview/apply for one exact current package as validated data. Apply creates one revision-bound WI, not an attempt or send. Requires audited identity/language and no prior attempt.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserRequestSchema.shape
    },async args=>asToolResult(await releaseBrowserPublication(args)));
    server.registerTool('ba_claim_browser_publication',{
        description:'Claim only an existing current owner-released browser WI. Returns a lease only to the current scoped executor; never restarts a started/uncertain attempt.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserClaimSchema.shape
    },async args=>asToolResult(await claimBrowserPublication(args)));
    server.registerTool('ba_start_browser_submission',{
        description:'Record one durable attempt before provider interaction. Does not permit Submit. A replay returns reconciliation-only, never a second attempt.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserBoundarySchema.shape
    },async args=>asToolResult(await startBrowserSubmission(args)));
    server.registerTool('ba_pre_submit_browser_submission',{
        description:'One 30-second Submit permission after actual author/company, exact paragraph/image and duplicate checks. Caller observations are not independent provider proof. Lost/replayed response never renews permission.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserObservedSchema.shape
    },async args=>asToolResult(await preSubmitBrowserSubmission(args)));
    server.registerTool('ba_confirm_browser_submission',{
        description:'Atomically record provider object/permalink readback, exact attempt, fact and audit under current package/lease/pre-submit fences. Not a screenshot-only claim of independent verification.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserConfirmSchema.shape
    },async args=>asToolResult(await confirmBrowserSubmission(args)));
    server.registerTool('ba_reconcile_browser_submission',{
        description:'Owner-only readback of an existing provider object after UNKNOWN/expired lease. Completes that same attempt, never releases, retries or sends.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserReconcileSchema.shape
    },async args=>asToolResult(await reconcileBrowserSubmission(args)));
    server.registerTool('ba_mark_browser_submission_uncertain',{
        description:'Freeze the existing scoped attempt after a lost/uncertain result, including expired lease. No reset, fact or resend authority.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserUncertainSchema.shape
    },async args=>asToolResult(await markBrowserSubmissionUncertain(args)));
    server.registerTool('ba_diagnose_browser_publication',{
        description:'Scoped persisted lifecycle readback, including attempts/WI/fact and stored handoff presence/hashes. Optional expectedSnapshot returns exact field mismatches with bounded hash-only evidence. Never returns credentials, copy or raw lease tokens; no provider access.',
        annotations:{readOnlyHint:true},inputSchema:browserDiagnoseSchema.shape
    },async args=>asToolResult(await diagnoseBrowserPublication(args)));
}
