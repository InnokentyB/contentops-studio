import parserIntegrationService from '../parser_integration.service';

/**
 * Gets parser service health status.
 */
export async function getParserHealth(_projectId: number, _userId: number) {
    return parserIntegrationService.getHealth();
}

/**
 * Creates a parser search job for research intake.
 */
export async function createParserSearchJob(params: {
    userId: number;
    projectId: number;
    source?: 'reddit' | 'indie_hackers';
    query: string;
    subreddit?: string;
    subreddits?: string[];
    queryDefinitionId?: string;
    intent?: string;
    cluster?: string;
    priority?: number;
    matchMustIncludeAny?: string[];
    excludeIfContains?: string[];
    excludeRegexes?: string[];
    limit?: number;
    minScore?: number;
    dateFrom?: string;
    dateTo?: string;
    includeComments?: boolean;
    enrich?: boolean;
    idempotencyKey?: string;
}) {
    return parserIntegrationService.createSearchJob({
        projectId: params.projectId,
        source: params.source,
        query: params.query,
        subreddit: params.subreddit,
        subreddits: params.subreddits,
        queryDefinitionId: params.queryDefinitionId,
        intent: params.intent,
        cluster: params.cluster,
        priority: params.priority,
        matchMustIncludeAny: params.matchMustIncludeAny,
        excludeIfContains: params.excludeIfContains,
        excludeRegexes: params.excludeRegexes,
        limit: params.limit,
        minScore: params.minScore,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        includeComments: params.includeComments,
        enrich: params.enrich,
        idempotencyKey: params.idempotencyKey
    }, { userId: params.userId, minRole: 'editor' });
}

/**
 * Gets details of a parser search job.
 */
export async function getParserSearchJob(projectId: number, jobId: string, userId: number) {
    return parserIntegrationService.getSearchJob(projectId, jobId, { userId });
}

/**
 * Refreshes an existing parser search job.
 */
export async function refreshParserSearchJob(projectId: number, jobId: string, userId: number, idempotencyKey?: string) {
    return parserIntegrationService.refreshSearchJob({
        projectId,
        jobId,
        idempotencyKey
    }, { userId, minRole: 'editor' });
}

/**
 * Lists scraped posts from parser jobs.
 */
export async function listParserPosts(projectId: number, userId: number, limit?: number, offset?: number) {
    return parserIntegrationService.listPosts(projectId, { userId }, { limit, offset });
}

/**
 * Gets structured insights from parsed sources.
 */
export async function getParserInsights(projectId: number, userId: number, options: {
    limit?: number;
    offset?: number;
    jobId?: string;
    type?: string;
} = {}) {
    return parserIntegrationService.getInsights({
        projectId,
        limit: options.limit,
        offset: options.offset,
        jobId: options.jobId,
        type: options.type
    }, { userId });
}

/**
 * Gets summary of a parser search job.
 */
export async function getParserSummary(projectId: number, jobId: string, userId: number) {
    return parserIntegrationService.getSummary({
        projectId,
        jobId
    }, { userId });
}

/**
 * Lists parser search templates for a project.
 */
export async function listParserTemplates(projectId: number, userId: number) {
    return parserIntegrationService.listTemplates(projectId, { userId });
}

/**
 * Imports parser templates from YAML or query bank.
 */
export async function importParserTemplates(params: {
    userId: number;
    projectId: number;
    yamlContent?: string;
    queryBank?: Record<string, unknown>;
    scheduleDaily?: boolean;
    limit?: number;
    minScore?: number;
    dateFrom?: string;
    dateTo?: string;
    includeComments?: boolean;
    enrich?: boolean;
    idempotencyKey?: string;
}) {
    return parserIntegrationService.importTemplates({
        projectId: params.projectId,
        yamlContent: params.yamlContent,
        queryBank: params.queryBank,
        scheduleDaily: params.scheduleDaily,
        limit: params.limit,
        minScore: params.minScore,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        includeComments: params.includeComments,
        enrich: params.enrich,
        idempotencyKey: params.idempotencyKey
    }, { userId: params.userId, minRole: 'editor' });
}

/**
 * Runs a parser template on-demand.
 */
export async function runParserTemplate(projectId: number, templateId: string, userId: number, idempotencyKey?: string) {
    return parserIntegrationService.runTemplate({
        projectId,
        templateId,
        idempotencyKey
    }, { userId, minRole: 'editor' });
}
