"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const content_language_service_1 = require("../services/content_language.service");
(0, node_test_1.default)('content language defaults legacy channels to Russian', () => {
    strict_1.default.equal((0, content_language_service_1.normalizeContentLanguage)(undefined), 'ru');
    strict_1.default.equal((0, content_language_service_1.channelContentLanguage)({ config: {} }), 'ru');
    strict_1.default.equal((0, content_language_service_1.channelContentLanguage)({ config: { content_language: 'de' } }), 'ru');
});
(0, node_test_1.default)('content language recognizes English channel configuration', () => {
    strict_1.default.equal((0, content_language_service_1.channelContentLanguage)({ config: { content_language: 'en' } }), 'en');
    strict_1.default.match((0, content_language_service_1.contentLanguageInstruction)('en'), /English/);
});
