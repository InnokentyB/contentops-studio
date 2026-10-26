import {z} from 'zod';
const digest=z.string().regex(/^[a-f0-9]{64}$/),ordinal=z.number().int().positive(),time=z.number().finite();
const reference=z.string().max(500).regex(/^codex-control:\/\/local\/thread\/[a-f0-9-]{36}\/turn\/[a-f0-9-]{36}\/call\/[\w-]+$/);
export const terminalScope=z.object({projectId:ordinal,taskId:ordinal,attemptId:ordinal,expectedManifestChecksum:z.string().min(1).max(200),idempotencyKey:z.string().min(1).max(120)}).strict();
export const terminalPrincipal=z.object({userId:ordinal,actorId:z.string().regex(/^user:[1-9]\d*$/),projectId:ordinal,profile:z.enum(['owner','publisher'])}).strict();
export type TerminalPrincipal=z.infer<typeof terminalPrincipal>;
const operation=z.object({callId:z.string().min(1).max(200),ordinal,argumentsSha256:digest,status:z.enum(['completed','failed']),terminalOrdinal:ordinal,completedAtMs:time}).strict();
const item=z.object({providerId:z.string().min(1).max(300),earliestMs:time,latestMs:time,bodySha256:digest,assetSha256:digest.nullable()}).strict();
export const terminalEvidence=z.object({controlReference:reference,archiveSha256:digest,collectorSha256:digest,browserInstanceId:z.string().min(1).max(200),
 observation:z.object({schemaVersion:z.literal(1),kind:z.literal('LOCAL_ARCHIVE_TERMINAL_OBSERVATION'),threadId:z.string().uuid(),turnId:z.string().uuid(),
  start:z.object({ordinal,timestamp:z.string().datetime()}).strict(),end:z.object({ordinal,timestamp:z.string().datetime(),kind:z.enum(['task_complete','turn_aborted'])}).strict(),
  operations:z.array(operation).max(100),custodyGranted:z.literal(false),nativeQueueDrainProven:z.literal(false),providerAbsenceProven:z.literal(false),submissionPermitted:z.literal(false)}).strict(),
 declarations:z.array(z.object({callId:z.string().min(1).max(200),argumentsJson:z.string().max(262144)}).strict()).max(100),
 // Until a non-CUA transport and AX-bound preparation are independently implemented, deny both.
 otherOperations:z.array(z.unknown()).max(0),axBindings:z.array(z.unknown()).max(0),
 originalStart:z.object({callId:z.string().min(1).max(200),ordinal,projectId:ordinal,taskId:ordinal,attemptId:ordinal,workItemId:ordinal,keySha256:digest,leaseSha256:digest,snapshotSha256:digest}).strict(),
 providerWindow:z.object({controlReference:reference,profileUrl:z.string().url(),providerAccountId:z.string(),accountType:z.string(),startedAtMs:time,observedAtMs:time,
  view:z.literal('PUBLISHED'),order:z.literal('TIMESTAMP_DESC'),filters:z.array(z.unknown()).max(0),pinned:z.array(z.unknown()).max(0),gaps:z.array(z.unknown()).max(0),topBoundary:z.literal('OBSERVED'),
  pages:z.array(z.object({sourceCallId:z.string().min(1).max(200),ordinal,previousPageSha256:digest.nullable(),items:z.array(item).min(1).max(100)}).strict()).min(1).max(20)}).strict()
}).strict();
export type TerminalEvidence=z.infer<typeof terminalEvidence>;
export const terminalMetadata=terminalEvidence.omit({declarations:true,otherOperations:true,axBindings:true});
export type TerminalMetadata=z.infer<typeof terminalMetadata>;
