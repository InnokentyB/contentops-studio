/** Evidence from a bounded, complete provider Clip listing before any upload. */
export interface VkClipBaseline {
    captured_at: string;
    owner_id: string;
    object_ids: string[];
    complete: boolean;
}

/** Readback must be collected from the provider, never inferred from editor state. */
export interface VkClipReadback {
    public_url: string;
    provider_object_id: string;
    owner_id: string;
    provider_kind: 'short_video';
    provider_timestamp_source: 'provider';
    published_at: string;
    observed_at: string;
    text: string;
    media_present: boolean;
    /** Upload acknowledgement binds the selected bytes to the returned Clip. */
    clip_media_sha256: string;
}

/** Clip-specific UI port; a verified driver must implement every stage independently. */
export interface VkClipUi {
    assertSurfaceVerified(): Promise<void>;
    baseline(ownerId: string): Promise<VkClipBaseline>;
    openComposer(ownerId: string): Promise<void>;
    setCaption(text: string): Promise<void>;
    attachMp4(mediaPath: string, mediaSha256: string): Promise<void>;
    submit(): Promise<void>;
    readback(): Promise<VkClipReadback | null>;
}

/** No live Clip surface has been verified: fail before navigation, upload, or submit. */
export class UnverifiedVkClipUi implements VkClipUi {
    private blocked(): never {
        throw new Error('[VK_CLIP_UI_UNVERIFIED] Live VK Clip editor and provider readback require owner-verified surface/UAT');
    }
    async assertSurfaceVerified(): Promise<void> { this.blocked(); }
    async baseline(_ownerId: string): Promise<VkClipBaseline> { return this.blocked(); }
    async openComposer(_ownerId: string): Promise<void> { this.blocked(); }
    async setCaption(_text: string): Promise<void> { this.blocked(); }
    async attachMp4(_mediaPath: string, _mediaSha256: string): Promise<void> { this.blocked(); }
    async submit(): Promise<void> { this.blocked(); }
    async readback(): Promise<VkClipReadback | null> { return this.blocked(); }
}
