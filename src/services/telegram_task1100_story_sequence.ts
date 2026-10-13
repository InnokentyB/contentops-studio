import { createHash } from 'crypto';

export const TASK1100_ACCEPTED_BODY = `1/3
Текст принят. Время прошло. Ссылки нет.

Я считал публикацию готовой, хотя был подтверждён только контент. Доставка оставалась в неизвестном состоянии.

2/3
Четыре состояния вместо одного «готово»

1. Подготовлено.
2. Разрешено.
3. Отправлено.
4. Подтверждено.

Для каждого нужен свой факт: принятая редакция, разрешение, ответ площадки, публичная ссылка.

3/3
Где именно ломается контур

Разобрал реальный случай: почему владелец снова стал диспетчером и что я изменил в процессе.

Читать разбор в «Про продукты и системы»:
https://t.me/spherical_analyst/1279`;

export type TelegramStoryNativeLink = { url: string; label: string; canvasWidth: number; canvasHeight: number;
    centerX: number; centerY: number; width: number; height: number };
export type TelegramStoryFrame = { order: number; assetId: number; imageUrl: string; checksumSha256: string;
    caption: string; nativeLink?: TelegramStoryNativeLink };

export const TASK1100_STORY = {
    id: 1100, revision: 4, decisionId: 304, sequenceKey: 'p10-task1100-story-r4',
    bodySha256: '0b8962ebc8d9b36e793e887149617b0fac3cc21ba6400f6da94c49c1e26125a1',
    assetIds: [153, 154, 155], hashes: [
        '6033ef06d5a0f463109a09046457fb12c7ab3b284f8c9f6de57aa63a877e4754',
        'a33c851994f7a63a946aea17dae7de75d930f1c764f09ad884bac17247e37a13',
        'c34a7b109d01392029b6186ee82b48dba39623a85b5e1ee4be23bffbda038fbf'
    ], link: { url: 'https://t.me/spherical_analyst/1279', label: 'Читать разбор',
        centerX: 540, centerY: 1495, width: 480, height: 110 }
} as const;

function object(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function resolveTask1100StoryFrames(task: any): TelegramStoryFrame[] | null {
    if (task.id !== TASK1100_STORY.id) return null;
    if (task.project_id !== 10 || task.channel_id !== 108 || task.visual_placement !== 'story'
        || task.content_revision !== TASK1100_STORY.revision || task.accepted_revision !== TASK1100_STORY.revision
        || task.visual_decision_version !== TASK1100_STORY.revision || task.selected_asset_id !== 155
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== TASK1100_STORY.bodySha256) {
        throw new Error('[TELEGRAM_STORY_SEQUENCE_PACKAGE_CHANGED] Task1100 no longer matches the released package');
    }
    const candidates = Array.isArray(task.image_assets) ? task.image_assets.filter((asset: any) => {
        const provenance = object(asset?.provenance);
        return asset?.status === 'approved' && asset?.content_revision === TASK1100_STORY.revision
            && asset?.decision_id === TASK1100_STORY.decisionId && asset?.placement === 'story'
            && provenance.sequence_key === TASK1100_STORY.sequenceKey;
    }) : [];
    const ordered = candidates.sort((left: any, right: any) =>
        Number(object(left.provenance).frame_index) - Number(object(right.provenance).frame_index));
    if (ordered.length !== 3) throw new Error('[TELEGRAM_STORY_SEQUENCE_INCOMPLETE] Task1100 requires exactly three approved frames');
    return ordered.map((asset: any, index: number): TelegramStoryFrame => {
        const provenance = object(asset.provenance);
        const storage = object(provenance.planner_storage);
        const order = index + 1;
        if (Number(provenance.frame_count) !== 3 || Number(provenance.frame_index) !== order
            || asset.id !== TASK1100_STORY.assetIds[index] || storage.sha256 !== TASK1100_STORY.hashes[index]
            || storage.managed !== true || storage.mime_type !== 'image/jpeg'
            || Number(storage.width) !== 1080 || Number(storage.height) !== 1920
            || typeof asset.file_url !== 'string' || !asset.file_url.startsWith('https://')) {
            throw new Error('[TELEGRAM_STORY_SEQUENCE_PACKAGE_CHANGED] Task1100 frame binding changed');
        }
        const frame: TelegramStoryFrame = { order, assetId: asset.id, imageUrl: asset.file_url,
            checksumSha256: storage.sha256, caption: '' };
        if (order === 3) frame.nativeLink = resolveNativeLink(provenance.native_link_sticker);
        return frame;
    });
}

function resolveNativeLink(value: unknown): TelegramStoryNativeLink {
    const link = object(value);
    const placement = object(link.placement);
    if (link.required !== true || link.must_be_native_clickable !== true
        || link.url !== TASK1100_STORY.link.url || link.label !== TASK1100_STORY.link.label
        || Number(placement.center_x_px) !== TASK1100_STORY.link.centerX
        || Number(placement.center_y_px) !== TASK1100_STORY.link.centerY
        || Number(placement.width_px) !== TASK1100_STORY.link.width
        || Number(placement.height_px) !== TASK1100_STORY.link.height) {
        throw new Error('[TELEGRAM_STORY_NATIVE_LINK_CHANGED] Task1100 link area changed');
    }
    return { url: link.url, label: link.label, canvasWidth: 1080, canvasHeight: 1920,
        centerX: TASK1100_STORY.link.centerX, centerY: TASK1100_STORY.link.centerY,
        width: TASK1100_STORY.link.width, height: TASK1100_STORY.link.height };
}
