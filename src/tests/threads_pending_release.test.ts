import test from 'node:test';
import assert from 'node:assert/strict';
import { releasePendingThreadsTask } from '../services/threads_pending_release.service';
test('pending Threads release is limited to the two approved task packages', async () => {
    await assert.rejects(() => releasePendingThreadsTask({ projectId: 10, taskId: 1029 } as never),
        /THREADS_PENDING_SCOPE_MISMATCH/);
});
