import {McpServer} from '@modelcontextprotocol/sdk/server/mcp';
import type {RemotePrincipal} from '../remote-auth';
import {linkedinApiReadinessSchema,linkedinApiReleaseSchema,linkedinApiPublishSchema,linkedinApiReconcileSchema,linkedinApiError} from '../../services/linkedin_api_contract';
import {linkedinApiPublicationService as service} from '../../services/linkedin_api_publication.service';
import {asToolResult} from './common';

const knownCodes=new Set(['LINKEDIN_API_DISABLED','LINKEDIN_API_UNKNOWN','LINKEDIN_API_GRANTS_REQUIRED','LINKEDIN_API_CONFLICT','LINKEDIN_API_MEDIA_INVALID','LINKEDIN_API_PROVIDER_UNAVAILABLE','LINKEDIN_API_INTERRUPTED','LINKEDIN_API_OWNER_REQUIRED','LINKEDIN_API_NOT_DUE','LINKEDIN_API_READ_BUDGET','LINKEDIN_API_READ_BACKOFF','LINKEDIN_API_READ_IN_PROGRESS','LINKEDIN_API_IMAGE_PROCESSING']);
function failure(code:string){
    const action=code==='LINKEDIN_API_UNKNOWN'?'Inspect and reconcile this same attempt only; do not resend or switch transport.'
        :code==='LINKEDIN_API_PRINCIPAL_REQUIRED'||code==='LINKEDIN_API_SCOPE_MISMATCH'?'Reconnect with the authorized project-scoped Owner or Publisher profile and refresh the current task.'
        :linkedinApiError(code).message.replace(/^\[[^\]]+\]\s*/,'');
    return {...asToolResult({code,next_action:action,retry_allowed:false,published:false}),isError:true};
}
function projection(value:unknown):Record<string,unknown>{
    const source=value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
    const result:Record<string,unknown>={};
    for(const key of ['ready','admission_enabled','post_read','image_read_permission','published','publication_authorized'])if(typeof source[key]==='boolean')result[key]=source[key];
    if(source.image_read_probe==='not_performed')result.image_read_probe='not_performed';
    for(const key of ['route','transport'])if(source[key]==='linkedin_api')result[key]='linkedin_api';
    if(typeof source.author_urn==='string'&&/^urn:li:(person:[A-Za-z0-9_-]{1,80}|organization:[1-9]\d{0,24})$/.test(source.author_urn))result.author_urn=source.author_urn;
    if(typeof source.provider_object_id==='string'&&/^urn:li:(ugcPost|share):[1-9]\d{0,24}$/.test(source.provider_object_id))result.provider_object_id=source.provider_object_id;
    if(typeof source.attempt_id==='number'&&Number.isSafeInteger(source.attempt_id)&&source.attempt_id>0)result.attempt_id=source.attempt_id;
    if(source.status==='UNKNOWN'||source.status==='confirmed'||source.status==='held')result.status=source.status;
    if(source.mode==='dry_run')result.mode='dry_run';
    if(typeof source.code==='string'){
        const code=knownCodes.has(source.code)?source.code:'LINKEDIN_API_CONFLICT';
        result.code=code;result.next_action=code==='LINKEDIN_API_UNKNOWN'?'Reconcile this same attempt only; never resend.':linkedinApiError(code).message.replace(/^\[[^\]]+\]\s*/,'');
    }
    return result;
}
/** Session identity is closed over; tool arguments cannot choose an actor or tenant. */
export function registerLinkedInApiTools(server:McpServer,principal?:Readonly<RemotePrincipal>|null):void{
    async function run(args:{projectId:number;actorId:string},ownerOnly:boolean,call:()=>Promise<unknown>){
        if(!principal||!Number.isSafeInteger(principal.userId)||principal.userId<=0||principal.actorId!==`user:${principal.userId}`)return failure('LINKEDIN_API_PRINCIPAL_REQUIRED');
        if(args.actorId!==principal.actorId||(principal.projectId!==undefined&&principal.projectId!==args.projectId)
            ||(principal.profile!==undefined&&!['owner','publisher'].includes(principal.profile))||(ownerOnly&&principal.profile==='publisher'))return failure('LINKEDIN_API_SCOPE_MISMATCH');
        try{return {...asToolResult(projection(await call())),isError:false};}
        catch(error:unknown){const match=error instanceof Error?/^\[([A-Z_]+)\]/.exec(error.message):null;return failure(match&&knownCodes.has(match[1])?match[1]:'LINKEDIN_API_CONFLICT');}
    }
    server.registerTool('ba_get_linkedin_api_readiness',{description:'Read local verified LinkedIn connection and governed route readiness; no upload, public send or publication permission is granted. The new route is disabled until explicit admission.',inputSchema:linkedinApiReadinessSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},args=>run(args,false,()=>service.readiness(args)));
    server.registerTool('ba_release_linkedin_api_publication',{description:'Owner release of one exact accepted LinkedIn API package. Requires enabled, verified connection and canonical text/visual/attempt gates; sends nothing.',inputSchema:linkedinApiReleaseSchema.shape,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},args=>run(args,true,()=>service.release(args)));
    server.registerTool('ba_publish_linkedin_api_publication',{description:'Execute an Owner-released LinkedIn API attempt once using verified accepted media. Uncertain outcomes require reconciliation, never resend or browser fallback. Disabled by default.',inputSchema:linkedinApiPublishSchema.shape,annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}},(args,extra)=>run(args,false,()=>service.publish(args,extra.signal)));
    server.registerTool('ba_reconcile_linkedin_api_publication',{description:'Read only the provider object proven to belong to an existing LinkedIn API attempt and atomically record its verified canonical fact. No new send, reset or route conversion.',inputSchema:linkedinApiReconcileSchema.shape,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},(args,extra)=>run(args,false,()=>service.reconcile(args,extra.signal)));
}
