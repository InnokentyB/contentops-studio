import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DZEN1045_PHASE_C,
    dzen1045DialogFingerprint,
    isDzen1045HeaderPublishControl,
    runDzen1045PhaseC
} from '../services/dzen_task1045_phase_c_contract';

const dialog = {
    text: 'Настройки публикации Опубликовать',
    controls: [{ tag: 'button', text: 'Опубликовать', dataTestId: 'publication-confirm',
        disabled: false, geometry: { x: 980, y: 710, width: 180, height: 40 } }],
    requiredControls: []
};

test('phase C recognizes only the mapped unobstructed header publish control', () => {
    assert.equal(isDzen1045HeaderPublishControl({ text: 'Опубликовать', dataTestId: 'article-publish-btn',
        disabled: false, geometry: { x: 1063, y: 25, width: 136, height: 32 }, topmost: true }), true);
    assert.equal(isDzen1045HeaderPublishControl({ text: 'Опубликовать', dataTestId: 'article-publish-btn',
        disabled: false, geometry: { x: 1063, y: 25, width: 136, height: 32 }, topmost: false }), false);
    assert.equal(isDzen1045HeaderPublishControl({ text: 'Опубликовать', dataTestId: 'publication-confirm',
        disabled: false, geometry: { x: 1063, y: 25, width: 136, height: 32 }, topmost: true }), false);
});

test('phase C dialog fingerprint is stable and sensitive to confirmation contract', () => {
    const first = dzen1045DialogFingerprint(dialog);
    assert.equal(first, dzen1045DialogFingerprint({ ...dialog, controls: [...dialog.controls] }));
    assert.equal(first, dzen1045DialogFingerprint({ ...dialog, controls: [{ ...dialog.controls[0],
        geometry: { x: 240, y: 201, width: 109, height: 31 } }] }));
    assert.notEqual(first, dzen1045DialogFingerprint({ ...dialog, controls: [{ ...dialog.controls[0], disabled: true }] }));
});

test('phase C preview opens the real dialog but performs no final confirmation or provider write', async () => {
    let claims = 0; let submits = 0; let records = 0;
    const result = await runDzen1045PhaseC({ confirm: false,
        idempotencyKey: DZEN1045_PHASE_C.previewKey, expectedDialogFingerprint: null }, {
        inspectDialog: async () => ({ dialog, fingerprint: dzen1045DialogFingerprint(dialog),
            exactDraft: true as const, uniqueFinalControl: true,
            finalConfirmationClicks: 0 as const, providerWrites: 0 as const }),
        claim: async () => { claims += 1; return true; },
        submitOnce: async () => { submits += 1; throw new Error('not expected'); },
        record: async () => { records += 1; return {}; }
    });
    assert.equal(result.mode, 'preview');
    assert.equal(claims, 0); assert.equal(submits, 0); assert.equal(records, 0);
});

test('phase C confirm requires the preview fingerprint, claims first, submits once and records proof', async () => {
    const fingerprint = dzen1045DialogFingerprint(dialog);
    let claims = 0; let submits = 0; let records = 0;
    const publication = { public_url: 'https://dzen.ru/a/exact1045',
        provider_object_id: DZEN1045_PHASE_C.providerId, published_at: '2026-10-11T20:00:00.000Z',
        public_body_matches: true as const, public_asset_matches: true as const,
        public_title_matches: true as const, checked_at: '2026-10-11T20:01:00.000Z',
        final_submit_count: 1 as const, provider_trace: [{ method: 'POST', status: 200 }] };
    const result = await runDzen1045PhaseC({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_C.executeKey, expectedDialogFingerprint: fingerprint }, {
        inspectDialog: async () => ({ dialog, fingerprint, exactDraft: true as const, uniqueFinalControl: true,
            finalConfirmationClicks: 0 as const, providerWrites: 0 as const }),
        claim: async () => { claims += 1; return true; },
        submitOnce: async observed => { submits += 1; assert.equal(observed.fingerprint, fingerprint); return publication; },
        record: async value => { records += 1; assert.equal(value.public_url, publication.public_url); return { fact: 1 }; }
    });
    assert.equal(result.mode, 'published');
    assert.equal(claims, 1); assert.equal(submits, 1); assert.equal(records, 1);
});

test('phase C mismatch returns current evidence before claim and final confirmation', async () => {
    let claims = 0; let submits = 0;
    const result = await runDzen1045PhaseC({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_C.executeKey, expectedDialogFingerprint: 'stale' }, {
        inspectDialog: async () => ({ dialog, fingerprint: dzen1045DialogFingerprint(dialog), exactDraft: true as const,
            uniqueFinalControl: true,
            finalConfirmationClicks: 0 as const, providerWrites: 0 as const }),
        claim: async () => { claims += 1; return true; },
        submitOnce: async () => { submits += 1; throw new Error('not expected'); },
        record: async () => ({})
    });
    assert.equal(result.mode, 'fingerprint_mismatch');
    assert.equal(result.observedDialogFingerprint, dzen1045DialogFingerprint(dialog));
    assert.equal(claims, 0); assert.equal(submits, 0);
});

test('phase C preview returns ambiguous dialog evidence but confirm stops before claim', async () => {
    let claims = 0;
    const ports = { inspectDialog: async () => ({ dialog, fingerprint: dzen1045DialogFingerprint(dialog),
        exactDraft: true as const, uniqueFinalControl: false, finalConfirmationClicks: 0 as const, providerWrites: 0 as const }),
    claim: async () => { claims += 1; return true; },
    submitOnce: async () => { throw new Error('not expected'); }, record: async () => ({}) };
    const preview = await runDzen1045PhaseC({ confirm: false, idempotencyKey: DZEN1045_PHASE_C.previewKey,
        expectedDialogFingerprint: null }, ports);
    assert.equal(preview.mode, 'preview'); assert.equal(preview.inspection.uniqueFinalControl, false);
    await assert.rejects(runDzen1045PhaseC({ confirm: true, idempotencyKey: DZEN1045_PHASE_C.executeKey,
        expectedDialogFingerprint: preview.inspection.fingerprint }, ports), /FINAL_CONTROL_NOT_EXACT/);
    assert.equal(claims, 0);
});
