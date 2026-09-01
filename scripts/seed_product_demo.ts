import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import '../src/bootstrap-env';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const email = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
const password = process.env.DEMO_USER_PASSWORD || '';
if (!email || !email.includes('@')) throw new Error('DEMO_USER_EMAIL is required');
const demoEmail = email;
if (password.length < 16) throw new Error('DEMO_USER_PASSWORD must contain at least 16 characters');
if (process.env.DEMO_SEED_CONFIRM !== 'CONTENTOPS_STUDIO_PRODUCT_DEMO') {
    throw new Error('Set DEMO_SEED_CONFIRM=CONTENTOPS_STUDIO_PRODUCT_DEMO to seed the product demo');
}

const pool = new Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const projectSlug = 'contentops-studio-product-demo';

function utcDate(daysFromToday: number, hour = 12) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysFromToday);
    date.setUTCHours(hour, 0, 0, 0);
    return date;
}

function currentWeek() {
    const today = new Date();
    const day = today.getUTCDay() || 7;
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - day + 1));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start, end };
}

async function main() {
    const existingUser = await prisma.user.findUnique({ where: { email: demoEmail } });
    if (existingUser && !existingUser.is_demo) {
        throw new Error('Refusing to convert an existing regular account into a demo account');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = existingUser
        ? await prisma.user.update({
            where: { id: existingUser.id },
            data: { name: 'ContentOps Studio Demo', password_hash: passwordHash, is_demo: true }
        })
        : await prisma.user.create({
            data: { email: demoEmail, name: 'ContentOps Studio Demo', password_hash: passwordHash, is_demo: true }
        });

    const existingProject = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (existingProject && existingProject.kind !== 'demo') {
        throw new Error(`Refusing to reuse non-demo project ${projectSlug}`);
    }

    const project = await prisma.project.upsert({
        where: { slug: projectSlug },
        update: {
            name: 'ContentOps Studio Demo',
            description: 'A read-only workspace showing research, editorial planning, cross-channel production, approvals, publishing handoffs, and outcome analytics.',
            kind: 'demo',
            is_archived: false,
            archived_at: null
        },
        create: {
            name: 'ContentOps Studio Demo',
            slug: projectSlug,
            description: 'A read-only workspace showing research, editorial planning, cross-channel production, approvals, publishing handoffs, and outcome analytics.',
            kind: 'demo'
        }
    });

    await prisma.projectMember.upsert({
        where: { project_id_user_id: { project_id: project.id, user_id: user.id } },
        update: { role: 'viewer' },
        create: { project_id: project.id, user_id: user.id, role: 'viewer' }
    });

    const settings = [
        ['publication_plan_id', 'demo-content-system-2026'],
        ['publication_plan_meta', JSON.stringify({ timezone: 'Europe/Lisbon', purpose: 'product_demo', synthetic_data: true })],
        ['content_dictionary_yaml', 'preferred:\n  - evidence\n  - decision\navoid:\n  - game-changing\n  - revolutionary\n'],
        ['atoma_files_description', 'Synthetic product narrative, audience constraints, and channel rules used only for this demonstration.'],
        ['atoma_files_payload', JSON.stringify({ audience: 'Product and content operations leaders', voice: 'Clear, evidence-led, practical', demo: true })]
    ];
    for (const [key, value] of settings) {
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: project.id, key } },
            update: { value },
            create: { project_id: project.id, key, value }
        });
    }

    const channelSpecs = [
        { type: 'linkedin', name: 'Product Ops · LinkedIn' },
        { type: 'telegram', name: 'BA Practice · Telegram' },
        { type: 'vk', name: 'BA Community · VK' },
        { type: 'zen', name: 'Systems Thinking · Zen' },
        { type: 'habr', name: 'Engineering Workflow · Habr' },
        { type: 'threads', name: 'Daily Signals · Threads' }
    ];
    const channels = new Map<string, { id: number; type: string; name: string }>();
    for (const spec of channelSpecs) {
        const existing = await prisma.socialChannel.findFirst({
            where: { project_id: project.id, type: spec.type, name: spec.name }
        });
        const config = {
            platform: spec.type,
            workflow_mode: 'prepare_only',
            content_language: 'en',
            demo: true,
            connector_ready: false
        };
        const channel = existing
            ? await prisma.socialChannel.update({ where: { id: existing.id }, data: { config, is_active: true } })
            : await prisma.socialChannel.create({ data: { project_id: project.id, ...spec, config } });
        channels.set(spec.type, channel);
    }

    const { start, end } = currentWeek();
    const week = await prisma.weekPackage.upsert({
        where: { project_id_week_start_week_end: { project_id: project.id, week_start: start, week_end: end } },
        update: {
            week_theme: 'From scattered requests to an evidence-backed content operating system',
            core_thesis: 'Quality improves when research, decisions, production, and outcomes share one auditable workflow.',
            audience_focus: 'Product leaders, business analysts, and content operations teams',
            intent_tag: 'Authority',
            channel_mix: { linkedin: 2, telegram: 2, vk: 2, zen: 2, habr: 2, threads: 2 },
            plan_id: 'demo-content-system-2026',
            plan_version: '1.0',
            timezone: 'Europe/Lisbon',
            approval_status: 'approved'
        },
        create: {
            project_id: project.id,
            week_start: start,
            week_end: end,
            week_theme: 'From scattered requests to an evidence-backed content operating system',
            core_thesis: 'Quality improves when research, decisions, production, and outcomes share one auditable workflow.',
            audience_focus: 'Product leaders, business analysts, and content operations teams',
            intent_tag: 'Authority',
            channel_mix: { linkedin: 2, telegram: 2, vk: 2, zen: 2, habr: 2, threads: 2 },
            plan_id: 'demo-content-system-2026',
            plan_version: '1.0',
            timezone: 'Europe/Lisbon',
            approval_status: 'approved'
        }
    });

    const initiativeSpecs = [
        { external_key: 'demo-research', kind: 'campaign', title: 'Research: hidden cost of fragmented content operations', status: 'completed', days: -3 },
        { external_key: 'demo-editorial-week', kind: 'campaign', title: 'Editorial week: evidence to channel-native execution', status: 'in_progress', days: 2 },
        { external_key: 'demo-outcome-review', kind: 'event', title: 'Outcome review and next-cycle decision', status: 'planned', days: 7 }
    ];
    for (const spec of initiativeSpecs) {
        await prisma.initiative.upsert({
            where: { project_id_external_key: { project_id: project.id, external_key: spec.external_key } },
            update: { title: spec.title, status: spec.status, due_at: utcDate(spec.days), week_package_id: week.id },
            create: {
                project_id: project.id,
                week_package_id: week.id,
                external_key: spec.external_key,
                kind: spec.kind,
                subtype: spec.kind === 'event' ? 'decision_gate' : 'post',
                title: spec.title,
                description: 'Synthetic demo initiative illustrating dependencies and execution status.',
                status: spec.status,
                owner_role: 'content_operations',
                due_at: utcDate(spec.days),
                dependencies_status: 'confirmed'
            }
        });
    }

    const taskSpecs = [
        { key: 'demo-linkedin-evidence', platform: 'linkedin', type: 'linkedin_post', status: 'published', day: -1, title: 'The dashboard is not the operating system', mode: 'automatic', body: 'A dashboard tells you what happened. An operating system preserves why a decision was made, who accepted it, and what should happen next.' },
        { key: 'demo-telegram-workflow', platform: 'telegram', type: 'tg_post', status: 'published', day: -1, title: 'Five handoffs that silently degrade a content plan', mode: 'automatic', body: 'Most content quality is lost between tools, not inside the editor. The fix is explicit ownership, revision binding, and evidence at every handoff.' },
        { key: 'demo-vk-feedback', platform: 'vk', type: 'vk_post', status: 'published', day: 0, title: 'Feedback is useful only when it changes the next decision', mode: 'automatic', body: 'Collecting comments is not a feedback loop. A loop closes only when evidence changes a rule, priority, or next action.' },
        { key: 'demo-habr-auditability', platform: 'habr', type: 'habr_article', status: 'ready_for_execution', day: 1, title: 'Designing an auditable multi-agent content workflow', mode: 'browser_required', body: 'This article walks through the architecture of a governed workflow: source evidence, role boundaries, revision locks, approval decisions, durable assets, and publication facts.' },
        { key: 'demo-zen-system', platform: 'zen', type: 'zen_article', status: 'browser_required', day: 2, title: 'Why content teams need a system of record', mode: 'browser_required', body: 'When briefs, drafts, approvals, and metrics live in different places, the team cannot explain how a result was produced. A system of record restores that chain.' },
        { key: 'demo-threads-signal', platform: 'threads', type: 'threads_post', status: 'planned', day: 2, title: 'A short signal about revision ownership', mode: 'manual_handoff', body: 'If nobody owns the accepted revision, every downstream automation is operating on a guess.' },
        { key: 'demo-linkedin-approval', platform: 'linkedin', type: 'linkedin_post', status: 'approved', day: 3, title: 'Approval is a product decision, not a green checkbox', mode: 'automatic', body: 'A useful approval records scope, evidence, revision, and the decision owner. Anything less is difficult to audit and impossible to automate safely.' },
        { key: 'demo-telegram-metrics', platform: 'telegram', type: 'tg_post', status: 'drafted', day: 4, title: 'Three metrics that improve the next editorial cycle', mode: 'manual_handoff', body: 'Measure the audience response, the operational cost, and the decision that changed. Vanity totals alone do not improve the next cycle.' },
        { key: 'demo-vk-cancelled', platform: 'vk', type: 'vk_post', status: 'cancelled', day: 4, title: 'Cancelled duplicate: dashboard metrics recap', mode: 'manual_handoff', body: 'This duplicate was cancelled during plan review to protect channel frequency.' },
        { key: 'demo-habr-research', platform: 'habr', type: 'habr_article', status: 'planned', day: 5, title: 'Research backlog: where agent workflows fail in production', mode: 'browser_required', body: 'A research-led article planned for the next production slot.' },
        { key: 'demo-zen-outcomes', platform: 'zen', type: 'zen_article', status: 'planned', day: 5, title: 'From publication counts to measurable outcomes', mode: 'browser_required', body: 'A practical guide to connecting publication facts with checkpoints and next-cycle decisions.' },
        { key: 'demo-threads-retro', platform: 'threads', type: 'threads_post', status: 'planned', day: 6, title: 'Retrospective prompt: which handoff created the most rework?', mode: 'manual_handoff', body: 'The best retrospective question is the one that changes a process rule before the next cycle starts.' }
    ];

    for (const [index, spec] of taskSpecs.entries()) {
        const channel = channels.get(spec.platform)!;
        const accepted = ['published', 'ready_for_execution', 'browser_required', 'approved'].includes(spec.status);
        const published = spec.status === 'published';
        const taskData = {
            project_id: project.id,
            week_package_id: week.id,
            channel_id: channel.id,
            type: spec.type,
            layer: index % 3 === 0 ? 'analyst' : index % 3 === 1 ? 'community' : 'pro',
            title: spec.title,
            brief: `Channel-native demonstration asset for ${channel.name}. Synthetic data only.`,
            key_points: ['Traceable source', 'Explicit decision', 'Measurable outcome'],
            cta: 'Review the workflow and identify the next decision.',
            assets: {
                action: {
                    id: spec.key,
                    platform: spec.platform,
                    mode: spec.mode === 'automatic' ? 'automated' : 'manual',
                    demo: true
                }
            },
            draft_text: spec.body,
            content_revision: accepted ? 2 : 1,
            text_state: published ? 'published' : accepted ? 'accepted' : 'draft',
            accepted_revision: accepted ? 2 : null,
            visual_state: index % 2 === 0 ? 'NOT_REQUIRED' : 'APPROVED',
            handoff_state: accepted ? 'ready' : 'blocked',
            visual_mode: 'manual_review',
            visual_placement: index % 2 === 0 ? null : 'feed',
            status: spec.status,
            schedule_at: utcDate(spec.day, 9 + (index % 6) * 2),
            publish_at: utcDate(spec.day, 9 + (index % 6) * 2),
            content_due_at: utcDate(spec.day - 1, 17),
            quality_report: {
                demo: true,
                execution_mode: spec.mode === 'automatic' ? 'automatic' : 'browser',
                handoff_bundle: { publication: { body: spec.body, title: spec.title }, resources: [] },
                editorial_review: accepted ? { status: 'accepted', revision: 2 } : { status: 'pending' }
            },
            metrics: published ? { impressions: 2400 + index * 730, reactions: 84 + index * 17, comments: 12 + index * 4, clicks: 39 + index * 9 } : { demo: true },
            published_link: published ? `https://github.com/InnokentyB/contentops-studio#product-demo` : null,
            item_key: spec.key,
            review_policy: 'owner_approval',
            publication_mode: spec.mode,
            source_refs: [{ type: 'synthetic_demo', ref: 'ContentOps Studio product walkthrough' }]
        };

        const existing = await prisma.contentItem.findFirst({ where: { project_id: project.id, item_key: spec.key } });
        const task = existing
            ? await prisma.contentItem.update({ where: { id: existing.id }, data: taskData })
            : await prisma.contentItem.create({ data: taskData });

        if (published) {
            await prisma.publicationFact.upsert({
                where: { content_item_id: task.id },
                update: {
                    outcome: 'published',
                    published_at: taskData.schedule_at,
                    public_url: taskData.published_link,
                    provider_object_id: `demo-${spec.platform}-${task.id}`,
                    confirmed_by: 'demo-seed'
                },
                create: {
                    project_id: project.id,
                    content_item_id: task.id,
                    channel_id: channel.id,
                    artifact_kind: spec.type,
                    outcome: 'published',
                    published_at: taskData.schedule_at,
                    public_url: taskData.published_link,
                    provider_object_id: `demo-${spec.platform}-${task.id}`,
                    confirmation_mode: 'synthetic_demo',
                    evidence_type: 'demo_fixture',
                    evidence_ref: 'README product demo',
                    target_url: taskData.published_link,
                    utm_status: 'not_required',
                    confirmed_by: 'demo-seed'
                }
            });

            for (const checkpoint of ['24h', '72h']) {
                await prisma.metricSnapshot.upsert({
                    where: {
                        project_id_content_item_id_channel_id_checkpoint: {
                            project_id: project.id,
                            content_item_id: task.id,
                            channel_id: channel.id,
                            checkpoint
                        }
                    },
                    update: {
                        captured_at: utcDate(spec.day + (checkpoint === '24h' ? 1 : 3)),
                        collection_status: 'collected',
                        metrics: taskData.metrics
                    },
                    create: {
                        project_id: project.id,
                        content_item_id: task.id,
                        channel_id: channel.id,
                        checkpoint,
                        scheduled_for: utcDate(spec.day + (checkpoint === '24h' ? 1 : 3)),
                        captured_at: utcDate(spec.day + (checkpoint === '24h' ? 1 : 3)),
                        collection_mode: 'synthetic_demo',
                        source: 'demo_fixture',
                        collection_status: 'collected',
                        metrics: taskData.metrics,
                        evidence_ref: 'README product demo'
                    }
                });
            }
        }
    }

    console.log(JSON.stringify({
        ok: true,
        user_id: user.id,
        project_id: project.id,
        project_slug: project.slug,
        channels: channels.size,
        tasks: taskSpecs.length,
        password_printed: false
    }));
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
