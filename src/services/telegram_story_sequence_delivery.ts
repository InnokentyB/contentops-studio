import type { TelegramStoryFrame } from './telegram_task1100_story_sequence';

type StoryIdentity = { storyId: number; publicLink: string | null };

export async function publishTelegramStorySequence(
    params: { idempotencyKey: string; frames: TelegramStoryFrame[] },
    publishFrame: (frame: TelegramStoryFrame, idempotencyKey: string) => Promise<StoryIdentity>
) {
    if (params.frames.length < 2 || params.frames.some((frame, index) => frame.order !== index + 1)) {
        throw new Error('[TELEGRAM_STORY_SEQUENCE_INVALID] Story frames must be complete and ordered');
    }
    const storyIds: number[] = [];
    const storyLinks: string[] = [];
    for (const frame of params.frames) {
        const story = await publishFrame(frame,
            `${params.idempotencyKey}:frame:${frame.order}:asset:${frame.assetId}`);
        storyIds.push(story.storyId);
        if (story.publicLink) storyLinks.push(story.publicLink);
    }
    if (storyIds.length !== params.frames.length || storyLinks.length !== params.frames.length) {
        throw new Error('[TELEGRAM_STORY_SEQUENCE_READBACK_FAILED] Telegram did not confirm every Story frame and link');
    }
    return {
        adapter: 'telegram_story_sequence', deliveryMethod: 'mtproto_personal_story_sequence',
        publishedLink: storyLinks[storyLinks.length - 1], evidenceRef: storyLinks[storyLinks.length - 1],
        metrics: { telegram_story_ids: storyIds, telegram_story_links: storyLinks }
    };
}
