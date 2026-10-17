import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const checksum = z.string().regex(/^[a-f0-9]{64}$/);
export const browserProviderUuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const id = z.number().int().positive();
export const browserIdentitySchema = z.object({
    platform: z.enum(['linkedin', 'devto', 'setka', 'x']), accountType: z.enum(['company_page', 'personal']),
    accountRef: z.string().trim().min(1).max(300), profileUrl: z.string().url().max(500),
    providerAccountId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100),
    registryReference: z.string().trim().min(10).max(1000), registryEvidenceSha256: checksum
}).strict();
export const browserSnapshotSchema = z.object({projectId:id, taskId:id, channelId:id, contentRevision:id,
    bodySha256:checksum, scheduleAt:z.string().datetime({offset:true}), publishAt:z.string().datetime({offset:true}),
    selectedAssetId:id.nullable(), assetSha256:checksum.nullable(), decisionId:id, decisionVersion:id,
    manifestChecksum:z.string().regex(/^sha256:[a-f0-9]{64}$/),
    contentLanguage:z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/), identity:browserIdentitySchema
}).strict().superRefine((value,ctx)=>{
    const textOnly=value.identity.platform==='x';
    if(textOnly?(value.selectedAssetId!==null||value.assetSha256!==null)
        :(value.selectedAssetId===null||value.assetSha256===null))
        ctx.addIssue({code:'custom',message:'BROWSER_ASSET_POLICY_MISMATCH',path:['selectedAssetId']});
});
export const browserRequestSchema = z.object({projectId:id, taskId:id, actorId:z.string().regex(/^user:[1-9]\d*$/),
    snapshot:browserSnapshotSchema, approvalReference:z.string().trim().min(10).max(2000),
    idempotencyKey:z.string().trim().min(1).max(120), apply:z.boolean().optional().default(false)
}).strict().refine(v=>v.projectId===v.snapshot.projectId&&v.taskId===v.snapshot.taskId,{message:'SCOPE_MISMATCH'});
export type BrowserRequest = z.infer<typeof browserRequestSchema>;
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;
export type BrowserDb = Prisma.TransactionClient;
export type BrowserDependencies = {db:typeof prisma; manifest:typeof loadAgentWorkspaceManifest};
export const browserDefaults:BrowserDependencies = {db:prisma,manifest:loadAgentWorkspaceManifest};
export const object = (v:unknown):Record<string,unknown> =>
    v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const hash = (v:string):string => createHash('sha256').update(v).digest('hex');
export const snapshotHash = (v:BrowserSnapshot):string => hash(JSON.stringify(v));
export const paragraphHashes = (body:string):string[] => body.split(/\n\s*\n/).map(block=>hash(block.trim()));

/** Canonical profile syntax only; this is not proof of provider ownership. */
export function canonicalBrowserProfile(identity:z.infer<typeof browserIdentitySchema>):string {
    const url=new URL(identity.profileUrl);
    const validPath=identity.platform==='linkedin'
        ? (identity.accountType==='company_page'?/^\/company\/[a-zA-Z0-9_-]+\/?$/:/^\/in\/[a-zA-Z0-9_-]+\/?$/)
        : identity.platform==='setka'?/^\/users\/[0-9a-f-]+\/?$/
        : identity.platform==='x'?/^\/[A-Za-z0-9_]{1,15}\/?$/:/^\/[a-zA-Z0-9_-]+\/?$/;
    const host=identity.platform==='linkedin'?'www.linkedin.com':identity.platform==='setka'?'setka.ru':identity.platform==='x'?'x.com':'dev.to';
    const numericCompany=/^\/company\/([1-9]\d*)\/?$/.exec(url.pathname);
    if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password||url.search||url.hash
        ||!validPath.test(url.pathname)||(identity.platform!=='linkedin'&&identity.accountType!=='personal')
        ||(identity.platform==='setka'&&(!browserProviderUuid.safeParse(identity.providerAccountId).success
            ||url.pathname.replace(/\/$/,'')!==`/users/${identity.providerAccountId}`))
        ||(identity.platform==='x'&&(identity.providerAccountId!==url.pathname.replace(/^\/|\/$/g,'')
            ||identity.accountRef!=='@'+identity.providerAccountId))
        ||(identity.accountType==='company_page'&&!/^[1-9]\d*$/.test(identity.providerAccountId))
        ||(numericCompany&&numericCompany[1]!==identity.providerAccountId))
        throw new Error('[BROWSER_IDENTITY_INVALID]');
    return `${url.origin}${url.pathname.replace(/\/$/,'')}`;
}
export async function requireBrowserOwner(tx:BrowserDb,args:Pick<BrowserRequest,'projectId'|'actorId'>):Promise<void> {
    const member=await tx.projectMember.findUnique({where:{project_id_user_id:{project_id:args.projectId,user_id:Number(args.actorId.slice(5))}}});
    if(member?.role!=='owner')throw new Error('[OWNER_REQUIRED]');
}
export function loadBrowserTask(tx:BrowserDb,args:Pick<BrowserRequest,'projectId'|'taskId'>) {
    return tx.contentItem.findFirst({where:{id:args.taskId,project_id:args.projectId},
        include:{channel:true,selected_asset:true,publication_fact:true,art_direction_decisions:{where:{status:'active'}}}});
}
export type BrowserTask = NonNullable<Awaited<ReturnType<typeof loadBrowserTask>>>;
export type BrowserSnapshotMismatch={field:string;expected:string|number|boolean|null;current:string|number|boolean|null;
    representation?:'sha256';current_present?:boolean};
const digestValue=(v:unknown):string|null=>typeof v==='string'?hash(v):null;
const enumValue=(v:unknown,allowed:readonly string[]):string|null=>v==null?null:
    typeof v==='string'&&allowed.includes(v)?v:'[redacted_invalid_value]';
/** The admission predicates also produce bounded, hash-only diagnostic evidence. */
export function browserSnapshotMismatches(task:Awaited<ReturnType<typeof loadBrowserTask>>,s:BrowserSnapshot):BrowserSnapshotMismatch[] {
    if(!task)return[{field:'task.exists',expected:true,current:false}];
    const config=object(task?.channel?.config), quality=object(task?.quality_report);
    const asset=task?.selected_asset, storage=object(object(asset?.provenance).planner_storage);
    const profile=canonicalBrowserProfile(s.identity);
    const configuredProfile=config.profile_url||config.channel_url||object(config.raw_account).url||config.account_ref;
    const textOnly=s.identity.platform==='x';
    const expectedPlacement=s.identity.platform==='devto'?'article_cover':'feed';
    // Legacy Setka imports used unknown rather than a provider account type.
    // The adopted personal UUID profile still requires exact owner/audit/native
    // readback; this does not change the shared channel or other providers.
    const legacySetkaType=s.identity.platform==='setka'&&s.identity.accountType==='personal'&&config.account_type==='unknown';
    const decision=task?.art_direction_decisions.find(d=>d.id===s.decisionId);
    const rows:BrowserSnapshotMismatch[]=[];
    const check=(field:string,valid:boolean,expected:BrowserSnapshotMismatch['expected'],current:BrowserSnapshotMismatch['current'])=>{
        if(!valid)rows.push({field,expected,current});};
    const equal=(field:string,expected:number|null,current:number|null|undefined)=>check(field,current===expected,expected,current??null);
    const text=(field:string,expected:string,current:unknown)=>{
        if(current!==expected)rows.push({field,expected:hash(expected),current:digestValue(current),representation:'sha256'});};
    const fixed=(field:string,expected:string,current:unknown,allowed:readonly string[]=[expected])=>
        check(field,current===expected,expected,enumValue(current,allowed));
    equal('project_id',s.projectId,task.project_id);equal('id',s.taskId,task.id);equal('channel_id',s.channelId,task.channel_id);
    equal('channel.id',s.channelId,task.channel?.id);equal('channel.project_id',s.projectId,task.channel?.project_id);
    check('channel.is_active',Boolean(task.channel?.is_active),true,Boolean(task.channel?.is_active));
    fixed('channel.type',s.identity.platform,task.channel?.type,['linkedin','devto','setka','x']);
    const legacyXType=textOnly&&(config.account_type===undefined||config.account_type==='unknown');
    check('channel.config.account_type',legacySetkaType||legacyXType||config.account_type===s.identity.accountType,
        s.identity.accountType,enumValue(config.account_type,['personal','company_page','unknown']));
    text('channel.config.account_ref',s.identity.accountRef,config.account_ref);
    text('channel.config.profile_url',profile,typeof configuredProfile==='string'?configuredProfile.replace(/\/$/,''):null);
    check('channel.config.execution_modes.manual',Array.isArray(config.execution_modes)&&config.execution_modes.includes('manual'),true,
        Array.isArray(config.execution_modes)&&config.execution_modes.includes('manual'));
    check('channel.config.capability_flags.manual_handoff',object(config.capability_flags).manual_handoff===true,true,
        object(config.capability_flags).manual_handoff===true);
    equal('content_revision',s.contentRevision,task.content_revision);equal('accepted_revision',s.contentRevision,task.accepted_revision);
    fixed('text_state','accepted',task.text_state,['accepted','draft','rejected','stale']);
    check('draft_text.sha256',hash(task.draft_text||'')===s.bodySha256,s.bodySha256,hash(task.draft_text||''));
    check('schedule_at',task.schedule_at?.toISOString()===s.scheduleAt,s.scheduleAt,task.schedule_at?.toISOString()??null);
    check('publish_at',task.publish_at?.toISOString()===s.publishAt,s.publishAt,task.publish_at?.toISOString()??null);
    fixed('handoff_state','ready',task.handoff_state,['ready','blocked','stale']);
    check('quality_report.publication_hold',!quality.publication_hold,false,Boolean(quality.publication_hold));
    fixed('visual_state',textOnly?'NO_VISUAL_NEEDED':'APPROVED',task.visual_state,['APPROVED','STALE','NO_VISUAL_NEEDED','PENDING_ASSESSMENT']);
    fixed('visual_placement',expectedPlacement,task.visual_placement,['feed','article_cover','story']);
    equal('selected_asset_id',s.selectedAssetId,task.selected_asset_id);
    if(textOnly){
        check('selected_asset.absent',!asset,true,!asset);
        check('snapshot.selected_asset_id',s.selectedAssetId===null,null,s.selectedAssetId);
        check('snapshot.asset_sha256',s.assetSha256===null,null,s.assetSha256);
        check('visual_mode.not_required',task.visual_mode!=='required',true,task.visual_mode!=='required');
        check('draft_text.native_length',Boolean(task.draft_text?.trim())&&(task.draft_text?.length??0)<=280,true,
            Boolean(task.draft_text?.trim())&&(task.draft_text?.length??0)<=280);
    }else{
    equal('selected_asset.id',s.selectedAssetId,asset?.id);
    equal('selected_asset.project_id',s.projectId,asset?.project_id);equal('selected_asset.content_item_id',s.taskId,asset?.content_item_id);
    equal('selected_asset.content_revision',s.contentRevision,asset?.content_revision);equal('selected_asset.decision_id',s.decisionId,asset?.decision_id);
    fixed('selected_asset.placement',expectedPlacement,asset?.placement,['feed','article_cover','story']);
    fixed('selected_asset.status','approved',asset?.status,['approved','rejected','stale','pending']);
    check('selected_asset.file_url.https',Boolean(asset?.file_url?.startsWith('https://')),true,Boolean(asset?.file_url?.startsWith('https://')));
    check('selected_asset.storage.sha256',storage.sha256===s.assetSha256,s.assetSha256,checksum.safeParse(storage.sha256).success?String(storage.sha256):null);
    check('selected_asset.storage.managed',storage.managed===true,true,storage.managed===true);
    fixed('selected_asset.storage.provider','r2',storage.provider);
    check('selected_asset.storage.mime_type',['image/jpeg','image/png'].includes(String(storage.mime_type)),
        'image/jpeg or image/png',enumValue(storage.mime_type,['image/jpeg','image/png']));
    }
    equal('decision.id',s.decisionId,decision?.id);equal('decision.project_id',s.projectId,decision?.project_id);
    equal('decision.content_item_id',s.taskId,decision?.content_item_id);equal('decision.source_content_revision',s.contentRevision,decision?.source_content_revision);
    equal('decision.decision_version',s.decisionVersion,decision?.decision_version);
    check('visual_decision_version',decision?.decision_version===task.visual_decision_version,decision?.decision_version??null,task.visual_decision_version);
    fixed('decision.status','active',decision?.status,['active','superseded','stale']);
    check('decision.decision',decision?.decision===(textOnly?'NO_VISUAL_NEEDED':'GENERATE'),textOnly?'NO_VISUAL_NEEDED':'GENERATE',
        enumValue(decision?.decision,['GENERATE','ADAPT','REUSE','BLOCKED','NO_VISUAL_NEEDED']));
    fixed('decision.channel',s.identity.platform,decision?.channel,['linkedin','devto','setka','x']);
    fixed('decision.placement',expectedPlacement,decision?.placement,['feed','article_cover','story']);
    const handoffBody=object(object(quality.handoff_bundle).publication).body;
    if(handoffBody!==task.draft_text)rows.push({field:'quality_report.handoff_bundle.publication.body',expected:digestValue(task.draft_text),
        current:digestValue(handoffBody),representation:'sha256',current_present:typeof handoffBody==='string'});
    return rows;
}
/** Shared revision/tenant/identity/asset fence; no concrete business identifiers. */
export function assertBrowserSnapshot(task:Awaited<ReturnType<typeof loadBrowserTask>>,s:BrowserSnapshot):asserts task is BrowserTask {
    const mismatches=browserSnapshotMismatches(task,s);
    if(mismatches.length)throw new Error(`[BROWSER_SNAPSHOT_MISMATCH] ${JSON.stringify(mismatches)}`);
}
export async function checkedBrowserContext(tx:BrowserDb,args:BrowserRequest,deps:BrowserDependencies) {
    await requireBrowserOwner(tx,args);
    const manifest=await deps.manifest(args.projectId,Number(args.actorId.slice(5)),tx);
    if(manifest.checksum!==args.snapshot.manifestChecksum)throw new Error('[STALE_MANIFEST]');
    const task=await loadBrowserTask(tx,args);assertBrowserSnapshot(task,args.snapshot);return task;
}
export function browserFingerprint(task:BrowserTask,s:BrowserSnapshot):string {
    return hash(JSON.stringify({snapshot:s,channel:task.channel?.config,imageUrl:task.selected_asset?.file_url,
        handoff:object(task.quality_report).handoff_bundle}));
}
export async function noBrowserDelivery(tx:BrowserDb,args:BrowserRequest):Promise<void> {
    if(await tx.deliveryAttempt.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId}}))
        throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
    if(await tx.connectorDispatchJob.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
        state:{notIn:['cancelled','confirmed']}}}))throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
    if(await tx.workItem.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,kind:'browser_publish',
        state:{notIn:['cancelled','completed']}}}))throw new Error('[BROWSER_WORK_EXISTS]');
}
export async function browserPrior(tx:BrowserDb,args:BrowserRequest,command:string):Promise<Record<string,unknown>|null> {
    const prior=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
        actor_id:args.actorId,command,idempotency_key:args.idempotencyKey}});
    if(prior&&object(prior.before_state).request_hash!==hash(JSON.stringify(args)))throw new Error('[IDEMPOTENCY_CONFLICT]');
    return prior?{...object(prior.after_state),replayed:true}:null;
}
export const browserCas = (task:BrowserTask) => ({id:task.id,project_id:task.project_id,channel_id:task.channel_id,
    status:task.status,publication_mode:task.publication_mode,content_revision:task.content_revision,
    accepted_revision:task.accepted_revision,selected_asset_id:task.selected_asset_id,
    schedule_at:task.schedule_at,publish_at:task.publish_at,visual_decision_version:task.visual_decision_version});
