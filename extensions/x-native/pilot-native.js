(() => {
    const READER_BUILD_SHA256 = '__X_NATIVE_READER_BUILD__';
    const visible = element => element && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden';
    function packageData(value) {
        if (!value || !['projectId', 'taskId', 'channelId', 'revision'].every(key => Number.isSafeInteger(value[key]) && value[key] > 0)
            || typeof value.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.bodySha256)
            || typeof value.account !== 'string' || !/^@[A-Za-z0-9_]{1,15}$/.test(value.account)
            || value.profileUrl !== `https://x.com/${value.account.slice(1)}`
            || !Number.isFinite(Date.parse(value.scheduleAt))) throw Error('NATIVE_PACKAGE_INVALID');
        return value;
    }
    function account(expected) {
        const buttons = [...document.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"]')].filter(visible);
        const handles = buttons.length === 1 ? buttons[0].innerText.match(/@[A-Za-z0-9_]+/g) : [];
        if (!handles || handles.length !== 1 || handles[0].toLowerCase() !== expected.account.toLowerCase()) throw Error('NATIVE_ACCOUNT_MISMATCH');
        return expected.account;
    }
    function profile(expected, operation) {
        if (location.origin !== 'https://x.com' || location.pathname.replace(/\/$/, '').toLowerCase()
            !== `/${expected.account.slice(1)}`.toLowerCase() || location.search || location.hash) {
            throw Error(`NATIVE_${operation}_TARGET_INVALID`);
        }
    }
    function nativeStatuses(expected) {
        const ownPath = `/${expected.account.slice(1)}`.toLowerCase();
        return [...document.querySelectorAll('article[data-testid="tweet"]')].filter(visible).flatMap(article => {
            const authors = [...article.querySelectorAll('[data-testid="User-Name"] a[href]')]
                .filter(link => link.closest('article') === article && !link.closest('[data-testid="quoteTweet"]'));
            if (!authors.some(link => link.getAttribute('href')?.replace(/\/$/, '').toLowerCase() === ownPath)) return [];
            const times = [...article.querySelectorAll('a[href*="/status/"] time[datetime]')]
                .filter(time => time.closest('article') === article && !time.closest('[data-testid="quoteTweet"]'));
            const texts = [...article.querySelectorAll('[data-testid="tweetText"]')]
                .filter(text => text.closest('article') === article && !text.closest('[data-testid="quoteTweet"]') && visible(text));
            if (times.length !== 1 || texts.length !== 1) return [];
            const href = times[0].closest('a')?.getAttribute('href');
            let url;
            try { url = new URL(href, location.origin); } catch { return []; }
            const parts = url.pathname.split('/');
            if (url.origin !== 'https://x.com' || url.search || url.hash || parts.length !== 4
                || `/${parts[1]}`.toLowerCase() !== ownPath || parts[2] !== 'status' || !/^[1-9]\d*$/.test(parts[3])
                || !Number.isFinite(Date.parse(times[0].dateTime))) return [];
            return [{ id: parts[3], text: texts[0].innerText, publishedAt: times[0].dateTime,
                publicUrl: `${expected.profileUrl}/status/${parts[3]}`,
                pinnedOrRepost: !!article.querySelector('[data-testid="socialContext"]') }];
        });
    }
    async function history(text, expected) {
        profile(expected, 'HISTORY'); account(expected);
        const statuses = new Map(); const deadline = Date.now() + 120000;
        let complete = false;
        for (let round = 0; round < 20 && Date.now() < deadline; round++) {
            account(expected);
            for (const status of nativeStatuses(expected)) {
                if (status.text === text) throw Error('NATIVE_DUPLICATE_FOUND');
                if (!status.pinnedOrRepost && statuses.size < 20) statuses.set(status.id, status);
            }
            if ([...statuses.values()].some(status => Date.parse(status.publishedAt) <= Date.parse(expected.scheduleAt))) {
                complete = true; break;
            }
            if (statuses.size >= 20) break;
            window.scrollBy(0, Math.max(600, innerHeight));
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!complete) throw Error('NATIVE_HISTORY_INCOMPLETE');
        return { historyComplete: true, duplicateFound: false, scannedStatuses: statuses.size,
            historyFrom: new Date(Math.min(...[...statuses.values()].map(status => Date.parse(status.publishedAt)))).toISOString(),
            historyThrough: new Date().toISOString() };
    }
    function editor(text, expected) {
        if (location.origin !== 'https://x.com' || !/^\/compose\/(post|tweet)\/?$/.test(location.pathname)
            || location.search || location.hash) throw Error('NATIVE_EDITOR_MODE_INVALID');
        account(expected);
        const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
        // X wraps one composer in nested dialogs. Only one ancestor chain is valid;
        // sibling dialogs and a nested confirmation that excludes the editor fail closed.
        const leaf = dialogs.find(dialog => dialogs.every(parent => parent === dialog || parent.contains(dialog)));
        const root = dialogs.find(dialog => dialogs.every(child => child === dialog || dialog.contains(child)));
        if (!leaf || !root) throw Error('NATIVE_EDITOR_AMBIGUOUS');
        const fields = [...root.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"]')].filter(visible);
        const buttons = [...root.querySelectorAll('[data-testid="tweetButton"]')].filter(visible);
        if (fields.length !== 1 || buttons.length !== 1 || !leaf.contains(fields[0]) || !leaf.contains(buttons[0])) {
            throw Error('NATIVE_EDITOR_AMBIGUOUS');
        }
        if (fields[0].innerText !== text) throw Error('NATIVE_EDITOR_TEXT_MISMATCH');
        if (root.querySelector('[data-testid="attachments"], [data-testid="quoteTweet"], [data-testid="inline_reply_offscreen"]')) throw Error('NATIVE_EDITOR_MEDIA_PRESENT');
        if (buttons[0].getAttribute('aria-disabled') === 'true' || buttons[0].disabled) throw Error('NATIVE_POST_DISABLED');
        const language = (document.documentElement.lang || 'en').toLowerCase().split('-')[0];
        const postLabel = { en: 'Post', ru: 'Опубликовать пост' }[language];
        if (!postLabel || buttons[0].innerText.trim() !== postLabel) throw Error('NATIVE_POST_LABEL_UNSUPPORTED');
        return { button: buttons[0], observedAt: new Date().toISOString(), account: expected.account, text,
            kind: 'editor', editorMode: 'new_post', attachments: 0 };
    }
    async function result(text, expected) {
        profile(expected, 'RESULT'); const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
            account(expected);
            const matches = nativeStatuses(expected).filter(status => status.text === text);
            if (matches.length > 1) throw Error('NATIVE_RESULT_AMBIGUOUS');
            if (matches.length === 1) return { kind: 'published', observedAt: new Date().toISOString(), account: expected.account,
                text: matches[0].text, providerObjectId: matches[0].id, publicUrl: matches[0].publicUrl, publishedAt: matches[0].publishedAt };
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return { kind: 'unknown', observedAt: new Date().toISOString(), reason: 'readback_timeout' };
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id || !message || typeof message.text !== 'string'
            || message.text.length < 1 || message.text.length > 280) return false;
        if (!['history', 'editor', 'click', 'result'].includes(message.operation)) return false;
        (async () => {
            const expected = packageData(message.packageData);
            if (message.operation === 'click' && Date.now() < Date.parse(expected.scheduleAt)) throw Error('NATIVE_NOT_DUE');
            if (message.readerBuildSha256 !== READER_BUILD_SHA256 || !/^[a-f0-9]{64}$/.test(READER_BUILD_SHA256)) {
                throw Error('NATIVE_READER_BUILD_MISMATCH');
            }
            if (message.operation === 'history') return history(message.text, expected);
            if (message.operation === 'result') return result(message.text, expected);
            const checked = editor(message.text, expected);
            if (message.operation === 'click') {
                const expires = Date.parse(message.permit?.expiresAt);
                if (!Number.isSafeInteger(message.permit?.attemptId) || message.permit.attemptId < 1
                    || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 15000) throw Error('NATIVE_PERMIT_EXPIRED');
                // No async step between native final expiry/editor check and click.
                checked.button.click(); return { click_invoked: true };
            }
            const { button: _element, ...observation } = checked; return observation;
        })().then(value => respond({ ok: true, readerBuildSha256: READER_BUILD_SHA256, value }), error => respond({ ok: false,
            code: error instanceof Error && /^NATIVE_[A-Z0-9_]+$/.test(error.message) ? error.message : 'NATIVE_SURFACE_BLOCKED' }));
        return true;
    });
})();
