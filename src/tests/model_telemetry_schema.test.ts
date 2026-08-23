import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('agent run schema persists model usage and estimated cost', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    for (const field of ['provider', 'model', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'estimated_cost_usd', 'latency_ms']) {
        assert.match(schema, new RegExp(`\\b${field}\\b`));
    }
});
