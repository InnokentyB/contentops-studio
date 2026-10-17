ARG BROWSER_BASE=tower-browser-checks:20261016
FROM ${BROWSER_BASE}

# Local reviewed cache image: inspect its ID before building; no install/download.
USER 1000:1000
RUN node -e "const assert=require('node:assert/strict'); assert.equal(require('/app/node_modules/playwright/package.json').version, '1.63.0')"
ENV HOME=/tmp \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    X_BROWSER_PLAYWRIGHT_MODULE=/app/node_modules/playwright \
    X_BROWSER_EXECUTABLE=/opt/playwright/chromium-1243/chrome-linux64/chrome
WORKDIR /workspace
CMD ["node", "--test", "--test-concurrency=1", "tests/tdpd/x-native-shared-extension-browser.test.mjs"]
