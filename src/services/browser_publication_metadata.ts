import { buildGeneratedContentItemHandoff } from './publication_plan/handoff';
import { z } from 'zod';
import { BrowserDb,BrowserDependencies,BrowserRequest,requireBrowserOwner,loadBrowserTask,
    browserSnapshotMismatches,assertBrowserSnapshot,object } from './browser_publication_contract';

/** Only an entirely absent legacy bundle can be materialized; divergent evidence is never repaired here. */
export async function browserMetadataRepairContext(tx:BrowserDb,args:BrowserRequest,deps:BrowserDependencies) {
    await requireBrowserOwner(tx,args);
    const manifest=await deps.manifest(args.projectId,Number(args.actorId.slice(5)),tx);
    if(manifest.checksum!==args.snapshot.manifestChecksum)throw new Error('[STALE_MANIFEST]');
    const task=await loadBrowserTask(tx,args);
    if(!task)assertBrowserSnapshot(task,args.snapshot);
    const quality=object(task.quality_report),mismatches=browserSnapshotMismatches(task,args.snapshot);
    const absent=!Object.prototype.hasOwnProperty.call(quality,'handoff_bundle');
    const materialize=absent&&mismatches.length===1
        &&mismatches[0].field==='quality_report.handoff_bundle.publication.body'&&mismatches[0].current_present===false;
    if(materialize&&(task.quality_report===null||typeof task.quality_report!=='object'||Array.isArray(task.quality_report)))
        throw new Error('[BROWSER_HANDOFF_METADATA_INVALID]');
    if(!materialize){assertBrowserSnapshot(task,args.snapshot);return{task,handoff:object(quality.handoff_bundle),materialize:false,mismatches};}
    const where={project_id:args.projectId,content_item_id:args.taskId};
    const [attempt,work,job]=await Promise.all([tx.deliveryAttempt.findFirst({where}),
        tx.workItem.findFirst({where:{...where,kind:'browser_publish'}}),tx.connectorDispatchJob.findFirst({where})]);
    if(task.publication_fact||task.published_link||attempt||work||job)throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
    const identity=args.snapshot.identity;
    // The existing builder uses channel.name for checklist/account instructions.
    // Bind its entire projection to the verified reference, never the display label.
    const generated=buildGeneratedContentItemHandoff({...task,channel:{...task.channel,name:identity.accountRef}},
        {requireAcceptedContent:true});
    const handoff={...generated,mode:'manual',content_language:args.snapshot.contentLanguage,
        task:{...generated.task,account_ref:identity.accountRef},
        account:{ref:identity.accountRef,platform:identity.platform,account_type:identity.accountType,
            profile_url:identity.profileUrl,provider_account_id:identity.providerAccountId}};
    // Re-run the unchanged strict fence against the canonical candidate before any write.
    const canonical=z.record(z.string(),z.json()).parse(handoff);
    assertBrowserSnapshot({...task,quality_report:{...quality,handoff_bundle:canonical}},args.snapshot);
    return{task,handoff:canonical,materialize:true,mismatches};
}
