"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = apiRoutes;
const planner_service_1 = __importDefault(require("../services/planner.service"));
const generator_service_1 = __importDefault(require("../services/generator.service"));
const multi_agent_service_1 = __importDefault(require("../services/multi_agent.service"));
const publisher_service_1 = __importDefault(require("../services/publisher.service"));
const model_service_1 = __importDefault(require("../services/model.service"));
const v2_orchestrator_service_1 = __importDefault(require("../services/v2_orchestrator.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const auth_service_1 = __importDefault(require("../services/auth.service"));
const comment_service_1 = __importDefault(require("../services/comment.service"));
const storage_service_1 = __importDefault(require("../services/storage.service"));
const content_dictionary_service_1 = __importDefault(require("../services/content_dictionary.service"));
const content_policy_matrix_service_1 = __importDefault(require("../services/content_policy_matrix.service"));
const publication_plan_service_1 = __importDefault(require("../services/publication_plan.service"));
const metrics_service_1 = __importDefault(require("../services/metrics.service"));
const egress_diagnostics_1 = require("../utils/egress_diagnostics");
async function loadPublicationPlanContext(projectId) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: ['publication_plan_meta', 'publication_plan_assets', 'publication_plan_accounts', 'publication_plan_asset_snapshots', 'publication_plan_content_file_snapshots'] }
        }
    });
    const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
    const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
    const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;
    const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
    const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;
    if (!meta || !assets || !accounts) {
        return null;
    }
    return {
        meta: JSON.parse(meta),
        assets: JSON.parse(assets),
        accounts: JSON.parse(accounts),
        asset_snapshots: assetSnapshots ? JSON.parse(assetSnapshots) : {},
        content_file_snapshots: contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {},
        actions: []
    };
}
function safeJsonParse(value) {
    if (!value?.trim())
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function formatJson(value) {
    return JSON.stringify(value, null, 2);
}
function extractRequestErrorMessage(error, fallback) {
    const directMessage = typeof error?.message === 'string' ? error.message.trim() : '';
    const providerDescription = typeof error?.response?.description === 'string'
        ? error.response.description.trim()
        : (typeof error?.description === 'string' ? error.description.trim() : '');
    if (providerDescription) {
        if (directMessage && directMessage !== 'Bad Request' && directMessage !== providerDescription) {
            return `${directMessage}: ${providerDescription}`;
        }
        return providerDescription;
    }
    if (directMessage) {
        return directMessage;
    }
    return fallback;
}
async function loadPublicationProjectContext(projectId) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: ['content_dictionary_yaml', 'content_policy_matrix_yaml', 'atoma_files_description', 'atoma_files_payload'] }
        }
    });
    return {
        glossaryYaml: settings.find((setting) => setting.key === 'content_dictionary_yaml')?.value || null,
        contentPolicyMatrixYaml: settings.find((setting) => setting.key === 'content_policy_matrix_yaml')?.value || null,
        atomaFilesDescription: settings.find((setting) => setting.key === 'atoma_files_description')?.value || null,
        atomaFilesPayload: safeJsonParse(settings.find((setting) => setting.key === 'atoma_files_payload')?.value || null)
    };
}
function derivePublicationVoice(item) {
    return (item?.assets?.action?.voice_profile
        || item?.assets?.action?.parameters?.voice_profile
        || item?.channel?.config?.voice_profile
        || item?.metrics?.voice_profile
        || null);
}
function resolveTaskScheduleAt(item) {
    const actionScheduleAt = item?.assets?.action?.scheduled_at;
    if (typeof actionScheduleAt === 'string' && actionScheduleAt.trim()) {
        return actionScheduleAt;
    }
    return item?.schedule_at?.toISOString?.() || item?.schedule_at || null;
}
function buildPublicationTaskListItem(item) {
    const qualityReport = item.quality_report || {};
    const metrics = item.metrics || {};
    return {
        id: item.id,
        type: item.type,
        layer: item.layer,
        title: item.title,
        brief: item.brief,
        status: item.status,
        schedule_at: item?.schedule_at?.toISOString?.() || item?.schedule_at || null,
        published_link: item.published_link,
        metrics: {
            monitoring: metrics.monitoring || null,
            collected_metrics: metrics.collected_metrics || null,
            publication_outcome: metrics.publication_outcome || null,
            account_ref: metrics.account_ref || null,
            metrics_updated_at: metrics.metrics_updated_at || null
        },
        quality_report: {
            execution_mode: qualityReport.execution_mode || null,
            publication_outcome: qualityReport.publication_outcome || null
        },
        channel: item.channel ? {
            id: item.channel.id,
            name: item.channel.name,
            type: item.channel.type,
            config: item.channel.config || null
        } : null
    };
}
function buildPublicationTaskDetailItem(item, options) {
    const qualityReport = item.quality_report || {};
    const metrics = item.metrics || {};
    const assets = item.assets || {};
    const handoffBundle = options?.handoffBundle || qualityReport.handoff_bundle || null;
    const firstResourceWithUrl = (handoffBundle?.resource_files || []).find((entry) => entry?.url);
    const firstSourceContent = (handoffBundle?.resource_files || []).find((entry) => typeof entry?.content === 'string' && entry.content.trim());
    const derivedVoice = derivePublicationVoice(item);
    return {
        id: item.id,
        type: item.type,
        layer: item.layer,
        title: item.title,
        brief: item.brief,
        key_points: item.key_points || null,
        status: item.status,
        schedule_at: resolveTaskScheduleAt(item),
        published_link: item.published_link,
        draft_text: item.draft_text || null,
        channel: item.channel ? {
            id: item.channel.id,
            name: item.channel.name,
            type: item.channel.type,
            config: item.channel.config || null
        } : null,
        assets: {
            action: assets.action || null,
            resolved_assets: assets.resolved_assets || [],
            generated_visuals: assets.generated_visuals || []
        },
        metrics: {
            monitoring: metrics.monitoring || null,
            collected_metrics: metrics.collected_metrics || null,
            publication_outcome: metrics.publication_outcome || null,
            account_ref: metrics.account_ref || null,
            task_id: metrics.task_id || null,
            metrics_updated_at: metrics.metrics_updated_at || null
        },
        quality_report: {
            execution_mode: qualityReport.execution_mode || null,
            publication_outcome: qualityReport.publication_outcome || null,
            manual_publication_note: qualityReport.manual_publication_note || null,
            critic_review: qualityReport.critic_review || null,
            generated_image: qualityReport.generated_image || null,
            content_edit_history: Array.isArray(qualityReport.content_edit_history) ? qualityReport.content_edit_history : [],
            verification: qualityReport.verification || null,
            post_actions: qualityReport.post_actions || null,
            handoff_bundle: handoffBundle
        },
        project_context: {
            glossary_available: Boolean(options?.projectContext?.glossaryYaml),
            glossary_yaml: options?.projectContext?.glossaryYaml || null,
            content_policy_matrix_yaml: options?.projectContext?.contentPolicyMatrixYaml || null,
            atoma_files_description: options?.projectContext?.atomaFilesDescription || null,
            atoma_files_payload: options?.projectContext?.atomaFilesPayload || null
        },
        workspace_context: {
            plan_item_ref: assets.action?.id || metrics.task_id || null,
            target_resource_url: handoffBundle?.publication?.link_url || firstResourceWithUrl?.url || null,
            target_resource_label: handoffBundle?.publication?.link_url ? 'publication.link_url' : firstResourceWithUrl?.file_name || firstResourceWithUrl?.ref || null,
            source_content: firstSourceContent?.content || handoffBundle?.publication?.body || item.draft_text || '',
            source_file_name: firstSourceContent?.file_name || null,
            voice_profile: derivedVoice,
            platform_type: item.channel?.type || item.layer || null
        }
    };
}
function countBundleResourceFiles(bundle) {
    return Array.isArray(bundle?.resource_files) ? bundle.resource_files.length : 0;
}
function countResolvedAssets(item) {
    return Array.isArray(item?.assets?.resolved_assets) ? item.assets.resolved_assets.length : 0;
}
async function runPublicationCriticReview(projectId, item, overrideText) {
    const plan = await loadPublicationPlanContext(projectId);
    const projectContext = await loadPublicationProjectContext(projectId);
    const action = item.assets?.action;
    const bundle = plan && action
        ? publication_plan_service_1.default.buildHandoffBundle({ ...plan, actions: [action] }, item)
        : (item.quality_report?.handoff_bundle || null);
    const publicationBody = (overrideText || bundle?.publication?.body || item.draft_text || '').trim();
    const sourceContent = (bundle?.resource_files || []).find((entry) => typeof entry?.content === 'string' && entry.content.trim())?.content || '';
    if (!publicationBody) {
        throw new Error('No publication body is available for critic review.');
    }
    const platform = item.channel?.type || item.layer || item.type;
    const voice = derivePublicationVoice(item);
    const dictionaryReport = content_dictionary_service_1.default.validateText(publicationBody, projectContext.glossaryYaml);
    const policyReport = content_policy_matrix_service_1.default.validateText(publicationBody, projectContext.contentPolicyMatrixYaml, {
        platform,
        voice
    });
    let llmCritic = null;
    let llmError = null;
    try {
        llmCritic = await multi_agent_service_1.default.runPublicationCritic(projectId, {
            task_id: action?.id || item.metrics?.task_id || item.id,
            title: item.title,
            channel: item.channel?.name || item.layer || item.type,
            platform,
            voice_profile: voice,
            target_resource_url: bundle?.publication?.link_url || null,
            publication_body: publicationBody,
            source_content: sourceContent,
            glossary_yaml: projectContext.glossaryYaml,
            content_policy_matrix_yaml: projectContext.contentPolicyMatrixYaml,
            applied_policy: policyReport.derived_policy,
            deterministic_findings: {
                dictionary: dictionaryReport.findings,
                policy: policyReport.findings,
                dictionary_score: dictionaryReport.score,
                policy_score: policyReport.score,
                policy_dimensions: policyReport.dimensions
            },
            atoma_files_description: projectContext.atomaFilesDescription,
            atoma_files_payload: projectContext.atomaFilesPayload
        });
    }
    catch (error) {
        llmError = error?.message || 'Critic agent failed';
    }
    const llmDimensions = llmCritic?.dimensions && typeof llmCritic.dimensions === 'object'
        ? llmCritic.dimensions
        : {};
    const mergedDimensions = {
        platform_fit: Math.round(((policyReport.dimensions.platform_fit || 0) + (Number(llmDimensions.platform_fit) || policyReport.dimensions.platform_fit || 0)) / 2),
        voice_fit: Math.round(((policyReport.dimensions.voice_fit || 0) + (Number(llmDimensions.voice_fit) || policyReport.dimensions.voice_fit || 0)) / 2),
        length_fit: Math.round(((policyReport.dimensions.length_fit || 0) + (Number(llmDimensions.length_fit) || policyReport.dimensions.length_fit || 0)) / 2),
        rule_fit: Math.round(((policyReport.dimensions.rule_fit || 0) + (Number(llmDimensions.rule_fit) || policyReport.dimensions.rule_fit || 0)) / 2),
        dictionary_fit: dictionaryReport.score,
        llm_quality: llmCritic?.score ?? null
    };
    const overallScore = llmCritic
        ? Math.round((dictionaryReport.score + policyReport.score + llmCritic.score) / 3)
        : Math.round((dictionaryReport.score + policyReport.score) / 2);
    const criticReview = {
        checked_at: new Date().toISOString(),
        overall_score: overallScore,
        dictionary: dictionaryReport,
        policy_matrix: {
            score: policyReport.score,
            findings: policyReport.findings,
            dimensions: policyReport.dimensions,
            derived_policy: policyReport.derived_policy
        },
        scoring_dimensions: mergedDimensions,
        llm_critic: llmCritic,
        llm_error: llmError,
        glossary_available: Boolean(projectContext.glossaryYaml),
        content_policy_matrix_available: Boolean(projectContext.contentPolicyMatrixYaml),
        content_policy_matrix_yaml: projectContext.contentPolicyMatrixYaml,
        atoma_files_description: projectContext.atomaFilesDescription,
        atoma_files_payload: projectContext.atomaFilesPayload,
        workspace_context: {
            platform,
            voice_profile: voice,
            target_resource_url: bundle?.publication?.link_url || null
        }
    };
    return {
        criticReview,
        publicationBody,
        bundle,
        projectContext
    };
}
async function apiRoutes(fastify) {
    // Auth and Project context middleware
    fastify.addHook('preHandler', async (request, reply) => {
        // Skip auth for public endpoints (like public image serving)
        if (request.url.startsWith('/public/')) {
            return;
        }
        // Skip auth for static files if needed, but here we cover /api/
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Authentication required' });
            return;
        }
        try {
            const user = auth_service_1.default.verifyToken(token);
            request.user = user;
            const projectId = request.headers['x-project-id'];
            if (projectId) {
                const pid = parseInt(projectId);
                const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, pid);
                if (!hasAccess) {
                    reply.code(403).send({ error: 'No access to this project' });
                    return;
                }
                request.projectId = pid;
            }
        }
        catch (e) {
            reply.code(401).send({ error: 'Invalid or expired token' });
        }
    });
    // Public endpoint to serve images for Telegram link preview
    fastify.get('/public/posts/:id/image', async (request, reply) => {
        const { id } = request.params;
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) },
            select: { image_url: true }
        });
        if (!post || !post.image_url) {
            return reply.code(404).send({ error: 'Image not found' });
        }
        if (post.image_url.startsWith('data:image/')) {
            const matches = post.image_url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return reply.code(400).send({ error: 'Invalid image format' });
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            reply.header('Content-Type', mimeType);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(buffer);
        }
        else if (post.image_url.startsWith('/uploads/')) {
            // Local upload: serve file
            const fs = require('fs');
            const path = require('path');
            const filename = post.image_url.split('/').pop() || '';
            const localPath = path.join(__dirname, '../../uploads', filename);
            if (fs.existsSync(localPath)) {
                const ext = filename.split('.').pop()?.toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                const buffer = fs.readFileSync(localPath);
                reply.header('Content-Type', mimeType);
                reply.header('Cache-Control', 'public, max-age=86400');
                return reply.send(buffer);
            }
            return reply.code(404).send({ error: 'Local image file not found' });
        }
        else if (post.image_url.startsWith('http')) {
            return reply.redirect(post.image_url);
        }
        else {
            return reply.code(400).send({ error: 'Unrecognized image url format' });
        }
    });
    // Public endpoint to serve images for V2 ContentItem link preview
    fastify.get('/public/content-items/:id/image', async (request, reply) => {
        const { id } = request.params;
        const item = await prisma.contentItem.findUnique({
            where: { id: parseInt(id) },
            select: { assets: true }
        });
        if (!item || !item.assets) {
            return reply.code(404).send({ error: 'ContentItem or assets not found' });
        }
        const assets = item.assets;
        const generatedVisual = Array.isArray(assets?.generated_visuals)
            ? assets.generated_visuals[0]
            : null;
        const imageUrl = generatedVisual?.url || generatedVisual?.image_url || generatedVisual?.src || null;
        if (!imageUrl) {
            return reply.code(404).send({ error: 'Image not found in assets' });
        }
        if (imageUrl.startsWith('data:image/')) {
            const matches = imageUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return reply.code(400).send({ error: 'Invalid image format' });
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            reply.header('Content-Type', mimeType);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(buffer);
        }
        else if (imageUrl.startsWith('/uploads/')) {
            const fs = require('fs');
            const path = require('path');
            const filename = imageUrl.split('/').pop() || '';
            const localPath = path.join(__dirname, '../../uploads', filename);
            if (fs.existsSync(localPath)) {
                const ext = filename.split('.').pop()?.toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                const buffer = fs.readFileSync(localPath);
                reply.header('Content-Type', mimeType);
                reply.header('Cache-Control', 'public, max-age=86400');
                return reply.send(buffer);
            }
            return reply.code(404).send({ error: 'Local image file not found' });
        }
        else if (imageUrl.startsWith('http')) {
            return reply.redirect(imageUrl);
        }
        else {
            return reply.code(400).send({ error: 'Unrecognized image url format' });
        }
    });
    // Weeks
    fastify.get('/api/weeks', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const weeks = await prisma.week.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { posts: true } } }
        });
        return weeks;
    });
    fastify.post('/api/weeks', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { theme, startDate, channelId } = request.body;
        let start, end;
        if (startDate) {
            const date = new Date(startDate);
            const range = await planner_service_1.default.getWeekRangeForDate(date);
            start = range.start;
            end = range.end;
        }
        else {
            const range = await planner_service_1.default.getNextWeekRange();
            start = range.start;
            end = range.end;
        }
        try {
            const week = await planner_service_1.default.createWeek(projectId, theme, start, end);
            // Default: All 7 days (14 slots)
            await planner_service_1.default.generateSlots(week.id, projectId, start, 14, 0, channelId);
            return week;
        }
        catch (e) {
            // P2002 is Prisma Unique Constraint Violation
            if (e.code === 'P2002') {
                console.log(`[API] Week already exists for project ${projectId} and start ${start}. Returning existing.`);
                const existing = await prisma.week.findFirst({
                    where: {
                        project_id: projectId,
                        week_start: start,
                        week_end: end
                    },
                    include: { _count: { select: { posts: true } } }
                });
                return existing;
            }
            console.error('[API] Error creating week:', e);
            reply.code(500).send({ error: 'Failed to create week', details: e.message });
        }
    });
    fastify.get('/api/weeks/:id', async (request, reply) => {
        try {
            const { id } = request.params;
            const week = await prisma.week.findUnique({
                where: { id: parseInt(id) },
                include: {
                    posts: {
                        orderBy: { publish_at: 'asc' }
                    }
                }
            });
            if (!week) {
                reply.code(404).send({ error: 'Week not found' });
                return;
            }
            // Get topics if in topics_generated status
            let topics = null;
            if (week.status === 'topics_generated') {
                console.log('Week status is topics_generated, looking for run...');
                const run = await prisma.agentRun.findFirst({
                    where: { input: `Theme: ${week.theme}` },
                    orderBy: { created_at: 'desc' },
                    include: { iterations: true }
                });
                if (run) {
                    console.log('Run found:', run.id);
                    // Noop
                }
            }
            console.log('Returning week:', week.id); // Debug Log
            // Sanitize BigInt for Fastify
            const serializedPosts = week.posts.map((p) => ({
                ...p,
                approval_message_id: p.approval_message_id ? p.approval_message_id.toString() : null
            }));
            return { ...week, posts: serializedPosts, topics };
        }
        catch (e) {
            console.error('Error in GET /api/weeks/:id:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /weeks/${request.params.id}: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
    fastify.put('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params;
        const data = request.body;
        const week = await prisma.week.update({
            where: { id: parseInt(id) },
            data
        });
        return week;
    });
    fastify.delete('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params;
        await prisma.week.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });
    // Week actions
    fastify.post('/api/weeks/:id/generate-topics', async (request, reply) => {
        try {
            const projectId = request.projectId;
            console.log('[API] Generate Topics Request:', {
                projectId,
                params: request.params,
                headers_x_project_id: request.headers['x-project-id']
            });
            if (!projectId) {
                console.error('[API] Missing Project ID');
                return reply.code(400).send({ error: 'Project ID required' });
            }
            const { id } = request.params;
            const { promptPresetId, overwrite } = request.body;
            const week = await prisma.week.findUnique({
                where: { id: parseInt(id) } // Removed project_id check temporarily to depend on middleware
            });
            // Double check project ownership if needed, or rely on middleware
            if (!week || week.project_id !== projectId) {
                return reply.code(404).send({ error: 'Week not found' });
            }
            // Handle Overwrite
            if (overwrite) {
                console.log(`[API] Overwriting topics for week ${id}`);
                await prisma.post.deleteMany({
                    where: {
                        week_id: week.id,
                        status: { in: ['planned', 'topics_generated'] } // Only delete planned/generated, keep published/scheduled? 
                        // Actually, if we regenerate topics, we probably want to wipe the slate for this week unless they are already locked in.
                    }
                });
            }
            let promptOverride;
            if (promptPresetId) {
                const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
                if (preset)
                    promptOverride = preset.prompt_text;
            }
            // Determine how many topics to generate based on existing posts (topics)
            const existingPosts = await prisma.post.findMany({
                where: { week_id: week.id, status: { not: 'planned' } }, // Count generated/approved topics
                select: { topic: true }
            });
            const existingCount = existingPosts.length;
            const existingTopics = existingPosts.map(p => p.topic || '').filter(t => t);
            let countToGenerate = 0;
            // Target 14 topics (full week)
            if (existingCount < 14) {
                countToGenerate = 14 - existingCount;
            }
            else {
                return reply.code(400).send({ error: 'Maximum topics (14) already reached' });
            }
            if (countToGenerate <= 0) {
                return reply.code(400).send({ error: 'No topics needed or max reached' });
            }
            // Generate slots for new topics
            // We need to know where to start indexing. 
            // Assuming slots are 1-based index. 
            // Actually, we should check if slots already exist for these indices.
            // But simplify: just generate slots starting from current count.
            // Push to queue instead of running inline
            const { topicsQueue } = require('../queue');
            await topicsQueue.add('generate-topics', {
                projectId,
                weekId: week.id,
                promptOverride,
                countToGenerate,
                existingCount,
                existingTopics
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }
            });
            return reply.code(202).send({ success: true, message: 'Topics generation queued in background' });
        }
        catch (error) {
            console.error('[API Error] Generate Topics Failed API setup:', error);
            const fs = require('fs');
            const logEntry = `[${new Date().toISOString()}] Error in /generate-topics API: ${error.message}\nStack: ${error.stack}\n\n`;
            fs.appendFileSync('server_error.log', logEntry);
            return reply.code(500).send({ error: 'Internal Server Error', details: error.message });
        }
    });
    fastify.post('/api/weeks/:id/approve-topics', async (request, reply) => {
        const { id } = request.params;
        const weekId = parseInt(id);
        // Update all posts status
        await prisma.post.updateMany({
            where: {
                week_id: weekId,
                status: 'topics_generated'
            },
            data: {
                status: 'topics_approved'
            }
        });
        await planner_service_1.default.updateWeekStatus(weekId, 'topics_approved');
        return { success: true };
    });
    fastify.post('/api/weeks/:id/generate-posts', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id), project_id: projectId },
            include: { posts: true }
        });
        if (!week) {
            reply.code(404).send({ error: 'Week not found' });
            return;
        }
        await planner_service_1.default.updateWeekStatus(week.id, 'generating');
        // Generate posts asynchronously via BullMQ Queue
        const { postsQueue } = require('../queue');
        for (const post of week.posts) {
            if (!post.topic)
                continue;
            await prisma.post.update({
                where: { id: post.id },
                data: { status: 'generating' }
            });
            await postsQueue.add('generate-post', {
                projectId,
                theme: week.theme,
                topic: post.topic,
                postId: post.id,
                isBatch: true // Identifies we should check if entire week is done
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 10000 }
            });
        }
        return reply.code(202).send({ success: true, message: 'Generation queued' });
    });
    fastify.post('/api/weeks/:id/generate-sequential', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id) }
        });
        if (!week)
            return reply.code(404).send({ error: 'Week not found' });
        // Trigger background generation
        (async () => {
            const writer = require('../services/sequential_writer.service').default;
            try {
                await writer.generateWeekPosts(projectId, week.id);
            }
            catch (e) {
                console.error('Sequential generation failed', e);
            }
        })();
        return { success: true, message: 'Sequential generation started' };
    });
    fastify.post('/api/posts/:id/generate-image', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const { provider } = request.body;
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) }
        });
        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }
        try {
            console.log(`[Generate Image] Enqueueing request for Post ${id}, Provider: ${provider || 'gpt-image'}`);
            const textToUse = post.final_text || post.generated_text || post.topic || '';
            // Mark immediately to stop re-clicks
            await prisma.post.update({
                where: { id: parseInt(id) },
                data: { status: 'generating' }
            });
            const { imageQueue } = require('../queue');
            await imageQueue.add('generate-image', {
                projectId,
                postId: post.id,
                provider: provider || 'gpt-image',
                textToUse,
                topic: post.topic
            }, {
                attempts: 2,
                backoff: { type: 'exponential', delay: 10000 }
            });
            return reply.code(202).send({ success: true, message: 'Image generation queued' });
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ error: `Queue failed: ${error.message}` });
        }
    });
    fastify.post('/api/posts/:id/upload-image', async (request, reply) => {
        const { id } = request.params;
        const data = await request.file();
        if (!data) {
            return reply.code(400).send({ error: 'No file uploaded' });
        }
        try {
            const buffer = await data.toBuffer();
            const ext = data.filename.split('.').pop() || 'jpg';
            const filename = `post-${id}-${Date.now()}.${ext}`;
            const destinationPath = `uploads/${filename}`;
            console.log(`[Upload] Uploading ${filename} to Supabase Storage...`);
            const imageUrl = await storage_service_1.default.uploadFileFromBuffer(buffer, data.mimetype, destinationPath);
            console.log(`[Upload] Upload success: ${imageUrl}`);
            await prisma.post.update({
                where: { id: parseInt(id) },
                data: {
                    image_url: imageUrl,
                    image_prompt: 'Uploaded by user'
                }
            });
            return { success: true, imageUrl };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ error: 'Upload failed', details: error.message || error });
        }
    });
    // Posts
    fastify.get('/api/posts/:id', async (request, reply) => {
        const { id } = request.params;
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) },
            include: { week: true }
        });
        if (!post) {
            reply.code(404).send({ error: 'Post not found' });
            return;
        }
        // Find associated WeekPackage by matching dates and project_id (with range overlap support)
        let weekPackageId = null;
        if (post.week) {
            const weekPackage = await prisma.weekPackage.findFirst({
                where: {
                    project_id: post.project_id,
                    week_start: {
                        gte: post.week.week_start,
                        lte: post.week.week_end
                    }
                }
            });
            weekPackageId = weekPackage?.id || null;
        }
        const { week, ...rest } = post;
        return {
            ...rest,
            week_package_id: weekPackageId
        };
    });
    fastify.put('/api/posts/:id', async (request, reply) => {
        const { id } = request.params;
        const data = request.body;
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data
        });
        return post;
    });
    fastify.post('/api/posts/:id/approve', async (request, reply) => {
        const { id } = request.params;
        const data = request.body || {};
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: {
                ...data, // Allow updating publish_at, text, channel_id etc during approval
                status: 'scheduled'
            }
        });
        return post;
    });
    fastify.post('/api/posts/:id/approve-topic', async (request, reply) => {
        const { id } = request.params;
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: { status: 'topics_approved' }
        });
        return post;
    });
    fastify.post('/api/posts/:id/publish-now', async (request, reply) => {
        const { id } = request.params;
        try {
            const host = request.headers.host || undefined;
            const result = await publisher_service_1.default.publishPostNow(parseInt(id), host);
            return {
                success: true,
                publishMethod: result.publishMethod,
                warning: result.warning || null
            };
        }
        catch (e) {
            console.error('Publish now failed', e);
            reply.code(500).send({ error: e.message });
        }
    });
    fastify.post('/api/posts/:id/generate', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const post = await prisma.post.findFirst({
            where: {
                id: parseInt(id),
                week: { project_id: projectId }
            },
            include: { week: true }
        });
        if (!post || !post.week) {
            reply.code(404).send({ error: 'Post not found or access denied' });
            return;
        }
        if (!post.topic) {
            reply.code(400).send({ error: 'Post has no topic' });
            return;
        }
        const { promptPresetId, withImage } = request.body;
        let promptOverride;
        if (promptPresetId) {
            const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
            if (preset)
                promptOverride = preset.prompt_text;
        }
        // Immediately update status and enqueue background generation via BullMQ
        await prisma.post.update({
            where: { id: post.id },
            data: { status: 'generating' }
        });
        const { postsQueue } = require('../queue');
        await postsQueue.add('generate-post', {
            projectId,
            theme: post.week.theme,
            topic: post.topic,
            postId: post.id,
            promptOverride,
            withImage,
            isBatch: false
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 }
        });
        return reply.code(202).send({ success: true, message: 'Generation queued in background' });
    });
    fastify.post('/api/posts/:id/validate-dictionary', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { text } = request.body;
        const post = await prisma.post.findFirst({
            where: {
                id: parseInt(id),
                project_id: projectId
            }
        });
        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }
        const dictionarySetting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });
        const report = content_dictionary_service_1.default.validateText(text || post.final_text || post.generated_text || '', dictionarySetting?.value || null);
        return report;
    });
    fastify.get('/api/publication-tasks', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { status, manualOnly } = request.query;
        const where = {
            project_id: projectId,
            assets: { not: undefined }
        };
        if (status === 'active') {
            where.status = { in: ['planned', 'ready_for_execution', 'awaiting_manual_publication', 'published', 'failed'] };
        }
        else if (status) {
            where.status = status;
        }
        const items = await prisma.contentItem.findMany({
            where,
            select: {
                id: true,
                type: true,
                layer: true,
                title: true,
                brief: true,
                status: true,
                schedule_at: true,
                published_link: true,
                quality_report: true,
                metrics: true,
                channel: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                        config: true
                    }
                }
            },
            orderBy: { schedule_at: 'asc' }
        });
        const filtered = manualOnly === 'true'
            ? items.filter((item) => item.quality_report?.execution_mode === 'manual')
            : items;
        const response = filtered.map(buildPublicationTaskListItem);
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.list', {
            projectId,
            status: status || 'active',
            manualOnly: manualOnly === 'true',
            itemCount: response.length,
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
        });
        return response;
    });
    fastify.get('/api/publication-tasks/:id', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const plan = await loadPublicationPlanContext(projectId);
        const projectContext = await loadPublicationProjectContext(projectId);
        const action = item.assets?.action;
        if (!plan || !action) {
            const response = buildPublicationTaskDetailItem(item, { projectContext });
            (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.detail', {
                projectId,
                taskId: item.id,
                hasPlan: false,
                resolvedAssets: countResolvedAssets(item),
                sourceContentBytes: (0, egress_diagnostics_1.textBytes)(response.workspace_context?.source_content),
                responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
            });
            return response;
        }
        const bundle = publication_plan_service_1.default.buildHandoffBundle({ ...plan, actions: [action] }, item);
        const response = buildPublicationTaskDetailItem(item, {
            handoffBundle: bundle,
            projectContext
        });
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.detail', {
            projectId,
            taskId: item.id,
            hasPlan: true,
            resolvedAssets: countResolvedAssets(item),
            bundleResourceFiles: countBundleResourceFiles(bundle),
            publicationBodyBytes: (0, egress_diagnostics_1.textBytes)(bundle?.publication?.body),
            sourceContentBytes: (0, egress_diagnostics_1.textBytes)(response.workspace_context?.source_content),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
        });
        return response;
    });
    fastify.put('/api/publication-tasks/:id/content', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { body } = request.body;
        if (typeof body !== 'string') {
            return reply.code(400).send({ error: 'body must be a string' });
        }
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const nextQualityReport = {
            ...(item.quality_report || {})
        };
        const previousBody = String(nextQualityReport.handoff_bundle?.publication?.body
            || item.draft_text
            || '');
        const history = Array.isArray(nextQualityReport.content_edit_history)
            ? nextQualityReport.content_edit_history
            : [];
        if (body !== previousBody) {
            nextQualityReport.content_edit_history = [
                {
                    edited_at: new Date().toISOString(),
                    previous_body: previousBody,
                    next_body: body
                },
                ...history
            ].slice(0, 20);
        }
        if (nextQualityReport.handoff_bundle?.publication) {
            nextQualityReport.handoff_bundle = {
                ...nextQualityReport.handoff_bundle,
                publication: {
                    ...nextQualityReport.handoff_bundle.publication,
                    body
                }
            };
        }
        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                draft_text: body,
                quality_report: nextQualityReport
            }
        });
        const response = {
            id: updated.id,
            draft_text: updated.draft_text,
            quality_report: updated.quality_report
        };
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.save_content', {
            projectId,
            taskId: updated.id,
            requestBodyBytes: (0, egress_diagnostics_1.textBytes)(body),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
        });
        return response;
    });
    fastify.post('/api/publication-tasks/:id/prepare-handoff', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const plan = await loadPublicationPlanContext(projectId);
        if (!plan) {
            const response = {
                item: {
                    ...item,
                    schedule_at: resolveTaskScheduleAt(item)
                },
                bundle: null,
                reused: false,
                warning: 'No imported publication plan context is available for this task.'
            };
            (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.prepare_handoff', {
                projectId,
                taskId: item.id,
                hasPlan: false,
                responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
            });
            return reply.code(200).send(response);
        }
        const action = item.assets?.action;
        plan.actions = action ? [action] : [];
        const bundle = publication_plan_service_1.default.buildHandoffBundle(plan, item);
        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                status: bundle.mode === 'manual' ? 'awaiting_manual_publication' : 'ready_for_execution',
                quality_report: {
                    ...(item.quality_report || {}),
                    handoff_bundle: bundle,
                    prepared_at: new Date().toISOString()
                }
            }
        });
        const response = {
            item: {
                ...updated,
                schedule_at: resolveTaskScheduleAt(updated)
            },
            bundle
        };
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.prepare_handoff', {
            projectId,
            taskId: item.id,
            hasPlan: true,
            bundleResourceFiles: countBundleResourceFiles(bundle),
            publicationBodyBytes: (0, egress_diagnostics_1.textBytes)(bundle?.publication?.body),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
        });
        return response;
    });
    fastify.post('/api/publication-tasks/:id/publish-now', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const taskId = parseInt(id);
        const item = await prisma.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { channel: true }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        try {
            const host = request.headers.host || undefined;
            const result = await publisher_service_1.default.processPublicationTaskNow(taskId, host);
            const refreshed = await prisma.contentItem.findFirst({
                where: { id: taskId, project_id: projectId },
                include: { channel: true }
            });
            const response = {
                success: true,
                result,
                item: refreshed ? {
                    ...refreshed,
                    schedule_at: resolveTaskScheduleAt(refreshed)
                } : null
            };
            (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.publish_now', {
                projectId,
                taskId,
                responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
            });
            return response;
        }
        catch (error) {
            return reply.code(400).send({ error: extractRequestErrorMessage(error, 'Failed to publish task now') });
        }
    });
    fastify.post('/api/publication-tasks/:id/confirm-publication', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { publishedLink, note, outcome } = request.body;
        if (!publishedLink) {
            return reply.code(400).send({ error: 'publishedLink is required' });
        }
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const monitoring = item.metrics?.monitoring || {};
        const publicationOutcome = outcome || 'published';
        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                status: 'published',
                published_link: publishedLink,
                metrics: {
                    ...(item.metrics || {}),
                    manual_confirmation_at: new Date().toISOString(),
                    publication_outcome: publicationOutcome,
                    monitoring: {
                        ...monitoring,
                        awaiting_analytics: true,
                        awaiting_comment_alerts: monitoring.needs_comment_monitoring === true
                    }
                },
                quality_report: {
                    ...(item.quality_report || {}),
                    manual_publication_note: note || null,
                    publication_outcome: publicationOutcome
                }
            }
        });
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.confirm_publication', {
            projectId,
            taskId: updated.id,
            publishedLinkBytes: (0, egress_diagnostics_1.textBytes)(publishedLink),
            noteBytes: (0, egress_diagnostics_1.textBytes)(note),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(updated)
        });
        return updated;
    });
    fastify.post('/api/publication-tasks/:id/record-metrics', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { metrics } = request.body;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                metrics: {
                    ...(item.metrics || {}),
                    collected_metrics: metrics || {},
                    metrics_updated_at: new Date().toISOString()
                }
            }
        });
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.record_metrics', {
            projectId,
            taskId: updated.id,
            metricsBytes: (0, egress_diagnostics_1.jsonBytes)(metrics || {}),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(updated)
        });
        return updated;
    });
    fastify.post('/api/publication-tasks/:id/collect-metrics', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const result = await metrics_service_1.default.collectMetricsForContentItem(parseInt(id), projectId);
        if (!result.found) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.collect_metrics', {
            projectId,
            taskId: parseInt(id),
            found: result.found,
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(result)
        });
        return result;
    });
    fastify.post('/api/publication-tasks/:id/external-comment-alert', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { text, commentUrl, author } = request.body;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const composed = [
            author ? `Author: ${author}` : null,
            text ? `Comment: ${text}` : null,
            commentUrl ? `URL: ${commentUrl}` : null
        ].filter(Boolean).join('\n');
        const comment = await comment_service_1.default.createComment(projectId, 'content_item', item.id, composed || 'External comment alert received', 'assistant');
        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                metrics: {
                    ...(item.metrics || {}),
                    last_comment_alert_at: new Date().toISOString()
                }
            }
        });
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.external_comment_alert', {
            projectId,
            taskId: item.id,
            textBytes: (0, egress_diagnostics_1.textBytes)(text),
            commentUrlBytes: (0, egress_diagnostics_1.textBytes)(commentUrl),
            authorBytes: (0, egress_diagnostics_1.textBytes)(author),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(comment)
        });
        return comment;
    });
    fastify.post('/api/publication-tasks/:id/critic-check', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { text } = request.body;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        let criticReview;
        try {
            criticReview = (await runPublicationCriticReview(projectId, item, text)).criticReview;
        }
        catch (error) {
            return reply.code(400).send({ error: error?.message || 'No publication body is available for critic review.' });
        }
        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                quality_report: {
                    ...(item.quality_report || {}),
                    critic_review: criticReview
                }
            }
        });
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.critic_check', {
            projectId,
            taskId: item.id,
            inputTextBytes: (0, egress_diagnostics_1.textBytes)(text),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(criticReview)
        });
        return criticReview;
    });
    fastify.post('/api/publication-tasks/:id/fix-with-critic', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { text } = request.body;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const initial = await runPublicationCriticReview(projectId, item, text);
        const currentText = initial.publicationBody;
        const fixed = await multi_agent_service_1.default.runPublicationFixer(projectId, {
            task_id: (item.metrics?.task_id || item.id),
            title: item.title,
            channel: item.channel?.name || item.layer || item.type,
            platform: item.channel?.type || item.layer || item.type,
            voice_profile: derivePublicationVoice(item),
            original_text: currentText,
            critic_review: initial.criticReview,
            source_content: (initial.bundle?.resource_files || []).find((entry) => typeof entry?.content === 'string' && entry.content.trim())?.content || '',
            glossary_yaml: initial.projectContext.glossaryYaml,
            content_policy_matrix_yaml: initial.projectContext.contentPolicyMatrixYaml,
            atoma_files_description: initial.projectContext.atomaFilesDescription,
            atoma_files_payload: initial.projectContext.atomaFilesPayload
        });
        const nextQualityReport = {
            ...(item.quality_report || {})
        };
        const history = Array.isArray(nextQualityReport.content_edit_history)
            ? nextQualityReport.content_edit_history
            : [];
        if (fixed.updated_text && fixed.updated_text !== currentText) {
            nextQualityReport.content_edit_history = [
                {
                    edited_at: new Date().toISOString(),
                    previous_body: currentText,
                    next_body: fixed.updated_text,
                    source: 'critic_fixer'
                },
                ...history
            ].slice(0, 20);
        }
        if (nextQualityReport.handoff_bundle?.publication && fixed.updated_text) {
            nextQualityReport.handoff_bundle = {
                ...nextQualityReport.handoff_bundle,
                publication: {
                    ...nextQualityReport.handoff_bundle.publication,
                    body: fixed.updated_text
                }
            };
        }
        nextQualityReport.last_fixer_run = {
            fixed_at: new Date().toISOString(),
            summary: fixed.summary || null,
            resolved_findings: fixed.resolved_findings || [],
            raw: fixed
        };
        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                draft_text: fixed.updated_text || currentText,
                quality_report: nextQualityReport
            }
        });
        const reloaded = await prisma.contentItem.findFirst({
            where: { id: updated.id, project_id: projectId },
            include: { channel: true }
        });
        const finalCritic = reloaded
            ? await runPublicationCriticReview(projectId, reloaded, updated.draft_text || currentText)
            : null;
        if (reloaded && finalCritic) {
            await prisma.contentItem.update({
                where: { id: reloaded.id },
                data: {
                    quality_report: {
                        ...((reloaded.quality_report || {})),
                        critic_review: finalCritic.criticReview,
                        last_fixer_run: nextQualityReport.last_fixer_run
                    }
                }
            });
        }
        const response = {
            updated_text: updated.draft_text || currentText,
            fixer: fixed,
            critic_review: finalCritic?.criticReview || initial.criticReview
        };
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.fix_with_critic', {
            projectId,
            taskId: item.id,
            inputTextBytes: (0, egress_diagnostics_1.textBytes)(text || currentText),
            outputTextBytes: (0, egress_diagnostics_1.textBytes)(updated.draft_text || currentText),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(response)
        });
        return response;
    });
    fastify.post('/api/publication-tasks/:id/generate-image', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { provider } = request.body;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });
        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }
        const plan = await loadPublicationPlanContext(projectId);
        const action = item.assets?.action;
        const bundle = plan && action
            ? publication_plan_service_1.default.buildHandoffBundle({ ...plan, actions: [action] }, item)
            : (item.quality_report?.handoff_bundle || null);
        const publicationBody = (bundle?.publication?.body || item.draft_text || '').trim();
        const topic = item.title || action?.display_name || item.type;
        const selectedProvider = provider || 'gpt-image';
        if (!publicationBody) {
            return reply.code(400).send({ error: 'No publication body is available to generate an image.' });
        }
        let prompt = '';
        try {
            prompt = await generator_service_1.default.generateImagePrompt(projectId, topic, publicationBody, selectedProvider);
        }
        catch {
            prompt = `Create an editorial visual for "${topic}". Context: ${publicationBody.slice(0, 700)}`;
        }
        const imageUrl = selectedProvider === 'nano'
            ? await generator_service_1.default.generateImageNanoBanana(prompt)
            : await generator_service_1.default.generateImage(prompt);
        const previousVisuals = Array.isArray(item.assets?.generated_visuals)
            ? item.assets.generated_visuals
            : [];
        const generatedImage = {
            provider: selectedProvider,
            prompt,
            url: imageUrl,
            generated_at: new Date().toISOString()
        };
        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                assets: {
                    ...(item.assets || {}),
                    generated_visuals: [generatedImage, ...previousVisuals].slice(0, 6)
                },
                quality_report: {
                    ...(item.quality_report || {}),
                    generated_image: generatedImage
                }
            }
        });
        (0, egress_diagnostics_1.logEgressDiagnostic)('publication_tasks.generate_image', {
            projectId,
            taskId: item.id,
            provider: selectedProvider,
            publicationBodyBytes: (0, egress_diagnostics_1.textBytes)(publicationBody),
            promptBytes: (0, egress_diagnostics_1.textBytes)(prompt),
            responseBytes: (0, egress_diagnostics_1.jsonBytes)(generatedImage)
        });
        return generatedImage;
    });
    // Settings
    fastify.get('/api/settings/agents', async (request, reply) => {
        try {
            const projectId = request.projectId;
            if (!projectId)
                return reply.code(400).send({ error: 'Project ID required' });
            const roles = ['post_creator', 'post_critic', 'post_fixer', 'topic_creator', 'topic_critic', 'topic_fixer', 'visual_architect', 'structural_critic', 'precision_fixer', 'image_critic'];
            const agents = [];
            // Text Agents
            for (const role of roles) {
                try {
                    const config = await multi_agent_service_1.default.getAgentConfig(projectId, role);
                    let provider = 'Not Configured';
                    if (config.apiKey) {
                        if (config.apiKey.startsWith('sk-ant'))
                            provider = 'Anthropic';
                        else if (config.apiKey.startsWith('AIza'))
                            provider = 'Gemini';
                        else if (config.apiKey.startsWith('sk-'))
                            provider = 'OpenAI';
                        else
                            provider = 'Unknown';
                    }
                    agents.push({
                        role,
                        prompt: config.prompt,
                        apiKey: config.apiKey,
                        model: config.model,
                        provider
                    });
                }
                catch (e) {
                    console.error(`Failed to fetch config for role ${role}`, e);
                    // Push safe default instead of crashing
                    agents.push({
                        role,
                        prompt: '',
                        apiKey: '',
                        model: '',
                        provider: 'Error'
                    });
                }
            }
            // Image Agents (GPT-Image)
            try {
                const dallePrompt = await generator_service_1.default.getImagePromptTemplate(projectId, 'gpt-image');
                agents.push({
                    role: 'gpt_image_gen',
                    prompt: dallePrompt,
                    apiKey: '', // Managed via env mostly for now
                    model: 'dall-e-3',
                    provider: 'OpenAI (Env)'
                });
            }
            catch (e) {
                console.error('Failed to fetch DALL-E config', e);
            }
            // Image Agents (Nano)
            try {
                const nanoPrompt = await generator_service_1.default.getImagePromptTemplate(projectId, 'nano');
                agents.push({
                    role: 'nano_image_gen',
                    prompt: nanoPrompt,
                    apiKey: '',
                    model: 'imagen-3.0',
                    provider: 'Google (Env)'
                });
            }
            catch (e) {
                console.error('Failed to fetch Nano config', e);
            }
            return agents;
        }
        catch (e) {
            console.error('Error in GET /api/settings/agents:', e);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
    fastify.put('/api/settings/agents/:role', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { role } = request.params;
        const { prompt, apiKey, model } = request.body;
        // Handle Image Agents
        if (role === 'gpt_image_gen') {
            await generator_service_1.default.updateImagePromptTemplate(projectId, prompt, 'gpt-image');
            return { success: true };
        }
        if (role === 'nano_image_gen') {
            await generator_service_1.default.updateImagePromptTemplate(projectId, prompt, 'nano');
            return { success: true };
        }
        // Handle Text Agents
        const roleMap = {
            'post_creator': {
                prompt: multi_agent_service_1.default.KEY_POST_CREATOR_PROMPT,
                key: multi_agent_service_1.default.KEY_POST_CREATOR_KEY,
                model: multi_agent_service_1.default.KEY_POST_CREATOR_MODEL
            },
            'post_critic': {
                prompt: multi_agent_service_1.default.KEY_POST_CRITIC_PROMPT,
                key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY,
                model: multi_agent_service_1.default.KEY_POST_CRITIC_MODEL
            },
            'post_fixer': {
                prompt: multi_agent_service_1.default.KEY_POST_FIXER_PROMPT,
                key: multi_agent_service_1.default.KEY_POST_FIXER_KEY,
                model: multi_agent_service_1.default.KEY_POST_FIXER_MODEL
            },
            'topic_creator': {
                prompt: multi_agent_service_1.default.KEY_TOPIC_CREATOR_PROMPT,
                key: multi_agent_service_1.default.KEY_TOPIC_CREATOR_KEY,
                model: multi_agent_service_1.default.KEY_TOPIC_CREATOR_MODEL
            },
            'topic_critic': {
                prompt: multi_agent_service_1.default.KEY_TOPIC_CRITIC_PROMPT,
                key: multi_agent_service_1.default.KEY_TOPIC_CRITIC_KEY,
                model: multi_agent_service_1.default.KEY_TOPIC_CRITIC_MODEL
            },
            'topic_fixer': {
                prompt: multi_agent_service_1.default.KEY_TOPIC_FIXER_PROMPT,
                key: multi_agent_service_1.default.KEY_TOPIC_FIXER_KEY,
                model: multi_agent_service_1.default.KEY_TOPIC_FIXER_MODEL
            },
            'visual_architect': {
                prompt: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_PROMPT,
                key: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_KEY,
                model: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_MODEL
            },
            'structural_critic': {
                prompt: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_PROMPT,
                key: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_KEY,
                model: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_MODEL
            },
            'precision_fixer': {
                prompt: multi_agent_service_1.default.KEY_PRECISION_FIXER_PROMPT,
                key: multi_agent_service_1.default.KEY_PRECISION_FIXER_KEY,
                model: multi_agent_service_1.default.KEY_PRECISION_FIXER_MODEL
            },
            'image_critic': {
                prompt: multi_agent_service_1.default.KEY_IMAGE_CRITIC_PROMPT,
                key: multi_agent_service_1.default.KEY_IMAGE_CRITIC_KEY,
                model: multi_agent_service_1.default.KEY_IMAGE_CRITIC_MODEL
            }
        };
        const keys = roleMap[role];
        if (!keys) {
            return reply.code(400).send({ error: 'Invalid role' });
        }
        try {
            // Helper to safe update
            const saveSetting = async (key, value) => {
                const existing = await prisma.projectSettings.findUnique({
                    where: { project_id_key: { project_id: projectId, key } }
                });
                if (existing) {
                    await prisma.projectSettings.update({
                        where: { id: existing.id },
                        data: { value }
                    });
                }
                else {
                    await prisma.projectSettings.create({
                        data: { project_id: projectId, key, value }
                    });
                }
            };
            await saveSetting(keys.prompt, prompt);
            await saveSetting(keys.key, apiKey || '');
            await saveSetting(keys.model, model);
            return { success: true };
        }
        catch (e) {
            console.error(`Failed to save settings for ${role}`, e);
            return reply.code(500).send({ error: 'Failed to save settings', details: e.message });
        }
    });
    fastify.get('/api/settings/runs', async (request, reply) => {
        const runs = await prisma.agentRun.findMany({
            orderBy: { created_at: 'desc' },
            take: 50
        });
        return runs;
    });
    // Agents Presets
    fastify.get('/api/settings/presets', async (request, reply) => {
        try {
            const projectId = request.projectId;
            if (!projectId)
                return reply.code(400).send({ error: 'Project ID required' });
            return await prisma.promptPreset.findMany({
                where: { project_id: projectId },
                orderBy: { created_at: 'desc' }
            });
        }
        catch (e) {
            console.error('Error in GET /api/settings/presets:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /presets: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
    fastify.post('/api/settings/presets', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { name, role, prompt_text } = request.body;
        return await prisma.promptPreset.create({
            data: { project_id: projectId, name, role, prompt_text }
        });
    });
    fastify.put('/api/settings/presets/:id', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const data = request.body;
        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0)
            return reply.code(404).send({ error: 'Not found' });
        return await prisma.promptPreset.update({
            where: { id: parseInt(id) },
            data
        });
    });
    fastify.delete('/api/settings/presets/:id', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0)
            return reply.code(404).send({ error: 'Not found' });
        await prisma.promptPreset.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });
    // Comments
    fastify.get('/api/comments', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { entityType, entityId } = request.query;
        if (!entityType || !entityId)
            return reply.code(400).send({ error: 'Missing params' });
        return await comment_service_1.default.getComments(projectId, entityType, parseInt(entityId));
    });
    fastify.post('/api/comments', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { entityType, entityId, text } = request.body;
        return await comment_service_1.default.createComment(projectId, entityType, parseInt(entityId), text, 'user');
    });
    // Keys Management
    fastify.get('/api/settings/keys', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const keys = await prisma.providerKey.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: 'desc' }
        });
        // Mask keys
        return keys.map(k => ({
            ...k,
            key: k.key.substring(0, 3) + '...' + k.key.substring(k.key.length - 4)
        }));
    });
    fastify.post('/api/settings/keys', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { name, key } = request.body;
        let provider = 'Other';
        if (key.startsWith('sk-ant'))
            provider = 'Anthropic';
        else if (key.startsWith('AIza'))
            provider = 'Gemini';
        else if (key.startsWith('sk-'))
            provider = 'OpenAI';
        const newKey = await prisma.providerKey.create({
            data: {
                project_id: projectId,
                name,
                key,
                provider
            }
        });
        return { success: true, id: newKey.id, provider: newKey.provider };
    });
    fastify.delete('/api/settings/keys/:id', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        // Ensure belongs to project
        const count = await prisma.providerKey.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0)
            return reply.code(404).send({ error: 'Not found' });
        await prisma.providerKey.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });
    fastify.get('/api/settings/content-dictionary', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });
        const yamlValue = setting?.value || content_dictionary_service_1.default.getDefaultYaml();
        const parsed = content_dictionary_service_1.default.parseYaml(yamlValue);
        return {
            yaml: yamlValue,
            parsed,
            updated_at: setting?.updated_at || null
        };
    });
    fastify.put('/api/settings/content-dictionary', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { yaml: yamlText } = request.body;
        if (typeof yamlText !== 'string' || !yamlText.trim()) {
            return reply.code(400).send({ error: 'yaml is required' });
        }
        try {
            const normalizedYaml = content_dictionary_service_1.default.normalizeToYaml(yamlText);
            const parsed = content_dictionary_service_1.default.parseYaml(normalizedYaml);
            const saved = await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } },
                update: { value: normalizedYaml },
                create: {
                    project_id: projectId,
                    key: 'content_dictionary_yaml',
                    value: normalizedYaml
                }
            });
            return {
                yaml: saved.value,
                parsed,
                updated_at: saved.updated_at
            };
        }
        catch (error) {
            return reply.code(400).send({ error: error.message || 'Invalid dictionary YAML' });
        }
    });
    fastify.get('/api/settings/content-policy-matrix', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_policy_matrix_yaml' } }
        });
        const yamlValue = setting?.value || content_policy_matrix_service_1.default.getDefaultYaml();
        const parsed = content_policy_matrix_service_1.default.parseYaml(yamlValue);
        return {
            yaml: yamlValue,
            parsed,
            updated_at: setting?.updated_at || null
        };
    });
    fastify.put('/api/settings/content-policy-matrix', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { yaml: yamlText } = request.body;
        if (typeof yamlText !== 'string' || !yamlText.trim()) {
            return reply.code(400).send({ error: 'yaml is required' });
        }
        try {
            const normalizedYaml = content_policy_matrix_service_1.default.normalizeToYaml(yamlText);
            const parsed = content_policy_matrix_service_1.default.parseYaml(normalizedYaml);
            const saved = await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'content_policy_matrix_yaml' } },
                update: { value: normalizedYaml },
                create: {
                    project_id: projectId,
                    key: 'content_policy_matrix_yaml',
                    value: normalizedYaml
                }
            });
            return {
                yaml: saved.value,
                parsed,
                updated_at: saved.updated_at
            };
        }
        catch (error) {
            return reply.code(400).send({ error: error.message || 'Invalid content policy matrix YAML' });
        }
    });
    fastify.get('/api/settings/atoma-context', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const settings = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['atoma_files_description', 'atoma_files_payload'] }
            }
        });
        const descriptionSetting = settings.find((setting) => setting.key === 'atoma_files_description') || null;
        const payloadSetting = settings.find((setting) => setting.key === 'atoma_files_payload') || null;
        const parsedPayload = safeJsonParse(payloadSetting?.value || null);
        const updatedAt = [descriptionSetting?.updated_at, payloadSetting?.updated_at]
            .filter(Boolean)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
        return {
            description: descriptionSetting?.value || '',
            payload: parsedPayload,
            payload_text: payloadSetting?.value
                ? (parsedPayload !== null ? formatJson(parsedPayload) : payloadSetting.value)
                : '',
            updated_at: updatedAt
        };
    });
    fastify.put('/api/settings/atoma-context', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { description, payloadText } = request.body;
        if (typeof description !== 'string' || typeof payloadText !== 'string') {
            return reply.code(400).send({ error: 'description and payloadText are required' });
        }
        const normalizedDescription = description.trim();
        const normalizedPayloadText = payloadText.trim();
        let normalizedPayloadValue = '';
        let parsedPayload = null;
        if (normalizedPayloadText) {
            try {
                parsedPayload = JSON.parse(normalizedPayloadText);
                normalizedPayloadValue = formatJson(parsedPayload);
            }
            catch (error) {
                return reply.code(400).send({ error: error.message || 'Invalid ATOMA payload JSON' });
            }
        }
        await prisma.$transaction(async (tx) => {
            if (normalizedDescription) {
                await tx.projectSettings.upsert({
                    where: { project_id_key: { project_id: projectId, key: 'atoma_files_description' } },
                    update: { value: normalizedDescription },
                    create: {
                        project_id: projectId,
                        key: 'atoma_files_description',
                        value: normalizedDescription
                    }
                });
            }
            else {
                await tx.projectSettings.deleteMany({
                    where: { project_id: projectId, key: 'atoma_files_description' }
                });
            }
            if (normalizedPayloadValue) {
                await tx.projectSettings.upsert({
                    where: { project_id_key: { project_id: projectId, key: 'atoma_files_payload' } },
                    update: { value: normalizedPayloadValue },
                    create: {
                        project_id: projectId,
                        key: 'atoma_files_payload',
                        value: normalizedPayloadValue
                    }
                });
            }
            else {
                await tx.projectSettings.deleteMany({
                    where: { project_id: projectId, key: 'atoma_files_payload' }
                });
            }
        });
        const refreshed = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['atoma_files_description', 'atoma_files_payload'] }
            }
        });
        const savedDescription = refreshed.find((setting) => setting.key === 'atoma_files_description')?.value || '';
        const savedPayloadValue = refreshed.find((setting) => setting.key === 'atoma_files_payload')?.value || '';
        const savedPayload = safeJsonParse(savedPayloadValue);
        const updatedAt = refreshed
            .map((setting) => setting.updated_at)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
        return {
            description: savedDescription,
            payload: savedPayload,
            payload_text: savedPayloadValue ? (savedPayload !== null ? formatJson(savedPayload) : savedPayloadValue) : '',
            updated_at: updatedAt
        };
    });
    fastify.get('/api/settings/skill-connections', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } }
        });
        if (!setting?.value) {
            return [];
        }
        try {
            const parsed = JSON.parse(setting.value);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (error) {
            console.error('Failed to parse llm_skill_connections', error);
            return [];
        }
    });
    fastify.put('/api/settings/skill-connections', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { connections } = request.body;
        if (!Array.isArray(connections)) {
            return reply.code(400).send({ error: 'connections must be an array' });
        }
        const normalized = connections.map((connection, index) => {
            if (!connection?.name || !connection?.provider || !connection?.model) {
                throw new Error(`connections[${index}] must include name, provider and model`);
            }
            return {
                id: String(connection.id || `skill-connection-${index + 1}`),
                name: String(connection.name).trim(),
                provider: String(connection.provider).trim(),
                model: String(connection.model).trim(),
                providerKeyId: typeof connection.providerKeyId === 'number' ? connection.providerKeyId : null,
                endpointType: String(connection.endpointType || 'native').trim(),
                skillMode: String(connection.skillMode || 'native_skills').trim(),
                enabledSkills: Array.isArray(connection.enabledSkills)
                    ? connection.enabledSkills.map((skill) => String(skill).trim()).filter(Boolean)
                    : [],
                systemPrompt: String(connection.systemPrompt || ''),
                notes: String(connection.notes || ''),
                enabled: connection.enabled !== false,
                supportsSkills: connection.supportsSkills !== false
            };
        });
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } },
            update: { value: JSON.stringify(normalized) },
            create: {
                project_id: projectId,
                key: 'llm_skill_connections',
                value: JSON.stringify(normalized)
            }
        });
        return normalized;
    });
    // Model Fetching
    fastify.get('/api/settings/models', async (request, reply) => {
        const projectId = request.projectId;
        const { provider, keyId, key } = request.query;
        let apiKey = key;
        let detectedProvider = provider || 'Unknown';
        // If keyId is provided, fetch from DB
        if (keyId) {
            const storedKey = await prisma.providerKey.findFirst({
                where: { id: parseInt(keyId), project_id: projectId }
            });
            if (storedKey) {
                apiKey = storedKey.key;
                detectedProvider = storedKey.provider;
            }
        }
        if (!apiKey)
            return reply.code(400).send({ error: 'API Key required' });
        // Auto-detect provider if missing
        if (!detectedProvider || detectedProvider === 'Unknown') {
            if (apiKey.startsWith('sk-ant'))
                detectedProvider = 'Anthropic';
            else if (apiKey.startsWith('AIza'))
                detectedProvider = 'Gemini';
            else if (apiKey.startsWith('sk-'))
                detectedProvider = 'OpenAI';
        }
        const models = await model_service_1.default.fetchModels(detectedProvider, apiKey);
        return { models };
    });
    // ==========================================
    // V2 Orchestrator Routes
    // ==========================================
    fastify.get('/api/v2/weeks', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const weeks = await prisma.weekPackage.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { content_items: true } } }
        });
        return weeks;
    });
    fastify.get('/api/v2/weeks/:id', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        let week = await prisma.weekPackage.findUnique({
            where: { id: parseInt(id), project_id: projectId },
            include: {
                content_items: {
                    orderBy: { schedule_at: 'asc' }
                }
            }
        });
        if (!week) {
            // Check if it is a V1 week ID
            const v1Week = await prisma.week.findFirst({
                where: { id: parseInt(id), project_id: projectId }
            });
            if (v1Week) {
                // Find matching V2 week package using range overlap
                const matchingWeekPackage = await prisma.weekPackage.findFirst({
                    where: {
                        project_id: projectId,
                        week_start: {
                            gte: v1Week.week_start,
                            lte: v1Week.week_end
                        }
                    },
                    include: {
                        content_items: {
                            orderBy: { schedule_at: 'asc' }
                        }
                    }
                });
                if (matchingWeekPackage) {
                    week = matchingWeekPackage;
                }
            }
        }
        if (!week)
            return reply.code(404).send({ error: 'V2 WeekPackage not found' });
        return week;
    });
    fastify.post('/api/v2/weeks/:id/convert-to-v1', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        try {
            const result = await planner_service_1.default.convertWeekPackageToV1(projectId, parseInt(id));
            (0, egress_diagnostics_1.logEgressDiagnostic)('weeks.convert_to_v1', {
                projectId,
                weekPackageId: parseInt(id),
                weekId: result.weekId,
                reused: result.reused
            });
            return {
                success: true,
                message: result.reused ? 'V1 Week already exists for these dates.' : 'V1 Week created successfully.',
                weekId: result.weekId
            };
        }
        catch (error) {
            if (error.message === 'V2 WeekPackage not found') {
                return reply.code(404).send({ error: error.message });
            }
            return reply.code(400).send({ error: error.message });
        }
    });
    fastify.post('/api/v2/plan-week', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { themeHint, startDate } = request.body;
        // Determine next Monday if not provided
        let weekStart = new Date();
        if (startDate) {
            weekStart = new Date(startDate);
        }
        else {
            const dayOfWeek = weekStart.getDay();
            const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
            weekStart.setDate(weekStart.getDate() + daysUntilNextMonday);
        }
        weekStart.setUTCHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setUTCHours(23, 59, 59, 999);
        try {
            // 1. SMO
            const wp = await v2_orchestrator_service_1.default.planWeek(projectId, weekStart, weekEnd, themeHint || '');
            // 2. DA (Dynamic split from MTA/SMO)
            await v2_orchestrator_service_1.default.architectDistribution(wp.id);
            // 3. NCC
            const validation = await v2_orchestrator_service_1.default.validateContinuity(wp.id);
            if (!validation.valid) {
                console.warn(`[NCC] Validation failed for WP ${wp.id}: ${validation.critique}`);
                // Save risks back or handle
            }
            return { success: true, weekPackageId: wp.id, validation };
        }
        catch (e) {
            console.error('[API] Error in V2 plan-week:', e);
            reply.code(500).send({ error: 'Failed to complete V2 planning', details: e.message });
        }
    });
    fastify.post('/api/v2/approve-week/:id', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const wp = await prisma.weekPackage.findUnique({ where: { id: parseInt(id), project_id: projectId } });
        if (!wp)
            return reply.code(404).send({ error: 'WeekPackage not found' });
        const updated = await prisma.weekPackage.update({
            where: { id: wp.id },
            data: { approval_status: 'approved' }
        });
        return { success: true, status: updated.approval_status };
    });
    fastify.post('/api/v2/architect-week/:id', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        try {
            const items = await v2_orchestrator_service_1.default.architectDistribution(parseInt(id));
            return { success: true, count: items.length };
        }
        catch (e) {
            reply.code(500).send({ error: e.message || 'Failed to architect week' });
        }
    });
    fastify.post('/api/v2/plan-quarter', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { goalHint, startDate, plannedChannels } = request.body;
        const dStart = startDate ? new Date(startDate) : new Date();
        try {
            const result = await v2_orchestrator_service_1.default.planQuarter(projectId, dStart, goalHint, plannedChannels);
            // For MVP, immediately kick off Monthly Tactical Agents (MTA) for all 3 generated months
            for (const month of result.monthArcs) {
                await v2_orchestrator_service_1.default.planMonth(month.id);
            }
            return { success: true, quarterId: result.quarterPlan.id };
        }
        catch (e) {
            reply.code(500).send({ error: e.message || 'Failed to plan quarter' });
        }
    });
    fastify.get('/api/v2/quarters', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            include: {
                month_arcs: {
                    include: {
                        week_packages: true
                    }
                }
            }
        });
        return quarters;
    });
    fastify.post('/api/v2/factory-sweep', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        try {
            // Trigger the generator service script Logic asynchronously or await it here.
            // For MVP API, we do it inline and block or trigger child process.
            // Let's do a lightweight inline sweep for just 2 items to prevent timeout
            const itemsToProcess = await prisma.contentItem.findMany({
                where: {
                    project_id: projectId,
                    status: 'planned',
                    week_package: { approval_status: 'approved' }
                },
                take: 2 // Max 2 per api ping to avoid 504 timeouts
            });
            const results = [];
            for (const item of itemsToProcess) {
                try {
                    await generator_service_1.default.generateContentItemText(item.id);
                    results.push({ id: item.id, status: 'drafted' });
                }
                catch (e) {
                    await prisma.contentItem.update({ where: { id: item.id }, data: { status: 'failed' } });
                    results.push({ id: item.id, status: 'failed', error: e.message });
                }
            }
            return { processed: results.length, results };
        }
        catch (e) {
            reply.code(500).send({ error: 'Failed during factory sweep', details: e.message });
        }
    });
    // ─── Strategy Assistant Chat ─────────────────────────────────────────────
    const DEFAULT_STRATEGY_PROMPT = `Ты — Стратегический Ассистент по контенту.
Твоя задача: помогать автору выстроить эффективную контентную стратегию для его каналов.
Ты учитываешь:
- Разные платформы (Telegram, VK, YouTube и т.д.) и их специфику аудитории
- Принципы стабильного контентного потока (контент-план, ритм публикаций)
- Воронку прогрева: Awareness → Authority → Conversion
- Текущий квартальный план и месячные арки
Ты задаёшь уточняющие вопросы, предлагаешь конкретные решения и форматы постов.
Отвечай на русском языке. Будь кратким, конкретным и полезным.`;
    /**
     * GET the current system prompt for the strategy assistant.
     */
    fastify.get('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = request.projectId;
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        return {
            systemPrompt: setting?.value || DEFAULT_STRATEGY_PROMPT
        };
    });
    /**
     * PUT updated system prompt for the strategy assistant.
     */
    fastify.put('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = request.projectId;
        const { systemPrompt } = request.body;
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } },
            update: { value: systemPrompt },
            create: { project_id: projectId, key: 'strategy_assistant_prompt', value: systemPrompt }
        });
        return { success: true };
    });
    /**
     * POST a message to the strategy assistant. Accepts conversation history.
     * Body: { message: string; history: { role: 'user'|'assistant'; content: string }[] }
     */
    fastify.post('/api/v2/strategy-chat', async (request, reply) => {
        const projectId = request.projectId;
        const { message, history = [] } = request.body;
        if (!message?.trim())
            return reply.code(400).send({ error: 'Message is required' });
        // Load custom system prompt (or use default)
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        const systemPrompt = setting?.value || DEFAULT_STRATEGY_PROMPT;
        // Load current quarters for context
        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            take: 1,
            include: { month_arcs: true }
        });
        const contextStr = quarters.length > 0
            ? `\n\nТекущий квартальный план:\nЦель: ${quarters[0].strategic_goal}\nПилар: ${quarters[0].primary_pillar}\nМесяцы: ${quarters[0].month_arcs.map(m => m.arc_theme).join(', ')}`
            : '';
        const openai = new (require('openai').default)({ apiKey: process.env.OPENAI_API_KEY });
        const messages = [
            { role: 'system', content: systemPrompt + contextStr },
            ...history.slice(-10), // keep last 10 turns for context
            { role: 'user', content: message }
        ];
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages,
                max_tokens: 1000
            });
            const reply_text = completion.choices[0]?.message.content || '';
            return { reply: reply_text };
        }
        catch (e) {
            reply.code(500).send({ error: e.message || 'AI request failed' });
        }
    });
}
