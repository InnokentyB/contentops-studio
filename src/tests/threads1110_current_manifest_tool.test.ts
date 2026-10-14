import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTomorrowPublicationTools } from '../mcp/tools/tomorrow_publication_tools';

test('P10-1110-01 exact1110 accepts a current checksum without changing Dzen or1108 schemas', () => {
    const schemas = new Map<string, z.ZodRawShape>();
    const server = { registerTool(name: string, config: { inputSchema: z.ZodRawShape }) {
        schemas.set(name, config.inputSchema);
    } };
    registerTomorrowPublicationTools(server as unknown as McpServer);
    const base = { projectId: 10, taskId: 1110, actorId: 'user:2',
        expectedManifestChecksum: `sha256:${'a'.repeat(64)}`,
        approvalReference: 'Exact owner GO for1110', idempotencyKey: '1110-r2-release-fixture' };
    const schema = z.object(schemas.get('ba_release_threads_task1110_api')!);
    assert.equal(schema.safeParse(base).success, true);
    for (const patch of [{ projectId: 7 }, { taskId: 1114 }, { actorId: 'system:fixture' },
        { expectedManifestChecksum: 'not-a-checksum' }, { idempotencyKey: '' }]) {
        assert.equal(schema.safeParse({ ...base, ...patch }).success, false);
    }
    assert.equal(z.object(schemas.get('ba_release_threads_task1108_api')!).safeParse({ ...base, taskId: 1108 }).success, false);
    assert.equal(z.object(schemas.get('ba_release_dzen_task1002')!).safeParse({ ...base, taskId: 1002 }).success, false);
});
