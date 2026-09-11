import { createHash } from 'crypto';
import prisma from '../db';
import parserClient from './parser_client';

type JsonObject = Record<string, any>;

export interface OrganizationSearchParams {
    organizationId: number;
    userId: number;
    actorId: string;
    query: string;
    sources: string[];
    projectScope: { mode: 'all_active' | 'selected'; projectIds?: number[] };
    idempotencyKey: string;
    filters?: JsonObject;
    waitMs?: number;
}

export interface RouteSignalParams {
    organizationId: number;
    userId: number;
    actorId: string;
    signalId: number;
    projectId: number;
    assessmentRevision: number;
    decision: 'routed' | 'dismissed';
    note?: string;
    idempotencyKey: string;
}

export interface PromoteSignalParams {
    projectId: number;
    userId: number;
    actorId: string;
    routeId: number;
    target: 'initiative' | 'research_task' | 'publication_theme';
    title?: string;
    brief?: string;
    idempotencyKey: string;
}

interface NormalizedSignal {
    source_type: string;
    provider_object_id: string | null;
    canonical_url: string;
    normalized_url_hash: string;
    title: string;
    excerpt: string;
    author_identity: string | null;
    source_published_at: Date | null;
    observed_at: Date;
    snapshot_hash: string;
    metadata: JsonObject;
}

interface AdapterOutcome {
    source: string;
    status: 'completed' | 'failed';
    signals: NormalizedSignal[];
    error_code?: string;
    retryable?: boolean;
}

const db = prisma as any;
const SUGGESTED_THRESHOLD = 60;

function stableJson(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (typeof value === 'object') {
        return `{${Object.entries(value as JsonObject)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function normalizeQuery(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeUrl(value: string): string {
    try {
        const url = new URL(value);
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
        }
        url.hostname = url.hostname.toLocaleLowerCase();
        url.pathname = url.pathname.replace(/\/+$/, '') || '/';
        return url.toString();
    } catch {
        return value.trim();
    }
}

function boundedText(value: unknown, max: number): string {
    return String(value || '').trim().slice(0, max);
}

function parseDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSignal(raw: JsonObject, requestedSource: string): NormalizedSignal {
    const sourceType = boundedText(raw.source || raw.source_type || requestedSource, 80);
    const canonicalUrl = normalizeUrl(boundedText(raw.canonical_url || raw.url, 2048));
    if (!canonicalUrl) throw new Error('[INVALID_SOURCE_SIGNAL] canonical_url is required');
    const title = boundedText(raw.title, 500);
    const excerpt = boundedText(raw.excerpt || raw.snapshot, 4000);
    const observedAt = parseDate(raw.observed_at) || new Date();
    const providerId = boundedText(raw.provider_object_id, 500) || null;
    const snapshotMaterial = stableJson({ sourceType, providerId, canonicalUrl, title, excerpt });
    return {
        source_type: sourceType,
        provider_object_id: providerId,
        canonical_url: canonicalUrl,
        normalized_url_hash: sha256(canonicalUrl),
        title,
        excerpt,
        author_identity: boundedText(raw.author_identity || raw.author, 500) || null,
        source_published_at: parseDate(raw.source_published_at || raw.published_at),
        observed_at: observedAt,
        snapshot_hash: sha256(snapshotMaterial),
        metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    };
}

/**
 * Deterministic adapter is deliberately unavailable unless explicitly selected.
 * Its response is an inert fixture and all returned prose remains untrusted input.
 */
function runDeterministicAdapter(source: string): AdapterOutcome {
    if (process.env.ORGANIZATION_RESEARCH_ADAPTER_MODE !== 'deterministic_test') {
        return { source, status: 'failed', signals: [], error_code: 'SOURCE_ADAPTER_NOT_CONFIGURED', retryable: false };
    }
    let fixture: JsonObject;
    try {
        fixture = JSON.parse(process.env.ORGANIZATION_RESEARCH_TEST_RESPONSE || '{}');
    } catch {
        return { source, status: 'failed', signals: [], error_code: 'INVALID_TEST_ADAPTER_RESPONSE', retryable: false };
    }
    const configuredFailure = (fixture.failures || {})[source];
    if (configuredFailure) {
        return {
            source,
            status: 'failed',
            signals: [],
            error_code: boundedText(configuredFailure.error_code || configuredFailure, 120),
            retryable: configuredFailure.retryable !== false,
        };
    }
    const sourceSignals = Array.isArray(fixture.signals)
        ? fixture.signals.filter((entry: JsonObject) => String(entry.source || entry.source_type) === source)
        : [];
    return { source, status: 'completed', signals: sourceSignals.map((entry: JsonObject) => normalizeSignal(entry, source)) };
}

async function runProductionAdapter(params: { organizationId: number; source: string; query: string; idempotencyKey: string; waitMs?: number }): Promise<AdapterOutcome> {
    if (!process.env.PARSER_API_BASE_URL) return { source: params.source, status: 'failed', signals: [], error_code: 'SOURCE_ADAPTER_NOT_CONFIGURED', retryable: false };
    try {
        const queued = await parserClient.createOrganizationSearchJob({
            organizationId: params.organizationId, source: params.source as 'reddit' | 'indie_hackers', query: params.query,
            idempotencyKey: `${params.idempotencyKey}:${params.source}`, limit: 25, includeComments: true, enrich: true,
        });
        const deadline = Date.now() + Math.max(0, params.waitMs ?? 10000);
        let view: JsonObject = queued;
        while (queued?.job_id && Date.now() <= deadline) {
            view = await parserClient.getOrganizationSearchJob(params.organizationId, queued.job_id);
            const state = String(view?.latest_run?.status || view?.status || '').toLowerCase();
            if (['completed', 'failed', 'partial', 'succeeded'].includes(state)) break;
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
        const state = String(view?.latest_run?.status || view?.status || '').toLowerCase();
        const items = Array.isArray(view?.results?.items) ? view.results.items : [];
        if (!['completed', 'partial', 'succeeded'].includes(state)) {
            return { source: params.source, status: 'failed', signals: [], error_code: state === 'failed' ? (view?.latest_run?.error_code || 'SOURCE_FAILED') : 'SOURCE_PENDING', retryable: true };
        }
        return {
            source: params.source, status: state === 'partial' ? 'failed' : 'completed',
            signals: items.map((item: JsonObject) => normalizeSignal({
                source: params.source,
                provider_object_id: item.reddit_post_id || item.provider_object_id || item.post_id || item.id,
                canonical_url: item.url || item.permalink || item.canonical_url,
                title: item.title || item.headline,
                excerpt: item.body || item.selftext || item.content || item.text || item.snippet,
                author_identity: item.author || item.author_name,
                source_published_at: item.created_at || item.published_at,
                metadata: { score: item.score ?? null, comments_count: item.comments_count ?? item.num_comments ?? null, community: item.subreddit || item.community || null }
            }, params.source)),
            ...(state === 'partial' ? { error_code: view?.latest_run?.error_code || 'SOURCE_PARTIAL', retryable: true } : {})
        };
    } catch (error: any) {
        return { source: params.source, status: 'failed', signals: [], error_code: /timed out/i.test(error?.message || '') ? 'SOURCE_TIMEOUT' : 'SOURCE_REQUEST_FAILED', retryable: true };
    }
}

async function runSourceAdapter(params: { organizationId: number; source: string; query: string; idempotencyKey: string; waitMs?: number }) {
    return process.env.ORGANIZATION_RESEARCH_ADAPTER_MODE === 'deterministic_test'
        ? runDeterministicAdapter(params.source)
        : runProductionAdapter(params);
}

function words(value: unknown): Set<string> {
    const tokens = stableJson(value).toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    return new Set(tokens);
}

function assess(signal: NormalizedSignal, profile: JsonObject): { score: number; reasons: string[]; dimensions: JsonObject; risks: string[] } {
    const signalWords = words(`${signal.title} ${signal.excerpt}`);
    const groups: Array<[string, unknown, number]> = [
        ['problems', profile.problems, 35],
        ['themes', profile.themes, 30],
        ['audience', profile.audience, 20],
        ['products', profile.products, 10],
        ['competitors', profile.competitors, 5],
    ];
    let score = 0;
    const reasons: string[] = [];
    const dimensions: JsonObject = {};
    for (const [name, value, weight] of groups) {
        const candidates = words(value || []);
        const matches = [...candidates].filter((token) => signalWords.has(token));
        dimensions[name] = matches;
        if (matches.length) {
            score += Math.min(weight, Math.ceil((matches.length / Math.max(1, candidates.size)) * weight));
            reasons.push(`${name}: ${matches.slice(0, 5).join(', ')}`);
        }
    }
    const excluded = [...words(profile.exclude_terms || [])].filter((token) => signalWords.has(token));
    if (excluded.length) score = Math.max(0, score - 40);
    const risks = excluded.length ? [`Excluded terms matched: ${excluded.join(', ')}`] : [];
    return { score: Math.min(100, score), reasons, dimensions, risks };
}

export class OrganizationIntelligenceService {
    private async requireOrganizationMember(organizationId: number, userId: number, roles?: string[]): Promise<JsonObject> {
        const member = await db.organizationMember.findUnique({
            where: { organization_id_user_id: { organization_id: organizationId, user_id: userId } },
        });
        if (!member || (roles && !roles.includes(member.role))) {
            throw new Error('[Security] Organization access required');
        }
        return member;
    }

    private async requireProjectRole(projectId: number, userId: number, roles: string[]): Promise<JsonObject> {
        const member = await db.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: userId } },
        });
        if (!member || !roles.includes(member.role)) throw new Error('[Security] Project owner or editor access required');
        return member;
    }

    async getContext(params: { organizationId: number; userId: number }): Promise<JsonObject> {
        const member = await this.requireOrganizationMember(params.organizationId, params.userId);
        const organization = await db.organization.findUnique({
            where: { id: params.organizationId },
            include: {
                projects: { where: { is_archived: false }, include: { research_profile: true } },
                research_connections: true,
            },
        });
        if (!organization || organization.is_archived) throw new Error('[ORGANIZATION_NOT_FOUND] Organization is unavailable');
        const routedCounts = await db.projectSignalRoute.groupBy({
            by: ['project_id'], where: { signal: { organization_id: params.organizationId }, state: 'routed' }, _count: { _all: true },
        });
        return {
            organization: { id: organization.id, name: organization.name, slug: organization.slug },
            role: member.role,
            capabilities: member.role === 'owner' ? ['read', 'search', 'route', 'configure_sources'] : member.role === 'researcher' ? ['read', 'search', 'route'] : ['read'],
            projects: organization.projects.map((project: JsonObject) => ({
                id: project.id, name: project.name, slug: project.slug,
                profile_revision: project.research_profile?.revision || null,
                research_profile: project.research_profile ? {
                    audience: project.research_profile.audience, problems: project.research_profile.problems,
                    themes: project.research_profile.themes, products: project.research_profile.products,
                    competitors: project.research_profile.competitors, include_terms: project.research_profile.include_terms,
                    exclude_terms: project.research_profile.exclude_terms, languages: project.research_profile.languages,
                    geographies: project.research_profile.geographies,
                } : null,
                inbox_count: routedCounts.find((entry: JsonObject) => entry.project_id === project.id)?._count?._all || 0,
            })),
            sources: organization.research_connections.map((connection: JsonObject) => ({
                id: connection.id, source_type: connection.source_type, name: connection.name,
                capabilities: connection.capabilities, is_active: connection.is_active,
                last_verified_at: connection.last_verified_at, last_error_code: connection.last_error_code,
            })),
        };
    }

    async search(params: OrganizationSearchParams): Promise<JsonObject> {
        await this.requireOrganizationMember(params.organizationId, params.userId, ['owner', 'researcher']);
        if (!params.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED] idempotencyKey is required');
        if (!params.query?.trim()) throw new Error('[INVALID_QUERY] query is required');
        const sources = [...new Set((params.sources || []).map(String).filter(Boolean))];
        if (!sources.length) throw new Error('[INVALID_SOURCES] at least one source is required');
        const requestHash = sha256(stableJson({ query: normalizeQuery(params.query), sources: [...sources].sort(), projectScope: params.projectScope, filters: params.filters || {} }));

        const replay = await db.researchRun.findFirst({
            where: { organization_id: params.organizationId, actor_id: params.actorId, idempotency_key: params.idempotencyKey },
        });
        if (replay) {
            const replayHash = sha256(stableJson({
                query: replay.normalized_query,
                sources: [...replay.requested_sources].sort(),
                projectScope: replay.project_scope_snapshot,
                filters: replay.adapter_versions?.request_filters || {},
            }));
            if (replayHash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT] idempotency key was used with another request');
            return this.getRun({ organizationId: params.organizationId, userId: params.userId, researchRunId: replay.id });
        }

        const projects = await db.project.findMany({
            where: {
                organization_id: params.organizationId,
                is_archived: false,
                ...(params.projectScope.mode === 'selected' ? { id: { in: params.projectScope.projectIds || [] } } : {}),
            },
            include: { research_profile: true },
        });
        if (params.projectScope.mode === 'selected' && projects.length !== new Set(params.projectScope.projectIds || []).size) {
            throw new Error('[INVALID_PROJECT_SCOPE] One or more projects are outside the active organization scope');
        }

        let run: JsonObject;
        try {
            run = await db.researchRun.create({ data: {
                organization_id: params.organizationId, actor_id: params.actorId,
                query: params.query.trim(), normalized_query: normalizeQuery(params.query), requested_sources: sources,
                project_scope_snapshot: params.projectScope, status: 'running', source_outcomes: [],
                idempotency_key: params.idempotencyKey,
                adapter_versions: { deterministic_test: '1', request_filters: params.filters || {} }, started_at: new Date(),
            } });
        } catch (error: any) {
            // The unique key is the concurrency claim: only its winner may fan out to adapters.
            if (error?.code !== 'P2002') throw error;
            const concurrent = await db.researchRun.findFirst({ where: {
                organization_id: params.organizationId, actor_id: params.actorId, idempotency_key: params.idempotencyKey,
            } });
            if (!concurrent) throw error;
            return this.getRun({ organizationId: params.organizationId, userId: params.userId, researchRunId: concurrent.id });
        }

        try {
            const outcomes = await Promise.all(sources.map((source) => runSourceAdapter({
                organizationId: params.organizationId, source, query: params.query,
                idempotencyKey: params.idempotencyKey, waitMs: params.waitMs,
            })));
            const fetched = outcomes.reduce((sum, outcome) => sum + outcome.signals.length, 0);
            const signals: JsonObject[] = [];
            for (const outcome of outcomes) {
                for (const candidate of outcome.signals) {
                    const identityWhere = candidate.provider_object_id
                        ? { organization_id_source_type_provider_object_id: { organization_id: params.organizationId, source_type: candidate.source_type, provider_object_id: candidate.provider_object_id } }
                        : { organization_id_source_type_normalized_url_hash: { organization_id: params.organizationId, source_type: candidate.source_type, normalized_url_hash: candidate.normalized_url_hash } };
                    const signal = await db.sourceSignal.upsert({
                        where: identityWhere,
                        create: {
                            organization_id: params.organizationId,
                            source_type: candidate.source_type, provider_object_id: candidate.provider_object_id,
                            canonical_url: candidate.canonical_url, normalized_url_hash: candidate.normalized_url_hash,
                            title: candidate.title, excerpt: candidate.excerpt, author_identity: candidate.author_identity,
                            source_published_at: candidate.source_published_at,
                            provenance: { canonical_url: candidate.canonical_url, provider_object_id: candidate.provider_object_id, observed_at: candidate.observed_at },
                            snapshot_hash: candidate.snapshot_hash, normalized_metadata: candidate.metadata,
                            untrusted_external_content: true, first_observed_at: candidate.observed_at, last_observed_at: candidate.observed_at,
                        },
                        update: {
                            last_observed_at: candidate.observed_at, title: candidate.title, excerpt: candidate.excerpt,
                            snapshot_hash: candidate.snapshot_hash, normalized_metadata: candidate.metadata,
                        },
                    });
                    await db.researchRunSignal.upsert({
                        where: { research_run_id_signal_id: { research_run_id: run.id, signal_id: signal.id } },
                        create: { research_run_id: run.id, signal_id: signal.id }, update: {},
                    });
                    for (const project of projects) {
                        const profile = project.research_profile || { revision: 0 };
                        const fit = assess(candidate, profile);
                        await db.projectSignalAssessment.upsert({
                            where: { signal_id_project_id_profile_revision: { signal_id: signal.id, project_id: project.id, profile_revision: profile.revision || 0 } },
                            create: {
                                signal_id: signal.id, project_id: project.id,
                                profile_revision: profile.revision || 0, revision: 1, fit_score: fit.score,
                                reasons: fit.reasons, matched_dimensions: fit.dimensions, risks: fit.risks,
                                state: fit.score >= SUGGESTED_THRESHOLD ? 'suggested' : 'unrouted',
                                assessment_adapter: 'deterministic_lexical', assessment_version: '1',
                            }, update: {},
                        });
                    }
                    signals.push(signal);
                }
            }
            const failed = outcomes.filter((outcome) => outcome.status === 'failed').length;
            await db.researchRun.update({ where: { id: run.id }, data: {
                status: failed === 0 ? 'completed' : signals.length ? 'partial' : 'failed',
                source_outcomes: outcomes.map(({ signals: found, ...outcome }) => ({ ...outcome, fetched: found.length })),
                fetched_count: fetched, deduplicated_count: new Set(signals.map((signal) => signal.id)).size,
                assessed_count: signals.length * projects.length, completed_at: new Date(),
            } });
        } catch (error) {
            await db.researchRun.update({ where: { id: run.id }, data: { status: 'failed', completed_at: new Date() } });
            throw error;
        }
        return this.getRun({ organizationId: params.organizationId, userId: params.userId, researchRunId: run.id });
    }

    async getRun(params: { organizationId: number; userId: number; researchRunId: number }): Promise<JsonObject> {
        await this.requireOrganizationMember(params.organizationId, params.userId);
        const run = await db.researchRun.findFirst({
            where: { id: params.researchRunId, organization_id: params.organizationId },
            include: { signals: { orderBy: { signal_id: 'asc' }, include: { signal: { include: { assessments: { orderBy: { project_id: 'asc' } } } } } } },
        });
        if (!run) throw new Error('[RESEARCH_RUN_NOT_FOUND] Research run not found');
        const signals = run.signals.map((link: JsonObject) => ({
            id: link.signal.id, source_type: link.signal.source_type, provider_object_id: link.signal.provider_object_id,
            title: link.signal.title, excerpt: link.signal.excerpt,
            untrusted_external_content: true,
            provenance: { canonical_url: link.signal.canonical_url, snapshot_hash: link.signal.snapshot_hash, observed_at: link.signal.last_observed_at },
            project_assessments: link.signal.assessments.map((assessment: JsonObject) => ({
                id: assessment.id, project_id: assessment.project_id, revision: assessment.revision,
                profile_revision: assessment.profile_revision, fit_score: assessment.fit_score, reasons: assessment.reasons,
                matched_dimensions: assessment.matched_dimensions, risks: assessment.risks, state: assessment.state,
            })),
        }));
        return {
            research_run_id: run.id, status: run.status, source_outcomes: run.source_outcomes || [], signals,
            counts: {
                fetched: run.fetched_count || 0, deduplicated: run.deduplicated_count || signals.length,
                assessed: run.assessed_count || signals.reduce((sum: number, signal: JsonObject) => sum + signal.project_assessments.length, 0),
                routed: await db.projectSignalRoute.count({ where: { signal_id: { in: signals.map((signal: JsonObject) => signal.id) }, state: 'routed' } }),
            },
        };
    }

    async getResearchRun(params: { organizationId: number; userId: number; researchRunId: number }): Promise<JsonObject> {
        return this.getRun(params);
    }

    async routeSignal(params: RouteSignalParams): Promise<JsonObject> {
        await this.requireOrganizationMember(params.organizationId, params.userId, ['owner', 'researcher']);
        const existing = await db.projectSignalRoute.findFirst({ where: {
            project_id: params.projectId, actor_id: params.actorId, idempotency_key: params.idempotencyKey,
        } });
        if (existing) return this.routeView(existing);
        const existingSignalRoute = await db.projectSignalRoute.findFirst({ where: { signal_id: params.signalId, project_id: params.projectId } });
        if (existingSignalRoute) {
            if (existingSignalRoute.decision !== params.decision) throw new Error('[ROUTE_DECISION_CONFLICT] Signal already has another project decision');
            return this.routeView(existingSignalRoute);
        }
        const project = await db.project.findFirst({ where: { id: params.projectId, organization_id: params.organizationId, is_archived: false } });
        if (!project) throw new Error('[INVALID_PROJECT_SCOPE] Project is outside the active organization scope');
        const assessment = await db.projectSignalAssessment.findFirst({ where: {
            signal_id: params.signalId, project_id: params.projectId, revision: params.assessmentRevision,
            signal: { organization_id: params.organizationId },
        } });
        if (!assessment) throw new Error('[STALE_ASSESSMENT] Assessment revision is unavailable');
        const route = await db.projectSignalRoute.create({ data: {
            signal_id: params.signalId, project_id: params.projectId,
            assessment_id: assessment.id, assessment_revision: assessment.revision, decision: params.decision, state: params.decision,
            actor_id: params.actorId, note: params.note || null, idempotency_key: params.idempotencyKey,
        } });
        await db.projectSignalAssessment.update({ where: { id: assessment.id }, data: { state: params.decision } });
        return this.routeView(route);
    }

    private routeView(route: JsonObject): JsonObject {
        return { id: route.id, signal_id: route.signal_id, project_id: route.project_id, assessment_revision: route.assessment_revision, state: route.state };
    }

    async promoteSignal(params: PromoteSignalParams): Promise<JsonObject> {
        await this.requireProjectRole(params.projectId, params.userId, ['owner', 'editor']);
        const route = await db.projectSignalRoute.findFirst({
            where: { id: params.routeId, project_id: params.projectId, state: { in: ['routed', 'promoted'] } }, include: { signal: true },
        });
        if (!route) throw new Error('[SIGNAL_NOT_ROUTED] Signal must be routed before promotion');
        const title = boundedText(params.title || route.signal.title, 500);
        const externalKey = `intelligence-signal-${route.signal_id}-assessment-${route.assessment_revision}-${params.target}`;
        const artifactShape = params.target === 'publication_theme'
            ? { kind: 'publication', subtype: 'publication_theme', owner_role: 'editor' }
            : params.target === 'research_task'
                ? { kind: 'infrastructure', subtype: 'research_task', owner_role: 'researcher' }
                : { kind: 'infrastructure', subtype: 'research_signal', owner_role: 'owner' };
        const result = await db.$transaction(async (tx: any) => {
            const initiative = await tx.initiative.upsert({
                where: { project_id_external_key: { project_id: params.projectId, external_key: externalKey } },
                create: {
                    project_id: params.projectId, external_key: externalKey, ...artifactShape,
                    title, description: params.brief || `Source evidence: ${route.signal.canonical_url}`, status: 'planned',
                }, update: {},
            });
            const artifact = {
                id: initiative.id, type: params.target, title: initiative.title,
                provenance: { source_signal_id: route.signal_id, assessment_revision: route.assessment_revision, route_id: route.id },
            };
            if (route.state === 'promoted' && route.note?.includes(`promotion-key:${params.idempotencyKey}`)) return artifact;
            if (route.promoted_artifact_id && (route.promoted_artifact_type !== params.target || route.note?.includes(`promotion-key:${params.idempotencyKey}`) === false)) {
                throw new Error('[ALREADY_PROMOTED] Route was promoted by another command');
            }
            await tx.projectSignalRoute.update({ where: { id: route.id }, data: {
                promoted_artifact_type: params.target, promoted_artifact_id: initiative.id, promoted_at: new Date(),
                state: 'promoted',
                note: [route.note, `promotion-key:${params.idempotencyKey}`].filter(Boolean).join('\n'),
            } });
            return artifact;
        });
        return { artifact: result };
    }

    async reassessProject(params: { organizationId: number; projectId: number; userId: number; actorId: string }): Promise<JsonObject> {
        await this.requireOrganizationMember(params.organizationId, params.userId);
        await this.requireProjectRole(params.projectId, params.userId, ['owner', 'editor']);
        const project = await db.project.findFirst({ where: { id: params.projectId, organization_id: params.organizationId }, include: { research_profile: true } });
        if (!project?.research_profile) throw new Error('[RESEARCH_PROFILE_REQUIRED] Project research profile is required');
        const signals = await db.sourceSignal.findMany({ where: { organization_id: params.organizationId } });
        let created = 0;
        for (const signal of signals) {
            const candidate = normalizeSignal(signal, signal.source_type);
            const fit = assess(candidate, project.research_profile);
            const prior = await db.projectSignalAssessment.findFirst({ where: { signal_id: signal.id, project_id: params.projectId }, orderBy: { revision: 'desc' } });
            await db.projectSignalAssessment.create({ data: {
                signal_id: signal.id, project_id: params.projectId,
                profile_revision: project.research_profile.revision, revision: (prior?.revision || 0) + 1,
                fit_score: fit.score, reasons: fit.reasons, matched_dimensions: fit.dimensions, risks: fit.risks,
                state: fit.score >= SUGGESTED_THRESHOLD ? 'suggested' : 'unrouted',
                assessment_adapter: 'deterministic_lexical', assessment_version: '1',
            } });
            created += 1;
        }
        return { project_id: params.projectId, profile_revision: project.research_profile.revision, assessments_created: created, source_fetches: 0 };
    }
}

export const organizationIntelligenceService = new OrganizationIntelligenceService();
export const organizationIntelligenceInternals = {
    normalizeQuery,
    normalizeUrl,
    normalizeSignal,
    assess,
    runDeterministicAdapter,
    runProductionAdapter,
};
export default organizationIntelligenceService;
