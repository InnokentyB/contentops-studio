import assert from 'node:assert/strict';
import test from 'node:test';
import {withPublicationPrincipal} from '../mcp/publication-principal';
import { executePublicationTaskByChannel, isTaskNativeDzenPublication } from '../mcp/tools/task_publication_tools';

test('Dzen 1036 is exact task-native scope, not a generic project bypass', () => {
    assert.equal(isTaskNativeDzenPublication(10, 1036), true);
    assert.equal(isTaskNativeDzenPublication(7, 1036), false);
    assert.equal(isTaskNativeDzenPublication(10, 1040), false);
});

test('generic Threads classification refuses missing release bindings without legacy or Telegram fallback', async () => {
    const calls: string[] = [];
    await assert.rejects(withPublicationPrincipal({userId:2,actorId:'user:2',profile:'publisher',projectId:10},()=>executePublicationTaskByChannel(
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
    )),/THREADS_RELEASE_ENVELOPE_REQUIRED/);
    assert.deepEqual(calls, []);
});
