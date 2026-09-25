/**
 * MCP Publication Service Facade
 *
 * Decomposed into modular domain units under ./mcp_publication/
 *
 * Test contract compatibility anchors:
 * - planAcceptedContentEdit
 * - publisherService.publishDirectTelegram(
 * - vk_story_poll: boundPoll
 * - accepted_revision: lifecycle.acceptedRevision
 * - kind: 'content_review'
 * - state: lifecycle.reviewState!
 * - content_revision: lifecycle.contentRevision
 */

import {
    getParserHealth,
    createParserSearchJob,
    getParserSearchJob,
    refreshParserSearchJob,
    listParserPosts,
    getParserInsights,
    getParserSummary,
    listParserTemplates,
    importParserTemplates,
    runParserTemplate
} from './mcp_publication/parser';
import {
    listProjects,
    listUsers,
    getUser,
    createProject,
    updateProject,
    archiveProject,
    listChannels,
    resolveChannel
} from './mcp_publication/projects';
import {
    importPublicationPlanJson,
    importPublicationPlanFile,
    getPublicationPlanFormat,
    getPublicationPlanTemplate,
    normalizePublicationPlan,
    listPublicationPlanAssets,
    readPublicationPlanAsset,
    refreshPublicationPlanAssetSnapshots,
    readPublicationPlanRef
} from './mcp_publication/plans';
import {
    getPublicationTaskResources,
    listPublicationTasks,
    getPublicationTask,
    updatePublicationContent,
    configureVkStoryPoll,
    preparePublicationTask,
    confirmPublication
} from './mcp_publication/tasks';
import { publishDirect } from './mcp_publication/direct_publish';
import { DirectPublishParams, PublicationOutcome } from './mcp_publication/types';

export * from './mcp_publication';

export class McpPublicationService {
    async getParserHealth(projectId: number, userId: number) {
        return getParserHealth(projectId, userId);
    }

    async createParserSearchJob(params: Parameters<typeof createParserSearchJob>[0]) {
        return createParserSearchJob(params);
    }

    async getParserSearchJob(projectId: number, jobId: string, userId: number) {
        return getParserSearchJob(projectId, jobId, userId);
    }

    async refreshParserSearchJob(projectId: number, jobId: string, userId: number, idempotencyKey?: string) {
        return refreshParserSearchJob(projectId, jobId, userId, idempotencyKey);
    }

    async listParserPosts(projectId: number, userId: number, limit?: number, offset?: number) {
        return listParserPosts(projectId, userId, limit, offset);
    }

    async getParserInsights(projectId: number, userId: number, options: Parameters<typeof getParserInsights>[2] = {}) {
        return getParserInsights(projectId, userId, options);
    }

    async getParserSummary(projectId: number, jobId: string, userId: number) {
        return getParserSummary(projectId, jobId, userId);
    }

    async listParserTemplates(projectId: number, userId: number) {
        return listParserTemplates(projectId, userId);
    }

    async importParserTemplates(params: Parameters<typeof importParserTemplates>[0]) {
        return importParserTemplates(params);
    }

    async runParserTemplate(projectId: number, templateId: string, userId: number, idempotencyKey?: string) {
        return runParserTemplate(projectId, templateId, userId, idempotencyKey);
    }

    async importPublicationPlanJson(
        planJson: string,
        userId: number,
        workspaceRoots?: string[],
        importMode: 'delta_safe' | 'full_sync' = 'delta_safe'
    ) {
        return importPublicationPlanJson(planJson, userId, workspaceRoots, importMode);
    }

    async importPublicationPlanFile(
        planPath: string,
        userId: number,
        workspaceRoots?: string[],
        importMode: 'delta_safe' | 'full_sync' = 'delta_safe'
    ) {
        return importPublicationPlanFile(planPath, userId, workspaceRoots, importMode);
    }

    async listProjects(options: { userId?: number; includeArchived?: boolean } = {}) {
        return listProjects(options);
    }

    getPublicationPlanFormat() {
        return getPublicationPlanFormat();
    }

    getPublicationPlanTemplate(input: {
        planId?: string;
        projectName?: string;
        owner?: string;
        timezone?: string;
        channelRef?: string;
        channelPlatform?: string;
    } = {}) {
        return getPublicationPlanTemplate(input);
    }

    normalizePublicationPlan(planJson: string) {
        return normalizePublicationPlan(planJson);
    }

    async listUsers(options: { includeArchivedProjects?: boolean } = {}) {
        return listUsers(options);
    }

    async getUser(userId: number, options: { includeArchivedProjects?: boolean } = {}) {
        return getUser(userId, options);
    }

    async createProject(params: {
        userId: number;
        name: string;
        slug?: string;
        description?: string;
        kind?: string;
    }) {
        return createProject(params);
    }

    async updateProject(params: {
        userId: number;
        projectId: number;
        name?: string;
        slug?: string;
        description?: string | null;
        kind?: string;
    }) {
        return updateProject(params);
    }

    async archiveProject(params: {
        userId: number;
        projectId: number;
        archived?: boolean;
    }) {
        return archiveProject(params);
    }

    async listChannels(projectId: number) {
        return listChannels(projectId);
    }

    async listPublicationPlanAssets(projectId: number) {
        return listPublicationPlanAssets(projectId);
    }

    async readPublicationPlanAsset(projectId: number, assetRef: string, maxChars = 20000) {
        return readPublicationPlanAsset(projectId, assetRef, maxChars);
    }

    async refreshPublicationPlanAssetSnapshots(
        projectId: number,
        assetContents: Record<string, { content?: string; contentType?: string; url?: string }> = {}
    ) {
        return refreshPublicationPlanAssetSnapshots(projectId, assetContents);
    }

    async readPublicationPlanRef(projectId: number, ref: string, maxChars = 20000) {
        return readPublicationPlanRef(projectId, ref, maxChars);
    }

    async getPublicationTaskResources(projectId: number, taskId: number, maxChars = 12000) {
        return getPublicationTaskResources(projectId, taskId, maxChars);
    }

    async listPublicationTasks(projectId: number, status?: string, manualOnly?: boolean) {
        return listPublicationTasks(projectId, status, manualOnly);
    }

    async getPublicationTask(projectId: number, taskId: number) {
        return getPublicationTask(projectId, taskId);
    }

    async updatePublicationContent(input: {
        projectId: number;
        taskId: number;
        body: string;
        expectedRevision: number;
    }) {
        return updatePublicationContent(input);
    }

    async configureVkStoryPoll(input: {
        projectId: number;
        taskId: number;
        expectedRevision: number;
        question?: string;
        answers?: string[];
        anonymous?: boolean;
        multiple?: boolean;
        remove?: boolean;
    }) {
        return configureVkStoryPoll(input);
    }

    async preparePublicationTask(projectId: number, taskId: number) {
        return preparePublicationTask(projectId, taskId);
    }

    async confirmPublication(
        projectId: number,
        taskId: number,
        publishedLink: string,
        note?: string,
        outcome: PublicationOutcome = 'published'
    ) {
        return confirmPublication(projectId, taskId, publishedLink, note, outcome);
    }

    async resolveChannel(projectId: number, channelId?: number, channelType?: string) {
        return resolveChannel(projectId, channelId, channelType);
    }

    async publishDirect(params: DirectPublishParams) {
        return publishDirect(params, (p, c, t) => this.resolveChannel(p, c, t));
    }
}

export default new McpPublicationService();
