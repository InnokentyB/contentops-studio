import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests', testMatch: 'publication-method.spec.ts', workers: 1,
    retries: 0, reporter: 'line',
    use: { baseURL: 'http://127.0.0.1:5187', browserName: 'chromium' },
    webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort',
        url: 'http://127.0.0.1:5187', reuseExistingServer: false, timeout: 30000 }
});
