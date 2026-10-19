import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { guardManualPublicationFact } from '../services/publication_manual_fact_guard';

test('active pilot job owns its fact; generic callers cannot relabel a manual write as automatic', async () => {
    let locks = 0, reads = 0;
    const tx = { workflowEvent: { findFirst: async () => null }, $queryRaw: async () => { locks++; return []; },
        contentItem: { findFirst: async () => ({ quality_report: null }) }, connectorDispatchJob: {
        findFirst: async (query: unknown) => {
            if ((query as { where: { binding?: unknown } }).where.binding) return null;
            reads++;
            assert.deepEqual(query, { where: { project_id: 10, content_item_id: 1048,
                OR: [{ state: { notIn: ['confirmed', 'cancelled'] } }, { state: 'cancelled', attempt_id: { not: null } }] }, select: { id: true } });
            return { id: 'existing-job' };
        }
    } } as unknown as Prisma.TransactionClient;
    await assert.rejects(guardManualPublicationFact(tx, { projectId: 10, taskId: 1048,
        internalConfirmation: false }), /ADAPTER_RECONCILIATION_REQUIRED/);
    assert.equal(locks, 1); assert.equal(reads, 1);
    await guardManualPublicationFact(tx, { projectId: 10, taskId: 1048, internalConfirmation: true });
    await guardManualPublicationFact(tx, { projectId: 10, taskId: 999, internalConfirmation: false });
    assert.equal(reads, 1);
});

test('resolved pilot may use the existing correction path without creating another job', async () => {
    const tx = { workflowEvent: { findFirst: async () => null }, $queryRaw: async () => [], contentItem: { findFirst: async () => ({ quality_report: null }) },
        connectorDispatchJob: { findFirst: async () => null }
    } as unknown as Prisma.TransactionClient;
    await guardManualPublicationFact(tx, { projectId: 10, taskId: 1048, internalConfirmation: false });
});
