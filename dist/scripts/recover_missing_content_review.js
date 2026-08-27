"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const db_1 = __importStar(require("../db"));
const work_queue_service_1 = __importDefault(require("../services/work_queue.service"));
function requiredArg(name) {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (!value)
        throw new Error(`Missing --${name}`);
    return value;
}
async function main() {
    const projectId = Number(requiredArg('project'));
    const taskId = Number(requiredArg('task'));
    const expectedContentRevision = Number(requiredArg('revision'));
    const idempotencyKey = requiredArg('idempotency-key');
    const apply = process.argv.includes('--apply');
    const owner = await db_1.default.projectMember.findFirst({
        where: { project_id: projectId, role: 'owner' },
        select: { user_id: true }
    });
    const content = await db_1.default.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        select: {
            id: true,
            item_key: true,
            status: true,
            content_revision: true,
            accepted_revision: true,
            text_state: true,
            handoff_state: true,
            visual_state: true,
            channel_id: true,
            schedule_at: true,
            cta: true,
            draft_text: true
        }
    });
    if (!owner || !content)
        throw new Error('Recovery target or project owner not found');
    if (content.content_revision !== expectedContentRevision) {
        throw new Error(`Revision mismatch: expected ${expectedContentRevision}, current ${content.content_revision}`);
    }
    const reviews = await db_1.default.workItem.findMany({
        where: { project_id: projectId, content_item_id: taskId, kind: 'content_review' },
        select: { id: true, state: true, result_version: true }
    });
    const body = content.draft_text || '';
    const snapshot = {
        id: content.id,
        item_key: content.item_key,
        status: content.status,
        content_revision: content.content_revision,
        accepted_revision: content.accepted_revision,
        text_state: content.text_state,
        handoff_state: content.handoff_state,
        visual_state: content.visual_state,
        channel_id: content.channel_id,
        schedule_at: content.schedule_at,
        cta: content.cta,
        body_length: body.length,
        body_sha256: (0, crypto_1.createHash)('sha256').update(body).digest('hex'),
        reviews
    };
    if (!apply) {
        console.log(JSON.stringify({ apply, project_id: projectId, task: snapshot }, null, 2));
        return;
    }
    const result = await work_queue_service_1.default.recoverMissingContentReview({
        projectId,
        actorId: `user:${owner.user_id}`,
        taskId,
        expectedContentRevision,
        idempotencyKey,
        evidenceRequirement: 'Primary JSON evidence and owner acceptance are required before publication.'
    });
    console.log(JSON.stringify({ result, before: snapshot }, null, 2));
}
main()
    .finally(async () => {
    await db_1.default.$disconnect();
    await db_1.pool.end();
})
    .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
