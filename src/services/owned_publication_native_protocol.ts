import {z} from 'zod';
import {ownedResourceSchema} from './owned_publication_adapter_resources';
import {ownedPackageSchema,ownedReceiptSchema} from './owned_publication_contract';

const nativeId=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const nativeClaimSchema=z.object({attemptId:z.number().int().positive(),key:z.string().min(1).max(200),
    package:ownedPackageSchema,generation:z.number().int().nonnegative(),jobId:z.string().nullable(),workItemId:z.number().int().nullable(),
    leaseSha256:z.string().nullable(),eventNamespace:z.string().optional(),origin:z.literal('legacy_native_v1').optional(),nativeObjectId:nativeId.optional()}).strict();
export const nativeInvocationSchema=z.object({version:z.literal('owned-native-v1'),nonce:z.string().regex(/^[a-f0-9]{64}$/),
    operation:z.enum(['inventory','publish','readback']),deadline:z.number().int().positive(),package:ownedPackageSchema,claim:nativeClaimSchema.optional()}).strict();
export type OwnedNativeInvocation=z.infer<typeof nativeInvocationSchema>;
export const nativeSecretSchema=z.object({cookies:z.string().min(1).max(65536)}).strict();
export const nativeInventorySchema=z.object({complete:z.boolean(),absent:z.boolean(),accountId:nativeId,
    packageDigest:z.string().regex(/^[a-f0-9]{64}$/),checkedAt:z.string().datetime()}).strict();
export const nativeObservationSchema=z.object({objectId:nativeId,accountId:nativeId}).strict();
export const nativeChildSchema=z.discriminatedUnion('kind',[
    z.object({kind:z.literal('resources'),nonce:z.string(),resources:z.array(ownedResourceSchema).min(1).max(8)}).strict(),
    z.object({kind:z.literal('phase'),nonce:z.string(),sequence:z.number().int(),operation:z.enum(['mutation','submit']),observation:nativeObservationSchema.optional()}).strict(),
    z.object({kind:z.literal('result'),nonce:z.string(),result:z.union([nativeInventorySchema,ownedReceiptSchema,z.null()])}).strict(),
    z.object({kind:z.literal('failure'),nonce:z.string(),code:z.enum(['OWNED_NATIVE_UNCERTAIN','OWNED_NATIVE_CANCELLED','OWNED_NATIVE_INVALID'])}).strict()
]);
export function boundedNative(value:unknown,limit=65536):void{
    let size:number;try{size=Buffer.byteLength(JSON.stringify(value),'utf8');}catch{throw Error('OWNED_NATIVE_INVALID');}
    if(size>limit)throw Error('OWNED_NATIVE_LIMIT');
}
