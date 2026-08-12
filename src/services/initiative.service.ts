import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import prisma from '../db';

export type InitiativeKind = 'publication' | 'event' | 'campaign' | 'infrastructure';
export type DependencyType = 'blocks' | 'requires' | 'not_before' | 'informs';

export class InitiativeService {
    private publicationTaskView(workItems: Array<{ content_item: any }>): Record<string, unknown> | null {
        const task = workItems.find(item => item.content_item)?.content_item;
        if (!task) return null;
        return {
            id: task.id,
            status: task.status,
            mode: task.publication_mode || 'manual_handoff',
            has_draft: Boolean(task.draft_text?.trim()),
            published_link: task.published_link || null,
            channel_id: task.channel_id || null,
            workspace_path: `/publication-tasks?taskId=${task.id}`
        };
    }

    private validateCalendarRange(fromDate: string, toDate: string): { from: Date; to: Date } {
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (!datePattern.test(fromDate) || !datePattern.test(toDate)) {
            throw new Error('[INVALID_DATE_RANGE] fromDate and toDate must use YYYY-MM-DD');
        }

        const from = new Date(`${fromDate}T00:00:00.000Z`);
        const to = new Date(`${toDate}T23:59:59.999Z`);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || fromDate > toDate) {
            throw new Error('[INVALID_DATE_RANGE] fromDate must be on or before toDate');
        }
        return { from, to };
    }

    private stableJson(value: unknown): string {
        if (value === undefined) return 'null';
        if (Array.isArray(value)) return `[${value.map(item => this.stableJson(item)).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`)
                .join(',')}}`;
        }
        return JSON.stringify(value);
    }

    private requestHash(value: unknown): string {
        return createHash('sha256').update(this.stableJson(value)).digest('hex');
    }

    /**
     * Security check verifying actor project access.
     */
    private async requireProjectAccess(
        client: Prisma.TransactionClient | typeof prisma,
        projectId: number,
        actorId: string
    ): Promise<void> {
        if (!actorId || typeof actorId !== 'string' || !actorId.trim()) {
            throw new Error(`[Security] Access denied: Actor ID is required`);
        }

        const project = await client.project.findUnique({
            where: { id: projectId }
        });
        if (!project) {
            throw new Error(`[Security] Access denied: Project ${projectId} does not exist`);
        }

        if (actorId.startsWith('user:')) {
            const parsedUserId = Number(actorId.split(':')[1]);
            if (!Number.isInteger(parsedUserId) || parsedUserId <= 0 || actorId !== `user:${parsedUserId}`) {
                throw new Error(`[Security] Access denied: Invalid user actor ID format "${actorId}"`);
            }

            const member = await client.projectMember.findUnique({
                where: {
                    project_id_user_id: {
                        project_id: projectId,
                        user_id: parsedUserId
                    }
                }
            });
            if (!member) {
                throw new Error(`[Security] Access denied: actor ${actorId} does not have access to project ${projectId}`);
            }
            return;
        }

        const binding = await client.serviceIdentityBinding.findUnique({
            where: {
                project_id_actor_id: {
                    project_id: projectId,
                    actor_id: actorId
                }
            }
        });
        if (!binding || !binding.is_active) {
            throw new Error(`[Security] Access denied: Service identity "${actorId}" has no active project binding for project ${projectId}`);
        }
    }

    private async upsertInitiativeWithClient(
        tx: Prisma.TransactionClient,
        params: Parameters<InitiativeService['upsertInitiative']>[0]
    ) {
        const existing = await tx.initiative.findUnique({
            where: {
                project_id_external_key: {
                    project_id: params.projectId,
                    external_key: params.externalKey
                }
            }
        });

        const dates = {
            due_at: params.dueAt ? new Date(params.dueAt) : null,
            start_at: params.startAt ? new Date(params.startAt) : null,
            end_at: params.endAt ? new Date(params.endAt) : null,
            decision_at: params.decisionAt ? new Date(params.decisionAt) : null,
            event_at: params.eventAt ? new Date(params.eventAt) : null,
            measurement_at: params.measurementAt ? new Date(params.measurementAt) : null
        };

        if (existing) {
            return tx.initiative.update({
                where: { id: existing.id },
                data: {
                    kind: params.kind,
                    subtype: params.subtype !== undefined ? params.subtype : existing.subtype,
                    title: params.title || existing.title,
                    description: params.description !== undefined ? params.description : existing.description,
                    status: params.status !== undefined ? params.status : existing.status,
                    owner_role: params.ownerRole !== undefined ? params.ownerRole : existing.owner_role,
                    due_at: params.dueAt !== undefined ? dates.due_at : existing.due_at,
                    start_at: params.startAt !== undefined ? dates.start_at : existing.start_at,
                    end_at: params.endAt !== undefined ? dates.end_at : existing.end_at,
                    decision_at: params.decisionAt !== undefined ? dates.decision_at : existing.decision_at,
                    event_at: params.eventAt !== undefined ? dates.event_at : existing.event_at,
                    measurement_at: params.measurementAt !== undefined ? dates.measurement_at : existing.measurement_at
                }
            });
        }

        return tx.initiative.create({
            data: {
                project: { connect: { id: params.projectId } },
                external_key: params.externalKey,
                kind: params.kind,
                subtype: params.subtype || null,
                title: params.title,
                description: params.description || null,
                status: params.status || 'planned',
                owner_role: params.ownerRole || null,
                ...dates
            }
        });
    }

    /**
     * Upserts an initiative by project_id and external_key.
     */
    async upsertInitiative(params: {
        projectId: number;
        actorId: string;
        externalKey: string;
        kind: InitiativeKind | string;
        subtype?: string;
        title: string;
        description?: string;
        status?: string;
        ownerRole?: string;
        dueAt?: string | null;
        startAt?: string | null;
        endAt?: string | null;
        decisionAt?: string | null;
        eventAt?: string | null;
        measurementAt?: string | null;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId);
            const item = await this.upsertInitiativeWithClient(tx, params);

            return {
                id: item.id,
                project_id: item.project_id,
                external_key: item.external_key,
                kind: item.kind,
                subtype: item.subtype,
                title: item.title,
                status: item.status,
                due_at: item.due_at?.toISOString() || null,
                start_at: item.start_at?.toISOString() || null,
                event_at: item.event_at?.toISOString() || null,
                decision_at: item.decision_at?.toISOString() || null
            };
        });
    }

    /**
     * Checks if adding a dependency link from -> to creates a cycle.
     */
    private async checkForCycles(
        tx: Prisma.TransactionClient,
        projectId: number,
        fromId: number,
        toId: number
    ): Promise<boolean> {
        // BFS / DFS from `toId` to see if `fromId` is reachable
        const visited = new Set<number>();
        const queue = [toId];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current === fromId) return true; // Cycle detected!
            visited.add(current);

            const outgoing = await tx.initiativeDependency.findMany({
                where: {
                    project_id: projectId,
                    from_initiative_id: current
                }
            });

            for (const dep of outgoing) {
                if (!visited.has(dep.to_initiative_id)) {
                    queue.push(dep.to_initiative_id);
                }
            }
        }
        return false;
    }

    private async linkInitiativesWithClient(
        tx: Prisma.TransactionClient,
        params: Parameters<InitiativeService['linkInitiatives']>[0]
    ) {
        const fromItem = await tx.initiative.findUnique({
            where: { project_id_external_key: { project_id: params.projectId, external_key: params.fromKey } }
        });
        const toItem = await tx.initiative.findUnique({
            where: { project_id_external_key: { project_id: params.projectId, external_key: params.toKey } }
        });

        if (!fromItem) throw new Error(`Initiative ${params.fromKey} not found in project ${params.projectId}`);
        if (!toItem) throw new Error(`Initiative ${params.toKey} not found in project ${params.projectId}`);

        const depType = params.type || 'blocks';
        if (await this.checkForCycles(tx, params.projectId, fromItem.id, toItem.id)) {
            throw new Error(`[CYCLE_DETECTED] Cannot create circular dependency between ${params.fromKey} and ${params.toKey}`);
        }

        const dep = await tx.initiativeDependency.upsert({
            where: {
                from_initiative_id_to_initiative_id_type: {
                    from_initiative_id: fromItem.id,
                    to_initiative_id: toItem.id,
                    type: depType
                }
            },
            update: {
                condition: params.condition || null,
                source: params.source || null
            },
            create: {
                project_id: params.projectId,
                from_initiative_id: fromItem.id,
                to_initiative_id: toItem.id,
                type: depType,
                condition: params.condition || null,
                source: params.source || null
            }
        });

        await tx.initiative.update({
            where: { id: toItem.id },
            data: { dependencies_status: 'confirmed' }
        });
        return dep;
    }

    /**
     * Links two initiatives with a dependency relationship and cycle detection.
     */
    async linkInitiatives(params: {
        projectId: number;
        actorId: string;
        fromKey: string;
        toKey: string;
        type?: DependencyType | string;
        condition?: string;
        source?: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId);
            const dep = await this.linkInitiativesWithClient(tx, params);

            return {
                id: dep.id,
                from_key: params.fromKey,
                to_key: params.toKey,
                type: dep.type
            };
        });
    }

    /**
     * Imports an operational plan containing initiatives and dependency linkages.
     */
    async importOperationalPlan(params: {
        projectId: number;
        actorId: string;
        externalPlan: {
            initiatives?: Array<{
                external_key: string;
                kind: string;
                subtype?: string;
                title: string;
                description?: string;
                status?: string;
                due_at?: string;
                start_at?: string;
                end_at?: string;
                decision_at?: string;
                event_at?: string;
                measurement_at?: string;
            }>;
            dependencies?: Array<{
                from: string;
                to: string;
                type?: string;
                condition?: string;
            }>;
        };
        idempotencyKey?: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId);
            const initiatives = params.externalPlan.initiatives || [];
            const dependencies = params.externalPlan.dependencies || [];
            const requestHash = this.requestHash(params.externalPlan);

            if (params.idempotencyKey) {
                const existingEvent = await tx.workflowEvent.findFirst({
                    where: {
                        project_id: params.projectId,
                        actor_id: params.actorId,
                        command: 'import_operational_plan',
                        idempotency_key: params.idempotencyKey
                    }
                });
                if (existingEvent) {
                    const existingHash = (existingEvent.before_state as Record<string, unknown> | null)?.request_hash;
                    if (existingHash !== requestHash) {
                        throw new Error('[IDEMPOTENCY_CONFLICT] The idempotency key was already used with a different operational plan');
                    }
                    return (existingEvent.after_state as Record<string, unknown>) || {
                        imported_count: initiatives.length,
                        linked_dependencies_count: dependencies.length
                    };
                }
            }

            for (const item of initiatives) {
                await this.upsertInitiativeWithClient(tx, {
                    projectId: params.projectId,
                    actorId: params.actorId,
                    externalKey: item.external_key,
                    kind: item.kind,
                    subtype: item.subtype,
                    title: item.title,
                    description: item.description,
                    status: item.status,
                    dueAt: item.due_at,
                    startAt: item.start_at,
                    endAt: item.end_at,
                    decisionAt: item.decision_at,
                    eventAt: item.event_at,
                    measurementAt: item.measurement_at
                });
            }

            for (const dep of dependencies) {
                await this.linkInitiativesWithClient(tx, {
                    projectId: params.projectId,
                    actorId: params.actorId,
                    fromKey: dep.from,
                    toKey: dep.to,
                    type: dep.type || 'blocks',
                    condition: dep.condition
                });
            }

            const result = {
                imported_count: initiatives.length,
                linked_dependencies_count: dependencies.length
            };

            if (params.idempotencyKey) {
                await tx.workflowEvent.create({
                    data: {
                        project_id: params.projectId,
                        actor_id: params.actorId,
                        command: 'import_operational_plan',
                        before_state: { request_hash: requestHash },
                        after_state: result,
                        idempotency_key: params.idempotencyKey
                    }
                });
            }

            return result;
        });
    }

    /**
     * Creates or updates the execution-side ContentItem for one publication initiative.
     * WorkItem is the explicit bridge between the operational and execution layers.
     */
    async materializePublicationTask(params: {
        projectId: number;
        actorId: string;
        initiativeKey: string;
        draftText?: string;
        brief?: string;
        channelId?: number;
        publicationMode: 'manual_handoff' | 'approval_required' | 'automatic';
        scheduleAt?: string;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId);
            const requestHash = this.requestHash({
                initiativeKey: params.initiativeKey,
                draftText: params.draftText,
                brief: params.brief,
                channelId: params.channelId,
                publicationMode: params.publicationMode,
                scheduleAt: params.scheduleAt
            });
            const existingEvent = await tx.workflowEvent.findFirst({
                where: {
                    project_id: params.projectId,
                    actor_id: params.actorId,
                    command: 'materialize_publication_task',
                    idempotency_key: params.idempotencyKey
                }
            });
            if (existingEvent) {
                const existingHash = (existingEvent.before_state as Record<string, unknown> | null)?.request_hash;
                if (existingHash !== requestHash) {
                    throw new Error('[IDEMPOTENCY_CONFLICT] The key was already used with different publication task content');
                }
                return (existingEvent.after_state as Record<string, unknown>) || {};
            }

            const initiative = await tx.initiative.findUnique({
                where: {
                    project_id_external_key: {
                        project_id: params.projectId,
                        external_key: params.initiativeKey
                    }
                }
            });
            if (!initiative) throw new Error(`Initiative ${params.initiativeKey} not found in project ${params.projectId}`);
            if (initiative.kind !== 'publication') {
                throw new Error('[INVALID_INITIATIVE_KIND] Only publication initiatives can create publication tasks');
            }
            if (params.channelId) {
                const channel = await tx.socialChannel.findFirst({ where: { id: params.channelId, project_id: params.projectId } });
                if (!channel) throw new Error(`[INVALID_CHANNEL] Channel ${params.channelId} does not belong to project ${params.projectId}`);
            }

            const existingBridge = await tx.workItem.findFirst({
                where: { project_id: params.projectId, initiative_id: initiative.id, content_item_id: { not: null } },
                include: { content_item: true },
                orderBy: { id: 'asc' }
            });
            const executionMode = params.publicationMode === 'automatic'
                ? 'automated'
                : params.publicationMode === 'approval_required' ? 'assisted' : 'manual';
            const scheduleAt = params.scheduleAt ? new Date(params.scheduleAt) : (initiative.due_at || null);
            const contentData = {
                channel_id: params.channelId ?? existingBridge?.content_item?.channel_id ?? null,
                title: initiative.title,
                brief: params.brief ?? existingBridge?.content_item?.brief ?? initiative.description,
                draft_text: params.draftText ?? existingBridge?.content_item?.draft_text ?? null,
                status: params.draftText?.trim() ? 'drafted' : (existingBridge?.content_item?.status || 'planned'),
                schedule_at: scheduleAt,
                publish_at: scheduleAt,
                item_key: initiative.external_key,
                publication_mode: params.publicationMode,
                assets: { initiative_key: initiative.external_key },
                quality_report: {
                    ...((existingBridge?.content_item?.quality_report as Record<string, unknown> | null) || {}),
                    execution_mode: executionMode,
                    initiative_key: initiative.external_key
                } as Prisma.InputJsonValue
            };

            const contentItem = existingBridge?.content_item
                ? await tx.contentItem.update({ where: { id: existingBridge.content_item.id }, data: contentData })
                : await tx.contentItem.create({
                    data: {
                        project_id: params.projectId,
                        type: 'publication',
                        layer: 'operational',
                        ...contentData
                    }
                });
            const workItem = existingBridge || await tx.workItem.create({
                data: {
                    project_id: params.projectId,
                    initiative_id: initiative.id,
                    content_item_id: contentItem.id,
                    item_key: initiative.external_key,
                    kind: 'content_write',
                    state: 'available',
                    assignee_role: 'content_writer',
                    due_at: scheduleAt
                }
            });
            const result = {
                initiative_id: initiative.id,
                publication_task_id: contentItem.id,
                work_item_id: workItem.id,
                workspace_path: `/publication-tasks?taskId=${contentItem.id}`,
                publication_mode: params.publicationMode
            };
            await tx.workflowEvent.create({
                data: {
                    project_id: params.projectId,
                    work_item_id: workItem.id,
                    content_item_id: contentItem.id,
                    actor_id: params.actorId,
                    command: 'materialize_publication_task',
                    before_state: { request_hash: requestHash },
                    after_state: result,
                    idempotency_key: params.idempotencyKey
                }
            });
            return result;
        });
    }

    async syncPublishedPublicationTask(projectId: number, contentItemId: number): Promise<number> {
        const result = await prisma.initiative.updateMany({
            where: {
                project_id: projectId,
                kind: 'publication',
                work_items: { some: { content_item_id: contentItemId } }
            },
            data: { status: 'completed' }
        });
        return result.count;
    }

    /**
     * Retrieves an initiative by project_id and external_key.
     */
    async getInitiative(params: {
        projectId: number;
        actorId: string;
        externalKey: string;
    }): Promise<Record<string, unknown>> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId);

        const item = await prisma.initiative.findUnique({
            where: {
                project_id_external_key: {
                    project_id: params.projectId,
                    external_key: params.externalKey
                }
            },
            include: {
                dependencies_incoming: {
                    include: { from_initiative: true }
                },
                dependencies_outgoing: {
                    include: { to_initiative: true }
                },
                work_items: { where: { content_item_id: { not: null } }, include: { content_item: true } }
            }
        });

        if (!item) {
            throw new Error(`Initiative ${params.externalKey} not found in project ${params.projectId}`);
        }

        const confirmedBlockers = item.dependencies_incoming.map(dep => ({
            external_key: dep.from_initiative.external_key,
            title: dep.from_initiative.title,
            status: dep.from_initiative.status,
            type: dep.type
        }));

        return {
            id: item.id,
            project_id: item.project_id,
            external_key: item.external_key,
            kind: item.kind,
            subtype: item.subtype,
            title: item.title,
            status: item.status,
            dependencies_status: item.dependencies_status,
            due_at: item.due_at?.toISOString() || null,
            start_at: item.start_at?.toISOString() || null,
            event_at: item.event_at?.toISOString() || null,
            decision_at: item.decision_at?.toISOString() || null,
            publication_task: this.publicationTaskView(item.work_items),
            confirmed_blockers: confirmedBlockers
        };
    }

    /**
     * Lists initiatives for a project with optional filtering.
     */
    async listInitiatives(params: {
        projectId: number;
        actorId: string;
        filter?: { kind?: string; status?: string };
    }): Promise<{ initiatives: Record<string, unknown>[] }> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId);

        const where: Prisma.InitiativeWhereInput = { project_id: params.projectId };
        if (params.filter?.kind) where.kind = params.filter.kind;
        if (params.filter?.status) where.status = params.filter.status;

        const items = await prisma.initiative.findMany({
            where,
            orderBy: { id: 'asc' }
        });

        return {
            initiatives: items.map(item => ({
                id: item.id,
                project_id: item.project_id,
                external_key: item.external_key,
                kind: item.kind,
                subtype: item.subtype,
                title: item.title,
                status: item.status,
                dependencies_status: item.dependencies_status,
                due_at: item.due_at?.toISOString() || null,
                start_at: item.start_at?.toISOString() || null,
                end_at: item.end_at?.toISOString() || null,
                decision_at: item.decision_at?.toISOString() || null,
                event_at: item.event_at?.toISOString() || null,
                measurement_at: item.measurement_at?.toISOString() || null
            }))
        };
    }

    /**
     * Audits external plan coverage against current database initiatives.
     */
    async auditPlanCoverage(params: {
        projectId: number;
        actorId: string;
        externalPlan: {
            initiatives?: Array<{
                external_key: string;
                kind: string;
                due_at?: string;
                start_at?: string;
                end_at?: string;
                decision_at?: string;
                event_at?: string;
                measurement_at?: string;
            }>;
        };
    }): Promise<Record<string, unknown>> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId);

        const externalItems = params.externalPlan.initiatives || [];
        const externalKeys = externalItems.map(i => i.external_key);

        const plannerItems = await prisma.initiative.findMany({
            where: { project_id: params.projectId }
        });

        const existingKeySet = new Set(plannerItems.map(i => i.external_key));
        const missingKeys = externalKeys.filter(k => !existingKeySet.has(k));
        const externalKeySet = new Set(externalKeys);
        const plannerOnlyKeys = plannerItems
            .filter(item => !externalKeySet.has(item.external_key))
            .map(item => item.external_key)
            .sort();
        const plannerByKey = new Map(plannerItems.map(item => [item.external_key, item]));
        const comparableFields = ['kind', 'due_at', 'start_at', 'end_at', 'decision_at', 'event_at', 'measurement_at'] as const;
        const mismatches = externalItems.flatMap(externalItem => {
            const plannerItem = plannerByKey.get(externalItem.external_key);
            if (!plannerItem) return [];

            const fields = comparableFields.filter(field => {
                const expected = externalItem[field];
                if (expected === undefined) return false;
                if (field === 'kind') return plannerItem.kind !== expected;
                const actual = plannerItem[field]?.toISOString() || null;
                return actual !== new Date(expected).toISOString();
            });
            return fields.length > 0 ? [{ external_key: externalItem.external_key, fields }] : [];
        });

        return {
            total_external_initiatives: externalKeys.length,
            covered_count: externalKeys.filter(key => existingKeySet.has(key)).length,
            missing_count: missingKeys.length,
            missing_keys: missingKeys,
            planner_only_keys: plannerOnlyKeys,
            mismatches
        };
    }

    /**
     * Evaluates release readiness for a target initiative based on incoming blocker states.
     */
    async getReleaseReadiness(params: {
        projectId: number;
        actorId: string;
        initiativeKey: string;
    }): Promise<Record<string, unknown>> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId);

        const item = await prisma.initiative.findUnique({
            where: {
                project_id_external_key: {
                    project_id: params.projectId,
                    external_key: params.initiativeKey
                }
            },
            include: {
                dependencies_incoming: {
                    include: { from_initiative: true }
                }
            }
        });

        if (!item) {
            throw new Error(`Initiative ${params.initiativeKey} not found in project ${params.projectId}`);
        }

        const blockers = item.dependencies_incoming
            .filter(dep => dep.type === 'blocks' && dep.from_initiative.status !== 'completed')
            .map(dep => ({
                external_key: dep.from_initiative.external_key,
                title: dep.from_initiative.title,
                kind: dep.from_initiative.kind,
                status: dep.from_initiative.status,
                due_at: dep.from_initiative.due_at?.toISOString() || null
            }));

        const isBlocked = blockers.length > 0 || item.status === 'blocked';
        const dependenciesUnknown = item.dependencies_status === 'dependencies_unknown';
        const isReady = !isBlocked && !dependenciesUnknown;

        return {
            initiative_key: params.initiativeKey,
            status: item.status,
            dependencies_status: item.dependencies_status,
            readiness: dependenciesUnknown ? 'unknown' : (isBlocked ? 'blocked' : 'ready'),
            is_ready: isReady,
            is_blocked: isBlocked,
            blockers
        };
    }

    /**
     * Lists release blockers and downstream impact for overdue initiatives.
     */
    async listReleaseBlockers(params: {
        projectId: number;
        actorId: string;
        asOf?: string;
    }): Promise<Record<string, unknown>> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId);

        const currentTime = params.asOf ? new Date(params.asOf) : new Date();

        const initiatives = await prisma.initiative.findMany({
            where: { project_id: params.projectId },
            include: {
                dependencies_outgoing: {
                    include: { to_initiative: true }
                }
            }
        });

        const overdueInitiatives: Record<string, unknown>[] = [];

        for (const item of initiatives) {
            if (item.status === 'completed') continue;

            const targetDate = item.due_at || item.start_at || item.decision_at || item.event_at || item.end_at || item.measurement_at;
            if (targetDate && currentTime.getTime() > targetDate.getTime()) {
                const downstreamImpact = item.dependencies_outgoing.map(dep => ({
                    external_key: dep.to_initiative.external_key,
                    title: dep.to_initiative.title,
                    kind: dep.to_initiative.kind
                }));

                overdueInitiatives.push({
                    external_key: item.external_key,
                    title: item.title,
                    kind: item.kind,
                    status: item.status,
                    due_at: targetDate.toISOString(),
                    downstream_impact: downstreamImpact
                });
            }
        }

        return { overdue_initiatives: overdueInitiatives };
    }

    /**
     * Returns operational calendar items with explicit date_type preserved.
     */
    async getOperationalCalendar(params: {
        projectId: number;
        actorId: string;
        fromDate: string;
        toDate: string;
    }): Promise<{ items: Record<string, unknown>[] }> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId);

        const { from, to } = this.validateCalendarRange(params.fromDate, params.toDate);

        const initiatives = await prisma.initiative.findMany({
            where: { project_id: params.projectId },
            include: { work_items: { where: { content_item_id: { not: null } }, include: { content_item: true } } },
            orderBy: { id: 'asc' }
        });

        const items: Record<string, unknown>[] = [];

        for (const item of initiatives) {
            let dateVal: Date | null = null;
            let dateType = 'due_at';

            if (item.due_at) { dateVal = item.due_at; dateType = 'due_at'; }
            else if (item.start_at) { dateVal = item.start_at; dateType = 'start_at'; }
            else if (item.event_at) { dateVal = item.event_at; dateType = 'event_at'; }
            else if (item.decision_at) { dateVal = item.decision_at; dateType = 'decision_at'; }
            else if (item.end_at) { dateVal = item.end_at; dateType = 'end_at'; }
            else if (item.measurement_at) { dateVal = item.measurement_at; dateType = 'measurement_at'; }

            if (dateVal && dateVal.getTime() >= from.getTime() && dateVal.getTime() <= to.getTime()) {
                items.push({
                    id: item.id,
                    external_key: item.external_key,
                    kind: item.kind,
                    subtype: item.subtype,
                    title: item.title,
                    status: item.status,
                    date_type: dateType,
                    date: dateVal.toISOString(),
                    publication_task: this.publicationTaskView(item.work_items)
                });
            }
        }

        return { items };
    }

    /**
     * Returns the agent-facing operational view used by MCP and HTTP consumers.
     */
    async getOperationalCalendarView(params: {
        projectId: number;
        actorId: string;
        fromDate: string;
        toDate: string;
        asOf?: string;
    }): Promise<Record<string, unknown>> {
        this.validateCalendarRange(params.fromDate, params.toDate);
        const [calendar, exceptions, initiativeList] = await Promise.all([
            this.getOperationalCalendar(params),
            this.listReleaseBlockers({ projectId: params.projectId, actorId: params.actorId, asOf: params.asOf }),
            this.listInitiatives({ projectId: params.projectId, actorId: params.actorId })
        ]);

        const readinessEntries = await Promise.all(initiativeList.initiatives.map(async (item) => {
            const readiness = await this.getReleaseReadiness({
                projectId: params.projectId,
                actorId: params.actorId,
                initiativeKey: String(item.external_key)
            });
            return [String(item.external_key), readiness] as const;
        }));
        const readinessByKey = Object.fromEntries(readinessEntries);
        const overdueInitiatives = exceptions.overdue_initiatives as Record<string, unknown>[];

        return {
            range: { from: params.fromDate, to: params.toDate },
            items: calendar.items.map(item => ({
                ...item,
                readiness: readinessByKey[String(item.external_key)]
            })),
            overdue_initiatives: overdueInitiatives,
            summary: {
                total: initiativeList.initiatives.length,
                in_range: calendar.items.length,
                overdue: overdueInitiatives.length,
                dependencies_unknown: initiativeList.initiatives.filter(item => item.dependencies_status === 'dependencies_unknown').length,
                by_kind: initiativeList.initiatives.reduce<Record<string, number>>((counts, item) => {
                    const kind = String(item.kind);
                    counts[kind] = (counts[kind] || 0) + 1;
                    return counts;
                }, {})
            }
        };
    }
}

export default new InitiativeService();
