import {createHash} from 'crypto';
import {z} from 'zod';
import type {OwnedPublicationClaim,OwnedPublicationReceipt} from './owned_publication_contract';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const dzenNativePrimarySchema=z.object({objectId:id,accountId:id,title:z.string().min(1).max(1000),body:z.string().max(50000),
    imageId:id,imageUrl:z.string().max(1000)}).strict();
export type DzenNativePrimary=z.infer<typeof dzenNativePrimarySchema>;
const nativePublishedSchema=z.object({id,publisherId:id,title:z.string(),isPublished:z.literal(true),status:z.literal('published'),
    publishTime:z.number().int(),commonUrl:z.string()}).strict();
export const dzenNativeHash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const dzenNativeBody=(value:string)=>value.replace(/\r\n/g,'\n').replace(/\u00a0/g,' ');
export function dzenNativeUncertain():never{throw Error('OWNED_NATIVE_UNCERTAIN');}
export function dzenNativeCover(primary:DzenNativePrimary):string{
    const p=dzenNativePrimarySchema.parse(primary);
    if(!new RegExp(`^https://avatars\\.dzeninfra\\.ru/get-zen_doc/[0-9]+/pub_${p.objectId}_${p.imageId}/orig$`).test(p.imageUrl))return dzenNativeUncertain();
    return p.imageUrl;
}
export function verifyDzenNativePrimary(claim:OwnedPublicationClaim,input:unknown,cover:Uint8Array,objectId:string):DzenNativePrimary{
    const p=dzenNativePrimarySchema.parse(input),expected=claim.package;
    if(p.objectId!==objectId||p.accountId!==expected.accountId||p.title!==expected.title||dzenNativeBody(p.body)!==dzenNativeBody(expected.body)
        ||dzenNativeHash(expected.body)!==expected.bodySha256||cover.length<1||cover.length>2000000||dzenNativeHash(cover)!==expected.assetSha256)return dzenNativeUncertain();
    dzenNativeCover(p);return p;
}
/** Same object/account across response, Studio, primary body and original cover; no substring or URL-only proof. */
export function verifyDzenNativeReceipt(claim:OwnedPublicationClaim,submit:unknown,row:unknown,primary:unknown,cover:Uint8Array,observedAt:string):OwnedPublicationReceipt{
    const native=z.object({id,publisherId:id}).strict().parse(submit),published=nativePublishedSchema.parse(row);
    const p=verifyDzenNativePrimary(claim,primary,cover,native.id),stamp=Date.parse(observedAt);
    if(native.publisherId!==p.accountId||published.publisherId!==p.accountId||published.id!==native.id||published.title!==p.title
        ||published.commonUrl!==`https://dzen.ru/a/${p.objectId}`||published.publishTime<Date.UTC(2000,0,1)||published.publishTime>stamp||!Number.isFinite(stamp))return dzenNativeUncertain();
    return {schemaVersion:'owned-provider-receipt-v1',attemptId:claim.attemptId,key:claim.key,packageDigest:claim.package.digest,generation:claim.generation,
        accountId:p.accountId,objectId:p.objectId,url:published.commonUrl,publishedAt:new Date(published.publishTime).toISOString(),observedAt,
        bodySha256:claim.package.bodySha256,assetSha256:claim.package.assetSha256,title:p.title};
}
