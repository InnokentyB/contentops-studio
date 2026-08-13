"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const publication_content_state_1 = require("../services/publication_content_state");
(0, node_test_1.default)('created publication task without content is empty', () => {
    strict_1.default.equal((0, publication_content_state_1.derivePublicationContentState)({ status: 'planned', draft_text: null }), 'empty');
});
(0, node_test_1.default)('publication task with a saved draft is ready', () => {
    strict_1.default.equal((0, publication_content_state_1.derivePublicationContentState)({ status: 'planned', draft_text: 'Ready text' }), 'ready');
});
(0, node_test_1.default)('handoff publication body counts as ready content', () => {
    strict_1.default.equal((0, publication_content_state_1.derivePublicationContentState)({
        status: 'awaiting_manual_publication',
        quality_report: { handoff_bundle: { publication: { body: 'Prepared body' } } }
    }), 'ready');
});
(0, node_test_1.default)('published task takes precedence over content readiness', () => {
    strict_1.default.equal((0, publication_content_state_1.derivePublicationContentState)({
        status: 'published',
        draft_text: 'Ready text',
        published_link: 'https://example.com/post'
    }), 'published');
});
