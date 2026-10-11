import test from 'node:test';
import assert from 'node:assert/strict';
import { DZEN1045 } from '../services/dzen_task1045_resume_contract';
import { DZEN1045_SECOND_ATTEMPT } from '../services/dzen_task1045_second_attempt_contract';
import { assertDzen1045SecondAttemptState } from '../services/dzen_task1045_second_attempt_recovery.service';

type GuardInput = Parameters<typeof assertDzen1045SecondAttemptState>[0];

function exactTask(): GuardInput {
    return {
        id: 1045, project_id: 10, channel_id: 116,
        channel: { id: 116, project_id: 10, name: 'analystcraft_dzen', type: 'dzen',
            account_ref: 'analystcraft_dzen', url: null, config: {}, is_active: true,
            created_at: new Date(), updated_at: new Date() },
        status: 'publishing', publication_mode: 'owner_released', content_revision: 4,
        accepted_revision: 4, text_state: 'accepted', draft_text: 'accepted body',
        visual_placement: 'article_cover', visual_state: 'APPROVED', visual_decision_version: 1,
        selected_asset_id: 129, selected_asset: { id: 129, project_id: 10, content_item_id: 1045,
            content_revision: 4, kind: 'image', file_url: 'https://cdn.test/129.png', mime_type: 'image/png',
            width: 1200, height: 630, size_bytes: 100, checksum: null, status: 'approved',
            provenance: { planner_storage: { sha256: DZEN1045.assetSha } }, metadata: {},
            created_by: 'user:2', created_at: new Date(), updated_at: new Date() },
        publication_fact: null, published_link: null,
        quality_report: { publication_task_delivery: { state: 'provider_result_uncertain',
            idempotency_key: DZEN1045_SECOND_ATTEMPT.attemptKey,
            failed_at: DZEN1045_SECOND_ATTEMPT.failedAt, retry_via_api: false,
            error: 'Dzen failed: [DZEN_FINAL_SUBMIT_NOT_ATTEMPTED] final click not attempted' } }
    } as unknown as GuardInput;
}

test('second-attempt state guard accepts only the exact frozen pre-submit incident', () => {
    const task = exactTask();
    assert.equal(assertDzen1045SecondAttemptState(task, () => DZEN1045.bodySha).task.id, 1045);
    for (const mutate of [
        (value: Record<string, unknown>) => { value.id = 1036; },
        (value: Record<string, unknown>) => { value.selected_asset_id = 128; },
        (value: Record<string, unknown>) => { value.published_link = 'https://dzen.ru/a/existing'; },
        (value: Record<string, unknown>) => {
            value.quality_report = { publication_task_delivery: { state: 'provider_result_uncertain',
                idempotency_key: DZEN1045.originalKey, failed_at: DZEN1045_SECOND_ATTEMPT.failedAt,
                retry_via_api: false, error: '[DZEN_FINAL_SUBMIT_NOT_ATTEMPTED]' } };
        }
    ]) {
        const changed = structuredClone(task) as unknown as Record<string, unknown>;
        mutate(changed);
        assert.throws(() => assertDzen1045SecondAttemptState(changed as unknown as GuardInput,
            () => DZEN1045.bodySha), /DZEN1045_SECOND_ATTEMPT_GUARD_FAILED/);
    }
});
