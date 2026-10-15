import { createHash } from 'crypto';
import { z } from 'zod';
import { X1113 as p } from './x1113_contract';
const Id = z.union([z.string().min(1), z.number().int()]).transform(String);
const Context = z.object({ observedAt: z.string().datetime({ offset: true }), selectedBrowserId: Id,
    browsers: z.array(z.object({ id: Id, profileName: z.string() })).min(1).max(30),
    targetTab: z.object({ browserId: Id, tabId: Id, url: z.string().url() }), accountRef: z.literal('@naraHeTc'),
    source: z.literal('native_cua_browser_info'), editorText: z.string().optional(), mediaCount: z.number().int().optional(),
    submitEnabled: z.boolean().optional(), compositionKind: z.string().optional() });
/** Owning runtime must pass actual freshly read BrowserInfo/tab/account, never stored tags or caller permission flags. */
export function checkX1113LiveContext(value: unknown, stage: 'start' | 'submit', now: number) {
    const parsed = Context.safeParse(value);
    if (!parsed.success) throw new Error('[X1113_LIVE_CONTEXT_REQUIRED]');
    const c = parsed.data;
    const browsers = c.browsers.filter(browser => browser.id === c.selectedBrowserId);
    const age = now - Date.parse(c.observedAt);
    if (browsers.length !== 1 || browsers[0].profileName !== p.browserProfile || c.targetTab.browserId !== c.selectedBrowserId
        || new URL(c.targetTab.url).origin !== 'https://x.com' || age < -5_000 || age > 30_000) {
        throw new Error('[X1113_PERSONAL_BROWSER_REQUIRED]');
    }
    const editorHash = c.editorText === undefined ? null : createHash('sha256').update(c.editorText).digest('hex');
    if (stage === 'submit' && (editorHash !== p.bodySha256 || c.mediaCount !== 0
        || c.submitEnabled !== true || c.compositionKind !== 'new_post')) throw new Error('[X1113_EDITOR_READBACK_MISMATCH]');
    const safe = { browserProfile: p.browserProfile, observedAccountRef: p.account, observedAt: c.observedAt,
        contextSource: 'owning_publisher_live_browser_info' as const, editorTextSha256: stage === 'submit' ? editorHash : null };
    return { ...safe, clientRuntimeGuardSha256: createHash('sha256').update(JSON.stringify(safe)).digest('hex'),
        server_browser_verified: false, client_runtime_guard_required: true };
}
/** Run ONLY inside the owning native executor. Callbacks must use actual native surfaces, not stored tags. */
export async function executeX1113NativeSubmit(runtime: {
    readNativeContext: () => Promise<unknown>;
    preSubmit: (proof: ReturnType<typeof checkX1113LiveContext>) => Promise<{ submission_permitted: boolean }>;
    clickNativePost: (target: { browserId: string; tabId: string; url: string }) => Promise<unknown>;
    now: () => number;
}) {
    const first = Context.parse(await runtime.readNativeContext());
    const proof = checkX1113LiveContext(first, 'submit', runtime.now());
    const permission = await runtime.preSubmit(proof);
    if (permission.submission_permitted !== true) throw new Error('[X1113_SUBMIT_NOT_PERMITTED]');
    const final = Context.parse(await runtime.readNativeContext());
    checkX1113LiveContext(final, 'submit', runtime.now());
    if (first.selectedBrowserId !== final.selectedBrowserId || first.targetTab.tabId !== final.targetTab.tabId
        || first.targetTab.url !== final.targetTab.url) {
        throw new Error('[X1113_NATIVE_SURFACE_CHANGED_RECONCILE_ONLY]');
    }
    // No retries/catches: after this single callback any error is uncertain, never another click.
    const outcome = await runtime.clickNativePost(final.targetTab);
    return { proof, outcome };
}
