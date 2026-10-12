import type { Page, Locator } from 'playwright';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import type { VkClipUi, VkClipBaseline } from './vk_browser_clip_ui';

/** Independent provider evidence; local hashes and local clocks are not provider proof. */
export interface VkClipProviderEvidence {
    public_url: string; provider_object_id: string; owner_id: string;
    provider_kind: 'short_video'; provider_timestamp_source: 'provider';
    published_at: string; observed_at: string; text: string; media_present: boolean;
    clip_media_sha256: string; media_acknowledgement_reference: string;
}
/** A permitted collector must establish complete listing and actual upload acknowledgement. */
export interface VkClipProviderEvidenceReader {
    baseline(ownerId: string): Promise<{ captured_at: string; owner_id: string; object_ids: string[]; complete: boolean }>;
    publishedClip(url: string): Promise<VkClipProviderEvidence | null>;
}
/** Screenshots ground semantics but cannot set either of these operational gates. */
export interface VkClipSurfaceVerification {
    permitted: boolean; domContractVerified: boolean; evidenceReference: string;
}
/** Observed editor defaults; only Story distribution is actively disabled by this route. */
export interface VkClipEditorSettings {
    stories: false; comments: boolean; duets: boolean; show_in_community: boolean;
}
/** Narrow browser port lets offline DOM fixtures replace navigation without using VK. */
export interface VkClipPagePort {
    navigate(url: string): Promise<void>;
    locator(selector: string): Locator;
    button(name: RegExp): Locator;
    caption(): Locator;
    storySwitch(): Locator;
    namedSwitch(name: RegExp): Locator;
    processed(): Locator;
    snapshot(): Promise<{ url: string; links: string[]; body: string; hasVideo: boolean }>;
}
/** Bind the tentative screenshot-grounded controls to a browser page. Live verification is separate. */
export function createPlaywrightVkClipPagePort(page: Page): VkClipPagePort {
    return {
        navigate: async url => { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); },
        locator: selector => page.locator(selector),
        button: name => page.getByRole('button', { name }),
        caption: () => page.getByPlaceholder('О чём ваш клип?', { exact: true }),
        storySwitch: () => page.getByRole('switch', { name: /опубликовать в истори(?:и|ях)|publish in stories/i }),
        namedSwitch: name => page.getByRole('switch', { name }),
        processed: () => page.getByText(/клип обработан|загружен и обработан|готов к публикации|clip processed/i),
        snapshot: () => page.evaluate(() => ({ url: location.href,
            links: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map(anchor => anchor.href),
            body: document.body.innerText, hasVideo: document.querySelector('video') !== null }))
    };
}

const providerEvidenceSchema = z.object({
    public_url: z.string().url(), provider_object_id: z.string(), owner_id: z.string(),
    provider_kind: z.literal('short_video'), provider_timestamp_source: z.literal('provider'),
    published_at: z.string().datetime({ offset: true }), observed_at: z.string().datetime({ offset: true }),
    text: z.string(), media_present: z.literal(true), clip_media_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    media_acknowledgement_reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/)
});
function canonicalClip(value: string, ownerId: string): string | null {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || !['vk.com', 'vk.ru'].includes(url.hostname)
        || url.username || url.password || url.port || url.search || url.hash
        || !new RegExp(`^/clip${ownerId}_[1-9]\\d*$`).test(url.pathname)) return null;
    return `https://vk.com${url.pathname}`;
}

/** Tentative screenshot-grounded editor driver; a permitted verified DOM contract is mandatory. */
export class PlaywrightVkClipUi implements VkClipUi {
    private ownerId: string | null = null;
    private baselineIds: string[] | null = null;
    private acceptedCaption: string | null = null;
    private uploadedHash: string | null = null;
    private allocatedUrl: string | null = null;
    private submissionStarted = false;
    private uploadAttempted = false;
    private observedSettings: VkClipEditorSettings | null = null;
    constructor(private readonly page: VkClipPagePort,
        private readonly verification: VkClipSurfaceVerification = { permitted: false, domContractVerified: false, evidenceReference: '' },
        private readonly evidence?: VkClipProviderEvidenceReader) {}
    async assertSurfaceVerified(): Promise<void> {
        if (!this.verification.permitted || !this.verification.domContractVerified || !this.verification.evidenceReference.trim()) {
            throw new Error('[VK_CLIP_UI_UNVERIFIED] Permitted DOM contract and independent provider evidence are required');
        }
        if (!this.evidence) throw new Error('[VK_CLIP_PROVIDER_EVIDENCE_REQUIRED] No verified independent evidence collector is configured');
    }
    async baseline(ownerId: string): Promise<VkClipBaseline> {
        await this.assertSurfaceVerified();
        if (!/^-[1-9]\d*$/.test(ownerId)) throw new Error('[VK_CLIP_OWNER_INVALID] Community identity is required');
        const result = await this.evidence!.baseline(ownerId);
        if (result.owner_id !== ownerId || result.complete !== true || !Number.isFinite(Date.parse(result.captured_at))
            || !Array.isArray(result.object_ids) || result.object_ids.length > 200
            || result.object_ids.some(id => canonicalClip(`https://vk.com/${id}`, ownerId) === null)
            || new Set(result.object_ids).size !== result.object_ids.length) {
            throw new Error('[VK_CLIP_BASELINE_UNCONFIRMED] Complete community Clip baseline is required');
        }
        this.ownerId = ownerId; this.baselineIds = [...result.object_ids];
        return result;
    }
    async openComposer(ownerId: string): Promise<void> {
        await this.assertSurfaceVerified();
        if (this.uploadAttempted || this.submissionStarted) throw new Error('[VK_CLIP_UPLOAD_STATE_INVALID]');
        if (ownerId !== this.ownerId || !this.baselineIds) throw new Error('[VK_CLIP_BASELINE_REQUIRED]');
        await this.page.navigate(`https://vk.com/clips/upload${ownerId}`);
        const input = this.page.locator('input[type="file"][accept*="video"]');
        if (await input.count() !== 1) throw new Error('[VK_CLIP_EDITOR_AMBIGUOUS] One explicit video upload control is required');
        await input.waitFor({ state: 'attached', timeout: 30_000 });
    }
    async setCaption(text: string): Promise<void> {
        await this.assertSurfaceVerified();
        if (!this.uploadedHash || !text.trim() || this.submissionStarted) throw new Error('[VK_CLIP_CAPTION_AFTER_UPLOAD_REQUIRED]');
        const caption = this.page.caption();
        if (await caption.count() !== 1) throw new Error('[VK_CLIP_EDITOR_AMBIGUOUS]');
        await caption.fill(text, { timeout: 30_000 });
        if (await caption.inputValue() !== text) throw new Error('[VK_CLIP_CAPTION_MISMATCH]');
        this.acceptedCaption = text;
    }
    async attachMp4(mediaPath: string, mediaSha256: string): Promise<void> {
        await this.assertSurfaceVerified();
        if (!this.ownerId || this.uploadAttempted || this.submissionStarted) throw new Error('[VK_CLIP_UPLOAD_STATE_INVALID]');
        if (!/\.mp4$/i.test(mediaPath) || !/^[a-f0-9]{64}$/.test(mediaSha256)) throw new Error('[VK_CLIP_MP4_REQUIRED]');
        const file = await stat(mediaPath);
        if (!file.isFile() || file.size < 1 || file.size > 512 * 1024 * 1024) throw new Error('[VK_CLIP_ASSET_SIZE_INVALID]');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(mediaPath)) hash.update(chunk);
        if (hash.digest('hex') !== mediaSha256) throw new Error('[VK_CLIP_LOCAL_MEDIA_HASH_MISMATCH]');
        this.uploadAttempted = true;
        await this.page.locator('input[type="file"][accept*="video"]').setInputFiles(mediaPath, { timeout: 30_000 });
        // A disappearing progress bar or a pre-publication permalink is insufficient.
        await this.page.processed().waitFor({ state: 'visible', timeout: 180_000 });
        if (await this.page.button(/обложка|cover/i).count() !== 1) throw new Error('[VK_CLIP_COVER_SETTING_UNVERIFIABLE]');
        await this.disableStoryDistribution();
        this.observedSettings = await this.readEditorSettings();
        const snapshot = await this.page.snapshot();
        const links = [...new Set(snapshot.links.map(link => canonicalClip(link, this.ownerId!)).filter((link): link is string => Boolean(link)))];
        if (links.length !== 1) throw new Error('[VK_CLIP_ALLOCATION_UNCONFIRMED] Exact allocated Clip identity is required');
        this.allocatedUrl = links[0]; this.uploadedHash = mediaSha256;
    }
    private async disableStoryDistribution(): Promise<void> {
        const toggle = this.page.storySwitch();
        if (await toggle.count() !== 1) throw new Error('[VK_CLIP_STORY_SETTING_UNVERIFIABLE]');
        const checked = await toggle.getAttribute('aria-checked');
        if (checked === 'true') await toggle.click({ timeout: 30_000 });
        if (await toggle.getAttribute('aria-checked') !== 'false') throw new Error('[VK_CLIP_STORY_SETTING_UNVERIFIABLE]');
    }
    private async readEditorSettings(): Promise<VkClipEditorSettings> {
        const read = async (label: RegExp): Promise<boolean> => {
            const control = this.page.namedSwitch(label);
            if (await control.count() !== 1 || !await control.isVisible()) throw new Error('[VK_CLIP_EDITOR_SETTINGS_UNVERIFIABLE]');
            const value = await control.getAttribute('aria-checked');
            if (value !== 'true' && value !== 'false') throw new Error('[VK_CLIP_EDITOR_SETTINGS_UNVERIFIABLE]');
            return value === 'true';
        };
        return { stories: false,
            comments: await read(/разрешить комментарии|allow comments/i),
            duets: await read(/разрешить дуэты|allow duets/i),
            show_in_community: await read(/показ(?:ывать|ать).*сообществ|show.*community/i) };
    }
    /** Return the final readback of visible editor defaults without changing their values. */
    settingsReadback(): VkClipEditorSettings {
        if (!this.observedSettings) throw new Error('[VK_CLIP_EDITOR_SETTINGS_UNVERIFIABLE]');
        return { ...this.observedSettings };
    }
    async submit(): Promise<void> {
        await this.assertSurfaceVerified();
        if (!this.uploadedHash || !this.allocatedUrl || !this.acceptedCaption || this.submissionStarted) throw new Error('[VK_CLIP_SUBMIT_STATE_INVALID]');
        await this.disableStoryDistribution();
        this.observedSettings = await this.readEditorSettings();
        if (await this.page.caption().inputValue() !== this.acceptedCaption) throw new Error('[VK_CLIP_CAPTION_MISMATCH]');
        const button = this.page.button(/^опубликовать$|^publish$/i);
        if (await button.count() !== 1) throw new Error('[VK_CLIP_EDITOR_AMBIGUOUS]');
        this.submissionStarted = true;
        await button.click({ timeout: 30_000 });
    }
    async readback(): Promise<VkClipProviderEvidence | null> {
        await this.assertSurfaceVerified();
        if (!this.submissionStarted || !this.allocatedUrl || !this.ownerId) throw new Error('[VK_CLIP_NOT_SUBMITTED]');
        const raw = await this.evidence!.publishedClip(this.allocatedUrl);
        if (!raw) return null;
        if (!raw.media_acknowledgement_reference?.trim() || raw.clip_media_sha256 !== this.uploadedHash) {
            throw new Error('[VK_CLIP_MEDIA_BINDING_UNVERIFIABLE] Local byte integrity alone is not provider acknowledgement');
        }
        const parsed = providerEvidenceSchema.safeParse(raw);
        if (!parsed.success) throw new Error('[VK_CLIP_PROVIDER_EVIDENCE_INVALID] Exact provider timestamp and acknowledgement are required');
        const proof = parsed.data;
        const canonical = canonicalClip(proof.public_url, this.ownerId);
        if (canonical !== this.allocatedUrl || proof.owner_id !== this.ownerId
            || proof.provider_object_id !== new URL(this.allocatedUrl).pathname.slice(1)
            || this.baselineIds?.includes(proof.provider_object_id) || proof.text !== this.acceptedCaption
            || Date.parse(proof.published_at) > Date.parse(proof.observed_at)) throw new Error('[VK_CLIP_PUBLICATION_IDENTITY_MISMATCH]');
        await this.page.navigate(this.allocatedUrl);
        const snapshot = await this.page.snapshot();
        if (canonicalClip(snapshot.url, this.ownerId) !== canonical || !snapshot.hasVideo
            || !snapshot.body.includes(this.acceptedCaption!)
            || !snapshot.links.some(link => link === `https://vk.com/club${this.ownerId!.slice(1)}`)) {
            throw new Error('[VK_CLIP_PLAYBACK_READBACK_UNCONFIRMED] Independent playback, caption and community are required');
        }
        return { ...proof, public_url: canonical! };
    }
}
