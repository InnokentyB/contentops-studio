"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("../db"));
class CommentService {
    async createComment(projectId, entityType, entityId, text, authorRole = 'user') {
        return await db_1.default.comment.create({
            data: {
                project_id: projectId,
                entity_type: entityType,
                entity_id: entityId,
                text,
                author_role: authorRole
            }
        });
    }
    async getComments(projectId, entityType, entityId) {
        return await db_1.default.comment.findMany({
            where: {
                project_id: projectId,
                entity_type: entityType,
                entity_id: entityId
            },
            orderBy: { created_at: 'asc' }
        });
    }
    // Helper to format comments as a dialogue string for LLM context
    async getCommentsForContext(projectId, entityType, entityId) {
        const comments = await this.getComments(projectId, entityType, entityId);
        if (comments.length === 0)
            return '';
        return comments.map(c => `${c.author_role === 'user' ? 'User' : 'Agent'}: ${c.text}`).join('\n');
    }
}
exports.default = new CommentService();
