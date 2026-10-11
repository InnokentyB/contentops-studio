import puppeteer from 'puppeteer';
import { parseBrowserCookieHeader } from './puppeteer/dzen_dom_helpers';
import { inspectDzen1045Absence, resumeDzen1045InExistingDraft } from './puppeteer/dzen1045_existing_draft';
import type { Dzen1045DraftProof } from './dzen_task1045_resume_contract';
import { inspectDzen1045SecondAttempt, recoverDzen1045SecondAttemptInBrowser } from './puppeteer/dzen1045_second_attempt';
import type { Dzen1045SecondAttemptDraftProof } from './dzen_task1045_second_attempt_contract';
import puppeteerPublisherService from './puppeteer_publisher.service';
import { restoreDzen1045InBrowser } from './puppeteer/dzen1045_zero_restore';
import { inspectDzen1045RestoreIncident } from './puppeteer/dzen1045_restore_reconcile';
import { createDzen1045DurableDraftPhaseA } from './puppeteer/dzen1045_phase_a';
import { probeDzen1045CreationContract } from './puppeteer/dzen1045_phase_a_probe';
import { probeDzen1045CreationMenu } from './puppeteer/dzen1045_phase_a_menu_probe';
import { createDzen1045DurableDraftPhaseAV2 } from './puppeteer/dzen1045_phase_a_v2';
import { inspectDzen1045PhaseAV2Incident } from './puppeteer/dzen1045_phase_a_v2_reconcile';
import { probeDzen1045ExactEditorState } from './puppeteer/dzen1045_phase_a_v2_editor_probe';
import { publishDzen1045ExistingDraftOnce } from './puppeteer/dzen1045_phase_b';
import { probeDzen1045PhaseBDialog } from './puppeteer/dzen1045_phase_b_dialog_probe';
import { probeDzen1045EditorControlMap } from './puppeteer/dzen1045_editor_control_map';
import { previewDzen1045PhaseC, publishDzen1045PhaseCOnce } from './puppeteer/dzen1045_phase_c';

type Config = { cookies: string; channel_id: string };

async function withDzen1045Page<T>(config: Config, run: (page: import('puppeteer').Page) => Promise<T>) {
    const browser = await puppeteer.launch({ headless: true, args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'
    ] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        const cookies = [
            ...parseBrowserCookieHeader(config.cookies, 'dzen.ru'),
            ...parseBrowserCookieHeader(config.cookies, '.dzen.ru'),
            ...parseBrowserCookieHeader(config.cookies, '.yandex.ru')
        ];
        if (cookies.length === 0) throw new Error('[DZEN_AUTH_REQUIRED] Parsed cookie set is empty');
        await page.setCookie(...cookies);
        return await run(page);
    } finally {
        await browser.close();
    }
}

export async function inspectDzen1045AbsenceInBrowser(config: Config) {
    return withDzen1045Page(config, inspectDzen1045Absence);
}

export async function resumeDzen1045DraftInBrowser(config: Config, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string },
    claim: (proof: Dzen1045DraftProof) => Promise<boolean>) {
    return withDzen1045Page(config, page => resumeDzen1045InExistingDraft(page, acceptedBody, args, claim));
}

export async function recoverDzen1045SecondAttemptInBrowserSession(config: Config, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string },
    claim: (proof: Dzen1045SecondAttemptDraftProof) => Promise<boolean>) {
    return withDzen1045Page(config,
        page => recoverDzen1045SecondAttemptInBrowser(page, acceptedBody, args, claim));
}

export async function inspectDzen1045SecondAttemptInBrowserSession(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => inspectDzen1045SecondAttempt(page, acceptedBody));
}

export async function restoreDzen1045InBrowserSession(config: Config, acceptedBody: string, imageUrl: string) {
    return withDzen1045Page(config, page => restoreDzen1045InBrowser(page, acceptedBody, imageUrl, {
        openComposer: async () => { await puppeteerPublisherService.openDzenComposer(page, config, 'article');
            await puppeteerPublisherService.assertDzenAuthenticated(page); },
        uploadImage: url => puppeteerPublisherService.uploadDzenImage(page, url)
    }));
}

export async function inspectDzen1045RestoreIncidentInBrowser(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => inspectDzen1045RestoreIncident(page, acceptedBody));
}

export async function createDzen1045DurableDraftPhaseAInBrowser(config: Config, acceptedBody: string, imageUrl: string) {
    return withDzen1045Page(config, page => createDzen1045DurableDraftPhaseA(page, acceptedBody, imageUrl, {
        openComposer: async () => { await puppeteerPublisherService.openDzenComposer(page, config, 'article');
            await puppeteerPublisherService.assertDzenAuthenticated(page); },
        uploadImage: url => puppeteerPublisherService.uploadDzenImage(page, url)
    }));
}
export async function probeDzen1045CreationContractInBrowser(config: Config) {
    return withDzen1045Page(config, probeDzen1045CreationContract);
}
export async function probeDzen1045CreationMenuInBrowser(config: Config) {
    return withDzen1045Page(config, probeDzen1045CreationMenu);
}
export async function createDzen1045DurableDraftPhaseAV2InBrowser(config: Config,
    acceptedBody: string, imageUrl: string) {
    return withDzen1045Page(config, page => createDzen1045DurableDraftPhaseAV2(
        page, acceptedBody, imageUrl, { uploadImage: url => puppeteerPublisherService.uploadDzenImage(page, url) }
    ));
}
export async function inspectDzen1045PhaseAV2IncidentInBrowser(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => inspectDzen1045PhaseAV2Incident(page, acceptedBody));
}
export async function probeDzen1045ExactEditorStateInBrowser(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => probeDzen1045ExactEditorState(page, acceptedBody));
}
export async function publishDzen1045ExistingDraftOnceInBrowser(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => publishDzen1045ExistingDraftOnce(page, acceptedBody));
}
export async function probeDzen1045PhaseBDialogInBrowser(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => probeDzen1045PhaseBDialog(page, acceptedBody));
}
export async function probeDzen1045EditorControlMapInBrowser(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => probeDzen1045EditorControlMap(page, acceptedBody));
}
export async function previewDzen1045PhaseCInBrowser(config: Config, acceptedBody: string) {
    return withDzen1045Page(config, page => previewDzen1045PhaseC(page, acceptedBody));
}
export async function publishDzen1045PhaseCOnceInBrowser(config: Config, acceptedBody: string,
    expectedDialogFingerprint: string) {
    return withDzen1045Page(config,
        page => publishDzen1045PhaseCOnce(page, acceptedBody, expectedDialogFingerprint));
}
