import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import multiAgentService from '../services/multi_agent.service';
import fs from 'fs';
import path from 'path';

test('multiAgentService.getAgentConfig falls back to gpt-4o for invalid model names', async () => {
    // Mock directly on the service's prisma client by casting to any
    const originalFindFirst = (multiAgentService as any).prisma.projectSettings.findFirst;
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

test('multiAgentService.runImageCritic converts local relative upload paths to base64 data URLs', async () => {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const testFilename = 'test-mock-image.png';
    const testFilePath = path.join(uploadsDir, testFilename);
    const mockBuffer = Buffer.from('fake-image-bytes');
    fs.writeFileSync(testFilePath, mockBuffer);

    // Temporarily remove OPENAI_API_KEY from environment to force fallback to this.openai
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    // Mock projectSettings to return empty (use defaults)
    const mockSettingsDelegate = {
        findUnique: async () => null,
        create: async (args: any) => args.data
    };
    Object.defineProperty((multiAgentService as any).prisma, 'projectSettings', {
        get: () => mockSettingsDelegate,
        configurable: true
    });

    // Mock the openai client and completions.create call
    let passedImageUrl = '';
    const originalOpenai = (multiAgentService as any).openai;
    const mockOpenai = {
        chat: {
            completions: {
                create: async (args: any) => {
                    const userMessage = args.messages.find((m: any) => m.role === 'user');
                    const imgObj = userMessage.content.find((c: any) => c.type === 'image_url');
                    passedImageUrl = imgObj.image_url.url;
                    return {
                        choices: [{ message: { content: '{"critique": "ok", "recommendations": "none", "new_prompt": "prompt"}' } }]
                    };
                }
            }
        }
    };
    (multiAgentService as any).openai = mockOpenai;

    try {
        await multiAgentService.runImageCritic(1, 'Test text context', `/uploads/${testFilename}`);
        assert.equal(passedImageUrl, 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==');
    } finally {
        (multiAgentService as any).openai = originalOpenai;
        delete (multiAgentService as any).prisma.projectSettings;
        process.env.OPENAI_API_KEY = originalApiKey;
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
    }
});
