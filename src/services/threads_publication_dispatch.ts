import {threadsErrorDiagnostic} from './threads_error_catalog';
import {currentPublicationPrincipal} from '../mcp/publication-principal';
import {PublicationDiagnosticError,type PublicationDiagnostic} from './publication_diagnostics';
import genericThreadsReleaseService from './threads_generic_release.service';
import type {OwnedPublicationRequest} from './owned_publication_contract';

export type SharedPublicationRequest=OwnedPublicationRequest&{releaseIdempotencyKey?:string;actorId?:string};
const fieldActions=[
    {field:'approvalReference',action:'Use the approval reference from the existing exact Owner release; do not invent a new authorization.'},
    {field:'expectedManifestChecksum',action:'Read the current project manifest and verify it matches the existing release.'},
    {field:'releaseIdempotencyKey',action:'Use the stable key of the existing ba_release_approved_threads_task release.'},
    {field:'idempotencyKey',action:'Supply and preserve one stable send key. Reconcile an existing attempt rather than replacing its key.'}
] as const;
function deny(code:string,message:string,field:string,action:string):never{
    throw new PublicationDiagnosticError({code,message,retry_allowed:false,reasons:[{code,field,message,action}]});
}
/** Shared composition boundary; classification never grants API authority or selects a browser fallback. */
export async function publishThreadsWithRelease(args:SharedPublicationRequest,signal?:AbortSignal):Promise<Record<string,unknown>>{
    const principal=currentPublicationPrincipal();
    if(!principal)deny('THREADS_PRINCIPAL_REQUIRED','An authenticated publication operator is required.','principal',
        'Use the existing authenticated project Owner or Publisher profile; do not send credentials in tool arguments.');
    if(principal.projectId!==undefined&&principal.projectId!==args.projectId)
        deny('THREADS_PROJECT_SCOPE_MISMATCH','The connected profile belongs to another project.','projectId','Use the authorized profile for the intended project and read its current release.');
    if(args.actorId!==undefined&&args.actorId!==principal.actorId)
        deny('THREADS_ACTOR_SCOPE_MISMATCH','The submitted actor differs from the authenticated operator.','actorId','Use the authenticated actor bound to the existing release; never substitute another actor.');
    if((args.operation!==undefined&&args.operation!=='publish')||args.attemptId!==undefined||args.expectedPackageSha256!==undefined||args.expectedAcceptedRevision!==undefined)
        deny('THREADS_OPERATION_UNSUPPORTED','These operation fields do not belong to the generic Threads send contract.','operation',
            'Use ba_release_approved_threads_task for release or ba_reconcile_threads_publication for an existing attempt. Supply only the supported exact release envelope to publish.');
    const reasons:PublicationDiagnostic['reasons'][number][]=fieldActions.flatMap(({field,action})=>{
        const value=args[field];
        return typeof value==='string'&&value.trim()?[]:[{code:'THREADS_RELEASE_FIELD_REQUIRED',field,message:'A required exact release binding is missing.',action}];
    });
    if(reasons.length)throw new PublicationDiagnosticError({code:'THREADS_RELEASE_ENVELOPE_REQUIRED',
        message:'This Threads route requires the complete existing generic release envelope.',retry_allowed:false,reasons});
    // Validation above narrows runtime data. The existing service remains authoritative for current release/package/grants/history.
    try{return await genericThreadsReleaseService.publish({projectId:args.projectId,taskId:args.taskId,actorId:principal.actorId,
        approvalReference:args.approvalReference!,expectedManifestChecksum:args.expectedManifestChecksum!,
        releaseIdempotencyKey:args.releaseIdempotencyKey!,idempotencyKey:args.idempotencyKey!,dryRun:args.dryRun},signal);}
    catch(error:unknown){throw new PublicationDiagnosticError(threadsErrorDiagnostic(error));}
}
