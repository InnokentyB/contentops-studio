import {createHash} from 'crypto';
import {z} from 'zod';

export const threadsSnapshotSchema=z.object({
    projectId:z.number().int().positive(), taskId:z.number().int().positive(), channelId:z.number().int().positive(),
    actorId:z.string().regex(/^user:[1-9]\d*$/), manifestChecksum:z.string(),
    revision:z.number().int().positive(), bodySha256:z.string().regex(/^[a-f0-9]{64}$/),
    releaseKey:z.string().min(1), releaseSha256:z.string().regex(/^[a-f0-9]{64}$/),
    userId:z.string().regex(/^\d+$/), username:z.string().regex(/^[A-Za-z0-9_.]+$/)
}).strict();
export type ThreadsApiSnapshot=z.infer<typeof threadsSnapshotSchema>;
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const threadsReconcileSchema=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),
    attemptId:z.number().int().positive(),actorId:z.string().regex(/^user:[1-9]\d*$/),
    expectedManifestChecksum:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).strict();
export type ThreadsReconcileArgs=z.infer<typeof threadsReconcileSchema>;
/** Exact package fields are provider-independent approved data, never new business identifiers. */
export function assertThreadsPackageProof(proof:Record<string,unknown>,expected:Record<string,string|number|null|undefined>){
    if(Object.entries(expected).some(([key,value])=>value===undefined||proof[key]!==value))
        throw new Error('[THREADS_RECOVERY_PACKAGE_CHANGED]');
}

const profile=z.object({id:z.string().regex(/^\d+$/),username:z.string()});
const post=z.object({id:z.string().regex(/^\d+$/),username:z.string(),text:z.string(),permalink:z.string(),
    timestamp:z.string(),media_type:z.literal('TEXT_POST'),is_reply:z.literal(false)});
export function assertThreadsRecoveryProfile(value:unknown,snapshot:ThreadsApiSnapshot){
    const parsed=profile.safeParse(value);
    if(!parsed.success||parsed.data.id!==snapshot.userId||parsed.data.username!==snapshot.username)
        throw new Error('[THREADS_RECOVERY_ACCOUNT_MISMATCH]');
}
/** A known provider object, never text-history similarity, is the recovery identity. */
export function verifyThreadsRecovery(profileValue:unknown,postValue:unknown,snapshot:ThreadsApiSnapshot,
    postId:string,start:Date,end:Date){
    assertThreadsRecoveryProfile(profileValue,snapshot);
    const object=post.safeParse(postValue);
    if(!object.success)throw new Error('[THREADS_RECOVERY_READBACK_MISMATCH]');
    const p=object.data;let url:URL;
    try{url=new URL(p.permalink);}catch{throw new Error('[THREADS_RECOVERY_READBACK_MISMATCH]');}
    const time=Date.parse(p.timestamp);
    if(p.id!==postId||p.username!==snapshot.username||digest(p.text)!==snapshot.bodySha256
        ||!Number.isFinite(time)||time<start.getTime()||time>end.getTime()
        ||url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash
        ||!['threads.net','www.threads.net','threads.com','www.threads.com'].includes(url.hostname)
        ||!new RegExp(`^/@${snapshot.username.replace(/\./g,'\\.')}\\/post\\/[A-Za-z0-9_-]+\\/?$`).test(url.pathname))
        throw new Error('[THREADS_RECOVERY_READBACK_MISMATCH]');
    return {id:p.id,url:url.toString(),publishedAt:p.timestamp};
}
