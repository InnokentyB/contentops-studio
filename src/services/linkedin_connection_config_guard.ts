import {isDeepStrictEqual} from 'node:util';
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const owns=(value:Record<string,unknown>,key:string):boolean=>Object.prototype.hasOwnProperty.call(value,key);
export class LinkedInConnectionFieldsProtected extends Error {
 readonly code='LINKEDIN_CONNECTION_FIELDS_PROTECTED';
 readonly action='Reconnect the exact LinkedIn channel through Settings to change its verified connection or author identity.';
 constructor(){super('Verified LinkedIn connection fields can only be changed by the governed connection flow.');}
}
/** Generic settings cannot manufacture OAuth evidence or replace its bound credential/author. */
export function protectLinkedInConnectionConfig(incoming:unknown,current:unknown={},inheritedProof=false,depth=0):Record<string,unknown>{
 if(depth>32)throw new LinkedInConnectionFieldsProtected();
 const next=object(incoming),existing=object(current),verified=inheritedProof||owns(existing,'linkedin_oauth');
 const protectedFields=['linkedin_oauth','access_token_encrypted',...(verified?['linkedin_urn','account_type','access_token']:[])];
 for(const key of protectedFields){
  if(!owns(next,key))continue;
  if(key==='access_token'&&next[key]==='******')continue;
  if(!owns(existing,key)||!isDeepStrictEqual(next[key],existing[key]))throw new LinkedInConnectionFieldsProtected();
 }
 const merged={...existing,...next};
 for(const key of protectedFields)if(owns(existing,key))merged[key]=existing[key];
 if(owns(next,'raw_account')||owns(existing,'raw_account')){
  if(owns(next,'raw_account')&&(next.raw_account===null||typeof next.raw_account!=='object'||Array.isArray(next.raw_account)))throw new LinkedInConnectionFieldsProtected();
  merged.raw_account=protectLinkedInConnectionConfig(next.raw_account,existing.raw_account,verified,depth+1);
 }
 return merged;
}
