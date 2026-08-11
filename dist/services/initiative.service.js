"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitiativeService = void 0;
const db_1 = __importDefault(require("../db"));
class InitiativeService {
    /**
     * Security check verifying actor project access.
     */
    async requireProjectAccess(client, projectId, actorId) {
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
            if (Number.isInteger(parsedUserId) && parsedUserId > 0) {
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
        }
        // Service actor identity check
        const members = await client.projectMember.findMany({
            where: { project_id: projectId }
        });
        if (members.length === 0) {
            throw new Error(`[Security] Access denied: Project ${projectId} has no members for actor ${actorId}`);
        }
    }
    /**
     * Upserts an initiative by project_id and external_key.
     */
    async upsertInitiative(params) {
        return db_1.default.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId);
            const existing = await tx.initiative.findUnique({
                where: {
                    project_id_external_key: {
                        project_id: params.projectId,
                        external_key: params.externalKey
                    }
                }
            });
            const data = {
                project: { connect: { id: params.projectId } },
                external_key: params.externalKey,
                kind: params.kind,
                subtype: params.subtype || null,
                title: params.title,
                description: params.description || null,
                status: params.status || 'planned',
                owner_role: params.ownerRole || null,
                due_at: params.dueAt ? new Date(params.dueAt) : null,
                start_at: params.startAt ? new Date(params.startAt) : null,
                end_at: params.endAt ? new Date(params.endAt) : null,
                decision_at: params.decisionAt ? new Date(params.decisionAt) : null,
                event_at: params.eventAt ? new Date(params.eventAt) : null,
                measurement_at: params.measurementAt ? new Date(params.measurementAt) : null
            };
            let item;
            if (existing) {
                item = await tx.initiative.update({
                    where: { id: existing.id },
                    data: {
                        kind: params.kind,
                        subtype: params.subtype !== undefined ? params.subtype : existing.subtype,
                        title: params.title || existing.title,
                        description: params.description !== undefined ? params.description : existing.description,
                        status: params.status !== undefined ? params.status : existing.status,
                        owner_role: params.ownerRole !== undefined ? params.ownerRole : existing.owner_role,
                        due_at: params.dueAt !== undefined ? (params.dueAt ? new Date(params.dueAt) : null) : existing.due_at,
                        start_at: params.startAt !== undefined ? (params.startAt ? new Date(params.startAt) : null) : existing.start_at,
                        end_at: params.endAt !== undefined ? (params.endAt ? new Date(params.endAt) : null) : existing.end_at,
                        decision_at: params.decisionAt !== undefined ? (params.decisionAt ? new Date(params.decisionAt) : null) : existing.decision_at,
                        event_at: params.eventAt !== undefined ? (params.eventAt ? new Date(params.eventAt) : null) : existing.event_at,
                        measurement_at: params.measurementAt !== undefined ? (params.measurementAt ? new Date(params.measurementAt) : null) : existing.measurement_at
                    }
                });
            }
            else {
                item = await tx.initiative.create({ data });
            }
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
    async checkForCycles(tx, projectId, fromId, toId) {
        // BFS / DFS from `toId` to see if `fromId` is reachable
        const visited = new Set();
        const queue = [toId];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current === fromId)
                return true; // Cycle detected!
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
    /**
     * Links two initiatives with a dependency relationship and cycle detection.
     */
    async linkInitiatives(params) {
        return db_1.default.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId);
            const fromItem = await tx.initiative.findUnique({
                where: { project_id_external_key: { project_id: params.projectId, external_key: params.fromKey } }
            });
            const toItem = await tx.initiative.findUnique({
                where: { project_id_external_key: { project_id: params.projectId, external_key: params.toKey } }
            });
            if (!fromItem)
                throw new Error(`Initiative ${params.fromKey} not found in project ${params.projectId}`);
            if (!toItem)
                throw new Error(`Initiative ${params.toKey} not found in project ${params.projectId}`);
            const depType = params.type || 'blocks';
            // Check for circular dependency
            const hasCycle = await this.checkForCycles(tx, params.projectId, fromItem.id, toItem.id);
            if (hasCycle) {
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
            // Update dependencies_status for toItem
            await tx.initiative.update({
                where: { id: toItem.id },
                data: { dependencies_status: 'confirmed' }
            });
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
    async importOperationalPlan(params) {
        const initiatives = params.externalPlan.initiatives || [];
        const dependencies = params.externalPlan.dependencies || [];
        let importedCount = 0;
        for (const item of initiatives) {
            await this.upsertInitiative({
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
            importedCount++;
        }
        for (const dep of dependencies) {
            await this.linkInitiatives({
                projectId: params.projectId,
                actorId: params.actorId,
                fromKey: dep.from,
                toKey: dep.to,
                type: dep.type || 'blocks',
                condition: dep.condition
            });
        }
        return {
            imported_count: importedCount,
            linked_dependencies_count: dependencies.length
        };
    }
    /**
     * Retrieves an initiative by project_id and external_key.
     */
    async getInitiative(params) {
        await this.requireProjectAccess(db_1.default, params.projectId, params.actorId);
        const item = await db_1.default.initiative.findUnique({
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
                }
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
            confirmed_blockers: confirmedBlockers
        };
    }
    /**
     * Lists initiatives for a project with optional filtering.
     */
    async listInitiatives(params) {
        await this.requireProjectAccess(db_1.default, params.projectId, params.actorId);
        const where = { project_id: params.projectId };
        if (params.filter?.kind)
            where.kind = params.filter.kind;
        if (params.filter?.status)
            where.status = params.filter.status;
        const items = await db_1.default.initiative.findMany({
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
                due_at: item.due_at?.toISOString() || null,
                start_at: item.start_at?.toISOString() || null
            }))
        };
    }
    /**
     * Audits external plan coverage against current database initiatives.
     */
    async auditPlanCoverage(params) {
        await this.requireProjectAccess(db_1.default, params.projectId, params.actorId);
        const externalItems = params.externalPlan.initiatives || [];
        const externalKeys = externalItems.map(i => i.external_key);
        const existingItems = await db_1.default.initiative.findMany({
            where: {
                project_id: params.projectId,
                external_key: { in: externalKeys }
            }
        });
        const existingKeySet = new Set(existingItems.map(i => i.external_key));
        const missingKeys = externalKeys.filter(k => !existingKeySet.has(k));
        return {
            total_external_initiatives: externalKeys.length,
            covered_count: existingKeySet.size,
            missing_count: missingKeys.length,
            missing_keys: missingKeys
        };
    }
    /**
     * Evaluates release readiness for a target initiative based on incoming blocker states.
     */
    async getReleaseReadiness(params) {
        await this.requireProjectAccess(db_1.default, params.projectId, params.actorId);
        const item = await db_1.default.initiative.findUnique({
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
        const isBlocked = blockers.length > 0;
        const isReady = !isBlocked && item.status !== 'blocked';
        return {
            initiative_key: params.initiativeKey,
            status: item.status,
            is_ready: isReady,
            is_blocked: isBlocked,
            blockers
        };
    }
    /**
     * Lists release blockers and downstream impact for overdue initiatives.
     */
    async listReleaseBlockers(params) {
        await this.requireProjectAccess(db_1.default, params.projectId, params.actorId);
        const currentTime = params.asOf ? new Date(params.asOf) : new Date();
        const initiatives = await db_1.default.initiative.findMany({
            where: { project_id: params.projectId },
            include: {
                dependencies_outgoing: {
                    include: { to_initiative: true }
                }
            }
        });
        const overdueInitiatives = [];
        for (const item of initiatives) {
            if (item.status === 'completed')
                continue;
            const targetDate = item.due_at || item.start_at || item.decision_at || item.event_at;
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
    async getOperationalCalendar(params) {
        await this.requireProjectAccess(db_1.default, params.projectId, params.actorId);
        const from = new Date(params.fromDate);
        const to = new Date(params.toDate + 'T23:59:59.999Z');
        const initiatives = await db_1.default.initiative.findMany({
            where: { project_id: params.projectId },
            orderBy: { id: 'asc' }
        });
        const items = [];
        for (const item of initiatives) {
            let dateVal = null;
            let dateType = 'due_at';
            if (item.due_at) {
                dateVal = item.due_at;
                dateType = 'due_at';
            }
            else if (item.start_at) {
                dateVal = item.start_at;
                dateType = 'start_at';
            }
            else if (item.event_at) {
                dateVal = item.event_at;
                dateType = 'event_at';
            }
            else if (item.decision_at) {
                dateVal = item.decision_at;
                dateType = 'decision_at';
            }
            else if (item.end_at) {
                dateVal = item.end_at;
                dateType = 'end_at';
            }
            if (dateVal && dateVal.getTime() >= from.getTime() && dateVal.getTime() <= to.getTime()) {
                items.push({
                    id: item.id,
                    external_key: item.external_key,
                    kind: item.kind,
                    subtype: item.subtype,
                    title: item.title,
                    status: item.status,
                    date_type: dateType,
                    date: dateVal.toISOString()
                });
            }
        }
        return { items };
    }
}
exports.InitiativeService = InitiativeService;
exports.default = new InitiativeService();
