"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const publication_execution_route_1 = require("../services/publication_execution_route");
const ready = {
    contentReady: true,
    visualReady: true,
    due: true,
    published: false,
    executionMode: 'automated',
    directExecutionSupported: true,
    publicationMode: 'connector_auto'
};
(0, node_test_1.default)('ready API-capable publication is routed to connector scheduler', () => {
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)(ready), 'connector_auto');
});
(0, node_test_1.default)('missing API or manual execution is routed to browser publication', () => {
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)({ ...ready, directExecutionSupported: false }), 'browser_required');
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)({ ...ready, executionMode: 'manual' }), 'browser_required');
});
(0, node_test_1.default)('content and visual gates block both execution routes', () => {
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)({ ...ready, contentReady: false }), 'waiting');
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)({ ...ready, visualReady: false }), 'waiting');
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)({ ...ready, due: false }), 'waiting');
});
(0, node_test_1.default)('published content cannot be routed for execution again', () => {
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)({ ...ready, published: true }), 'published');
});
(0, node_test_1.default)('connector failure disables API retries and selects browser fallback', () => {
    strict_1.default.deepEqual((0, publication_execution_route_1.browserFallbackReason)(new Error('token expired')), {
        code: 'CONNECTOR_PUBLISH_FAILED',
        message: 'token expired',
        retry_via_api: false,
        next_route: 'browser_required'
    });
});
(0, node_test_1.default)('an explicit browser route cannot fall back to the connector', () => {
    strict_1.default.equal((0, publication_execution_route_1.resolvePublicationExecutionRoute)({
        ...ready,
        publicationMode: 'browser_required'
    }), 'browser_required');
});
