import { VK_PUBLICATION_ROUTE, assertVkPublicationRoute } from './vk_publication_route_contract';
import fs from 'node:fs';
import { createVk1048PhotoDigestVerifier, createVk1048PlaywrightPhotoSource } from './vk1048_photo_identity';
import type { Vk1048ApplicationBroker } from './vk1048_application_broker';
import type { BrowserContext } from 'playwright';
import { PlaywrightVkBrowserUi } from './vk_browser_playwright_ui';
import { collectVk1048Wall, createVk1048WallInventory, type Vk1048WallMediaVerifier } from './vk1048_wall_collector';
import type { Vk1048ProviderSession, Vk1048AdmissionPort, Vk1048MediaAcknowledgement } from './vk1048_provider_execution';
/** Capability provided in-process by the action-time authority, never read from host config or a job. */
export interface Vk1048ActionAdmission {
    assess(): Promise<{ status: 'ACTION_ADMITTED'; executionContext: 'production_admitted'; authorization: 'application_host' } | { status: 'PERMISSION_UNVERIFIED' }>;
}
export interface Vk1048BrowserLaunchPort { launch(profileDirectory: string): Promise<BrowserContext>; }
export const vk1048PlaywrightLaunch: Vk1048BrowserLaunchPort = { launch: async profileDirectory => {
    const profile = fs.lstatSync(profileDirectory);
    if (!profile.isDirectory() || profile.isSymbolicLink()) throw new Error('[VK1048_EXISTING_PROFILE_REQUIRED]');
    const { chromium } = await import('playwright');
    return chromium.launchPersistentContext(profileDirectory, { headless: false, timeout: 30_000 });
} };
export interface Vk1048TrustedMediaPort extends Vk1048WallMediaVerifier {
    acknowledgement(signal?: AbortSignal): Promise<Vk1048MediaAcknowledgement | null>;
}
export interface Vk1048ProviderRuntime {
    reconcileOnly?: boolean; broker?: Vk1048ApplicationBroker;
    readonly route: typeof VK_PUBLICATION_ROUTE; executionContext: 'production_admitted'; evidenceDir: string; admission: Vk1048AdmissionPort;
    withSession<T>(run: (session: Vk1048ProviderSession) => Promise<T>): Promise<T>;
    loadApprovedImage(url: string): Promise<{ buffer: Buffer; filename: string; contentType?: string }>;
    now?: () => Date;
}
/** Resource location is not action authorization. Every new session reassesses admission before profile access. */
export function createVk1048PlaywrightRuntime(options: {
    reconcileOnly?: boolean; broker?: Vk1048ApplicationBroker; actionAdmission: Vk1048ActionAdmission; profileDirectory: string; evidenceDir: string;
    media?: Vk1048TrustedMediaPort; approvedAssetSha256?: string; loadApprovedImage: Vk1048ProviderRuntime['loadApprovedImage'];
    launch?: Vk1048BrowserLaunchPort; now?: () => Date; cleanupTimeoutMs?: number;
}): Vk1048ProviderRuntime {
    let quarantined = false;
    const assess = async () => {
        const result = await options.actionAdmission.assess();
        if (result.status !== 'ACTION_ADMITTED' || result.authorization !== 'application_host') return { status: 'PERMISSION_UNVERIFIED' as const,
            executionContext: 'production_blocked' as const, reason: 'ACTION_TIME_ADMISSION_UNAVAILABLE' };
        return { status: 'ACTION_ADMITTED' as const, executionContext: 'production_admitted' as const };
    };
    const runtime: Vk1048ProviderRuntime = { route: VK_PUBLICATION_ROUTE, reconcileOnly: options.reconcileOnly, broker: options.broker, executionContext: 'production_admitted', evidenceDir: options.evidenceDir,
        admission: { assess }, loadApprovedImage: options.loadApprovedImage, now: options.now,
        withSession: async run => {
            assertVkPublicationRoute(runtime.route);
            if (quarantined) throw new Error('[VK1048_SESSION_CLEANUP_UNCONFIRMED]');
            if ((await assess()).status !== 'ACTION_ADMITTED') throw new Error('[VK1048_PERMISSION_UNVERIFIED]');
            const context = await (options.launch ?? vk1048PlaywrightLaunch).launch(options.profileDirectory);
            let closePromise: Promise<void> | undefined;
            const close = (): Promise<void> => {
                closePromise ??= (async () => {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try { await Promise.race([context.close(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('[VK1048_SESSION_CLEANUP_UNCONFIRMED]')), options.cleanupTimeoutMs ?? 30_000); })]); }
                    catch { quarantined = true; throw new Error('[VK1048_SESSION_CLEANUP_UNCONFIRMED]'); }
                    finally { if (timer) clearTimeout(timer); }
                })();
                return closePromise;
            };
            try {
                const page = context.pages()[0] ?? await context.newPage();
                const ui = new PlaywrightVkBrowserUi(page);
                const verifier = options.media ?? createVk1048PhotoDigestVerifier(options.approvedAssetSha256 ?? '', createVk1048PlaywrightPhotoSource(page));
                const session: Vk1048ProviderSession = { ui, cancelPendingOperations: close,
                    reconcile: async (binding, _body, releasedAt, signal) => {
                        await ui.navigate(`https://vk.com/club${-binding.communityId}`);
                        if (await ui.loginRequired() || await ui.challengeRequired()) throw new Error('[VK1048_LOGIN_OR_CHALLENGE_REQUIRED]');
                        return collectVk1048Wall(createVk1048WallInventory(page), String(binding.communityId), releasedAt, verifier, options.now, signal);
                    }, mediaAcknowledgement: async signal => {
                        if (options.media) return options.media.acknowledgement(signal);
                        const proof = await ui.readbackPost();
                        if (!proof || signal?.aborted) return null;
                        const inventory = await createVk1048WallInventory(page).snapshot();
                        const card = inventory.rows.find(row => row.objectId === proof.provider_object_id);
                        if (!card) return null;
                        const media = await verifier.verify(card, signal);
                        return media?.acknowledged ? { assetSha256: media.assetSha256, providerMediaId: media.providerMediaId,
                            providerObjectId: card.objectId, acknowledged: true, ...(media.source ? { source: media.source } : {}) } : null;
                    } };
                return await run(session);
            } finally { await close(); }
        } };
    return runtime;
}
