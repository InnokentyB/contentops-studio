import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LINKEDIN1132_LANGUAGE,
    repairLinkedInTask1132Language
} from '../services/linkedin_task1132_language_repair.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

test('task1132 language repair is exposed only to owner and publisher profiles', () => {
    const tool = 'ba_repair_linkedin_task1132_language';
    assert.equal(isToolAllowedForProfile('owner', tool), true);
    assert.equal(isToolAllowedForProfile('publisher', tool), true);
    for (const profile of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist'] as const) {
        assert.equal(isToolAllowedForProfile(profile, tool), false);
    }
});

function harness() {
    let qualityReport: Record<string, unknown> = {
        execution_mode: 'assisted',
        handoff_bundle: { content_item_id: 1132, content_language: 'ru' }
    };
    const task = {
        id: 1132, project_id: 7, channel_id: 5,
        channel: { id: 5, type: 'linkedin', name: 'innokentiy_linkedin', is_active: true,
            config: { account_ref: LINKEDIN1132_LANGUAGE.profileUrl,
                workflow_mode: 'browser_required', connector_mode: 'browser_assisted' } },
        type: 'publication', status: 'ready_for_execution', publication_mode: 'approval_required',
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', handoff_state: 'ready',
        visual_state: 'NO_VISUAL_NEEDED', visual_placement: 'feed', selected_asset_id: null,
        title: LINKEDIN1132_LANGUAGE.title, draft_text: 'accepted English body',
        schedule_at: new Date(LINKEDIN1132_LANGUAGE.schedule),
        publish_at: new Date(LINKEDIN1132_LANGUAGE.schedule), published_link: null,
        publication_fact: null
    };
    const events: Array<Record<string, unknown>> = [];
    type RepairDb = NonNullable<Parameters<typeof repairLinkedInTask1132Language>[1]>;
    let db: RepairDb;
    db = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: {
            findFirst: async () => ({ ...task, quality_report: qualityReport }),
            updateMany: async (input: unknown) => {
                qualityReport = (input as { data: { quality_report: Record<string, unknown> } })
                    .data.quality_report;
                return { count: 1 };
            }
        },
        deliveryAttempt: { findFirst: async () => null },
        workItem: { findFirst: async () => null },
        workflowEvent: {
            findFirst: async () => null,
            create: async (input: unknown) => {
                events.push((input as { data: Record<string, unknown> }).data);
            }
        },
        async $transaction<T>(run: (tx: RepairDb) => Promise<T>) { return run(db); }
    };
    return { db, events, get qualityReport() { return qualityReport; } };
}

test('task1132 repair rematerializes English metadata without release or provider call', async () => {
    const h = harness();
    const base = {
        projectId: 7 as const, taskId: 1132 as const, actorId: 'user:2',
        expectedManifestChecksum: LINKEDIN1132_LANGUAGE.manifest,
        expectedBodySha256: LINKEDIN1132_LANGUAGE.bodySha,
        expectedScheduleAt: LINKEDIN1132_LANGUAGE.schedule,
        idempotencyKey: 'p7-1132-language-v1'
    };
    const dependencies = {
        hashBody: () => LINKEDIN1132_LANGUAGE.bodySha,
        manifestLoader: async () => ({ checksum: LINKEDIN1132_LANGUAGE.manifest }) as never
    };
    const preview = await repairLinkedInTask1132Language({ ...base, confirm: false }, h.db, dependencies);
    if (!('to' in preview)) throw new Error('preview missing');
    assert.equal(preview.to.content_language, 'en');
    assert.equal((h.qualityReport.handoff_bundle as Record<string, unknown>).content_language, 'ru');
    const applied = await repairLinkedInTask1132Language({ ...base, confirm: true }, h.db, dependencies);
    if (!('release_created' in applied)) throw new Error('apply result missing');
    assert.equal(h.qualityReport.content_language, 'en');
    assert.equal((h.qualityReport.handoff_bundle as Record<string, unknown>).content_language, 'en');
    assert.equal(applied.release_created, false);
    assert.equal(applied.provider_called, false);
    assert.equal(applied.publication_fact_created, false);
    assert.equal(h.events.length, 1);
});

test('task1132 repair fails closed when accepted bytes changed', async () => {
    const h = harness();
    await assert.rejects(repairLinkedInTask1132Language({
        projectId: 7, taskId: 1132, actorId: 'user:2',
        expectedManifestChecksum: LINKEDIN1132_LANGUAGE.manifest,
        expectedBodySha256: LINKEDIN1132_LANGUAGE.bodySha,
        expectedScheduleAt: LINKEDIN1132_LANGUAGE.schedule,
        idempotencyKey: 'p7-1132-language-changed', confirm: true
    }, h.db, {
        hashBody: () => 'changed',
        manifestLoader: async () => ({ checksum: LINKEDIN1132_LANGUAGE.manifest }) as never
    }), /GUARD_FAILED/);
    assert.equal(h.events.length, 0);
});

test('task1132 repair preserves and permits an explicitly pre-provider failed attempt', async () => {
    const h = harness();
    h.db.deliveryAttempt.findFirst = async () => ({ id: 81, status: 'failed',
        requires_manual_confirmation: false,
        error_message: '[BROWSER_PRE_PROVIDER_ABORT_CONFIRMED]' });
    const result = await repairLinkedInTask1132Language({
        projectId: 7, taskId: 1132, actorId: 'user:2',
        expectedManifestChecksum: LINKEDIN1132_LANGUAGE.manifest,
        expectedBodySha256: LINKEDIN1132_LANGUAGE.bodySha,
        expectedScheduleAt: LINKEDIN1132_LANGUAGE.schedule,
        idempotencyKey: 'p7-1132-language-pre-provider', confirm: true
    }, h.db, {
        hashBody: () => LINKEDIN1132_LANGUAGE.bodySha,
        manifestLoader: async () => ({ checksum: LINKEDIN1132_LANGUAGE.manifest }) as never
    });
    assert.equal('provider_called' in result && result.provider_called, false);
    assert.equal(h.qualityReport.content_language, 'en');
});

test('task1132 repair blocks an uncertain attempt', async () => {
    const h = harness();
    h.db.deliveryAttempt.findFirst = async () => ({ id: 82, status: 'pending',
        requires_manual_confirmation: true, error_message: '[BROWSER_READBACK_UNCONFIRMED]' });
    await assert.rejects(repairLinkedInTask1132Language({
        projectId: 7, taskId: 1132, actorId: 'user:2',
        expectedManifestChecksum: LINKEDIN1132_LANGUAGE.manifest,
        expectedBodySha256: LINKEDIN1132_LANGUAGE.bodySha,
        expectedScheduleAt: LINKEDIN1132_LANGUAGE.schedule,
        idempotencyKey: 'p7-1132-language-uncertain', confirm: true
    }, h.db, {
        hashBody: () => LINKEDIN1132_LANGUAGE.bodySha,
        manifestLoader: async () => ({ checksum: LINKEDIN1132_LANGUAGE.manifest }) as never
    }), /GUARD_FAILED/);
});
