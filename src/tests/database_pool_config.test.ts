import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDatabasePoolMax } from '../database_pool_config';

test('database pool defaults to a shared-service-safe per-process budget', () => {
    assert.equal(resolveDatabasePoolMax(undefined), 4);
    assert.equal(resolveDatabasePoolMax(''), 4);
});

test('database pool accepts an explicit bounded budget', () => {
    assert.equal(resolveDatabasePoolMax('1'), 1);
    assert.equal(resolveDatabasePoolMax('5'), 5);
});

test('database pool rejects values that could exhaust the shared session endpoint', () => {
    for (const value of ['0', '6', '15', '2.5', 'many']) {
        assert.throws(
            () => resolveDatabasePoolMax(value),
            /\[DATABASE_POOL_MAX_INVALID\]/
        );
    }
});

test('shared PostgreSQL pool applies the resolved per-process budget', async () => {
    const previous = process.env.DATABASE_POOL_MAX;
    process.env.DATABASE_POOL_MAX = '3';
    try {
        const { pool } = await import('../db');
        assert.equal(pool.options.max, 3);
        await pool.end();
    } finally {
        if (previous === undefined) delete process.env.DATABASE_POOL_MAX;
        else process.env.DATABASE_POOL_MAX = previous;
    }
});
