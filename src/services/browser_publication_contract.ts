import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const checksum = z.string().regex(/^[a-f0-9]{64}$/);
export const browserProviderUuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const id = z.number().int().positive();
const visualProductionDecision=z.enum(['GENERATE']);
export const browserIdentitySchema = z.object({
    platform: z.enum(['linkedin', 'devto', 'setka']), accountType: z.enum(['company_page', 'personal']),
    accountRef: z.string().trim().min(1).max(300), profileUrl: z.string().url().max(500),
    providerAccountId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100),
    registryReference: z.string().trim().min(10).max(1000), registryEvidenceSha256: checksum
}).strict();
export const browserSnapshotSchema = z.object({projectId:id, taskId:id, channelId:id, contentRevision:id,
    bodySha256:checksum, scheduleAt:z.string().datetime({offset:true}), publishAt:z.string().datetime({offset:true}),
    selectedAssetId:id, assetSha256:checksum, decisionId:id, decisionVersion:id,
    manifestChecksum:z.string().regex(/^sha256:[a-f0-9]{64}$/),
    contentLanguage:z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/), identity:browserIdentitySchema
}).strict();
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
        : identity.platform==='setka'?/^\/users\/[0-9a-f-]+\/?$/:/^\/[a-zA-Z0-9_-]+\/?$/;
    const host=identity.platform==='linkedin'?'www.linkedin.com':identity.platform==='setka'?'setka.ru':'dev.to';
    const numericCompany=/^\/company\/([1-9]\d*)\/?$/.exec(url.pathname);
    if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password||url.search||url.hash
        ||!validPath.test(url.pathname)||(identity.platform!=='linkedin'&&identity.accountType!=='personal')
        ||(identity.platform==='setka'&&(!browserProviderUuid.safeParse(identity.providerAccountId).success
            ||url.pathname.replace(/\/$/,'')!==`/users/${identity.providerAccountId}`))
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
/** Shared revision/tenant/identity/asset fence; no concrete business identifiers. */
export function assertBrowserSnapshot(task:Awaited<ReturnType<typeof loadBrowserTask>>,s:BrowserSnapshot):asserts task is BrowserTask {
    const config=object(task?.channel?.config), quality=object(task?.quality_report);
    const asset=task?.selected_asset, storage=object(object(asset?.provenance).planner_storage);
    const profile=canonicalBrowserProfile(s.identity);
    const configuredProfile=config.profile_url||config.channel_url||object(config.raw_account).url||config.account_ref;
    const expectedPlacement=s.identity.platform==='devto'?'article_cover':'feed';
    // Legacy Setka imports used unknown rather than a provider account type.
    // The adopted personal UUID profile still requires exact owner/audit/native
    // readback; this does not change the shared channel or other providers.
    const legacySetkaType=s.identity.platform==='setka'&&s.identity.accountType==='personal'&&config.account_type==='unknown';
    const decision=task?.art_direction_decisions.find(d=>d.id===s.decisionId);
    if(!task||task.project_id!==s.projectId||task.id!==s.taskId||task.channel_id!==s.channelId
        ||task.channel?.id!==s.channelId||task.channel.project_id!==s.projectId||!task.channel.is_active
        ||task.channel.type!==s.identity.platform||(!legacySetkaType&&config.account_type!==s.identity.accountType)
        ||config.account_ref!==s.identity.accountRef||typeof configuredProfile!=='string'
        ||configuredProfile.replace(/\/$/,'')!==profile
        ||!Array.isArray(config.execution_modes)||!config.execution_modes.includes('manual')
        ||object(config.capability_flags).manual_handoff!==true
        ||task.content_revision!==s.contentRevision||task.accepted_revision!==s.contentRevision||task.text_state!=='accepted'
        ||hash(task.draft_text||'')!==s.bodySha256||task.schedule_at?.toISOString()!==s.scheduleAt
        ||task.publish_at?.toISOString()!==s.publishAt||task.handoff_state!=='ready'||quality.publication_hold
        ||task.visual_state!=='APPROVED'||task.visual_placement!==expectedPlacement||task.selected_asset_id!==s.selectedAssetId
        ||!asset||asset.id!==s.selectedAssetId||asset.project_id!==s.projectId||asset.content_item_id!==s.taskId
        ||asset.content_revision!==s.contentRevision||asset.decision_id!==s.decisionId||asset.placement!==expectedPlacement
        ||asset.status!=='approved'||!asset.file_url?.startsWith('https://')||storage.sha256!==s.assetSha256
        ||storage.managed!==true||storage.provider!=='r2'||!['image/jpeg','image/png'].includes(String(storage.mime_type))
        ||!decision||decision.project_id!==s.projectId||decision.content_item_id!==s.taskId
        ||decision.source_content_revision!==s.contentRevision||decision.decision_version!==s.decisionVersion
        ||decision.decision_version!==task.visual_decision_version||decision.status!=='active'||!visualProductionDecision.safeParse(decision.decision).success
        ||decision.channel!==s.identity.platform||decision.placement!==expectedPlacement
        ||object(object(quality.handoff_bundle).publication).body!==task.draft_text)
        throw new Error('[BROWSER_SNAPSHOT_MISMATCH]');
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
