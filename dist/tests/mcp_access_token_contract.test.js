"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const mcp_access_token_service_1 = require("../services/mcp_access_token.service");
(0, node_test_1.default)('personal MCP tokens are stored as deterministic hashes, not plaintext', () => {
    const token = 'mcp_example-secret';
    strict_1.default.notEqual((0, mcp_access_token_service_1.hashMcpToken)(token), token);
    strict_1.default.equal((0, mcp_access_token_service_1.hashMcpToken)(token), (0, mcp_access_token_service_1.hashMcpToken)(token));
    strict_1.default.equal((0, mcp_access_token_service_1.hashMcpToken)(token).length, 64);
});
(0, node_test_1.default)('only scoped agent profiles can receive personal MCP access', () => {
    strict_1.default.equal((0, mcp_access_token_service_1.isManagedMcpProfile)('planner'), true);
    strict_1.default.equal((0, mcp_access_token_service_1.isManagedMcpProfile)('writer'), true);
    strict_1.default.equal((0, mcp_access_token_service_1.isManagedMcpProfile)('art_director'), true);
    strict_1.default.equal((0, mcp_access_token_service_1.isManagedMcpProfile)('owner'), false);
});
