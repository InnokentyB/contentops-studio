import { test, expect, request } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3003';

const DEFAULT_EMAIL = process.env.TEST_EMAIL || 'e2e@contentops-studio.test';
const DEFAULT_PASS = process.env.TEST_PASS || 'e2e-test-password-123';

async function getAuthData(): Promise<{ token: string; user: object; projects: object[] }> {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API_URL}/api/auth/login`, {
        data: {
            email: DEFAULT_EMAIL,
            password: DEFAULT_PASS
        }
    });
    if (!res.ok()) {
        throw new Error(`Login failed with status ${res.status()}: ${await res.text()}`);
    }
    return res.json();
}

async function injectAuth(page: import('@playwright/test').Page) {
    const data = await getAuthData();
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate(({ token, user, projects }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('projects', JSON.stringify(projects));
        if ((projects as { id: number }[]).length > 0) {
            localStorage.setItem('projectId', String((projects as { id: number }[])[0].id));
        }
    }, data as { token: string; user: object; projects: object[] });
}

test.describe('TDPD UI validations & Toast system E2E tests', () => {
    test.beforeEach(async ({ page }) => {
        await injectAuth(page);
    });

    test('should validate Telegram Channel ID prefix (-100)', async ({ page }) => {
        await page.goto('/settings');
        await page.getByRole('button', { name: /channels/i }).click();

        const idInput = page.locator('label:has-text("Channel ID") ~ input');
        await idInput.fill('123456789'); // missing prefix
        const warning = page.locator('text=Telegram channel IDs usually start with -100');
        await expect(warning).toBeVisible();

        await idInput.fill('-100123456789'); // correct prefix
        await expect(warning).not.toBeVisible();
    });

    test('should validate Telegram Handle normalization prefix (@)', async ({ page }) => {
        await page.goto('/settings');
        await page.getByRole('button', { name: /channels/i }).click();

        const usernameInput = page.locator('label:has-text("Username") ~ input');
        await usernameInput.fill('testchannel'); // missing @
        const hint = page.locator('text=Will be auto-normalized to include @ prefix');
        await expect(hint).toBeVisible();

        await usernameInput.fill('@testchannel'); // correct prefix
        await expect(hint).not.toBeVisible();
    });

    test('should validate VK Group ID sign prefix (negative)', async ({ page }) => {
        await page.goto('/settings');
        await page.getByRole('button', { name: /channels/i }).click();

        // Switch to VKontakte type using the Add Channel selector dropdown
        const selectDropdown = page.locator('h3:has-text("Add Channel") ~ select');
        await selectDropdown.selectOption('vk');

        const idInput = page.locator('label:has-text("VK Group/Community ID") ~ input');
        await idInput.fill('123456789'); // missing sign
        const warning = page.locator('text=VK Group IDs must be negative (start with -)');
        await expect(warning).toBeVisible();

        await idInput.fill('-123456789'); // correct
        await expect(warning).not.toBeVisible();
    });

    test('should show premium toast notifications upon settings updates', async ({ page }) => {
        await page.goto('/settings');
        
        // Locate project name input and wait for it to be loaded (value not empty)
        const nameInput = page.locator('label:has-text("Project Name") ~ input');
        await expect(nameInput).not.toHaveValue('');

        // Fill out new project name
        await nameInput.fill('E2E Updated Project Name');

        // Click Save Changes button
        await page.getByRole('button', { name: 'Save Changes' }).click();

        // Verify premium toast container is visible
        const toast = page.locator('.toast-card');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('Project updated successfully');
    });

    test('should allow selecting a publication source when initiating a new week', async ({ page }) => {
        await page.goto('/calendar');

        // Click on INITIATE WEEK button to show the creation panel
        const initiateBtn = page.getByRole('button', { name: /INITIATE WEEK|ABORT/i });
        await initiateBtn.click();

        // Check if Strategic Theme input, Node Activation Date, and Publication Source dropdown are visible
        const themeInput = page.locator('label:has-text("Strategic Theme") ~ input');
        const selectSource = page.locator('label:has-text("Publication Source") ~ select');
        
        await expect(themeInput).toBeVisible();
        await expect(selectSource).toBeVisible();

        // The select should contain 'Default Node Setting' option
        const defaultOption = selectSource.locator('option[value=""]');
        await expect(defaultOption).toContainText('Default Node Setting');
    });
});
