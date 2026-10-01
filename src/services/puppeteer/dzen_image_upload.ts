import type { ElementHandle, Page } from 'puppeteer';
import { classifyDzenImageUploadOutcome } from './dzen_dom_helpers';

const ARTICLE_IMAGE_SELECTOR = 'figure[itemprop="image"] img, [class*="article-image-item__image"]';
const UPLOAD_ERROR_PATTERN = /не удалось загрузить изображение|загружено с ошибкой|image upload failed|failed to upload image/i;

/** Select a local image and require provider plus editor confirmation before publication can continue. */
export async function uploadDzenFileAndVerify(
    page: Page,
    input: ElementHandle<HTMLInputElement>,
    filePath: string,
    previousImageCount: number
): Promise<void> {
    const uploadResponsePromise = page.waitForResponse((providerResponse) => {
        if (providerResponse.request().method().toUpperCase() !== 'POST') return false;
        try {
            const providerUrl = new URL(providerResponse.url());
            return (providerUrl.hostname === 'dzen.ru' || providerUrl.hostname.endsWith('.dzen.ru'))
                && providerUrl.pathname === '/editor-api/v2/add-image';
        } catch {
            return false;
        }
    }, { timeout: 30_000 }).catch(() => null);

    await input.uploadFile(filePath);
    const uploadResponse = await uploadResponsePromise;
    await page.waitForFunction(
        (before, selector, errorSource) => {
            const imageCount = document.querySelectorAll(selector).length;
            const text = document.body?.innerText || '';
            return imageCount > before || new RegExp(errorSource, 'i').test(text);
        },
        { timeout: 30_000 },
        previousImageCount,
        ARTICLE_IMAGE_SELECTOR,
        UPLOAD_ERROR_PATTERN.source
    ).catch(() => undefined);
    const uploadState = await page.evaluate((before, selector) => ({
        insertedImage: document.querySelectorAll(selector).length > before,
        pageText: document.body?.innerText || ''
    }), previousImageCount, ARTICLE_IMAGE_SELECTOR);
    const outcome = classifyDzenImageUploadOutcome({
        responseStatus: uploadResponse?.status() ?? null,
        insertedImage: uploadState.insertedImage,
        pageText: uploadState.pageText
    });
    if (outcome.kind === 'rejected') {
        throw new Error(`[DZEN_IMAGE_UPLOAD_REJECTED] ${outcome.message}`);
    }
    if (outcome.kind === 'uncertain') {
        throw new Error(`[DZEN_IMAGE_UPLOAD_UNCERTAIN] ${outcome.reason}`);
    }
}
