import { Prisma } from '@prisma/client';
import prisma from '../../db';

/**
 * Scopes for work queue operations.
 */
export type WorkQueueScope =
    | 'work_queue:read'
    | 'work_queue:claim'
    | 'work_queue:complete'
    | 'work_queue:block'
    | 'work_queue:release'
    | 'work_queue:decide'
    | 'work_queue:reschedule';

/**
 * Represents a registered service identity with scoped permissions.
 */
export interface RegisteredServiceIdentity {
    actorId: string;
    name: string;
    scopes: WorkQueueScope[];
}

/**
 * Prisma-compatible database client type for use across work queue modules.
 * Accepts both standalone PrismaClient and transaction-scoped clients.
 */
export type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Registry of authorized service identities and their granted scopes.
 */
export const REGISTERED_SERVICE_IDENTITIES: Record<string, RegisteredServiceIdentity> = {
    'system:planner': {
        actorId: 'system:planner',
        name: 'System Content Planner',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    },
    'system:mcp': {
        actorId: 'system:mcp',
        name: 'MCP Server System',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    },
    'system:orchestrator': {
        actorId: 'system:orchestrator',
        name: 'Media Orchestrator Engine',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    },
    'agent:content_writer': {
        actorId: 'agent:content_writer',
        name: 'Content Writer Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release']
    },
    'agent:content_reviewer': {
        actorId: 'agent:content_reviewer',
        name: 'Content Reviewer Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:decide']
    },
    'agent:plan_reviewer': {
        actorId: 'agent:plan_reviewer',
        name: 'Plan Reviewer Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:decide']
    },
    'agent:art_director': {
        actorId: 'agent:art_director',
        name: 'Art Director Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide']
    },
    'tdpd-red-agent': {
        actorId: 'tdpd-red-agent',
        name: 'TDPD Red Test Runner Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    }
};
