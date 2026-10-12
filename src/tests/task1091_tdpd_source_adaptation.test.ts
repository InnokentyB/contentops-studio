import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adaptTask1091TdpdSource,
    TASK1091_PREVIOUS_BODY_SHA256,
    TASK1091_TDPD_ADAPTATION_KEY,
    TASK1091_TDPD_MANIFEST_CHECKSUM,
    task1091TdpdAdaptationContract
} from '../services/task1091_tdpd_source_adaptation.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const previousBody = `Я устал повторять агентам одно и то же решение

Не потому, что оно потерялось. Оно записано. Проблема в другом: следующая задача начинается в новом чате, а решение не становится обязательным входом для действия.

Например, мы уже выбрали канал, зафиксировали актуальную ревизию и определили, кто может менять план. Агент видит только часть контекста и уверенно продолжает работу: предлагает другой канал, принимает черновик за согласованный текст или пытается изменить план из роли, у которой нет такого права.

Раньше я снова пересказывал всё вручную. Теперь перед публикацией или изменением плана агент должен прочитать текущую запись о продукте, роли, канале и состоянии задачи. Если запись не даёт ответа, действие должно остановиться, а не достраиваться из истории разговора.

Это не решает проблему полностью. Реестр может отстать от внешней системы. Записанный маршрут не доказывает, что публикация действительно вышла. И наличие решения ещё не означает разрешение на действие.

Но для меня изменился сам вопрос. Вместо «как заставить агента помнить весь разговор?» я спрашиваю: «какую запись он обязан проверить перед следующим шагом и кто имеет право её изменить?»

Какое решение вы повторяете агенту не потому, что оно забыто, а потому, что не стало входом для следующего действия?`;

const previousTitle = 'Portfolio OS #2 — Я устал напоминать агентам, что мы вообще решили';
const previousPackageDescription = 'Basis: owner-authorized limited beta plan and provided '
    + 'registration-flow, README, legal-data-analytics, landing-copy-ru, communications-ru and '
    + 'beta-application.schema.json. Evidence payload: application-gated free access, explicit '
    + 'feedback commitment, documentation and feedback loop; beta is planned, not claimed launched. '
    + 'Supports max 4 native outputs.';
const schedule = new Date('2026-10-13T17:30:00.000Z');
const args = {
    projectId: 10, taskId: 1091, initiativeId: 291, sourcePackageId: 311,
    previousSourcePackageId: 313, actorId: 'user:2',
    expectedManifestChecksum: TASK1091_TDPD_MANIFEST_CHECKSUM,
    expectedContentRevision: 2, expectedAcceptedRevision: 2,
    expectedBodySha256: TASK1091_PREVIOUS_BODY_SHA256,
    expectedChannelId: 108, expectedScheduleAt: '2026-10-13T17:30:00.000Z',
    expectedTitle: previousTitle, idempotencyKey: TASK1091_TDPD_ADAPTATION_KEY,
    authorizationReference: 'Owner request to replace tomorrow task1091 topic with Kun Chen/TDPD review',
    confirm: false
} as const;

function fixture(options: { sourceOutputCount?: number; slotCount?: number; attemptCount?: number } = {}) {
    const activeArt = { id: 302, source_content_revision: 2,
        decision: 'NO_VISUAL_NEEDED', status: 'active' };
    const task = { id: 1091, project_id: 10, title: previousTitle,
        brief: 'old Portfolio OS brief', item_key: 'PORTFOLIO-OS-PERSONAL-TG-20261013-01',
        status: 'ready_for_execution', content_revision: 2, accepted_revision: 2,
        text_state: 'accepted', draft_text: previousBody, channel_id: 108,
        schedule_at: schedule, publish_at: schedule, publication_mode: 'approval_required',
        visual_state: 'NO_VISUAL_NEEDED', handoff_state: 'ready', selected_asset_id: null,
        publication_fact: null, published_link: null, quality_report: {
            execution_mode: 'assisted', handoff_bundle: { publication: { body: previousBody } }
        }, assets: { initiative_key: 'PORTFOLIO-OS-PERSONAL-TG-20261013-01' },
        work_items: [], art_direction_decisions: [activeArt] };
    const initiatives = new Map<number, Record<string, unknown>>([
        [291, { id: 291, project_id: 10, external_key: 'PORTFOLIO-OS-PERSONAL-TG-20261013-01',
            title: previousTitle, description: 'old Portfolio OS brief', subtype: 'portfolio_os_personal_tg',
            dependencies_status: 'none' }],
        [311, { id: 311, project_id: 10, external_key: 'W42-SP-PODMASTERIE-TDPD',
            subtype: 'source_package', status: 'in_progress', description: previousPackageDescription }],
        [313, { id: 313, project_id: 10, external_key: 'W42-SP-CONTENTOPS-PORTFOLIO-OS',
            subtype: 'source_package', status: 'in_progress' }]
    ]);
    const events: Array<Record<string, unknown>> = [];
    const dependencies: Array<Record<string, unknown>> = [];
    const writes: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const database = {
        project: { findUnique: async () => ({ id: 10, slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: {
            findFirst: async () => task,
            count: async () => options.slotCount ?? 1,
            updateMany: async ({ data }: { data: Record<string, unknown> }) => {
                writes.push({ kind: 'task', data }); Object.assign(task, data); return { count: 1 };
            }
        },
        initiative: {
            findFirst: async ({ where }: { where: { id: number } }) => initiatives.get(where.id) || null,
            updateMany: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
                const current = initiatives.get(where.id);
                if (!current) return { count: 0 };
                writes.push({ kind: `initiative:${where.id}`, data });
                Object.assign(current, data); return { count: 1 };
            }
        },
        initiativeDependency: {
            findUnique: async ({ where }: { where: { from_initiative_id_to_initiative_id_type: {
                from_initiative_id: number; to_initiative_id: number } } }) => {
                const key = where.from_initiative_id_to_initiative_id_type;
                return dependencies.find(dep => dep.from_initiative_id === key.from_initiative_id
                    && dep.to_initiative_id === key.to_initiative_id) || null;
            },
            count: async () => options.sourceOutputCount ?? 3,
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const row = { id: 4101, ...data }; dependencies.push(row); return row;
            }
        },
        deliveryAttempt: { count: async () => options.attemptCount ?? 0 },
        artDirectionDecision: {
            updateMany: async ({ data }: { data: Record<string, unknown> }) => {
                writes.push({ kind: 'art', data }); Object.assign(activeArt, data); return { count: 1 };
            }
        },
        workItem: { create: async ({ data }: { data: Record<string, unknown> }) => {
            const row = { id: 4201, ...data }; writes.push({ kind: 'work', data: row }); return row;
        } },
        workflowEvent: {
            count: async () => 0,
            findUnique: async ({ where }: { where: { project_id_actor_id_command_idempotency_key: {
                actor_id: string; command: string; idempotency_key: string } } }) => {
                const key = where.project_id_actor_id_command_idempotency_key;
                return events.find(event => event.actor_id === key.actor_id
                    && event.command === key.command && event.idempotency_key === key.idempotency_key) || null;
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const row = { id: 4301, ...data }; events.push(row); return row;
            }
        },
        $transaction: async (run: (client: unknown) => Promise<unknown>) => run(database)
    };
    return { task, initiatives, activeArt, events, dependencies, writes,
        deps: { database: database as never,
            manifestLoader: async () => ({ checksum: TASK1091_TDPD_MANIFEST_CHECKSUM }),
            now: () => new Date('2026-10-12T17:15:00.000Z') } };
}

test('task1091 adaptation preview is an exact no-write diff', async () => {
    const f = fixture();
    const result = await adaptTask1091TdpdSource(args, f.deps);
    assert.equal(result.mode, 'preview');
    assert.equal(result.source_package_id, 311);
    assert.equal(result.previous_topic_source_package_id, 313);
    assert.equal(f.writes.length, 0);
    assert.equal(f.dependencies.length, 0);
    assert.equal(f.task.title, previousTitle);
});

test('task1091 adaptation preserves revision2 as candidate and reopens governed revision3 work', async () => {
    const f = fixture();
    const result = await adaptTask1091TdpdSource({ ...args, confirm: true }, f.deps);
    assert.equal(f.task.title, task1091TdpdAdaptationContract.title);
    assert.equal(f.task.brief, task1091TdpdAdaptationContract.brief);
    assert.equal(f.task.draft_text, null);
    assert.equal(f.task.content_revision, 2);
    assert.equal(f.task.accepted_revision, null);
    assert.equal(f.task.status, 'planned');
    assert.equal(f.task.visual_state, 'STALE');
    assert.equal(f.activeArt.status, 'stale');
    const quality = f.task.quality_report as Record<string, unknown>;
    assert.equal('handoff_bundle' in quality, false);
    const candidates = quality.content_candidates as Array<Record<string, unknown>>;
    assert.equal(candidates[0].body_sha256, TASK1091_PREVIOUS_BODY_SHA256);
    assert.equal(candidates[0].body, previousBody);
    assert.equal(f.dependencies.length, 1);
    assert.equal(f.dependencies[0].from_initiative_id, 311);
    assert.equal(f.dependencies[0].to_initiative_id, 291);
    assert.equal(result.content_write_work_item_id, 4201);
    assert.equal(result.release_or_publish_performed, false);
    assert.equal(f.events.length, 1);
    const replay = await adaptTask1091TdpdSource({ ...args, confirm: true }, f.deps);
    assert.equal(replay.replayed, true);
    assert.equal(f.dependencies.length, 1);
});

test('task1091 adaptation rejects package-capacity, cadence or delivery drift before writes', async () => {
    for (const f of [fixture({ sourceOutputCount: 4 }), fixture({ slotCount: 2 }),
        fixture({ attemptCount: 1 })]) {
        await assert.rejects(adaptTask1091TdpdSource({ ...args, confirm: true }, f.deps),
            /TASK1091_TDPD_ADAPTATION_GUARD_FAILED/);
        assert.equal(f.writes.length, 0);
        assert.equal(f.events.length, 0);
    }
});

test('task1091 adaptation rejects any other task before database access', async () => {
    const f = fixture();
    await assert.rejects(adaptTask1091TdpdSource({ ...args, taskId: 1092 as 1091 }, f.deps),
        /TASK1091_TDPD_ADAPTATION_SCOPE_MISMATCH/);
    assert.equal(f.writes.length, 0);
});

test('task1091 adaptation is exposed only to Planner', () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_adapt_task1091_tdpd_source'), true);
    for (const profile of ['writer', 'editor', 'art_director', 'publisher',
        'growth_analyst', 'strategist'] as const) {
        assert.equal(isToolAllowedForProfile(profile, 'ba_adapt_task1091_tdpd_source'), false);
    }
});
