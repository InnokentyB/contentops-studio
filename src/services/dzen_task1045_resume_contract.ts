export const DZEN1045 = {
    projectId: 10, taskId: 1045, channelId: 116, revision: 4, assetId: 129, decisionId: 267,
    publisherId: '6a8029aba055ec36033bf81c', title: 'W41 allocation #24 — Dzen',
    bodySha: '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1',
    assetSha: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b',
    originalKey: 'dzen-p10-1045-r4-asset129-recovery-20261010-01',
    resumeKey: 'dzen-p10-1045-r4-asset129-existing-draft-resume-20261010-01',
    failedAt: '2026-10-10T11:59:26.438Z',
    errorCode: 'DZEN_FINAL_SUBMIT_NOT_ATTEMPTED'
} as const;

export function normalizeDzen1045Body(value: string): string {
    return value.normalize('NFKC').replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '')
        .replace(/\s+/g, ' ').trim();
}

export type Dzen1045DraftProof = {
    draftId: string;
    coverId: string;
    title: string;
    bodySha256: string;
    coverSha256: string;
    publishedMatches: number;
    publishedCoverageComplete: boolean;
    draftMatches: number;
    draftCoverageComplete: boolean;
    finalControlReady: boolean;
};

export function assertDzen1045DraftProof(proof: Dzen1045DraftProof): void {
    if (!/^[a-f0-9]{16,64}$/.test(proof.draftId) || !proof.coverId
        || proof.title !== DZEN1045.title || proof.bodySha256 !== DZEN1045.bodySha
        || proof.coverSha256 !== DZEN1045.assetSha || proof.publishedMatches !== 0
        || !proof.publishedCoverageComplete || proof.draftMatches !== 1
        || !proof.draftCoverageComplete || !proof.finalControlReady) {
        throw new Error('[DZEN1045_DRAFT_PROOF_FAILED] Exact existing draft package or exhaustive coverage changed');
    }
}

export async function runDzen1045DraftResume<T>(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen1045DraftProof>;
    claim(proof: Dzen1045DraftProof): Promise<boolean>;
    submit(proof: Dzen1045DraftProof): Promise<T>;
}): Promise<{ mode: 'preview'; proof: Dzen1045DraftProof } | { mode: 'submitted'; result: T }> {
    if (args.idempotencyKey !== DZEN1045.resumeKey) throw new Error('[DZEN1045_RESUME_KEY_REQUIRED]');
    const proof = await ports.inspect();
    assertDzen1045DraftProof(proof);
    if (!args.confirm) return { mode: 'preview', proof };
    if (!await ports.claim(proof)) throw new Error('[DZEN1045_RESUME_ALREADY_CLAIMED]');
    return { mode: 'submitted', result: await ports.submit(proof) };
}
