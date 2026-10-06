import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseXTask1025Revision3 } from '../services/x_task1025_rev3_release.service';
test('1025 revision 3 release rejects an old body or widened task before writes', async () => {
    await assert.rejects(() => releaseXTask1025Revision3({ taskId: 1079 } as never), /TASK1025_RELEASE_SCOPE_MISMATCH/);
});
