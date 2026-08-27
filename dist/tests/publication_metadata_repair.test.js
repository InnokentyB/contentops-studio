"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const publication_metadata_repair_1 = require("../services/publication_metadata_repair");
(0, node_test_1.default)('placement repair creates a new revision-bound art-direction input without changing content revision', () => {
    strict_1.default.deepEqual((0, publication_metadata_repair_1.planPublicationPlacementRepair)({
        contentItemId: 726,
        contentRevision: 2,
        acceptedRevision: 2,
        currentChannelId: 139,
        targetChannelId: 113,
        currentPlacement: 'feed',
        targetPlacement: 'article_cover'
    }), {
        contentRevision: 2,
        acceptedRevision: 2,
        channelId: 113,
        placement: 'article_cover',
        artDirectionState: 'available',
        inputContextVersion: 2,
        dedupeKey: 'art-direction:726:2:article_cover',
        note: 'Assess visual fit for revision 2, placement article_cover'
    });
});
(0, node_test_1.default)('placement repair refuses to operate on a stale accepted revision', () => {
    strict_1.default.throws(() => (0, publication_metadata_repair_1.planPublicationPlacementRepair)({
        contentItemId: 726,
        contentRevision: 2,
        acceptedRevision: 1,
        currentChannelId: 139,
        targetChannelId: 113,
        currentPlacement: 'feed',
        targetPlacement: 'article_cover'
    }), /CURRENT_REVISION_NOT_ACCEPTED/);
});
