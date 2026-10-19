import {z} from 'zod';
import {linkedinApiError} from './linkedin_api_contract';
export type LinkedInApiAuth={author:string;token:string;signal:AbortSignal};
const objectId=z.string().regex(/^urn:li:(?:share|ugcPost):[1-9]\d*$/),imageId=z.string().regex(/^urn:li:image:[A-Za-z0-9_-]+$/);
export const linkedinPostSchema=z.object({id:objectId,author:z.string(),commentary:z.string(),lifecycleState:z.literal('PUBLISHED'),visibility:z.literal('PUBLIC'),distribution:z.object({feedDistribution:z.literal('MAIN_FEED')}).passthrough(),publishedAt:z.number().int().nonnegative(),content:z.object({media:z.object({id:imageId}).passthrough().optional()}).strict().optional()}).passthrough();
export type LinkedInPost=z.infer<typeof linkedinPostSchema>;
const littleReserved=new Set('|{}@[]()<>#\\*_~'.split(''));
/** This route carries literal accepted copy only, never unapproved rich mentions/templates. */
function encodePlainCommentary(value:string):string{return [...value].map(c=>littleReserved.has(c)?'\\'+c:c).join('');}
function decodePlainCommentary(value:string):string{
 let text='';for(let i=0;i<value.length;i++){const c=value[i];if(c==='\\'){const next=value[++i];if(!next||!littleReserved.has(next))throw linkedinApiError('LINKEDIN_API_CONFLICT');text+=next;}else{if(littleReserved.has(c))throw linkedinApiError('LINKEDIN_API_CONFLICT');text+=c;}}return text;
}
/** Single-request methods only. Durable lifecycle, never this adapter, decides if a write may happen. */
export class LinkedInApiAdapter {
 private readonly request:typeof fetch;
 constructor(private readonly options:{request?:typeof fetch;version?:string}={}){this.request=options.request??fetch;}
 private headers(token:string){const version=this.options.version??'202609';if(!/^20\d{2}(?:0[1-9]|1[0-2])$/.test(version))throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');return {Authorization:`Bearer ${token}`,'Linkedin-Version':version,'X-Restli-Protocol-Version':'2.0.0','Content-Type':'application/json'};}
 private async call(path:string,a:LinkedInApiAuth,method='GET',body?:unknown):Promise<Response>{
  if(a.signal.aborted)throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');
  try{const response=await this.request(`https://api.linkedin.com/rest/${path}`,{method,headers:this.headers(a.token),body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:a.signal});
   if(!response.ok){await response.body?.cancel();throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');}return response;
  }catch{throw linkedinApiError(method==='POST'&&path==='posts'?'LINKEDIN_API_UNKNOWN':'LINKEDIN_API_PROVIDER_UNAVAILABLE');}
 }
 private async json(response:Response):Promise<unknown>{
  const reader=response.body?.getReader();if(!reader)throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>1048576)throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');chunks.push(next.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}
  catch{throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');}finally{await reader.cancel();reader.releaseLock();}
 }
 async initializeImage(a:LinkedInApiAuth):Promise<{id:string;uploadUrl:string}>{
  const parsed=z.object({value:z.object({image:imageId,uploadUrl:z.string().max(10000)})}).safeParse(await this.json(await this.call('images?action=initializeUpload',a,'POST',{initializeUploadRequest:{owner:a.author}})));
  if(!parsed.success)throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');this.uploadDestination(parsed.data.value.uploadUrl);return {id:parsed.data.value.image,uploadUrl:parsed.data.value.uploadUrl};
 }
 private uploadDestination(value:string):URL{
  let url:URL;try{url=new URL(value);}catch{throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');}
  // Provider-issued media upload origin only; never redirects, credentials, arbitrary hosts or ports.
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!['www.linkedin.com','api.linkedin.com'].includes(url.hostname)||!url.pathname.startsWith('/dms-uploads/'))throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');return url;
 }
 async uploadImage(uploadUrl:string,bytes:Buffer,signal:AbortSignal):Promise<void>{
  const url=this.uploadDestination(uploadUrl);if(signal.aborted)throw linkedinApiError('LINKEDIN_API_PROVIDER_UNAVAILABLE');
  try{const response=await this.request(url,{method:'PUT',body:new Uint8Array(bytes),redirect:'error',signal,headers:{'Content-Type':'application/octet-stream'}});await response.body?.cancel();if(!response.ok)throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');}catch{throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');}
 }
 async readImage(id:string,a:LinkedInApiAuth):Promise<boolean>{
  if(!imageId.safeParse(id).success)throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');
  const parsed=z.object({id:imageId,owner:z.string(),status:z.enum(['AVAILABLE','WAITING_UPLOAD','PROCESSING','PROCESSING_FAILED'])}).safeParse(await this.json(await this.call(`images/${encodeURIComponent(id)}`,a)));
  if(!parsed.success||parsed.data.id!==id||parsed.data.owner!==a.author||parsed.data.status==='PROCESSING_FAILED')throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');return parsed.data.status==='AVAILABLE';
 }
 async publish(a:LinkedInApiAuth&{text:string;imageId?:string}):Promise<string>{
  if(a.imageId&&!imageId.safeParse(a.imageId).success)throw linkedinApiError('LINKEDIN_API_MEDIA_INVALID');
  const response=await this.call('posts',a,'POST',{author:a.author,commentary:encodePlainCommentary(a.text),visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false,...(a.imageId?{content:{media:{id:a.imageId}}}:{})});
  const id=objectId.safeParse(response.headers.get('x-restli-id'));await response.body?.cancel();if(response.status!==201||!id.success)throw linkedinApiError('LINKEDIN_API_UNKNOWN');return id.data;
 }
 async readPost(id:string,a:LinkedInApiAuth):Promise<LinkedInPost>{
  if(!objectId.safeParse(id).success)throw linkedinApiError('LINKEDIN_API_UNKNOWN');const parsed=linkedinPostSchema.safeParse(await this.json(await this.call(`posts/${encodeURIComponent(id)}`,a)));
  if(!parsed.success||parsed.data.id!==id||'reshareContext' in parsed.data||'adContext' in parsed.data)throw linkedinApiError('LINKEDIN_API_CONFLICT');return {...parsed.data,commentary:decodePlainCommentary(parsed.data.commentary)};
 }
}
