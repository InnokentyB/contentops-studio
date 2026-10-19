import {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {linkedinApiSnapshotSchema,linkedinApiError,linkedinDigest,type LinkedInApiScope,type LinkedInApiSnapshot} from './linkedin_api_contract';
export const linkedInSerial={isolationLevel:Prisma.TransactionIsolationLevel.Serializable} as const;
export type LinkedInApiTx=Prisma.TransactionClient;
export async function loadLinkedInState(tx:LinkedInApiTx,a:{projectId:number;taskId:number;attemptId:number}){
 const row=await tx.apiDeliveryRecovery.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,attempt_id:a.attemptId,transport:'linkedin_api',contract_version:1}});
 if(!row)throw linkedinApiError('LINKEDIN_API_CONFLICT');const snapshot=linkedinApiSnapshotSchema.parse(row.snapshot);
 if(snapshot.projectId!==a.projectId||snapshot.taskId!==a.taskId||row.package_sha256!==snapshot.expectedBodySha256||row.release_sha256!==snapshot.releaseSha256||row.generation!==1)throw linkedinApiError('LINKEDIN_API_CONFLICT');return {row,snapshot};
}
export async function advanceLinkedInState(tx:LinkedInApiTx,a:{projectId:number;taskId:number;attemptId:number},from:string,to:string,data:Prisma.ApiDeliveryRecoveryUpdateManyMutationInput={}){
 const {row,snapshot}=await loadLinkedInState(tx,a);if(row.state!==from||row.lease_sha256)throw linkedinApiError('LINKEDIN_API_UNKNOWN');
 const changed=await tx.apiDeliveryRecovery.updateMany({where:{id:row.id,project_id:a.projectId,row_version:row.row_version,state:from,generation:1},data:{...data,state:to,row_version:{increment:1}}});
 if(changed.count!==1)throw linkedinApiError('LINKEDIN_API_CONFLICT');await tx.workflowEvent.create({data:{project_id:a.projectId,content_item_id:a.taskId,actor_id:snapshot.actorId,command:'linkedin_api_phase',after_state:{attempt_id:a.attemptId,from,to,generation:1}}});
}
export async function reserveLinkedInRead(tx:LinkedInApiTx,a:LinkedInApiScope&{attemptId:number},now:number){
 const {row,snapshot}=await loadLinkedInState(tx,a);if(!row.post_id||!row.publish_started_at||!row.observed_at||row.state!=='provider_id_recorded')throw linkedinApiError('LINKEDIN_API_UNKNOWN');
 const deadline=row.deadline_at?.getTime()??now+180000;
 if(now>=deadline||row.rounds>=3||row.requests_used>=20)throw linkedinApiError('LINKEDIN_API_READ_BUDGET');
 if(row.lease_expires_at&&row.lease_expires_at.getTime()>now)throw linkedinApiError('LINKEDIN_API_READ_IN_PROGRESS');
 if(row.next_read_at&&row.next_read_at.getTime()>now)throw linkedinApiError('LINKEDIN_API_READ_BACKOFF');
 const lease=linkedinDigest(randomUUID()),expires=new Date(Math.min(now+30000,deadline));
 const changed=await tx.apiDeliveryRecovery.updateMany({where:{id:row.id,row_version:row.row_version,project_id:a.projectId,state:'provider_id_recorded'},data:{rounds:{increment:1},requests_used:{increment:1},deadline_at:new Date(deadline),next_read_at:new Date(now+30000),lease_sha256:lease,lease_expires_at:expires,row_version:{increment:1}}});
 if(changed.count!==1)throw linkedinApiError('LINKEDIN_API_CONFLICT');return {row,snapshot,lease,expires};
}
export async function createLinkedInState(tx:LinkedInApiTx,snapshot:LinkedInApiSnapshot,attemptId:number){
 return tx.apiDeliveryRecovery.create({data:{project_id:snapshot.projectId,content_item_id:snapshot.taskId,attempt_id:attemptId,transport:'linkedin_api',state:'claimed',contract_version:1,package_sha256:snapshot.expectedBodySha256,release_sha256:snapshot.releaseSha256,snapshot}});
}
