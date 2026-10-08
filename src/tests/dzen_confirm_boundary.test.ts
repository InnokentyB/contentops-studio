import test from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'puppeteer';
import { clickDzenPublicationConfirm } from '../services/puppeteer/dzen_publication_outcome';

test('missing final control is explicitly pre-submit, never a retry authorization', async () => {
    let clicks = 0;
    const page = { waitForSelector: async () => { throw new Error('selector timeout'); },
        click: async () => { clicks++; } } as unknown as Page;
    await assert.rejects(() => clickDzenPublicationConfirm(page, '[data-testid="publish-btn"]'),
        /DZEN_FINAL_SUBMIT_NOT_ATTEMPTED/);
    assert.equal(clicks, 0);
});

test('click failure remains uncertain, never marked pre-submit', async () => {
    const page = { waitForSelector: async () => ({
        evaluate: async () => ({ disabled: false, ariaDisabled: false }),
        click: async () => { throw new Error('click transport lost'); }
    }) } as unknown as Page;
    await assert.rejects(() => clickDzenPublicationConfirm(page, 'button'), /click transport lost/);
});
