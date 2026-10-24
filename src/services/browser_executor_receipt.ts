import {createHash,createPublicKey,verify} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {PublicationDiagnosticError} from './publication_diagnostics';

const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.number().int().positive().safe();
const binding=z.object({projectId:id,taskId:id,attemptId:id,workItemId:id,
 packageSha256:sha,approvalSha256:sha,leaseSha256:sha,attemptKeySha256:sha,
 runtimeSha256:sha,epochSha256:sha,contextSha256:sha,profileSha256:sha,nativeContractSha256:sha,
 generation:z.number().int().nonnegative().safe(),challengeSha256:sha,
 purpose:z.enum(['fence_legacy','quiesce','profile_read']),issuerId:z.string().min(1).max(100),
 issuedAtMs:z.number().int().nonnegative().safe(),expiresAtMs:z.number().int().positive().safe()}).strict();
const payload=binding.extend({evidenceSha256:sha}).strict();
const envelope=z.object({payload,signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)}).strict();
const publicKey=z.object({kty:z.literal('EC'),crv:z.literal('P-256'),
 x:z.string().regex(/^[A-Za-z0-9_-]{43}$/),y:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
const registration=z.object({issuerId:z.string().min(1).max(100),publicKey,
 runtimeSha256:sha,epochSha256:sha,contextSha256:sha,profileSha256:sha,nativeContractSha256:sha}).strict();
export type BrowserExecutorExpectation=z.infer<typeof binding>;
export const browserExecutorExpectationSchema=binding;
export type BrowserExecutorRegistration=z.infer<typeof registration>;
export const browserExecutorRegistrationSchema=registration;
const fail=(field:string):never=>{throw new PublicationDiagnosticError({code:'BROWSER_EXECUTOR_RECEIPT_INVALID',
 message:'The original-executor evidence could not be authenticated against the current registered challenge.',retry_allowed:false,
 reasons:[{code:'BROWSER_EXECUTOR_RECEIPT_INVALID',field,message:'The receipt failed an original-executor evidence check.',
 action:'Inspect the registered original runtime and current durable challenge through the owning controller. Preserve the same attempt; do not renew a lease, submit or treat a signed assertion as native stop proof.'}]});};
/** Canonical bounded native proof digest: JSON property order must not affect authenticated evidence. */
export function browserExecutorEvidenceSha256(input:unknown):string {
 let nodes=0;
 const canonical=(v:unknown,depth:number):string=>{
  if(++nodes>10000||depth>32)return fail('receipt.evidence');
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(typeof v==='string'){if(v.length>262144)return fail('receipt.evidence');return JSON.stringify(v);}
  if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+canonical(x,depth+1)).join(',')+'}';
  return fail('receipt.evidence');
 };
 const value=canonical(input,0);if(Buffer.byteLength(value)>262144)return fail('receipt.evidence');
 return createHash('sha256').update(value).digest('hex');
}
/** Flat validated payload, sorted keys and a domain separator; no provider content or credentials. */
export function browserExecutorReceiptMessage(input:unknown):string {
 const parsed=payload.safeParse(input);if(!parsed.success)return fail('receipt.schema');
 const sorted=Object.fromEntries(Object.entries(parsed.data).sort(([a],[b])=>a<b?-1:a>b?1:0));
 return 'ContentOps:browser-executor:evidence:v1\n'+JSON.stringify(sorted);
}
/** Registration and expectation are SERVER-owned. Authentication alone grants no fence, pickup or Submit authority.
 * Caller must revalidate and consume the pending challenge in the same durable transaction as the recovery transition.
 * Never call this with a caller-supplied key/registration or interpret it as native CUA attestation. */
export function verifyBrowserExecutorReceipt(input:unknown,expectedInput:BrowserExecutorExpectation,
 registeredInput:BrowserExecutorRegistration,now:number,expectedEvidenceSha256?:string):{authenticated:true;evidenceRef:string} {
 const receipt=envelope.safeParse(input),expected=binding.safeParse(expectedInput),pin=registration.safeParse(registeredInput);
 if(!receipt.success||!expected.success||!pin.success)return fail('receipt.schema');
 const {evidenceSha256,...actual}=receipt.data.payload;
 if(expectedEvidenceSha256!==undefined&&evidenceSha256!==expectedEvidenceSha256)return fail('receipt.evidence');
 if(!isDeepStrictEqual(actual,expected.data))return fail('receipt.binding');
 for(const key of ['issuerId','runtimeSha256','epochSha256','contextSha256','profileSha256','nativeContractSha256'] as const)
  if(actual[key]!==pin.data[key])return fail('receipt.registration');
 if(!Number.isSafeInteger(now)||actual.expiresAtMs<=actual.issuedAtMs
  ||actual.expiresAtMs-actual.issuedAtMs>30000||now<actual.issuedAtMs||now>=actual.expiresAtMs)return fail('receipt.deadline');
 const message=browserExecutorReceiptMessage(receipt.data.payload);
 let valid=false;
 try{valid=verify('sha256',Buffer.from(message),{key:createPublicKey({key:pin.data.publicKey,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(receipt.data.signature,'base64url'));}
 catch{return fail('receipt.signature');}
 if(!valid)return fail('receipt.signature');
 // Hash the complete authenticated envelope: source evidence reference alone is not the signed binding.
 const digest=createHash('sha256').update(message+'\n'+receipt.data.signature).digest('hex');
 return {authenticated:true,evidenceRef:`sha256:${digest}`};
}
