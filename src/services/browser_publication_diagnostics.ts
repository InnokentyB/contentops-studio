import { z } from 'zod';
import { BrowserDependencies,browserDefaults,requireBrowserOwner,loadBrowserTask,object,hash,checksum,
    browserSnapshotSchema,browserSnapshotMismatches } from './browser_publication_contract';
export const browserDiagnoseSchema=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),
    actorId:z.string().regex(/^user:[1-9]\d*$/),expectedSnapshot:browserSnapshotSchema.optional()}).strict()
    .refine(v=>!v.expectedSnapshot||(v.projectId===v.expectedSnapshot.projectId&&v.taskId===v.expectedSnapshot.taskId),{message:'SCOPE_MISMATCH'});
/** Scoped persisted readback. No credentials, raw leases, copy, errors or browser session access. */
export async function diagnoseBrowserPublication(input:unknown,deps:BrowserDependencies=browserDefaults) {
    const args=browserDiagnoseSchema.parse(input);
    return deps.db.$transaction(async tx=>{
        await requireBrowserOwner(tx,args);const task=await loadBrowserTask(tx,args);
        if(!task)throw new Error('[PUBLICATION_TASK_NOT_FOUND]');
        const [attempts,work]=await Promise.all([
            tx.deliveryAttempt.findMany({where:{project_id:args.projectId,content_item_id:args.taskId},
                select:{id:true,status:true,requires_manual_confirmation:true,created_at:true,actual_published_at:true}}),
            tx.workItem.findMany({where:{project_id:args.projectId,content_item_id:args.taskId,kind:'browser_publish'},
                select:{id:true,state:true,input_context_version:true,lease_expires_at:true}})]);
        const quality=object(task.quality_report),release=object(quality.browser_release);
        const body=object(object(quality.handoff_bundle).publication).body;
        const mismatches=args.expectedSnapshot?browserSnapshotMismatches(task,args.expectedSnapshot):null;
        const assetHash=checksum.safeParse(object(object(task.selected_asset?.provenance).planner_storage).sha256);
        return {project_id:args.projectId,task_id:args.taskId,channel_id:task.channel_id,status:task.status,
            content_revision:task.content_revision,accepted_revision:task.accepted_revision,body_sha256:hash(task.draft_text||''),
            selected_asset_id:task.selected_asset_id,asset_sha256:assetHash.success?assetHash.data:null,
            schedule_at:task.schedule_at,publish_at:task.publish_at,
            content_language:quality.content_language||null,handoff_language:object(quality.handoff_bundle).content_language||null,
            release_snapshot:release.snapshot||null,attempts,browser_work_items:work,
            persisted_handoff:{bundle_present:quality.handoff_bundle!==undefined,
                publication_body_present:typeof body==='string',publication_body_sha256:typeof body==='string'?hash(body):null},
            snapshot_check:mismatches?{valid:mismatches.length===0,mismatches}:null,
            publication_fact:task.publication_fact?{id:task.publication_fact.id,public_url:task.publication_fact.public_url,
                provider_object_id:task.publication_fact.provider_object_id,published_at:task.publication_fact.published_at}:null,
            next_action:task.publication_fact?'read_only':attempts.length?'reconcile_existing_attempt':work.length?'claim_existing_work_item':'owner_preview',
            mutates_state:false,submission_permitted:false,retry_allowed:false};
    });
}
