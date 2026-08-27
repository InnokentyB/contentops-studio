"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const connectorFiles = [
    'src/services/mcp_publication.service.ts',
    'src/services/publisher.service.ts',
    'src/services/telegram_client.service.ts'
];
(0, node_test_1.default)('long Telegram media publications do not render the caption again as a reply preview', () => {
    for (const relativePath of connectorFiles) {
        const source = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), relativePath), 'utf8');
        strict_1.default.doesNotMatch(source, /reply_to_message_id\s*:/, `${relativePath} must send overflow as a standalone continuation`);
        strict_1.default.doesNotMatch(source, /replyTo\s*:/, `${relativePath} must not attach an MTProto reply preview to overflow`);
    }
});
(0, node_test_1.default)('MCP direct publication uses the canonical MTProto-first Telegram route', () => {
    const source = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'src/services/mcp_publication.service.ts'), 'utf8');
    strict_1.default.match(source, /publisherService\.publishDirectTelegram\s*\(/);
    strict_1.default.doesNotMatch(source, /require\(['"]\.\/telegram\.service['"]\)/);
    strict_1.default.doesNotMatch(source, /telegramService\.send(?:Message|Photo)\s*\(/);
});
