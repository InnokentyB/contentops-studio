import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import multiAgentService from '../services/multi_agent.service';

test('multiAgentService.getAgentConfig falls back to gpt-4o for invalid model names', async () => {
    const mockDelegate = {
        findUnique: async (args: any) => {
            const key = args.where.project_id_key.key;
            if (key.includes('model')) {
                return { value: 'gpt-5.4-pro' };
            }
            return null;
        },
        create: async (args: any) => {
            return args.data;
        }
    };

    Object.defineProperty((multiAgentService as any).prisma, 'projectSettings', {
        get: () => mockDelegate,
        configurable: true
    });

    try {
        const config = await multiAgentService.getAgentConfig(1, 'post_critic');
        assert.equal(config.model, 'gpt-4o');
    } finally {
        delete (multiAgentService as any).prisma.projectSettings;
    }
});

test('multiAgentService.getAgentConfig retains valid model names', async () => {
    const mockDelegate = {
        findUnique: async (args: any) => {
            const key = args.where.project_id_key.key;
            if (key.includes('model')) {
                return { value: 'claude-3-opus' };
            }
            return null;
        },
        create: async (args: any) => {
            return args.data;
        }
    };

    Object.defineProperty((multiAgentService as any).prisma, 'projectSettings', {
        get: () => mockDelegate,
        configurable: true
    });

    try {
        const config = await multiAgentService.getAgentConfig(1, 'post_critic');
        assert.equal(config.model, 'claude-3-opus');
    } finally {
        delete (multiAgentService as any).prisma.projectSettings;
    }
});
