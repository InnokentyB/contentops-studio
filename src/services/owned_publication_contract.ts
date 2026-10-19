import {createHash} from 'crypto';
import {z} from 'zod';
/** Data contract shared by governed provider lifecycles; no business identifiers are authority. */
export const OWNED_PROTOCOL='owned_provider_v1';
export const OWNED_PROVIDER='dzen';
export const OWNED_RELEASE_OPERATION='release';
export const NO_VISUAL_DECISION='NO_VISUAL_NEEDED';
export const ownedRequestSchema=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),
    operation:z.enum(['release','publish','reconcile']).default('publish'),dryRun:z.boolean().default(true),
    idempotencyKey:z.string().min(1).max(200).optional(),expectedAcceptedRevision:z.number().int().positive().optional(),
    expectedPackageSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),expectedManifestChecksum:z.string().min(1).max(200).optional(),
    approvalReference:z.string().min(1).max(1000).optional(),attemptId:z.number().int().positive().optional()}).strict();
export type OwnedPublicationRequest=z.input<typeof ownedRequestSchema>;
export interface OwnedPublicationPrincipal{actorId:string;userId:number;profile:string;projectId:number}
export interface OwnedPublicationPackage{protocol:'owned_provider_v1';provider:'dzen';projectId:number;taskId:number;
    channelId:number;revision:number;decisionId:number;decisionVersion:number;selectedAssetId:number;bodySha256:string;
    assetSha256:string;schedule:string;manifest:string;accountId:string;body:string;title:string;assetUrl:string;
    approvalReference:string;releaseActorId:string;digest:string;releaseId:number|null}
export interface OwnedPublicationClaim{attemptId:number;key:string;package:OwnedPublicationPackage;generation:number;
    jobId:string|null;workItemId:number|null;leaseSha256:string|null;eventNamespace?:string;origin?:'legacy_native_v1';nativeObjectId?:string}
export interface OwnedPublicationInventory{complete:boolean;absent:boolean;accountId:string;packageDigest:string;checkedAt:string}
export interface OwnedPublicationReceipt{schemaVersion:'owned-provider-receipt-v1';attemptId:number;key:string;
    packageDigest:string;generation:number;accountId:string;objectId:string;url:string;publishedAt:string;observedAt:string;
    bodySha256:string;assetSha256:string;title:string}
export interface OwnedPublicationBudget{deadline:number;signal:AbortSignal}
export type OwnedPublicationAction='inventory'|'mutation'|'submit'|'readback';
export interface OwnedPublicationAdapter{authorize(operation:OwnedPublicationAction,budget?:OwnedPublicationBudget):Promise<void>;
    inventory(pkg:OwnedPublicationPackage,budget?:OwnedPublicationBudget):Promise<OwnedPublicationInventory>;
    publish(claim:OwnedPublicationClaim,hooks:{beforeMutation:()=>Promise<void>;beforeSubmit:(observation?:{objectId:string;accountId:string})=>Promise<void>},budget?:OwnedPublicationBudget):Promise<OwnedPublicationReceipt>;
    readback(claim:OwnedPublicationClaim,budget?:OwnedPublicationBudget):Promise<OwnedPublicationReceipt|null>}
export interface OwnedPublicationResult{state:'preview'|'released'|'published'|'blocked'|'verification_required';
    project_id:number;task_id:number;retry_allowed:false;attempt_id?:number;job_id?:string;release_id?:number;
    package_sha256?:string;accepted_revision?:number;manifest_checksum?:string;blocker?:string;published_link?:string;external_id?:string}
export const ownedPackageSchema=z.object({protocol:z.literal(OWNED_PROTOCOL),provider:z.literal('dzen'),
    projectId:z.number().int().positive(),taskId:z.number().int().positive(),channelId:z.number().int().positive(),
    revision:z.number().int().positive(),decisionId:z.number().int().positive(),decisionVersion:z.number().int().positive(),selectedAssetId:z.number().int().positive(),
    bodySha256:z.string().regex(/^[a-f0-9]{64}$/),assetSha256:z.string().regex(/^[a-f0-9]{64}$/),schedule:z.string().datetime(),manifest:z.string().min(1),
    accountId:z.string().min(1).max(200),body:z.string().min(1).max(50000),title:z.string().min(1).max(1000),assetUrl:z.string().url().startsWith('https://'),
    approvalReference:z.string().min(1).max(1000),releaseActorId:z.string().regex(/^user:[1-9]\d*$/),digest:z.string().regex(/^[a-f0-9]{64}$/),releaseId:z.number().int().positive().nullable()}).strict();
export const ownedReceiptSchema=z.object({schemaVersion:z.literal('owned-provider-receipt-v1'),attemptId:z.number().int().positive(),key:z.string().min(1).max(200),packageDigest:z.string().regex(/^[a-f0-9]{64}$/),generation:z.number().int().nonnegative(),accountId:z.string().min(1).max(200),objectId:z.string().regex(/^[\w-]{1,200}$/),url:z.string().url(),publishedAt:z.string().datetime(),observedAt:z.string().datetime(),bodySha256:z.string().regex(/^[a-f0-9]{64}$/),assetSha256:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(1).max(1000)}).strict();
export const ownedHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function ownedObject(v:unknown):Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};}
/** Stable canonical material hash survives JSONB property ordering. */
export function ownedDigest(p:OwnedPublicationPackage){const parsed=ownedPackageSchema.parse(p);const{digest:ignored,releaseId:generated,...material}=parsed;return ownedHash(JSON.stringify(material));}
export function checkedOwnedReceipt(value:unknown,c:OwnedPublicationClaim,createdAt:Date,now:Date){
    const r=ownedReceiptSchema.parse(value),p=c.package;
    if(Buffer.byteLength(JSON.stringify(r))>65536||r.attemptId!==c.attemptId||r.key!==c.key||r.packageDigest!==p.digest
        ||r.generation!==c.generation||r.accountId!==p.accountId||r.bodySha256!==p.bodySha256||r.assetSha256!==p.assetSha256||r.title!==p.title
        ||r.url!==`https://dzen.ru/a/${r.objectId}`||Date.parse(r.publishedAt)<createdAt.getTime()-120000
        ||Date.parse(r.observedAt)<Date.parse(r.publishedAt)||Date.parse(r.observedAt)>now.getTime())throw Error('OWNED_RECEIPT_MISMATCH');
    return r;
}
export const ownedClaimSchema=z.object({attemptId:z.number().int().positive(),key:z.string().min(1).max(200),package:ownedPackageSchema,
    generation:z.number().int().nonnegative(),jobId:z.string().uuid().nullable(),workItemId:z.number().int().positive().nullable(),
    leaseSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),eventNamespace:z.string().optional(),origin:z.literal('legacy_native_v1').optional(),nativeObjectId:z.string().regex(/^[\w-]{1,200}$/).optional()}).strict();
