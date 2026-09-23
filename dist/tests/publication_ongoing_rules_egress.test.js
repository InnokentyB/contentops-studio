"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
(0, node_test_1.default)('ongoing rule polling does not load publication asset snapshots', () => {
    const source = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'src/services/publisher.service.ts'), 'utf8');
    const method = source.slice(source.indexOf('async processPublicationOngoingRules()'), source.indexOf('private async executeMeasurementSnapshot'));
    strict_1.default.match(method, /loadOngoingRulePlans/);
    strict_1.default.doesNotMatch(method, /loadPublicationPlanContext/);
    strict_1.default.doesNotMatch(method, /publication_plan_asset_snapshots/);
    strict_1.default.doesNotMatch(method, /publication_plan_content_file_snapshots/);
});
(0, node_test_1.default)('ongoing rule configuration uses a bounded in-memory cache and batched settings query', () => {
    const source = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'src/services/publisher.service.ts'), 'utf8');
    const loader = source.slice(source.indexOf('private ongoingRulePlanCache'), source.indexOf('async closeConnections()'));
    strict_1.default.match(loader, /PUBLICATION_RULES_CACHE_TTL_MS \|\| 300000/);
    strict_1.default.match(loader, /expiresAt > now/);
    strict_1.default.match(loader, /project_id: \{ in: projectIds \}/);
    strict_1.default.match(loader, /publication_plan_meta/);
    strict_1.default.match(loader, /publication_plan_measurement/);
    strict_1.default.doesNotMatch(loader, /publication_plan_asset_snapshots/);
    strict_1.default.doesNotMatch(loader, /publication_plan_content_file_snapshots/);
});
