import type { Prisma } from '@prisma/client';
import { ownerManualDigest } from './owner_manual_publication_contract';
export async function ownerManualFactSha(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, projectId: number, taskId: number): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{
        sha: string;
    }>> `SELECT encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') AS sha FROM planner.publication_facts f WHERE project_id=${projectId} AND content_item_id=${taskId}`;
    return rows[0]?.sha || null;
}
export async function ownerManualSnapshot(tx: Prisma.TransactionClient, projectId: number, taskId: number) {
    const task = await tx.$queryRaw<Array<{
        sha: string;
    }>> `SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS sha FROM planner.content_items t WHERE project_id=${projectId} AND id=${taskId}`;
    const custody = await tx.$queryRaw<Array<{
        kind: string;
        id: number;
        sha: string;
    }>> `SELECT 'work' AS kind,id,encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex') AS sha FROM planner.work_items w WHERE project_id=${projectId} AND content_item_id=${taskId} UNION ALL SELECT 'event',id,encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') FROM planner.workflow_events e WHERE project_id=${projectId} AND content_item_id=${taskId} ORDER BY kind,id`;
    return { task_snapshot_sha256: task[0]?.sha, custody_sha256: ownerManualDigest(custody), expected_fact_sha256: await ownerManualFactSha(tx, projectId, taskId) };
}
export async function ownerManualPreserved(tx: Prisma.TransactionClient, projectId: number, taskId: number) {
    const rows = await tx.$queryRaw<Array<{
        kind: string;
        id: string;
        sha: string;
    }>> `WITH custody AS (
 SELECT 'attempt' kind,id::text id,to_jsonb(x) value FROM planner.delivery_attempts x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'job',id::text,to_jsonb(x) FROM planner.connector_dispatch_jobs x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'browser',id::text,to_jsonb(x) FROM planner.browser_delivery_recovery x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'api',id::text,to_jsonb(x) FROM planner.api_delivery_recovery x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'preparation',attempt_id::text,to_jsonb(x) FROM planner.browser_preparation_execution x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT CASE WHEN kind='metric_capture' THEN 'metric_work' ELSE 'work' END,id::text,to_jsonb(x) FROM planner.work_items x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'event',id::text,to_jsonb(x) FROM planner.workflow_events x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'checkpoint',id::text,to_jsonb(x) FROM planner.metric_snapshots x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'approval',a.id::text,to_jsonb(a) FROM planner.approval_decisions a JOIN planner.work_items w ON w.id=a.work_item_id WHERE w.project_id=${projectId} AND w.content_item_id=${taskId}
 UNION ALL SELECT 'asset',id::text,to_jsonb(x) FROM planner.image_assets x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'decision',id::text,to_jsonb(x) FROM planner.art_direction_decisions x WHERE project_id=${projectId} AND content_item_id=${taskId}
 UNION ALL SELECT 'task','task',(to_jsonb(x)-ARRAY['status','published_link','updated_at','metrics','quality_report']) || jsonb_build_object('metrics',coalesce(metrics,'{}'::jsonb)-ARRAY['publication_outcome','manual_confirmation_at'],'quality_report',quality_report) FROM planner.content_items x WHERE project_id=${projectId} AND id=${taskId}
 ) SELECT kind,id,encode(sha256(convert_to(value::text,'UTF8')),'hex') sha FROM custody ORDER BY kind,id`;
    return rows;
}
