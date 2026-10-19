import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {loadAgentWorkspaceManifest} from './agent_workspace_manifest.service';
import {assertVisualReassessmentReady,lockVisualContent,VisualDecisionCode} from './visual_reassessment_binding';
import {validateLinkedInNativeText} from './linkedin_content_contract';
import {LinkedInApiProtocol,linkedinDigest,linkedinObject,linkedinApiError, type LinkedInApiScope,type LinkedInApiSnapshot} from './linkedin_api_contract';
export const linkedinCredentialSchema=z.object({token:z.string().min(1),verified:z.literal(true),expiresAt:z.string().datetime(),scopes:z.array(z.string()),memberUrn:z.string(),authorUrn:z.string(),accountKind:z.enum(['personal','organization']),clientId:z.string().min(1),verifiedAt:z.string().datetime(),organizationAuthorized:z.boolean(),imageReadAuthorized:z.boolean(),postReadAuthorized:z.literal(true)});
export type LinkedInCredential=z.infer<typeof linkedinCredentialSchema>;
export type CredentialResolver=(config:unknown,binding:{projectId:number;channelId:number})=>Promise<unknown>;
export const LINKEDIN_RELEASE_COMMAND='ba_release_linkedin_api_publication';
export async function requireLinkedInOwner(tx:Prisma.TransactionClient,a:{projectId:number;actorId:string}){
 const id=Number(/^user:([1-9]\d*)$/.exec(a.actorId)?.[1]);if(!Number.isSafeInteger(id))throw linkedinApiError('LINKEDIN_API_CONFLICT');
 await tx.$queryRaw`SELECT id FROM planner.users WHERE id=${id} FOR SHARE`;
 await tx.$queryRaw`SELECT id FROM planner.project_members WHERE project_id=${a.projectId} AND user_id=${id} FOR SHARE`;
 const member=await tx.projectMember.findUnique({where:{project_id_user_id:{project_id:a.projectId,user_id:id}},include:{user:true}});
 if(member?.role!=='owner'||member.user.is_demo)throw linkedinApiError('LINKEDIN_API_OWNER_REQUIRED');return id;
}
export function verifiedLinkedInCredential(value:unknown,now:number,image:boolean):LinkedInCredential{
 const p=linkedinCredentialSchema.safeParse(value);if(!p.success)throw linkedinApiError('LINKEDIN_API_GRANTS_REQUIRED');const c=p.data;
 const person=c.accountKind==='personal';if(!/^urn:li:person:[A-Za-z0-9_-]+$/.test(c.memberUrn)||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=now+60_000||Date.parse(c.verifiedAt)>now||!c.scopes.includes(person?'w_member_social':'w_organization_social')||!c.scopes.includes(person?'r_member_social':'r_organization_social')||(person?c.authorUrn!==c.memberUrn:!/^urn:li:organization:[1-9]\d*$/.test(c.authorUrn)||!c.organizationAuthorized)||(image&&!c.imageReadAuthorized))throw linkedinApiError('LINKEDIN_API_GRANTS_REQUIRED');return c;
}
export function credentialSha(c:LinkedInCredential){const {token:secret,...metadata}=c;return linkedinDigest(JSON.stringify({...metadata,credentialSha256:linkedinDigest(secret)}));}
/** Package is read under the canonical content lock at every authority boundary. */
export async function inspectLinkedInPackage(tx:Prisma.TransactionClient,a:LinkedInApiScope,resolve:CredentialResolver,now:number,mode:'approval_required'|'owner_released',attemptId?:number){
 const userId=await requireLinkedInOwner(tx,a);
 const binding=await tx.contentItem.findFirst({where:{project_id:a.projectId,id:a.taskId},select:{channel_id:true}});
 if(!binding?.channel_id)throw linkedinApiError('LINKEDIN_API_CONFLICT');
 await tx.$queryRaw`SELECT id FROM planner.social_channels WHERE project_id=${a.projectId} AND id=${binding.channel_id} FOR SHARE`;
 await lockVisualContent(tx,a.projectId,a.taskId);
 const manifest=await loadAgentWorkspaceManifest(a.projectId,userId,tx);if(manifest.checksum!==a.expectedManifestChecksum)throw linkedinApiError('LINKEDIN_API_CONFLICT');
 const task=await tx.contentItem.findFirst({where:{project_id:a.projectId,id:a.taskId},include:{channel:true,publication_fact:true,selected_asset:true}});
 if(!task||task.channel?.project_id!==a.projectId||task.channel.type!=='linkedin'||!task.channel.is_active)throw linkedinApiError('LINKEDIN_API_CONFLICT');
 await assertVisualReassessmentReady(tx,a.projectId,a.taskId);
 if(task.quality_report!==null&&(typeof task.quality_report!=='object'||Array.isArray(task.quality_report)))throw linkedinApiError('LINKEDIN_API_CONFLICT');
 const quality=linkedinObject(task.quality_report),config=linkedinObject(task.channel.config);
 const attempts=await tx.deliveryAttempt.findMany({where:{project_id:a.projectId,content_item_id:a.taskId}});
 const otherApi=await tx.apiDeliveryRecovery.findMany({where:{project_id:a.projectId,content_item_id:a.taskId}});
 if(attemptId?otherApi.length!==1||otherApi[0].attempt_id!==attemptId||otherApi[0].transport!=='linkedin_api':otherApi.length>0)throw linkedinApiError('LINKEDIN_API_CONFLICT');
 const browser=await tx.workItem.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,state:{notIn:['completed','cancelled']}}});
 const decision=await tx.artDirectionDecision.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,status:'active',source_content_revision:task.content_revision,channel:LinkedInApiProtocol.Provider,placement:'feed'},orderBy:{decision_version:'desc'}});
 const review=await tx.workItem.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,kind:'content_review',state:'completed',input_context_version:task.content_revision}});
 const art=await tx.workItem.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,kind:'art_direction',state:'completed',input_context_version:task.content_revision}});
 const asset=task.selected_asset,media=linkedinObject(linkedinObject(asset?.provenance).planner_storage),hasImage=task.selected_asset_id!==null;
 const visual=hasImage?task.visual_state==='APPROVED'&&asset?.id===task.selected_asset_id&&asset.project_id===a.projectId&&asset.content_item_id===a.taskId&&asset.status==='approved'&&asset.content_revision===task.content_revision&&asset.decision_id===decision?.id&&asset.placement==='feed'&&/^[a-f0-9]{64}$/.test(String(media.sha256))&&decision?.decision!==VisualDecisionCode.NotNeeded&&decision?.decision!==VisualDecisionCode.Blocked:task.visual_state==='NO_VISUAL_NEEDED'&&!asset&&decision?.decision===VisualDecisionCode.NotNeeded&&task.visual_mode!=='required';
 if(!review||!art||!decision||decision.decision_version!==task.visual_decision_version||!visual||browser||quality.publication_hold||task.text_state!=='accepted'||task.accepted_revision!==task.content_revision||task.visual_placement!=='feed'||task.handoff_state!=='ready'||task.publication_mode!==mode||task.status!==(attemptId?'publishing':'ready_for_execution')||task.publication_fact||task.published_link||!task.draft_text?.trim()||task.draft_text.length>3000||!validateLinkedInNativeText(task.draft_text).valid||!task.schedule_at||task.publish_at?.getTime()!==task.schedule_at.getTime()||!['linkedin_api'].includes(String(config.publication_transport??config.connector_mode))||(attemptId?attempts.length!==1||attempts[0].id!==attemptId||attempts[0].status!=='pending':attempts.length>0))throw linkedinApiError('LINKEDIN_API_CONFLICT');
 const credential=verifiedLinkedInCredential(await resolve(task.channel.config,{projectId:a.projectId,channelId:task.channel.id}),now,hasImage);
 return {task,decision,credential,connectionSha256:credentialSha(credential),bodySha256:linkedinDigest(task.draft_text),assetSha256:hasImage?String(media.sha256):null};
}
export async function checkLinkedInSnapshot(tx:Prisma.TransactionClient,s:LinkedInApiSnapshot,resolve:CredentialResolver,now:number,attemptId?:number){
 const current=await inspectLinkedInPackage(tx,s,resolve,now,'owner_released',attemptId);
 if(current.task.content_revision!==s.expectedContentRevision||current.task.channel_id!==s.expectedChannelId||current.bodySha256!==s.expectedBodySha256||current.task.selected_asset_id!==s.expectedSelectedAssetId||current.assetSha256!==s.expectedAssetSha256||current.decision.id!==s.expectedDecisionId||current.task.schedule_at?.toISOString()!==s.expectedScheduleAt||current.connectionSha256!==s.connectionSha256||current.credential.authorUrn!==s.expectedAuthorUrn)throw linkedinApiError('LINKEDIN_API_CONFLICT');
 const release=await tx.workflowEvent.findFirst({where:{project_id:s.projectId,content_item_id:s.taskId,actor_id:s.actorId,command:LINKEDIN_RELEASE_COMMAND,idempotency_key:s.idempotencyKey},orderBy:{id:'desc'}});
 if(!release||linkedinDigest(JSON.stringify(release.after_state))!==s.releaseSha256)throw linkedinApiError('LINKEDIN_API_CONFLICT');return current;
}
