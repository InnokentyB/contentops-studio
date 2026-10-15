import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { x1113BoundarySchema, x1113ClaimSchema } from '../services/x1113_contract';
import { guardManualPublicationFact } from '../services/publication_manual_fact_guard';
import type { Prisma } from '@prisma/client';
test('1113 generic manual form cannot bypass exact attempt confirmation', async () => {
    const noDatabase = {} as Prisma.TransactionClient;
    await assert.rejects(guardManualPublicationFact(noDatabase,
        { projectId: 10, taskId: 1113, internalConfirmation: false }), /X1113_EXACT_CONFIRMATION_REQUIRED/);
    await guardManualPublicationFact(noDatabase, { projectId: 10, taskId: 1113, internalConfirmation: true });
});
test('1113 lifecycle is owner/Publisher only, not content roles', () => {
    for (const name of ['ba_release_x_task1113_browser', 'ba_claim_x_task1113_browser',
        'ba_start_x_task1113_browser_submission', 'ba_pre_submit_x_task1113_browser_submission',
        'ba_confirm_x_task1113_browser_submission', 'ba_mark_x_task1113_browser_submission_uncertain']) {
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        assert.equal(isToolAllowedForProfile('owner', name), true);
        assert.equal(isToolAllowedForProfile('planner', name), false);
        assert.equal(isToolAllowedForProfile('writer', name), false);
    }
});
test('1113 claim does not require a not-yet-issued lease but submission does', () => {
    assert.equal(Object.prototype.hasOwnProperty.call(x1113ClaimSchema.shape, 'leaseToken'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(x1113BoundarySchema.shape, 'leaseToken'), true);
    assert.equal(x1113BoundarySchema.shape.browserProfile.safeParse('innokentybodrov.com').success, false);
});
