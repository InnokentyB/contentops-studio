import { createHash } from 'node:crypto';
import { DZEN1045_PHASE_B_RECONCILE } from './dzen_task1045_phase_b_reconcile_contract';

export const DZEN1045_PHASE_C = {
    tool: 'ba_execute_dzen_task1045_phase_c',
    providerId: DZEN1045_PHASE_B_RECONCILE.providerId,
    sourceState: 'phase_b_final_not_attempted',
    sourceControlMapKey: 'dzen-p10-1045-r4-asset129-editor-control-map-20261011-01',
    controlMapJsonSha256: '925ae9abb641ca815c88ee0eb1c64d76500913c7c9365fd59aa6d042638b1c48',
    controlMapPngSha256: '6665db1c5b4f55baf323f77391cbb2e3d82cf8c1f81bc0acf2c66da5a9bed329',
    previewKey: 'dzen-p10-1045-r4-asset129-phase-c-preview-20261011-01',
    executeKey: 'dzen-p10-1045-r4-asset129-phase-c-execute-20261011-01'
} as const;

export type Dzen1045Geometry = { x: number; y: number; width: number; height: number };
export type Dzen1045DialogControl = { tag: string; text: string; dataTestId: string | null;
    disabled: boolean; geometry: Dzen1045Geometry };
export type Dzen1045PublishDialog = { text: string; controls: Dzen1045DialogControl[];
    requiredControls: Array<{ label: string; value: string }> };
export type Dzen1045DialogInspection = { dialog: Dzen1045PublishDialog; fingerprint: string;
    exactDraft: true; uniqueFinalControl: boolean; finalConfirmationClicks: 0; providerWrites: 0;
    dialogCandidates?: Dzen1045PublishDialog[]; screenshot?: { mimeType: 'image/png'; base64: string } };
export type Dzen1045PhaseCPublication = { public_url: string; provider_object_id: typeof DZEN1045_PHASE_C.providerId;
    published_at: string; public_body_matches: true; public_asset_matches: true; public_title_matches: true;
    checked_at: string; final_submit_count: 1; provider_trace: Array<Record<string, unknown>> };

export function isDzen1045HeaderPublishControl(value: { text: string; dataTestId: string | null;
    disabled: boolean; geometry: Dzen1045Geometry; topmost: boolean }): boolean {
    const geometry = value.geometry;
    return value.text.trim() === 'Опубликовать' && value.dataTestId === 'article-publish-btn'
        && !value.disabled && value.topmost && Math.abs(geometry.x - 1063) <= 40
        && Math.abs(geometry.y - 25) <= 20 && geometry.width >= 100 && geometry.height >= 28;
}

export function dzen1045DialogFingerprint(dialog: Dzen1045PublishDialog): string {
    const canonical = { text: dialog.text.replace(/\s+/g, ' ').trim(),
        controls: dialog.controls.map(control => ({ tag: control.tag, text: control.text.replace(/\s+/g, ' ').trim(),
            dataTestId: control.dataTestId, disabled: control.disabled, geometry: control.geometry })),
        requiredControls: dialog.requiredControls.map(control => ({ label: control.label.trim(), value: control.value.trim() })) };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export async function runDzen1045PhaseC<T>(args: { confirm: boolean; idempotencyKey: string;
    expectedDialogFingerprint: string | null }, ports: {
    inspectDialog(): Promise<Dzen1045DialogInspection>;
    claim(inspection: Dzen1045DialogInspection): Promise<boolean>;
    submitOnce(inspection: Dzen1045DialogInspection): Promise<Dzen1045PhaseCPublication>;
    record(publication: Dzen1045PhaseCPublication): Promise<T>;
}) {
    const expectedKey = args.confirm ? DZEN1045_PHASE_C.executeKey : DZEN1045_PHASE_C.previewKey;
    if (args.idempotencyKey !== expectedKey) throw new Error('[DZEN1045_PHASE_C_KEY_REQUIRED]');
    const inspection = await ports.inspectDialog();
    if (!inspection.exactDraft || inspection.finalConfirmationClicks !== 0 || inspection.providerWrites !== 0) {
        throw new Error('[DZEN1045_PHASE_C_PREFLIGHT_INVALID]');
    }
    if (!args.confirm) return { mode: 'preview' as const, inspection };
    if (!inspection.uniqueFinalControl) throw new Error('[DZEN1045_PHASE_C_FINAL_CONTROL_NOT_EXACT]');
    if (!args.expectedDialogFingerprint) throw new Error('[DZEN1045_PHASE_C_DIALOG_FINGERPRINT_REQUIRED]');
    if (args.expectedDialogFingerprint !== inspection.fingerprint) return {
        mode: 'fingerprint_mismatch' as const, expectedDialogFingerprint: args.expectedDialogFingerprint,
        observedDialogFingerprint: inspection.fingerprint, inspection
    };
    if (!await ports.claim(inspection)) throw new Error('[DZEN1045_PHASE_C_ALREADY_CLAIMED]');
    const publication = await ports.submitOnce(inspection);
    if (publication.provider_object_id !== DZEN1045_PHASE_C.providerId || !publication.public_url
        || !publication.published_at || !publication.public_body_matches || !publication.public_asset_matches
        || !publication.public_title_matches || publication.final_submit_count !== 1) {
        throw new Error('[DZEN1045_PHASE_C_PUBLICATION_PROOF_INVALID]');
    }
    return { mode: 'published' as const, publication, result: await ports.record(publication) };
}
