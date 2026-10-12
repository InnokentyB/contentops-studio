import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const TASK1091_TDPD_ADAPTATION_KEY =
    'adapt-p10-task1091-kun-chen-tdpd-20261012-v1';
export const TASK1091_TDPD_MANIFEST_CHECKSUM =
    'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b';
export const TASK1091_PREVIOUS_BODY_SHA256 =
    'd4301764ab75882e461178972ce2958533e4d36d175e0bd94fccc3aaa91786c1';

const COMMAND = 'ba_adapt_task1091_tdpd_source';
const SCHEDULE = '2026-10-13T17:30:00.000Z';
const PREVIOUS_TITLE = 'Portfolio OS #2 — Я устал напоминать агентам, что мы вообще решили';
const NEXT_TITLE = 'Kun Chen: агентские тесты не доказывают правильность. Что это меняет для TDPD';
const PUBLICATION_KEY = 'PORTFOLIO-OS-PERSONAL-TG-20261013-01';
const SOURCE_PACKAGE_KEY = 'W42-SP-PODMASTERIE-TDPD';
const PREVIOUS_PACKAGE_KEY = 'W42-SP-CONTENTOPS-PORTFOLIO-OS';
const WRITE_DEDUPE_KEY = 'content-write:1091:source-adaptation:311:20261012';
const X_SOURCE_URL = 'https://x.com/kunchenguid/status/2108030810691629403';
const X_REPLY_URL = 'https://x.com/kunchenguid/status/2108055737188671760';
const TDPD_CANONICAL = '/Users/innokentyb/Documents/Product/VibeAnalitics/tdpd-canonical.md';

const PREVIOUS_SOURCE_PACKAGE_DESCRIPTION =
    'Basis: owner-authorized limited beta plan and provided registration-flow, README, '
    + 'legal-data-analytics, landing-copy-ru, communications-ru and beta-application.schema.json. '
    + 'Evidence payload: application-gated free access, explicit feedback commitment, documentation '
    + 'and feedback loop; beta is planned, not claimed launched. Supports max 4 native outputs.';

const SOURCE_PACKAGE_DESCRIPTION =
    'Basis: owner-authorized limited beta plan and provided registration-flow, README, '
    + 'legal-data-analytics, landing-copy-ru, communications-ru and beta-application.schema.json. '
    + 'Evidence payload: application-gated free access, explicit feedback commitment, documentation '
    + 'and feedback loop; beta is planned, not claimed launched. Added owner-authorized review source: '
    + `Kun Chen X ${X_SOURCE_URL} and clarification ${X_REPLY_URL}, read against the canonical `
    + `TDPD definition at ${TDPD_CANONICAL}. Claim limits: the cited DeepSWE result concerns `
    + 'autonomously written unit/integration tests; it does not evaluate E2E and does not validate '
    + 'TDPD. Supports max 4 native outputs.';

const NEXT_BRIEF = `Series: TDPD / Подмастерье аналитика, personal Telegram @spherical_analyst.
Source package: initiative #311 ${SOURCE_PACKAGE_KEY}. This adaptation replaces the planned Portfolio OS topic from source package #313 while preserving its accepted revision 2 as history only.
Demand stage: expert interpretation of current agent-development evidence.
Audience: analysts, product leaders and engineers defining acceptance for AI coding agents.
Topic: what Kun Chen's DeepSWE observation about autonomous agent-written tests does and does not change for TDPD.
Primary source: ${X_SOURCE_URL}. The author reports that, on the cited Sonnet 5.5 High DeepSWE evaluation, allowing autonomously written unit/integration tests did not improve success; banning new tests slightly increased success without statistical significance and reduced time/token use with statistical significance. Treat these as the source author's reported results, not an independently reproduced AnalystCraft result.
Clarification source: ${X_REPLY_URL}. The author explicitly says the conclusion is not “write no tests”: human guidance may change the value of tests, and E2E tests were outside this analysis.
Canonical comparison: ${TDPD_CANONICAL}. TDPD turns human-agreed user scenarios into executable E2E checks before implementation, keeps architecture decisions at the input, and retains human UAT at the output. TDPD is not unit-test-first TDD and must not be presented as validated by the cited benchmark.
Angle: the useful boundary is authority over expected behaviour. When the same agent invents both implementation and its checks, both may repeat one interpretation. A TDPD check earns authority from an agreed scenario, Context Baseline and human acceptance boundary; this is a methodological response, not proof that every E2E test is correct.
Structure: state the source claim precisely → preserve the author's E2E exclusion → compare it with the TDPD acceptance chain → name where tests can still fail → give one practical review question before an agent starts coding.
Evidence limits: no claim that unit or integration tests are universally useless; no claim that DeepSWE measured TDPD, E2E value, production reliability or long-term regression protection; no invented benchmark numbers beyond the source wording; distinguish reported evidence from interpretation.
Voice: first-person founder-practitioner review in Russian. Explain terms in plain language; avoid culture-war framing about TDD.
CTA: ask who has authority to define and change the acceptance check when an agent writes the implementation.
Editorial gates: Content Writer creates a new revision from this brief. Chief Editor runs anti-slop, source fidelity, TDD/TDPD distinction and same-profile duplicate checks. Art Director makes a fresh revision-bound decision after acceptance.
Publication mode: approval_required. No release or publication is authorized by this adaptation.
Measurement after a confirmed fact: substantive replies about test authority, scenario ownership and E2E boundaries at T+24h/T+7d.`;

export type Task1091TdpdAdaptationArgs = {
    projectId: 10;
    taskId: 1091;
    initiativeId: 291;
    sourcePackageId: 311;
    previousSourcePackageId: 313;
    actorId: string;
    expectedManifestChecksum: typeof TASK1091_TDPD_MANIFEST_CHECKSUM;
    expectedContentRevision: 2;
    expectedAcceptedRevision: 2;
    expectedBodySha256: typeof TASK1091_PREVIOUS_BODY_SHA256;
    expectedChannelId: 108;
    expectedScheduleAt: typeof SCHEDULE;
    expectedTitle: typeof PREVIOUS_TITLE;
    idempotencyKey: typeof TASK1091_TDPD_ADAPTATION_KEY;
    authorizationReference: string;
    confirm: boolean;
};

type Dependencies = {
    database: typeof prisma;
    manifestLoader(projectId: number, userId: number): Promise<{ checksum: string }>;
    now(): Date;
};

const dependencies: Dependencies = {
    database: prisma,
    manifestLoader: loadAgentWorkspaceManifest,
    now: () => new Date()
};

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function hashRequest(args: Task1091TdpdAdaptationArgs): string {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function assertArgs(args: Task1091TdpdAdaptationArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1091 || args.initiativeId !== 291
        || args.sourcePackageId !== 311 || args.previousSourcePackageId !== 313
        || args.expectedManifestChecksum !== TASK1091_TDPD_MANIFEST_CHECKSUM
        || args.expectedContentRevision !== 2 || args.expectedAcceptedRevision !== 2
        || args.expectedBodySha256 !== TASK1091_PREVIOUS_BODY_SHA256
        || args.expectedChannelId !== 108 || args.expectedScheduleAt !== SCHEDULE
        || args.expectedTitle !== PREVIOUS_TITLE
        || args.idempotencyKey !== TASK1091_TDPD_ADAPTATION_KEY
        || !args.authorizationReference.trim()) {
        throw new Error('[TASK1091_TDPD_ADAPTATION_SCOPE_MISMATCH]');
    }
    return Number(actor[1]);
}

async function loadState(database: typeof prisma) {
    const [project, task, initiative, sourcePackage, previousPackage, attempts, releases,
        sourceLink, previousLink, sourceOutputCount, dayChannelSlotCount] = await Promise.all([
        database.project.findUnique({ where: { id: 10 } }),
        database.contentItem.findFirst({ where: { id: 1091, project_id: 10 },
            include: { publication_fact: true, work_items: { orderBy: { id: 'asc' } },
                art_direction_decisions: { orderBy: { id: 'asc' } } } }),
        database.initiative.findFirst({ where: { id: 291, project_id: 10 } }),
        database.initiative.findFirst({ where: { id: 311, project_id: 10 } }),
        database.initiative.findFirst({ where: { id: 313, project_id: 10 } }),
        database.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1091 } }),
        database.workflowEvent.count({ where: { project_id: 10, content_item_id: 1091,
            command: { contains: 'release' } } }),
        database.initiativeDependency.findUnique({ where: {
            from_initiative_id_to_initiative_id_type: {
                from_initiative_id: 311, to_initiative_id: 291, type: 'informs'
            }
        } }),
        database.initiativeDependency.findUnique({ where: {
            from_initiative_id_to_initiative_id_type: {
                from_initiative_id: 313, to_initiative_id: 291, type: 'informs'
            }
        } }),
        database.initiativeDependency.count({ where: {
            project_id: 10, from_initiative_id: 311, type: 'informs'
        } }),
        database.contentItem.count({ where: { project_id: 10, channel_id: 108,
            schedule_at: { gte: new Date('2026-10-13T00:00:00.000Z'),
                lt: new Date('2026-10-14T00:00:00.000Z') },
            status: { notIn: ['cancelled', 'published'] } } })
    ]);
    const activeArt = task?.art_direction_decisions.find(decision => decision.status === 'active');
    if (!project || project.slug !== 'analystcraft-2' || !task || !initiative || !sourcePackage
        || !previousPackage || task.title !== PREVIOUS_TITLE || task.item_key !== PUBLICATION_KEY
        || task.status !== 'ready_for_execution' || task.content_revision !== 2
        || task.accepted_revision !== 2 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex')
            !== TASK1091_PREVIOUS_BODY_SHA256
        || task.channel_id !== 108 || task.schedule_at?.toISOString() !== SCHEDULE
        || task.publish_at?.toISOString() !== SCHEDULE || task.publication_mode !== 'approval_required'
        || task.visual_state !== 'NO_VISUAL_NEEDED' || task.handoff_state !== 'ready'
        || task.selected_asset_id !== null || task.publication_fact || task.published_link
        || attempts !== 0 || releases !== 0 || initiative.external_key !== PUBLICATION_KEY
        || initiative.title !== PREVIOUS_TITLE || initiative.dependencies_status !== 'none'
        || sourcePackage.external_key !== SOURCE_PACKAGE_KEY
        || sourcePackage.subtype !== 'source_package' || sourcePackage.status !== 'in_progress'
        || previousPackage.external_key !== PREVIOUS_PACKAGE_KEY
        || previousPackage.subtype !== 'source_package' || previousLink
        || sourcePackage.description !== PREVIOUS_SOURCE_PACKAGE_DESCRIPTION
        || sourceOutputCount !== 3 || dayChannelSlotCount !== 1
        || sourceLink || !activeArt || activeArt.id !== 302
        || activeArt.source_content_revision !== 2 || activeArt.decision !== 'NO_VISUAL_NEEDED') {
        throw new Error('[TASK1091_TDPD_ADAPTATION_GUARD_FAILED] Exact slot state changed');
    }
    return { task, initiative, sourcePackage, previousPackage, activeArt };
}

function preview(state: Awaited<ReturnType<typeof loadState>>) {
    return {
        project_id: 10,
        task_id: 1091,
        planner_initiative_id: 291,
        source_package_id: 311,
        previous_topic_source_package_id: 313,
        changed_fields: {
            title: { from: state.task.title, to: NEXT_TITLE },
            brief: { from: state.task.brief, to: NEXT_BRIEF },
            source_package: { from: PREVIOUS_PACKAGE_KEY, to: SOURCE_PACKAGE_KEY },
            text_state: { from: 'accepted', to: 'draft' },
            accepted_revision: { from: 2, to: null },
            visual_state: { from: 'NO_VISUAL_NEEDED', to: 'STALE' },
            handoff_state: { from: 'ready', to: 'blocked' },
            status: { from: 'ready_for_execution', to: 'planned' }
        },
        preserved: {
            channel_id: 108,
            channel_username: '@spherical_analyst',
            schedule_at: SCHEDULE,
            publication_mode: 'approval_required',
            historical_content_revision: 2,
            historical_body_sha256: TASK1091_PREVIOUS_BODY_SHA256,
            historical_art_decision_id: state.activeArt.id,
            publication_fact: null,
            delivery_attempt_count: 0,
            release_event_count: 0
        },
        next: { writer_revision: 3, content_write_state: 'available' },
        release_or_publish_performed: false
    };
}

/** Adapt the existing task1091 slot to the owner-selected TDPD source without publishing. */
export async function adaptTask1091TdpdSource(args: Task1091TdpdAdaptationArgs,
    deps: Dependencies = dependencies): Promise<Record<string, unknown>> {
    const userId = assertArgs(args);
    const requestHash = hashRequest(args);
    const [owner, manifest, existing] = await Promise.all([
        deps.database.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: 10, user_id: userId }
        } }),
        deps.manifestLoader(10, userId),
        deps.database.workflowEvent.findUnique({ where: {
            project_id_actor_id_command_idempotency_key: { project_id: 10,
                actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey }
        } })
    ]);
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== TASK1091_TDPD_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
    if (existing) {
        if (object(existing.before_state).request_hash !== requestHash) {
            throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
        }
        return { ...object(existing.after_state), audit_id: existing.id, replayed: true };
    }
    const current = await loadState(deps.database);
    const exactPreview = preview(current);
    if (!args.confirm) return { mode: 'preview', ...exactPreview };

    return deps.database.$transaction(async tx => {
        const [currentOwner, currentManifest, replay] = await Promise.all([
            tx.projectMember.findUnique({ where: {
                project_id_user_id: { project_id: 10, user_id: userId }
            } }),
            deps.manifestLoader(10, userId),
            tx.workflowEvent.findUnique({ where: {
                project_id_actor_id_command_idempotency_key: { project_id: 10,
                    actor_id: args.actorId, command: COMMAND,
                    idempotency_key: args.idempotencyKey }
            } })
        ]);
        if (currentOwner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        if (currentManifest.checksum !== TASK1091_TDPD_MANIFEST_CHECKSUM) {
            throw new Error('[STALE_MANIFEST]');
        }
        if (replay) {
            if (object(replay.before_state).request_hash !== requestHash) {
                throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
            }
            return { ...object(replay.after_state), audit_id: replay.id, replayed: true };
        }
        const state = await loadState(tx as typeof prisma);
        const quality = object(state.task.quality_report);
        const { handoff_bundle: _oldHandoff, ...qualityWithoutHandoff } = quality;
        const candidates = Array.isArray(quality.content_candidates)
            ? quality.content_candidates : [];
        const candidate = {
            content_revision: 2,
            accepted_revision: 2,
            body_sha256: TASK1091_PREVIOUS_BODY_SHA256,
            body: state.task.draft_text,
            title: state.task.title,
            brief: state.task.brief,
            status: 'superseded_by_owner_topic_change',
            preserved_at: deps.now().toISOString(),
            prior_topic_source_package: { id: 313, external_key: PREVIOUS_PACKAGE_KEY }
        };
        const nextQuality = {
            ...qualityWithoutHandoff,
            content_language: 'ru',
            content_candidates: [candidate, ...candidates].slice(0, 20),
            source_package_binding: { id: 311, external_key: SOURCE_PACKAGE_KEY,
                bound_by: args.actorId, authorization_reference: args.authorizationReference },
            topic_adaptation: { from_title: PREVIOUS_TITLE, to_title: NEXT_TITLE,
                adapted_at: deps.now().toISOString(), source_package_from: 313,
                source_package_to: 311 }
        };
        const sourceRefs = [
            { type: 'external_post', platform: 'x', author: 'Kun Chen', url: X_SOURCE_URL },
            { type: 'external_reply', platform: 'x', author: 'Kun Chen', url: X_REPLY_URL },
            { type: 'canonical_method', method: 'TDPD', path: TDPD_CANONICAL }
        ];
        const taskChanged = await tx.contentItem.updateMany({ where: {
            id: 1091, project_id: 10, title: PREVIOUS_TITLE, status: 'ready_for_execution',
            content_revision: 2, accepted_revision: 2, text_state: 'accepted', channel_id: 108,
            schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE),
            publication_mode: 'approval_required', selected_asset_id: null,
            publication_fact: null, published_link: null
        }, data: {
            title: NEXT_TITLE,
            brief: NEXT_BRIEF,
            key_points: Prisma.JsonNull,
            cta: 'Кто имеет право задавать и менять проверку результата, когда реализацию пишет агент?',
            assets: { ...object(state.task.assets), source_package_id: 311,
                source_package_key: SOURCE_PACKAGE_KEY,
                previous_topic_source_package_id: 313 } as Prisma.InputJsonValue,
            draft_text: null,
            text_state: 'draft',
            accepted_revision: null,
            visual_state: 'STALE',
            handoff_state: 'blocked',
            selected_asset_id: null,
            status: 'planned',
            quality_report: nextQuality as Prisma.InputJsonValue,
            source_refs: sourceRefs as Prisma.InputJsonValue
        } });
        if (taskChanged.count !== 1) throw new Error('[TASK1091_TDPD_ADAPTATION_CAS_CONFLICT]');
        await tx.artDirectionDecision.updateMany({ where: {
            project_id: 10, content_item_id: 1091, status: 'active'
        }, data: { status: 'stale' } });
        const initiativeChanged = await tx.initiative.updateMany({ where: {
            id: 291, project_id: 10, external_key: PUBLICATION_KEY, title: PREVIOUS_TITLE
        }, data: { title: NEXT_TITLE, description: NEXT_BRIEF,
            subtype: 'tdpd_e2e_review_personal_tg', dependencies_status: 'dependencies_unknown' } });
        if (initiativeChanged.count !== 1) {
            throw new Error('[TASK1091_TDPD_INITIATIVE_CAS_CONFLICT]');
        }
        const packageChanged = await tx.initiative.updateMany({ where: {
            id: 311, project_id: 10, external_key: SOURCE_PACKAGE_KEY,
            description: state.sourcePackage.description
        }, data: { description: SOURCE_PACKAGE_DESCRIPTION } });
        if (packageChanged.count !== 1) throw new Error('[TASK1091_TDPD_PACKAGE_CAS_CONFLICT]');
        const sourceLink = await tx.initiativeDependency.create({ data: {
            project_id: 10, from_initiative_id: 311, to_initiative_id: 291,
            type: 'informs',
            condition: 'Use the Kun Chen source, explicit E2E exclusion and canonical TDPD claim limits.',
            source: 'owner-authorized-task1091-topic-adaptation-20261012'
        } });
        const write = await tx.workItem.create({ data: {
            project_id: 10, initiative_id: 291, content_item_id: 1091,
            item_key: PUBLICATION_KEY, kind: 'content_write', state: 'available',
            assignee_role: 'content_writer', due_at: new Date(SCHEDULE),
            input_context_version: 2, result_version: 2, dedupe_key: WRITE_DEDUPE_KEY,
            note: 'Create revision 3 from the owner-selected Kun Chen / TDPD brief; revision 2 is history only.'
        } });
        const result = { mode: 'applied', ...preview(state), title: NEXT_TITLE,
            brief: NEXT_BRIEF, content_write_work_item_id: write.id,
            source_dependency_id: sourceLink.id, replayed: false };
        const beforeState = { request_hash: requestHash,
            authorization_reference: args.authorizationReference,
            title: state.task.title, brief: state.task.brief,
            content_revision: 2, accepted_revision: 2,
            body_sha256: TASK1091_PREVIOUS_BODY_SHA256,
            source_package_candidate: { id: 313, external_key: PREVIOUS_PACKAGE_KEY }
        } as Prisma.InputJsonValue;
        const audit = await tx.workflowEvent.create({ data: { project_id: 10,
            content_item_id: 1091, work_item_id: write.id, actor_id: args.actorId,
            command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: beforeState,
            after_state: result as Prisma.InputJsonValue } });
        return { ...result, audit_id: audit.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export const task1091TdpdAdaptationContract = {
    title: NEXT_TITLE,
    brief: NEXT_BRIEF,
    schedule: SCHEDULE,
    sourcePackageDescription: SOURCE_PACKAGE_DESCRIPTION
};
