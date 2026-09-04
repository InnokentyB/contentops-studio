export type VkStoryPoll = {
    question: string;
    answers: string[];
    anonymous: boolean;
    multiple: boolean;
    content_revision?: number;
};

function cleanText(value: unknown, field: string, maxLength: number) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!text) throw new Error(`[VK_STORY_POLL_INVALID] ${field} must not be empty`);
    if (text.length > maxLength) {
        throw new Error(`[VK_STORY_POLL_INVALID] ${field} exceeds ${maxLength} characters`);
    }
    return text;
}

export function normalizeVkStoryPoll(value: unknown): VkStoryPoll {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('[VK_STORY_POLL_INVALID] Poll must be an object');
    }
    const raw = value as any;
    const answers = Array.isArray(raw.answers)
        ? raw.answers.map((answer: unknown, index: number) => cleanText(answer, `Answer ${index + 1}`, 100))
        : [];
    if (answers.length < 2 || answers.length > 10) {
        throw new Error('[VK_STORY_POLL_INVALID] Poll must contain between 2 and 10 answers');
    }
    if (new Set(answers.map((answer: string) => answer.toLowerCase())).size !== answers.length) {
        throw new Error('[VK_STORY_POLL_INVALID] Poll answers must be unique');
    }
    const contentRevision = raw.content_revision ?? raw.contentRevision;
    return {
        question: cleanText(raw.question, 'Question', 255),
        answers,
        anonymous: raw.anonymous === true || raw.is_anonymous === true,
        multiple: raw.multiple === true || raw.is_multiple === true,
        ...(Number.isInteger(contentRevision) && contentRevision >= 0
            ? { content_revision: contentRevision }
            : {})
    };
}

export function resolveVkStoryPollFromTask(task: any): VkStoryPoll | null {
    const qualityReport = task?.quality_report && typeof task.quality_report === 'object' ? task.quality_report : {};
    const assets = task?.assets && typeof task.assets === 'object' ? task.assets : {};
    const candidate = qualityReport.handoff_bundle?.publication?.native_poll
        ?? assets.vk_story_poll
        ?? assets.action?.parameters?.native_poll
        ?? null;
    if (!candidate) return null;
    const poll = normalizeVkStoryPoll(candidate);
    if (poll.content_revision !== task.accepted_revision) {
        throw new Error('[VK_STORY_POLL_REVISION_MISMATCH] Poll must be bound to the accepted content revision');
    }
    return poll;
}

export function bindVkStoryPollToRevision(value: unknown, contentRevision: number): VkStoryPoll {
    const poll = normalizeVkStoryPoll(value);
    if (poll.content_revision !== contentRevision) {
        throw new Error('[VK_STORY_POLL_REVISION_MISMATCH] Poll must be bound to the current content revision');
    }
    return poll;
}

export function buildVkStoryPollSticker(poll: VkStoryPoll, providerPoll: any) {
    const pollId = Number(providerPoll?.id);
    const ownerId = Number(providerPoll?.owner_id);
    if (!Number.isSafeInteger(pollId) || pollId <= 0 || !Number.isSafeInteger(ownerId) || ownerId <= 0) {
        throw new Error('[VK_STORY_POLL_IDENTITY_MISSING] VK did not confirm the created poll identity');
    }
    return JSON.stringify({
        clickable_stickers: [{
            id: 1,
            type: 'poll',
            clickable_area: [
                { x: 80, y: 1080 },
                { x: 1000, y: 1080 },
                { x: 1000, y: 1720 },
                { x: 80, y: 1720 }
            ],
            poll: providerPoll
        }],
        original_width: 1080,
        original_height: 1920
    });
}

export function assertVkStoryPollReadback(story: any, expected: VkStoryPoll, pollId: number, ownerId: number) {
    const stickers = story?.clickable_stickers?.clickable_stickers;
    const sticker = Array.isArray(stickers)
        ? stickers.find((entry: any) => entry?.type === 'poll'
            && Number(entry?.poll?.id) === pollId
            && Number(entry?.poll?.owner_id) === ownerId)
        : null;
    const answerTexts = Array.isArray(sticker?.poll?.answers)
        ? sticker.poll.answers.map((answer: any) => String(answer?.text || '').replace(/\s+/g, ' ').trim())
        : [];
    if (!sticker
        || String(sticker.poll?.question || '').replace(/\s+/g, ' ').trim() !== expected.question
        || answerTexts.length !== expected.answers.length
        || answerTexts.some((answer: string, index: number) => answer !== expected.answers[index])) {
        throw new Error('[VK_STORY_POLL_READBACK_MISMATCH] VK did not return the exact native poll sticker');
    }
}
