"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const publication_task_activity_1 = require("../services/publication_task_activity");
(0, node_test_1.default)('active queue excludes published workflow tasks', () => {
    strict_1.default.equal((0, publication_task_activity_1.isPublicationTaskActive)({ status: 'published' }), false);
});
(0, node_test_1.default)('active queue excludes terminal negative publication outcomes', () => {
    strict_1.default.equal((0, publication_task_activity_1.isPublicationTaskActive)({ status: 'failed', publication_fact: { outcome: 'removed' } }), false);
    strict_1.default.equal((0, publication_task_activity_1.isPublicationTaskActive)({ status: 'planned', quality_report: { publication_outcome: 'blocked' } }), false);
});
(0, node_test_1.default)('active queue includes unfinished tasks without terminal outcome', () => {
    strict_1.default.equal((0, publication_task_activity_1.isPublicationTaskActive)({ status: 'awaiting_manual_publication' }), true);
});
