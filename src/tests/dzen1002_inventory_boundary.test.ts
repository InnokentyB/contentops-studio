import assert from 'node:assert/strict';
import test from 'node:test';
import { DzenTaskPublicationService } from '../services/dzen_task_publication.service';
import { DZEN1002_ROUTE as binding } from '../services/dzen_task1002_route.service';
import { enumerateDzen1002Inventory, type InventoryState } from '../services/dzen1002_inventory';

test('INV011 owning preflight selects task1002 reader and exposes sanitized incomplete evidence without writes', async () => {
    let events = 0; let selectedTask: number | undefined;
    const db = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        workflowEvent: { findFirst: async () => null, create: async () => { events++; } },
        contentItem: { findFirst: async () => ({ id: 1002, project_id: 10, channel_id: 116,
            channel: { type: 'dzen', config: { cookies: 'fixture=SECRET', channel_id: binding.providerChannelId } },
            status: 'ready_for_execution', publication_mode: 'owner_released', content_revision: 3, accepted_revision: 3,
            draft_text: 'accepted body', title: 'Exact title', visual_placement: 'article_cover', visual_state: 'APPROVED',
            schedule_at: new Date(binding.schedule), publish_at: new Date(binding.schedule), selected_asset_id: 151,
            selected_asset: { status: 'approved', content_revision: 3, file_url: 'https://assets.example/image.png',
                provenance: { planner_storage: { sha256: binding.assetSha256 } } },
            publication_fact: null, published_link: null, quality_report: {} }) },
        deliveryAttempt: { findFirst: async () => null },
        $transaction: async (run: (tx: unknown) => Promise<unknown>): Promise<unknown> => run(db)
    };
    const service = new DzenTaskPublicationService({ db, hashBody: () => binding.bodySha256,
        dzen: { publishPost: async () => { throw new Error('Forbidden provider write'); },
            testConnection: async () => { throw new Error('Wrong reader'); },
            readStudioPublications: async (_config: unknown, taskId?: 1002) => {
                selectedTask = taskId;
                const inventory = await enumerateDzen1002Inventory({ first: async (state: InventoryState) => ({
                    url: `https://dzen.ru/editor-api/v3/publications?state=${state}`,
                    status: 200, payload: { publications: [] } }), next: async () => { throw new Error('No retry'); } });
                return { authenticated: true, editor_available: true,
                    editor_url: `https://dzen.ru/profile/editor/id/${binding.providerChannelId}/publications`,
                    publications_payload_received: true, title_readback_complete: false,
                    publication_timestamp_readback_complete: true, state_readback_complete: false,
                    coverage_complete: inventory.complete, publications: inventory.publications,
                    inventory_diagnostics: inventory.diagnostics, checked_at: new Date().toISOString() };
            } }, facts: { record: async () => { throw new Error('Forbidden fact write'); } } });
    await assert.rejects(service.verifyConnector({ projectId: 10, taskId: 1002, actorId: 'user:2', idempotencyKey: 'inv011' }),
        (error: unknown) => error instanceof Error && error.message.includes('PAGINATION_UNKNOWN')
            && error.message.includes('published') && error.message.includes('draft') && !error.message.includes('SECRET'));
    assert.equal(selectedTask, 1002);
    assert.equal(events, 0);
});
