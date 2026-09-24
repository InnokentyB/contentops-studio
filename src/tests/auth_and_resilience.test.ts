import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RegisterSchema, LoginSchema } from '../schemas/routes.schema';

describe('Auth & Resilience Test Suite', () => {
    describe('RegisterSchema Validation', () => {
        test('rejects invalid email formats', () => {
            const result = RegisterSchema.safeParse({
                email: 'not-an-email',
                password: 'validPassword123'
            });
            assert.strictEqual(result.success, false);
        });

        test('rejects passwords shorter than 8 characters', () => {
            const result = RegisterSchema.safeParse({
                email: 'user@example.com',
                password: 'short'
            });
            assert.strictEqual(result.success, false);
            if (!result.success) {
                const issues = result.error.issues;
                assert.ok(issues.some((issue) => issue.message.includes('at least 8 characters')));
            }
        });

        test('accepts valid registration payload and normalizes email', () => {
            const result = RegisterSchema.safeParse({
                email: '  User.Test@Example.COM  ',
                password: 'securePassword123',
                name: 'Test User'
            });
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.email, 'user.test@example.com');
                assert.strictEqual(result.data.password, 'securePassword123');
                assert.strictEqual(result.data.name, 'Test User');
            }
        });

        test('rejects passwords exceeding 100 characters', () => {
            const result = RegisterSchema.safeParse({
                email: 'user@example.com',
                password: 'a'.repeat(101)
            });
            assert.strictEqual(result.success, false);
        });
    });

    describe('LoginSchema Validation', () => {
        test('rejects empty password', () => {
            const result = LoginSchema.safeParse({
                email: 'user@example.com',
                password: ''
            });
            assert.strictEqual(result.success, false);
        });

        test('accepts valid login credentials and normalizes email', () => {
            const result = LoginSchema.safeParse({
                email: '  Admin@Domain.ORG  ',
                password: 'myPassword!'
            });
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.email, 'admin@domain.org');
                assert.strictEqual(result.data.password, 'myPassword!');
            }
        });
    });

    describe('Database Pool Resilience', () => {
        test('verifies pool has error event listener registered', async () => {
            const { pool } = await import('../db');
            // An EventEmitter in node-pg should have at least 1 listener on 'error'
            const listenerCount = pool.listenerCount('error');
            assert.ok(listenerCount >= 1, 'pool must have an error event listener to prevent uncaught EventEmitter crashes');
        });
    });
});
