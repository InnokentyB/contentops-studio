import assert from 'node:assert/strict';
import test from 'node:test';
import { executePublicationTaskByChannel, isTaskNativeDzenPublication } from '../mcp/tools/task_publication_tools';

test('Dzen 1036 is exact task-native scope, not a generic project bypass', () => {
    assert.equal(isTaskNativeDzenPublication(10, 1036), true);
    assert.equal(isTaskNativeDzenPublication(7, 1036), false);
    assert.equal(isTaskNativeDzenPublication(10, 1040), false);
});

test('generic Threads task is resolved by channel and never falls through to Telegram', async () => {
    const calls: string[] = [];
    const result = await executePublicationTaskByChannel(
        { projectId: 10, taskId: 1021, dryRun: true },
        {
            isDzenTask: () => false,
            dzen: { execute: async () => { calls.push('dzen'); return {}; } },
            threads: {
                isThreadsTask: async () => true,
                execute: async () => { calls.push('threads'); return { mode: 'dry_run' }; }
            },
            telegram: { execute: async () => { calls.push('telegram'); return {}; } }
        }
    );
    assert.deepEqual(calls, ['threads']);
    assert.deepEqual(result, { mode: 'dry_run' });
});
