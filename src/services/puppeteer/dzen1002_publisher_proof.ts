import { createHash } from 'crypto';
import { z } from 'zod';
import type { Dzen1002Claim, Dzen1002Receipt } from '../dzen1002_runtime_contract';

export const DZEN1002_ACCOUNT = '6a8029aba055ec36033bf81c';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const primarySchema = z.object({ objectId: id, accountId: id, title: z.string().max(1000),
    body: z.string().max(200_000), cover: z.object({ objectId: id, imageId: id, url: z.string().max(500) }).strict() }).strict();
const evidenceSchema = z.object({ schemaVersion: z.literal('studio-v3-editor-v2'),
    submit: z.object({ id, publisherId: id }).strict(),
    studio: z.object({ id, publisherId: id, title: z.string().max(1000), isPublished: z.literal(true),
        status: z.literal('published'), publishTime: z.number().int(), commonUrl: z.string().max(500) }).strict(),
    primary: primarySchema,
    coverBytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0 && bytes.byteLength <= 2_000_000),
    observedAt: z.iso.datetime() }).strict();
export type Dzen1002Primary = z.infer<typeof primarySchema>;
export type Dzen1002NativeEvidence = z.infer<typeof evidenceSchema>;
export const normalizeDzen1002Body = (value: string): string => value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export function nativeUncertain(): never { throw new Error('[DZEN1002_NATIVE_UNCERTAIN] Exact native proof unavailable; reconcile without resend.'); }

/** Only original, same-object Dzen image bytes can establish approved cover equality. */
export function dzen1002CoverUrl(primary: Dzen1002Primary): string {
    const parsed = primarySchema.safeParse(primary);
    if (!parsed.success) return nativeUncertain();
    const { cover, objectId } = parsed.data;
    if (cover.objectId !== objectId) return nativeUncertain();
    const expected = new RegExp(`^https://avatars\\.dzeninfra\\.ru/get-zen_doc/[0-9]+/pub_${objectId}_${cover.imageId}/orig$`);
    if (!expected.test(cover.url)) return nativeUncertain();
    return cover.url;
}

/** Verify observed native identity/content/cover. No expected value fills missing observations. */
export function verifyDzen1002NativeProof(claim: Dzen1002Claim, input: unknown): Dzen1002Receipt {
    const parsed = evidenceSchema.safeParse(input);
    if (!parsed.success) return nativeUncertain();
    const e = parsed.data; const p = claim.package;
    const published = e.studio.publishTime; const observed = Date.parse(e.observedAt);
    if (p.accountId !== DZEN1002_ACCOUNT || e.submit.publisherId !== p.accountId || e.studio.publisherId !== p.accountId
        || e.primary.accountId !== p.accountId || e.submit.id !== e.studio.id || e.primary.objectId !== e.studio.id
        || e.studio.commonUrl !== `https://dzen.ru/a/${e.studio.id}`
        || e.studio.title !== p.title || e.primary.title !== p.title
        || normalizeDzen1002Body(e.primary.body) !== normalizeDzen1002Body(p.body)
        || sha(p.body) !== p.bodySha256 || sha(e.coverBytes) !== p.assetSha256
        || published < Date.UTC(2000, 0, 1) || published > observed || published >= Date.UTC(2100, 0, 1)) return nativeUncertain();
    dzen1002CoverUrl(e.primary);
    return { schemaVersion: 'dzen1002-native-v1', attemptId: claim.attemptId, key: claim.key,
        packageDigest: p.digest, accountId: p.accountId, objectId: e.studio.id, url: e.studio.commonUrl,
        publishedAt: new Date(published).toISOString(), observedAt: e.observedAt,
        bodySha256: p.bodySha256, assetSha256: p.assetSha256, title: e.primary.title };
}
