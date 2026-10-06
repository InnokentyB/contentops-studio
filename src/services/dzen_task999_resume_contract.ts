export const DZEN999 = {
    taskId: 999, projectId: 10, channelId: 116, revision: 2, assetId: 114,
    artifactKind: 'article',
    draftId: '6ac547ad5113b334aeff83d2',
    providerImageId: '6ac547c237e6ee15c5d71fc5',
    publisherId: '6a8029aba055ec36033bf81c',
    title: 'Почему метрика без контекста ведёт к ложному решению',
    bodySha: '78ffd5316ab3ffc4679d67788ec57f39558760917e70522d8ba0647a1f68b130',
    assetSha: 'd06c7ce1c3533dc1db76799bda8eff1395a9dde4e05684c593b16bd064479b1c',
    key: 'dzen-999-owner-approved-live-20261006-v1'
} as const;

export function normalizeDzen999Body(value: string): string {
    return value.replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
}

export type Dzen999Proof = {
    draftId: string; title: string; bodyMatches: boolean;
    coverId: string; coverSha: string; coverWidth: number; coverHeight: number;
    draftListed: boolean; publishedMatches: number; publicationListComplete: boolean;
    finalControlReady: boolean;
};

export function assertDzen999Proof(proof: Dzen999Proof): void {
    if (proof.draftId !== DZEN999.draftId || proof.title !== DZEN999.title || !proof.bodyMatches
        || proof.coverId !== DZEN999.providerImageId || proof.coverSha !== DZEN999.assetSha
        || proof.coverWidth !== 1200 || proof.coverHeight !== 630 || !proof.draftListed
        || proof.publishedMatches !== 0 || !proof.publicationListComplete || !proof.finalControlReady) {
        throw new Error('[DZEN999_RESUME_PROOF_FAILED] Existing draft package or stage changed');
    }
}

export async function runDzen999Resume<T>(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen999Proof>;
    claim(proof: Dzen999Proof): Promise<boolean>;
    submit(): Promise<T>;
}): Promise<{ mode: 'preview'; proof: Dzen999Proof } | { mode: 'submitted'; result: T }> {
    if (args.idempotencyKey !== DZEN999.key) throw new Error('[DZEN999_ORIGINAL_KEY_REQUIRED]');
    const proof = await ports.inspect();
    assertDzen999Proof(proof);
    if (!args.confirm) return { mode: 'preview', proof };
    if (!await ports.claim(proof)) throw new Error('[DZEN999_RESUME_ALREADY_CLAIMED]');
    return { mode: 'submitted', result: await ports.submit() };
}
