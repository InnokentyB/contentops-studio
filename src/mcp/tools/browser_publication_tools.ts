import {authorizeBrowserPublication,ownerBrowserInstructionSchema} from '../../services/browser_owner_instruction';
import {createPublicationRecoveryApplication} from '../../services/browser_recovery_application';
import type {BrowserRecoveryOperation} from '../../services/browser_recovery_runtime';
import {createPreparationRecovery} from '../../services/browser_preparation_recovery';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserRequestSchema } from '../../services/browser_publication_contract';
import { browserClaimSchema,browserBoundarySchema,browserObservedSchema } from '../../services/browser_publication_guard';
import { inspectBrowserPublication,repairBrowserPublicationMetadata,releaseBrowserPublication } from '../../services/browser_publication_release';
import { claimBrowserPublication,startBrowserSubmission,preSubmitBrowserSubmission,
    markBrowserSubmissionUncertain,browserUncertainSchema } from '../../services/browser_publication_execution';
import { confirmBrowserSubmission,reconcileBrowserSubmission,browserConfirmSchema,browserReconcileSchema } from '../../services/browser_publication_confirmation';
import { diagnoseBrowserPublication,browserDiagnoseSchema } from '../../services/browser_publication_diagnostics';
import { INTERNAL_MUTATION_ANNOTATIONS } from './common';
import { publicationDiagnosticResult } from './publication_diagnostic_result';
import { browserErrorDiagnostic,browserResultProjection } from '../../services/browser_actionable_diagnostics';
/** Shared owner-bound controls; admitted recovery may perform bounded provider reads and canonical finalization, never submission. */
export function registerBrowserPublicationTools(server:McpServer,recovery:BrowserRecoveryOperation=createPublicationRecoveryApplication(),preparation=createPreparationRecovery()):void {
    server.registerTool('ba_authorize_browser_publication',{description:'Owner-only one additional browser publication despite UNKNOWN or provider duplicate risk. Preserves old attempts; Publisher consumes authority but cannot mint it. Preview by default; no provider call.',annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:ownerBrowserInstructionSchema.shape},async args=>publicationDiagnosticResult('browser',()=>authorizeBrowserPublication(args),browserErrorDiagnostic));
    server.registerTool('ba_inspect_browser_publication',{
        description:'Read-only owner preview of an exact accepted LinkedIn image or canonical NO_VISUAL_NEEDED text-only post, Setka image post or DEV.to article-cover package. No release, send or independent provider verification.',
        annotations:{readOnlyHint:true},inputSchema:browserRequestSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>inspectBrowserPublication(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_repair_browser_publication_metadata',{
        description:'Owner-only audited metadata preview/apply: language, Registry identity and canonical materialization of an entirely absent legacy handoff bundle after exact durable checks and no delivery history. Partial/divergent bundles reject. Preserves accepted copy/revision/dates/channel/art/assets; never releases or publishes.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserRequestSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>repairBrowserPublicationMetadata(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_release_browser_publication',{
        description:'Owner-only preview/apply for one exact current package as validated data. Apply creates one revision-bound WI, not an attempt or send. Requires audited identity/language and no prior attempt.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserRequestSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>releaseBrowserPublication(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_claim_browser_publication',{
        description:'Claim only an existing current owner-released browser WI. Returns a lease only to the current scoped executor; never restarts a started/uncertain attempt.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserClaimSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>claimBrowserPublication(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_start_browser_submission',{
        description:'Record one durable attempt before provider interaction. Does not permit Submit. A replay returns reconciliation-only, never a second attempt.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserBoundarySchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>preparation.start(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_pre_submit_browser_submission',{
        description:'One 30-second Submit permission after actual author/company, exact paragraph/image and duplicate checks. idempotencyKey MUST equal the immutable key used by the original ba_start_browser_submission for this exact attempt, not a new per-stage key. An expired lease requires supported fenced same-attempt recovery; correcting a key does not renew it. Caller observations are not independent provider proof. Lost/replayed response never renews permission.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserObservedSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>preSubmitBrowserSubmission(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_confirm_browser_submission',{
        description:'Atomically record provider object/permalink readback, exact attempt, fact and audit under current package/lease/pre-submit fences. Not a screenshot-only claim of independent verification.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserConfirmSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>confirmBrowserSubmission(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_reconcile_browser_submission',{
        description:'Owner-only readback of an existing provider object after UNKNOWN/expired lease. Completes that same attempt, never releases, retries or sends.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserReconcileSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>reconcileBrowserSubmission(args),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_mark_browser_submission_uncertain',{
        description:'Freeze the existing scoped attempt after a lost/uncertain result, including expired lease. An admitted reader may reconcile and finalize its verified existing object; no reset or resend. Default has no admitted reader.',
        annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:browserUncertainSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>markBrowserSubmissionUncertain(args,undefined,undefined,recovery,input=>preparation.operation(input,recovery)),browserErrorDiagnostic,browserResultProjection));
    server.registerTool('ba_diagnose_browser_publication',{
        description:'Scoped persisted lifecycle readback, including attempts/WI/fact and stored handoff presence/hashes. Optional expectedSnapshot returns exact field mismatches with bounded hash-only evidence. Never returns credentials, copy or raw lease tokens; no provider access.',
        annotations:{readOnlyHint:true},inputSchema:browserDiagnoseSchema.shape
    },async args=>publicationDiagnosticResult('browser',()=>diagnoseBrowserPublication(args),browserErrorDiagnostic,browserResultProjection));
}
