import { test, expect } from '@playwright/test';

const task = { id: 1048, title: 'VK adapter pilot', type: 'vk_post', status: 'browser_required',
    publication_mode: 'browser_required', content_state: 'ready', draft_text: 'Approved pilot text',
    content_revision: 1, accepted_revision: 1, text_state: 'accepted', visual_state: 'APPROVED',
    channel: { id: 117, type: 'vk', name: 'AnalystCraft VK' },
    quality_report: { handoff_bundle: { publication: { body: 'Approved pilot text' } } } };

for (const width of [1440, 375]) {
    test(`operator switches methods without publication writes at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const writes: string[] = [];
        await page.addInitScript(() => {
            localStorage.setItem('token', 'offline-fixture');
            localStorage.setItem('projectId', '10');
            localStorage.setItem('locale', 'en');
        });
        await page.route('**/api/**', async route => {
            const path = new URL(route.request().url()).pathname;
            if (route.request().method() !== 'GET') writes.push(path);
            let body: unknown = [];
            if (path === '/api/auth/me') body = { user: { id: 2, email: 'fixture@example.test' }, projects: [{ id: 10, name: 'Fixture' }] };
            else if (path.endsWith('/adapter-status')) body = { supported: true, canExecute: false,
                manualRecordAllowed: false, diagnostics: { controlPlane: 'CONNECTED', applicationAuthorization: 'NOT_ASSESSED', providerReadiness: 'NOT_CHECKED', recordedRestriction: null }, state: 'blocked', blocker: 'PROVIDER_PERMISSION_UNVERIFIED',
                connection: 'online', heartbeatAt: new Date().toISOString(), observedAt: new Date().toISOString(), publicUrl: null };
            else if (path === '/api/publication-tasks/1048') body = task;
            else if (path === '/api/publication-tasks') body = [task];
            else if (path.endsWith('/visual-readiness')) body = { ready: true, visual_state: 'APPROVED' };
            await route.fulfill({ json: body });
        });
        await page.goto('/publication-tasks?taskId=1048');
        const selector = page.getByRole('combobox', { name: /Publication method|Способ публикации/ });
        await expect(selector).toBeVisible();
        await expect(page.getByText('PROVIDER_PERMISSION_UNVERIFIED', { exact: true })).toBeVisible();
        await expect(page.getByText('Application authorization has not been assessed.', { exact: true })).toBeVisible();
        await expect(page.getByText('VK login, rights and readiness have not been checked.', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /Publish through adapter|Опубликовать через адаптер/ })).toBeDisabled();
        await selector.selectOption('record');
        await expect(page.getByRole('button', { name: /Record publication fact|Зафиксировать факт публикации/ })).toBeDisabled();
        await selector.selectOption('adapter');
        expect(writes).toEqual([]);
        await selector.locator('..').locator('..').screenshot({ path: `/tmp/publication-method-${width}.png` });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('unavailable adapter status disables both sends and competing records', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('token', 'offline-fixture'); localStorage.setItem('projectId', '10'); });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/adapter-status')) return route.fulfill({ status: 503, json: { error: 'ADAPTER_STATUS_UNAVAILABLE' } });
        const body = path === '/api/auth/me' ? { user: { id: 2 }, projects: [{ id: 10, name: 'Fixture' }] }
            : path === '/api/publication-tasks/1048' ? task : path === '/api/publication-tasks' ? [task]
                : path.endsWith('/visual-readiness') ? { ready: true } : [];
        await route.fulfill({ json: body });
    });
    await page.goto('/publication-tasks?taskId=1048');
    const selector = page.getByRole('combobox', { name: /Publication method|Способ публикации/ });
    await expect(page.getByText(/Status unavailable or stale|Состояние недоступно или устарело/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Publish through adapter|Опубликовать через адаптер/ })).toBeDisabled();
    await selector.selectOption('record');
    await expect(page.getByRole('button', { name: /Record publication fact|Зафиксировать факт публикации/ })).toBeDisabled();
});

test('supported non-VK channel sends only after its explicit publish button', async ({ page }) => {
    const direct = { ...task, id: 2000, status: 'ready_for_execution', publication_mode: 'connector_auto',
        channel: { id: 200, type: 'telegram', name: 'Fixture Telegram' } };
    const sends: string[] = [];
    await page.addInitScript(() => { localStorage.setItem('token', 'offline-fixture'); localStorage.setItem('projectId', '10'); });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== 'GET') sends.push(path);
        const body = path === '/api/auth/me' ? { user: { id: 2 }, projects: [{ id: 10, name: 'Fixture' }] }
            : path === '/api/publication-tasks/2000' ? direct : path === '/api/publication-tasks' ? [direct]
                : path.endsWith('/visual-readiness') ? { ready: true } : path.endsWith('/publish-now') ? { result: { adapter: 'fixture' } } : [];
        await route.fulfill({ json: body });
    });
    await page.goto('/publication-tasks?taskId=2000');
    const selector = page.getByRole('combobox', { name: /Publication method|Способ публикации/ });
    await selector.selectOption('record'); await selector.selectOption('adapter');
    expect(sends).toEqual([]);
    const publish = page.getByRole('button', { name: /Publish through adapter|Опубликовать через адаптер/ });
    await expect(publish).toBeEnabled(); await publish.click();
    await expect.poll(() => sends).toEqual(['/api/publication-tasks/2000/publish-now']);
});

for (const state of ['verification_required', 'stale', 'confirmed']) {
    test(`pilot ${state} keeps its canonical result boundary`, async ({ page }) => {
        const confirmed = state === 'confirmed';
        const current = confirmed ? { ...task, status: 'published', published_link: 'https://vk.ru/wall-240051152_99' } : task;
        await page.addInitScript(() => { localStorage.setItem('token', 'offline-fixture'); localStorage.setItem('projectId', '10'); });
        await page.route('**/api/**', async route => {
            const path = new URL(route.request().url()).pathname;
            const body = path === '/api/auth/me' ? { user: { id: 2 }, projects: [{ id: 10, name: 'Fixture' }] }
                : path === '/api/publication-tasks/1048' ? current : path === '/api/publication-tasks' ? [current]
                    : path.endsWith('/adapter-status') ? { supported: true, canExecute: false, manualRecordAllowed: confirmed,
                        state, blocker: null, connection: 'online', observedAt: new Date(Date.now() - (state === 'stale' ? 60000 : 0)).toISOString() }
                        : path.endsWith('/visual-readiness') ? { ready: true } : [];
            await route.fulfill({ json: body });
        });
        await page.goto('/publication-tasks?taskId=1048');
        const selector = page.getByRole('combobox', { name: /Publication method|Способ публикации/ });
        await expect(selector).toHaveValue(confirmed ? 'record' : 'adapter');
        if (!confirmed) {
            if (state === 'stale') await expect(page.getByText(/Status unavailable or stale|Состояние недоступно или устарело/)).toBeVisible();
            else await expect(page.getByText('Job: verification_required', { exact: true })).toBeVisible();
            await selector.selectOption('record');
            await expect(page.getByRole('button', { name: /Record publication fact|Зафиксировать факт публикации/ })).toBeDisabled();
        } else {
            await expect(page.getByRole('textbox', { name: /Live post link|Ссылка на пост/ })).toBeEnabled();
        }
    });
}
