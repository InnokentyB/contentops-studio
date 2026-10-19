import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import type {BrowserRecoveryPort,RecoveryContext,RecoveryReadControl,VerifiedRecoveryEvidence} from './browser_recovery_contract';
const digest=z.string().regex(/^[a-f0-9]{64}$/),objectId=z.string().regex(/^urn:li:(?:share|ugcPost):[1-9]\d*$/);
const scope=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),attemptId:z.number().int().positive(),packageSha256:digest}).strict();
const bindingSchema=z.object({route:z.literal('linkedin_api'),readAdmission:z.literal(true),authorUrn:z.string().regex(/^urn:li:(?:person:[A-Za-z0-9_-]+|organization:[1-9]\d*)$/),accountSha256:digest,accessToken:z.string().min(1).max(10000),apiVersion:z.string().regex(/^20\d{2}(?:0[1-9]|1[0-2])$/),permissions:z.array(z.string()).max(100),receipt:z.object({scope,accountSha256:digest,objectId,source:z.literal('admitted_executor_receipt'),media:z.object({providerMediaId:z.string().regex(/^urn:li:image:[A-Za-z0-9_-]+$/),assetSha256:digest}).strict().optional()}).strict().optional()}).strict();
type Binding=z.infer<typeof bindingSchema>;
const postSchema=z.object({id:objectId,author:z.string(),commentary:z.string().max(100000),lifecycleState:z.literal('PUBLISHED'),publishedAt:z.number().int().nonnegative(),visibility:z.literal('PUBLIC'),distribution:z.object({feedDistribution:z.literal('MAIN_FEED')}).passthrough(),content:z.object({media:z.object({id:z.string()}).passthrough()}).strict().optional()}).passthrough();
type Options={resolve:(context:RecoveryContext)=>Promise<unknown>;fetch?:typeof fetch;now?:()=>number};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const result=(kind:string)=>({kind});
class ReadFailure extends Error {constructor(readonly kind:string){super(kind);}}
/** Application-owned resolve must attest approved API route, grants and trusted original-attempt receipts; no request accepts this configuration. */
export function createLinkedInRecoveryReader(options:Options):BrowserRecoveryPort {
 const request=options.fetch??fetch,now=options.now??Date.now;
 const requests=new WeakMap<RecoveryReadControl,number>();
 const issued=new WeakMap<object,{context:RecoveryContext;binding:Binding;evidence:VerifiedRecoveryEvidence}>();
 const active=(control:RecoveryReadControl)=>!control.signal.aborted&&now()<control.deadlineMs;
 async function binding(context:RecoveryContext):Promise<Binding>{
  const parsed=bindingSchema.safeParse(await options.resolve(context));
  if(!parsed.success)throw new ReadFailure('COVERAGE_INCOMPLETE');
  const value=parsed.data,permission=value.authorUrn.startsWith('urn:li:person:')?'r_member_social':'r_organization_social';
  if(context.provider!=='linkedin'||value.accountSha256!==context.accountSha256||!value.permissions.includes(permission))throw new ReadFailure('PERMISSION_DENIED');
  if(value.receipt&&(!isDeepStrictEqual(value.receipt.scope,context.scope)||value.receipt.accountSha256!==context.accountSha256||(context.knownObjectId&&context.knownObjectId!==value.receipt.objectId)))throw new ReadFailure('COVERAGE_INCOMPLETE');
  return value;
 }
 async function get(path:string,b:Binding,control:RecoveryReadControl):Promise<unknown>{
  const used=requests.get(control)??0;
  if(!active(control)||!Number.isSafeInteger(control.maxRequests)||used>=control.maxRequests||!await control.takeRequest()||!active(control))throw new ReadFailure('TEMPORARY_UNAVAILABLE');
  requests.set(control,used+1);
  const response=await request(`https://api.linkedin.com/rest/posts${path}`,{method:'GET',redirect:'error',signal:control.signal,headers:{Authorization:`Bearer ${b.accessToken}`,'Linkedin-Version':b.apiVersion,'X-Restli-Protocol-Version':'2.0.0'}});
  if(!active(control))throw new ReadFailure('TEMPORARY_UNAVAILABLE');
  if(!response.ok){await response.body?.cancel();throw new ReadFailure([401,403].includes(response.status)?'PERMISSION_DENIED':response.status===404?'NOT_FOUND':[429,500,502,503,504].includes(response.status)?'TEMPORARY_UNAVAILABLE':'COVERAGE_INCOMPLETE');}
  const reader=response.body?.getReader();if(!reader)throw new ReadFailure('COVERAGE_INCOMPLETE');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){if(!active(control))throw new ReadFailure('TEMPORARY_UNAVAILABLE');const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>1048576)throw new ReadFailure('COVERAGE_INCOMPLETE');chunks.push(next.value);}}finally{await reader.cancel();reader.releaseLock();}
  if(!active(control))throw new ReadFailure('TEMPORARY_UNAVAILABLE');
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw new ReadFailure('COVERAGE_INCOMPLETE');}
 }
 function evidence(context:RecoveryContext,b:Binding,value:unknown):VerifiedRecoveryEvidence|undefined{
  const parsed=postSchema.safeParse(value);if(!parsed.success||!b.receipt)return undefined;const post=parsed.data;
  if('reshareContext' in post||'adContext' in post)return undefined;
  if(post.id!==b.receipt.objectId||post.author!==b.authorUrn||hash(post.commentary)!==context.bodySha256||post.publishedAt<context.publishedAfterMs||post.publishedAt>context.publishedBeforeMs)return undefined;
  if(context.assetSha256===null){if(post.content||b.receipt.media)return undefined;}
  else if(!post.content||!b.receipt.media||post.content.media.id!==b.receipt.media.providerMediaId||b.receipt.media.assetSha256!==context.assetSha256)return undefined;
  const observedAtMs=now();
  return {schemaVersion:1,provider:'linkedin',accountSha256:b.accountSha256,packageSha256:context.scope.packageSha256,bodySha256:hash(post.commentary),assetSha256:b.receipt.media?.assetSha256??null,providerObjectId:post.id,publicUrl:`https://www.linkedin.com/feed/update/${post.id}/`,publishedAtMs:post.publishedAt,observedAtMs,evidenceRef:`sha256:${hash(JSON.stringify({scope:context.scope,author:post.author,id:post.id,body:hash(post.commentary),media:b.receipt.media??null,publishedAt:post.publishedAt,observedAtMs}))}`};
 }
 async function history(context:RecoveryContext,b:Binding,control:RecoveryReadControl):Promise<void>{
  let start=0;
  while(active(control)){
   const page=await get(`?q=author&author=${encodeURIComponent(b.authorUrn)}&count=100&start=${start}`,b,control);
   const parsed=z.object({elements:z.array(z.unknown()).max(100),paging:z.object({start:z.number().int().nonnegative(),count:z.number().int().positive().max(100),total:z.number().int().nonnegative()}).passthrough()}).passthrough().safeParse(page);
   if(!parsed.success||parsed.data.paging.start!==start)throw new ReadFailure('COVERAGE_INCOMPLETE');
   const {paging,elements}=parsed.data;if(start+elements.length>=paging.total)return;
   if(!elements.length||elements.length!==paging.count)throw new ReadFailure('COVERAGE_INCOMPLETE');start+=elements.length;
  }
  throw new ReadFailure('TEMPORARY_UNAVAILABLE');
 }
 return {timeoutMs:30000,read:async(context,control)=>{
  try{if(!active(control))return result('TEMPORARY_UNAVAILABLE');const b=await binding(context);
   if(!b.receipt){await history(context,b,control);return result('COVERAGE_INCOMPLETE');}
   const found=evidence(context,b,await get(`/${encodeURIComponent(b.receipt.objectId)}`,b,control));
   if(!found)return result('COVERAGE_INCOMPLETE');const candidate={providerObjectId:found.providerObjectId};issued.set(candidate,{context:structuredClone(context),binding:b,evidence:found});return {kind:'FOUND',evidence:candidate};
  }catch(error:unknown){return result(error instanceof ReadFailure?error.kind:'TEMPORARY_UNAVAILABLE');}
 },verify:async(context,candidate,control)=>{
  if(!candidate||typeof candidate!=='object'||!active(control))return undefined;
  const prior=issued.get(candidate);issued.delete(candidate);if(!prior||!isDeepStrictEqual(prior.context,context))return undefined;
  try{const b=await binding(context);if(!isDeepStrictEqual(b,prior.binding)||!b.receipt)return undefined;return evidence(context,b,await get(`/${encodeURIComponent(b.receipt.objectId)}`,b,control));}catch{return undefined;}
 }};
}
