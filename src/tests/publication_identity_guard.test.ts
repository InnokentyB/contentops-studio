import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    assertAndClaimPublicationIdentity,
    assertReportedSourceLineage,
    canonicalizeMediumProfile,
    countUniquePublicationIdentities,
    normalizePublicationBody,
    publicationBodySha256,
    resolvePublicationIdentityCollision,
    structuredSourceIdentity
} from '../services/publication_identity.service';
import { authorizeIntentionalMediumRepublication } from '../services/medium_republication_authorization.service';
import { DbClient } from '../services/work_queue/types';
import { isToolAllowedForProfile } from '../mcp/capabilities';

type FakeClaim = Record<string, unknown> & { id: number; content_item_id: number; override_key: string };
type FakeTask = {
    id: number; project_id: number; channel_id: number; content_revision: number;
    draft_text: string | null; status: string; source_refs: unknown;
    channel: { id: number; type: string; config: { username: string } };
    publication_fact: { id: number; public_url: string } | null;
};

function mediumTask(id: number, body: string | null, username = 'i.a.bodrov85', published = false): FakeTask {
    return {
        id, project_id: 10, channel_id: id + 100, content_revision: 1, draft_text: body,
        status: published ? 'published' : 'drafted', source_refs: [{ type: 'source_package', ref: `SP-${id}` }],
        channel: { id: id + 100, type: 'medium', config: { username } },
        publication_fact: published ? { id: id + 1000, public_url: `https://medium.com/@${username}/fact-${id}` } : null
    };
}

function identityHarness(tasks: FakeTask[], events: Array<Record<string, unknown>> = []) {
    const claims: FakeClaim[] = [];
    let nextId = 1;
    const db = {
        contentItem: {
            findFirst: async ({ where }: { where: { id: number } }) => tasks.find(task => task.id === where.id) || null,
            findMany: async ({ where }: { where: { id: { not: number } } }) => tasks.filter(task => task.id !== where.id.not && task.draft_text !== null)
        },
        workflowEvent: {
            findFirst: async ({ where }: { where: { content_item_id: number } }) => [...events].reverse().find(event => event.content_item_id === where.content_item_id) || null
        },
        publicationIdentityClaim: {
            findUnique: async ({ where }: { where: { content_item_id: number } }) => claims.find(claim => claim.content_item_id === where.content_item_id) || null,
            delete: async ({ where }: { where: { id: number } }) => {
                const index = claims.findIndex(claim => claim.id === where.id);
                if (index >= 0) claims.splice(index, 1);
            },
            findFirst: async ({ where }: { where: Record<string, unknown> }) => claims.find(claim =>
                Object.entries(where).every(([key, value]) => claim[key] === value)) || null,
            createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
                const entry = data[0];
                const collision = claims.some(claim => claim.project_id === entry.project_id
                    && claim.platform === entry.platform
                    && claim.canonical_profile_hash === entry.canonical_profile_hash
                    && claim.normalized_body_sha256 === entry.normalized_body_sha256
                    && claim.override_key === entry.override_key);
                if (collision) return { count: 0 };
                claims.push({ ...entry, id: nextId++, content_item_id: Number(entry.content_item_id), override_key: String(entry.override_key) });
                return { count: 1 };
            }
        }
    };
    return { db: db as unknown as DbClient, claims };
}

test('Medium body identity normalizes line endings, Unicode and terminal whitespace', () => {
    const canonical = 'caf\u00e9\nsecond line';
    const variant = 'cafe\u0301\r\nsecond line  \r\n\t';
    assert.equal(normalizePublicationBody(variant), canonical);
    assert.equal(publicationBodySha256(variant), publicationBodySha256(canonical));
});

test('Medium profile identity canonicalizes equivalent profile forms', () => {
    assert.equal(canonicalizeMediumProfile('https://medium.com/@I.A.Bodrov85/'), 'medium.com/@i.a.bodrov85');
    assert.equal(canonicalizeMediumProfile('@I.A.Bodrov85'), 'medium.com/@i.a.bodrov85');
    assert.equal(canonicalizeMediumProfile('i.a.bodrov85'), 'medium.com/@i.a.bodrov85');
});

test('same profile and normalized body on another task is a collision', () => {
    const match = resolvePublicationIdentityCollision({
        taskId: 1053,
        canonicalProfile: 'medium.com/@i.a.bodrov85',
        normalizedBodySha256: publicationBodySha256('same body')
    }, [{
        taskId: 1037,
        canonicalProfile: 'medium.com/@i.a.bodrov85',
        normalizedBodySha256: publicationBodySha256('same body\r\n '),
        factId: 434,
        publicUrl: 'https://medium.com/@i.a.bodrov85/example-434'
    }]);
    assert.deepEqual(match, {
        task_id: 1037,
        fact_id: 434,
        public_url: 'https://medium.com/@i.a.bodrov85/example-434'
    });
});

test('same body on a different Medium profile is allowed', () => {
    const match = resolvePublicationIdentityCollision({
        taskId: 1053,
        canonicalProfile: 'medium.com/@second',
        normalizedBodySha256: publicationBodySha256('same body')
    }, [{
        taskId: 1037,
        canonicalProfile: 'medium.com/@first',
        normalizedBodySha256: publicationBodySha256('same body'),
        factId: 434,
        publicUrl: 'https://medium.com/@first/example-434'
    }]);
    assert.equal(match, null);
});

test('unique-content coverage collapses facts sharing one canonical identity', () => {
    const rows = [
        { canonicalProfile: 'medium.com/@one', normalizedBodySha256: 'a'.repeat(64) },
        { canonicalProfile: 'medium.com/@one', normalizedBodySha256: 'a'.repeat(64) },
        { canonicalProfile: 'medium.com/@two', normalizedBodySha256: 'a'.repeat(64) },
        { canonicalProfile: 'medium.com/@one', normalizedBodySha256: 'b'.repeat(64) }
    ];
    assert.equal(countUniquePublicationIdentities(rows), 3);
});

test('published same-profile task blocks another task and returns prior fact evidence', async () => {
    const body = 'canonical article';
    const duplicate = { ...mediumTask(1037, body), source_refs: null };
    const harness = identityHarness([duplicate, mediumTask(1053, `${body}\r\n  `, 'i.a.bodrov85', true)]);
    await assert.rejects(
        assertAndClaimPublicationIdentity(harness.db, {
            projectId: 10, taskId: 1037, boundary: 'writer_completion', body
        }),
        /DUPLICATE_PUBLICATION_CANDIDATE.*2053.*fact-1053/
    );
    assert.equal(harness.claims.length, 0);
});

test('audited exact prior-fact authorization permits intentional republication claim', async () => {
    const body = 'canonical article';
    const target = mediumTask(1053, body);
    const prior = mediumTask(1037, body, 'i.a.bodrov85', true);
    const harness = identityHarness([target, prior], [{
        id: 77,
        project_id: 10,
        content_item_id: target.id,
        command: 'ba_authorize_intentional_medium_republication',
        after_state: {
            authorized: true,
            prior_fact_id: prior.publication_fact?.id,
            canonical_profile: 'medium.com/@i.a.bodrov85',
            normalized_body_sha256: publicationBodySha256(body)
        }
    }]);
    const result = await assertAndClaimPublicationIdentity(harness.db, {
        projectId: 10, taskId: target.id, boundary: 'release'
    });
    assert.equal(result.intentional_republication, true);
    assert.equal(harness.claims[0].override_key, 'intentional-republish:77');
});

test('concurrent same-profile claims leave exactly one canonical owner', async () => {
    const first = mediumTask(1, null);
    const second = mediumTask(2, null);
    const harness = identityHarness([first, second]);
    const attempts = await Promise.allSettled([
        assertAndClaimPublicationIdentity(harness.db, {
            projectId: 10, taskId: first.id, boundary: 'writer_completion', body: 'race body'
        }),
        assertAndClaimPublicationIdentity(harness.db, {
            projectId: 10, taskId: second.id, boundary: 'writer_completion', body: 'race body\r\n '
        })
    ]);
    assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(attempt => attempt.status === 'rejected').length, 1);
    assert.equal(harness.claims.length, 1);
});

test('Medium guard fails closed without structured source lineage', async () => {
    const task = { ...mediumTask(1, 'body'), source_refs: null };
    const harness = identityHarness([task]);
    await assert.rejects(assertAndClaimPublicationIdentity(harness.db, {
        projectId: 10, taskId: task.id, boundary: 'editorial_acceptance'
    }), /SOURCE_LINEAGE_REQUIRED/);
});

test('Writer-reported source package cannot drift from persisted structured lineage', () => {
    const persisted = [{ type: 'source_package', ref: 'CONTENTOPS-SP-2026-W41-01' }];
    assert.doesNotThrow(() => assertReportedSourceLineage({
        source_package_id: 'CONTENTOPS-SP-2026-W41-01'
    }, persisted));
    assert.throws(() => assertReportedSourceLineage({
        source_package_id: 'AC-SP-2026-10-02-QWEN15B-ATOMIC'
    }, persisted), /SOURCE_LINEAGE_DRIFT/);
});

test('persisted source identity excludes credentials and unrelated payload fields', () => {
    assert.deepEqual(structuredSourceIdentity([{
        type: 'source_package', ref: 'SP-1', authorization: 'credential-must-not-persist',
        cookies: 'cookie-must-not-persist', body: 'large payload'
    }]), [{ type: 'source_package', ref: 'SP-1' }]);
});

test('all publication boundaries invoke the canonical identity guard before advancing', () => {
    const root = join(__dirname, '..');
    const sources = [
        ['services/work_queue/lifecycle_operations.js', 'writer_completion'],
        ['services/work_queue.service.js', 'editorial_acceptance'],
        ['services/mcp_publication/tasks.js', 'release'],
        ['services/publishers/publication_dispatcher.js', 'release'],
        ['services/publication_fact.service.js', 'fact_recording']
    ];
    for (const [relativePath, boundary] of sources) {
        const source = readFileSync(join(root, relativePath), 'utf8');
        assert.match(source, /assertAndClaimPublicationIdentity/);
        assert.match(source, new RegExp(`boundary: '${boundary}'`));
    }
});

test('intentional republication authorization remains owner-only', () => {
    const tool = 'ba_authorize_intentional_medium_republication';
    assert.equal(isToolAllowedForProfile('owner', tool), true);
    for (const profile of ['writer', 'editor', 'publisher', 'planner', 'growth_analyst'] as const) {
        assert.equal(isToolAllowedForProfile(profile, tool), false);
    }
});

test('owner authorization writes one audit event and does not create a fact or provider call', async () => {
    const body = 'intentional repeat';
    const target = mediumTask(22, body);
    const prior = mediumTask(11, body, 'i.a.bodrov85', true);
    const createdEvents: Array<Record<string, unknown>> = [];
    let factWrites = 0;
    let providerCalls = 0;
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
                createdEvents.push(data);
                return { id: 88, ...data };
            }
        },
        contentItem: { findFirst: async () => target },
        publicationFact: {
            findFirst: async () => ({
                ...prior.publication_fact,
                project_id: 10,
                outcome: 'published',
                content_item_id: prior.id,
                content_item: prior
            }),
            create: async () => { factWrites += 1; },
            update: async () => { factWrites += 1; }
        },
        provider: { publish: async () => { providerCalls += 1; } }
    };
    const database = {
        $transaction: async (operation: (client: typeof tx) => Promise<Record<string, unknown>>) => operation(tx)
    } as unknown as Parameters<typeof authorizeIntentionalMediumRepublication>[1];
    const result = await authorizeIntentionalMediumRepublication({
        projectId: 10,
        actorId: 'user:2',
        taskId: target.id,
        priorFactId: prior.publication_fact!.id,
        expectedCanonicalProfile: 'https://medium.com/@i.a.bodrov85',
        expectedNormalizedBodySha256: publicationBodySha256(body),
        reason: 'Owner-approved anniversary republication',
        idempotencyKey: 'intentional-repeat-22-v1'
    }, database);
    assert.equal(result.authorization_event_id, 88);
    assert.equal(createdEvents.length, 1);
    assert.equal(createdEvents[0].command, 'ba_authorize_intentional_medium_republication');
    assert.equal(factWrites, 0);
    assert.equal(providerCalls, 0);
});
