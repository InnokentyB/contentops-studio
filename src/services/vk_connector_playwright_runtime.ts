import { sandboxedChromiumLaunchOptions } from './browser_launch';
import { VK_PUBLICATION_ROUTE, assertVkPublicationRoute } from './vk_publication_route_contract';
import fs from 'node:fs';
import { createVkConnectorPhotoDigestVerifier, createVkConnectorPlaywrightPhotoSource } from './vk_connector_photo_identity';
import type { VkConnectorApplicationBroker } from './vk_connector_application_broker';
import type { BrowserContext } from 'playwright';
import { PlaywrightVkBrowserUi } from './vk_browser_playwright_ui';
import { collectVkConnectorWall, createVkConnectorWallInventory, type VkConnectorWallMediaVerifier } from './vk_connector_wall_collector';
import type { VkConnectorProviderSession, VkConnectorAdmissionPort, VkConnectorMediaAcknowledgement } from './vk_connector_provider_execution';
/** Capability provided in-process by the action-time authority, never read from host config or a job. */
export interface VkConnectorActionAdmission {
    assess(): Promise<{ status: 'ACTION_ADMITTED'; executionContext: 'production_admitted'; authorization: 'application_host' } | { status: 'PERMISSION_UNVERIFIED' }>;
}
export interface VkConnectorBrowserLaunchPort { launch(profileDirectory: string): Promise<BrowserContext>; }
export const vkConnectorPlaywrightLaunch: VkConnectorBrowserLaunchPort = { launch: async profileDirectory => {
    const profile = fs.lstatSync(profileDirectory);
    if (!profile.isDirectory() || profile.isSymbolicLink()) throw new Error('[VK_CONNECTOR_EXISTING_PROFILE_REQUIRED]');
    const { chromium } = await import('playwright');
    return chromium.launchPersistentContext(profileDirectory, sandboxedChromiumLaunchOptions({ headless: false, timeout: 30_000, executablePath: process.env.APP_BROWSER_EXECUTABLE_PATH ?? chromium.executablePath() }));
} };
export interface VkConnectorTrustedMediaPort extends VkConnectorWallMediaVerifier {
    acknowledgement(signal?: AbortSignal): Promise<VkConnectorMediaAcknowledgement | null>;
}
export interface VkConnectorProviderRuntime {
    recordedRestrictions?: (signal?: AbortSignal) => Promise<unknown>;
    reconcileOnly?: boolean; broker?: VkConnectorApplicationBroker;
    readonly route: typeof VK_PUBLICATION_ROUTE; executionContext: 'production_admitted'; evidenceDir: string; admission: VkConnectorAdmissionPort;
    withSession<T>(run: (session: VkConnectorProviderSession) => Promise<T>): Promise<T>;
    loadApprovedImage(url: string): Promise<{ buffer: Buffer; filename: string; contentType?: string }>;
    now?: () => Date;
}
/** Resource location is not action authorization. Every new session reassesses admission before profile access. */
export function createVkConnectorPlaywrightRuntime(options: {
    recordedRestrictions?: (signal?: AbortSignal) => Promise<unknown>;
    reconcileOnly?: boolean; broker?: VkConnectorApplicationBroker; actionAdmission: VkConnectorActionAdmission; profileDirectory: string; evidenceDir: string;
    media?: VkConnectorTrustedMediaPort; approvedAssetSha256?: string; loadApprovedImage: VkConnectorProviderRuntime['loadApprovedImage'];
    launch?: VkConnectorBrowserLaunchPort; now?: () => Date; cleanupTimeoutMs?: number;
}): VkConnectorProviderRuntime {
    let quarantined = false;
    const assess = async () => {
        const result = await options.actionAdmission.assess();
        if (result.status !== 'ACTION_ADMITTED' || result.authorization !== 'application_host') return { status: 'PERMISSION_UNVERIFIED' as const,
            executionContext: 'production_blocked' as const, reason: 'ACTION_TIME_ADMISSION_UNAVAILABLE' };
        return { status: 'ACTION_ADMITTED' as const, executionContext: 'production_admitted' as const };
    };
    const runtime: VkConnectorProviderRuntime = { recordedRestrictions: options.recordedRestrictions, route: VK_PUBLICATION_ROUTE, reconcileOnly: options.reconcileOnly, broker: options.broker, executionContext: 'production_admitted', evidenceDir: options.evidenceDir,
        admission: { assess }, loadApprovedImage: options.loadApprovedImage, now: options.now,
        withSession: async run => {
            assertVkPublicationRoute(runtime.route);
            if (quarantined) throw new Error('[VK_CONNECTOR_SESSION_CLEANUP_UNCONFIRMED]');
            if ((await assess()).status !== 'ACTION_ADMITTED') throw new Error('[VK_CONNECTOR_PERMISSION_UNVERIFIED]');
            const context = await (options.launch ?? vkConnectorPlaywrightLaunch).launch(options.profileDirectory);
            let closePromise: Promise<void> | undefined;
            const close = (): Promise<void> => {
                closePromise ??= (async () => {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try { await Promise.race([context.close(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('[VK_CONNECTOR_SESSION_CLEANUP_UNCONFIRMED]')), options.cleanupTimeoutMs ?? 30_000); })]); }
                    catch { quarantined = true; throw new Error('[VK_CONNECTOR_SESSION_CLEANUP_UNCONFIRMED]'); }
                    finally { if (timer) clearTimeout(timer); }
                })();
                return closePromise;
            };
            try {
                const page = context.pages()[0] ?? await context.newPage();
                const ui = new PlaywrightVkBrowserUi(page);
                const verifier = options.media ?? createVkConnectorPhotoDigestVerifier(options.approvedAssetSha256 ?? '', createVkConnectorPlaywrightPhotoSource(page));
                const session: VkConnectorProviderSession = { ui, cancelPendingOperations: close,
                    reconcile: async (binding, _body, releasedAt, signal) => {
                        await ui.navigate(`https://vk.com/club${-binding.communityId}`);
                        if (await ui.loginRequired() || await ui.challengeRequired()) throw new Error('[VK_CONNECTOR_LOGIN_OR_CHALLENGE_REQUIRED]');
                        return collectVkConnectorWall(createVkConnectorWallInventory(page), String(binding.communityId), releasedAt, verifier, options.now, signal);
                    }, mediaAcknowledgement: async signal => {
                        if (options.media) return options.media.acknowledgement(signal);
                        const proof = await ui.readbackPost();
                        if (!proof || signal?.aborted) return null;
                        const inventory = await createVkConnectorWallInventory(page).snapshot();
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
