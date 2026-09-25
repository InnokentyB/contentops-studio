import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import workQueueService from '../services/work_queue.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const input = { projectId: 29, actorId: 'user:1', taskId: 976,
    expectedContentRevision: 4, expectedAcceptedRevision: 4, expectedChannelId: null,
    expectedScheduleAt: '2026-09-25T14:30:00.000Z', expectedVisualMode: 'auto_assess',
    expectedVisualState: 'PENDING_ASSESSMENT', expectedVisualPlacement: 'feed', expectedStatus: 'approved',
    idempotencyKey: 'require-976-visual-v1' };

function fixture(overrides: Record<string, unknown> = {}) {
    const calls: string[] = []; let event: any = null;
    const task = { id: 976, project_id: 29, channel_id: null, content_revision: 4,
        accepted_revision: 4, text_state: 'accepted', status: 'approved', visual_mode: 'auto_assess',
        visual_state: 'PENDING_ASSESSMENT', visual_placement: 'feed', selected_asset_id: null,
        visual_decision_version: 0, schedule_at: new Date(input.expectedScheduleAt), published_link: null,
        publication_fact: null, week_package_id: 60, item_key: 'task:976', ...overrides };
    const tx: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => event, create: async ({data}: any) => { calls.push('audit'); event=data; return data; } },
        contentItem: { findFirst: async () => task, updateMany: async () => { calls.push('task-update'); return {count: 1}; } },
        workItem: { findFirst: async () => null, create: async ({data}: any) => { calls.push('work-item'); return {id: 1200, ...data}; } },
        artDirectionDecision: { findFirst: async () => null }
    };
    return { calls, tx, database: { $transaction: async (fn: any) => fn(tx) } as typeof prisma };
}

test('owner CAS requires a visual and materializes one revision-bound art-direction input', async () => {
    assert.equal(isToolAllowedForProfile('owner','ba_require_publication_visual'),true);
    assert.equal(isToolAllowedForProfile('planner','ba_require_publication_visual'),false);
    const h=fixture(); const result=await workQueueService.requirePublicationVisual(input,h.database);
    assert.equal(result.visual_mode,'required'); assert.equal(result.art_direction_work_item_id,1200);
    assert.equal(result.input_context_version,4); assert.deepEqual(h.calls,['task-update','work-item','audit']);
    assert.deepEqual(await workQueueService.requirePublicationVisual(input,h.database),result);
});

test('generic visual CAS rejects publication evidence, assets, decisions, active inputs and guard drift', async () => {
    for (const overrides of [{publication_fact:{outcome:'blocked'}},{selected_asset_id:1},{accepted_revision:3},{channel_id:1}]) {
        const h=fixture(overrides); await assert.rejects(workQueueService.requirePublicationVisual(input,h.database),/VISUAL_REQUIREMENT_TASK_CONFLICT/); assert.deepEqual(h.calls,[]);
    }
    for (const relation of ['decision','work']) { const h=fixture(); if(relation==='decision') h.tx.artDirectionDecision.findFirst=async()=>({id:1}); else h.tx.workItem.findFirst=async()=>({id:2});
        await assert.rejects(workQueueService.requirePublicationVisual(input,h.database),/VISUAL_REQUIREMENT_ALREADY_MATERIALIZED/); assert.deepEqual(h.calls,[]); }
});
