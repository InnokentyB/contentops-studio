"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const multi_agent_service_1 = __importDefault(require("../services/multi_agent.service"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
(0, node_test_1.default)('multiAgentService.getAgentConfig falls back to gpt-4o for invalid model names', async () => {
    // Mock directly on the service's prisma client by casting to any
    const originalFindFirst = multi_agent_service_1.default.prisma.projectSettings.findFirst;
    const mockDelegate = {
        findUnique: async (args) => {
            const key = args.where.project_id_key.key;
            if (key.includes('model')) {
                return { value: 'gpt-5.4-pro' };
            }
            return null;
        },
        create: async (args) => {
            return args.data;
        }
    };
    Object.defineProperty(multi_agent_service_1.default.prisma, 'projectSettings', {
        get: () => mockDelegate,
        configurable: true
    });
    try {
        const config = await multi_agent_service_1.default.getAgentConfig(1, 'post_critic');
        strict_1.default.equal(config.model, 'gpt-4o');
    }
    finally {
        delete multi_agent_service_1.default.prisma.projectSettings;
    }
});
(0, node_test_1.default)('multiAgentService.getAgentConfig retains valid model names', async () => {
    const mockDelegate = {
        findUnique: async (args) => {
            const key = args.where.project_id_key.key;
            if (key.includes('model')) {
                return { value: 'claude-3-opus' };
            }
            return null;
        },
        create: async (args) => {
            return args.data;
        }
    };
    Object.defineProperty(multi_agent_service_1.default.prisma, 'projectSettings', {
        get: () => mockDelegate,
        configurable: true
    });
    try {
        const config = await multi_agent_service_1.default.getAgentConfig(1, 'post_critic');
        strict_1.default.equal(config.model, 'claude-3-opus');
    }
    finally {
        delete multi_agent_service_1.default.prisma.projectSettings;
    }
});
(0, node_test_1.default)('multiAgentService.runImageCritic converts local relative upload paths to base64 data URLs', async () => {
    const uploadsDir = path_1.default.join(process.cwd(), 'uploads');
    if (!fs_1.default.existsSync(uploadsDir)) {
        fs_1.default.mkdirSync(uploadsDir, { recursive: true });
    }
    const testFilename = 'test-mock-image.png';
    const testFilePath = path_1.default.join(uploadsDir, testFilename);
    const mockBuffer = Buffer.from('fake-image-bytes');
    fs_1.default.writeFileSync(testFilePath, mockBuffer);
    // Temporarily remove OPENAI_API_KEY from environment to force fallback to this.openai
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    // Mock projectSettings to return empty (use defaults)
    const mockSettingsDelegate = {
        findUnique: async () => null,
        create: async (args) => args.data
    };
    Object.defineProperty(multi_agent_service_1.default.prisma, 'projectSettings', {
        get: () => mockSettingsDelegate,
        configurable: true
    });
    // Mock the openai client and completions.create call
    let passedImageUrl = '';
    const originalOpenai = multi_agent_service_1.default.openai;
    const mockOpenai = {
        chat: {
            completions: {
                create: async (args) => {
                    const userMessage = args.messages.find((m) => m.role === 'user');
                    const imgObj = userMessage.content.find((c) => c.type === 'image_url');
                    passedImageUrl = imgObj.image_url.url;
                    return {
                        choices: [{ message: { content: '{"critique": "ok", "recommendations": "none", "new_prompt": "prompt"}' } }]
                    };
                }
            }
        }
    };
    multi_agent_service_1.default.openai = mockOpenai;
    try {
        await multi_agent_service_1.default.runImageCritic(1, 'Test text context', `/uploads/${testFilename}`);
        strict_1.default.equal(passedImageUrl, 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==');
    }
    finally {
        multi_agent_service_1.default.openai = originalOpenai;
        delete multi_agent_service_1.default.prisma.projectSettings;
        process.env.OPENAI_API_KEY = originalApiKey;
        if (fs_1.default.existsSync(testFilePath)) {
            fs_1.default.unlinkSync(testFilePath);
        }
    }
});
