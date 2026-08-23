"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
(0, node_test_1.default)('agent run schema persists model usage and estimated cost', () => {
    const schema = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    for (const field of ['provider', 'model', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'estimated_cost_usd', 'latency_ms']) {
        strict_1.default.match(schema, new RegExp(`\\b${field}\\b`));
    }
});
