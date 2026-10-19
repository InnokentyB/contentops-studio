import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';
import { harness } from './helpers/vk_connector_harness';
import { VkConnectorAppAuthority } from '../services/vk_connector_app_authority';
import { connectorHash, connectorPackageHash } from '../services/vk_connector_contract';
import type { VkConnectorOriginalPhotoProof, VkConnectorPhotoVerification } from '../services/vk_connector_photo_proof';
import type { ConnectorConfirmArgs, ConnectorExecutionIdentity } from '../services/vk_connector_execution_contract';

async function setup(verifyPhoto?: (source: VkConnectorOriginalPhotoProof, hash: string) => Promise<VkConnectorPhotoVerification>) {
    const h = harness(true, 'vk_feed_provider'); h.snapshot.package.bodySha256 = connectorHash('fixture body');
    await h.service.dispatch({ ...h.request, expectedPackageSha256: connectorPackageHash(h.snapshot.package) });
    const consumer = { ...h.consumer, mode: 'vk_feed_provider' as const };
    const [queued] = (await h.service.poll(consumer)).jobs;
    const receipt = await h.service.ack({ ...consumer, ...queued });
    const identity: ConnectorExecutionIdentity = { ...consumer, jobId: receipt.jobId,
        generation: receipt.generation, packageSha256: receipt.packageSha256 };
    h.store.executionPackage = async () => ({ binding: h.snapshot.package, packageSha256: receipt.packageSha256,
        body: 'fixture body', asset: { id: 130, url: 'https://example.test/image.png', sha256: h.snapshot.package.assetSha256 },
        approvalReference: 'fixture-owner-release', releasedAt: '2026-10-12T18:00:00Z', workItemId: 1699,
        permissionStatus: 'NOT_CHECKED', providerExecution: 'blocked' });
    let now = new Date('2026-10-12T19:00:00Z');
    const authority = new VkConnectorAppAuthority(h.service, h.repository, () => new Date(now), verifyPhoto);
    const proof = { ownerId: '-240051152', startedAt: now.toISOString(), capturedAt: now.toISOString(),
        windowStart: '2026-10-12T18:00:00Z', windowEnd: now.toISOString(),
        coverage: 'complete_window', exhausted: true, rows: [] };
    return { h, identity, authority, proof, advance: () => { now = new Date(now.getTime() + 120_001); } };
}
test('VK017 app challenge accepts bounded host evidence once and retains no plaintext nonce in diagnostics', async () => {
    const { h, identity, authority, proof } = await setup();
    assert.equal(await authority.admission(identity), 'NOT_CHECKED');
    const challenge = await authority.issue({ ...identity, purpose: 'wall_read' });
    assert.equal(challenge.authorization, 'application_host');
    const execution = await h.service.executionPackage(identity);
    const envelope = { challengeId: challenge.challengeId, nonce: challenge.nonce, operation: 'wall_read', proof };
    const verified = await authority.verifyEvidence(identity, execution, envelope);
    assert.deepEqual(verified, proof);
    proof.ownerId = '0';
    assert.equal(verified?.ownerId, '-240051152');
    assert.equal(await authority.verifyEvidence(identity, execution, envelope), null);
    assert.equal(JSON.stringify(h.events).includes(challenge.nonce), false);
});
test('VK017 wrong generation, foreign process, fabricated permit and expired app challenge fail closed', async () => {
    const { h, identity, authority, proof, advance } = await setup();
    const challenge = await authority.issue({ ...identity, purpose: 'wall_read' });
    const execution = await h.service.executionPackage(identity);
    const envelope = { challengeId: challenge.challengeId, nonce: challenge.nonce, operation: 'wall_read', proof };
    assert.equal(await authority.admission({ ...identity, generation: identity.generation + 1 }), 'NOT_CHECKED');
    assert.equal(await authority.verifyEvidence({ ...identity, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' }, execution, envelope), null);
    assert.equal(await authority.verifyEvidence(identity, execution, { permitted: true, proof }), null);
    advance();
    assert.equal(await authority.admission(identity), 'NOT_CHECKED');
    assert.equal(await authority.verifyEvidence(identity, execution, envelope), null);
});
test('VK017 proof predating challenge and submission grant on reconciliation-only state are rejected', async () => {
    const { h, identity, authority, proof } = await setup();
    const challenge = await authority.issue({ ...identity, purpose: 'wall_read' });
    const execution = await h.service.executionPackage(identity);
    assert.equal(await authority.verifyEvidence(identity, execution, { challengeId: challenge.challengeId, nonce: challenge.nonce, operation: 'wall_read',
        proof: { ...proof, startedAt: '2026-10-12T18:59:59Z' } }), null);
    const row = h.jobs.get(identity.jobId); assert.ok(row); row.state = 'verification_required';
    await assert.rejects(authority.issue({ ...identity, purpose: 'submission' }), /RECONCILIATION_ONLY/);
});

test('VK017 wall capability grants no upload permission and explicit host denial revokes it', async () => {
    const { identity, authority } = await setup();
    await authority.issue({ ...identity, purpose: 'wall_read' });
    assert.equal(await authority.admission(identity, 'wall_read'), 'PERMITTED');
    assert.equal(await authority.admission(identity, 'submission'), 'NOT_CHECKED');
    authority.revoke(identity);
    assert.equal(await authority.admission(identity), 'NOT_CHECKED');
});

test('VK017 server verifies original bytes for the host-attested exact photo and post', async () => {
    let verified = false, downloads = 0;
    const { h, identity, authority, proof } = await setup(async () => { downloads++; return verified ? { verified: true } : { verified: false, reason: 'PHOTO_HASH_MISMATCH' }; });
    const execution = await h.service.executionPackage(identity);
    const source = { originalUrl: 'https://sun9.userapi.com/original.png', capturedAt: proof.capturedAt,
        postObjectId: '-240051152_61', providerMediaId: 'photo-240051152_55' };
    const exact = { ...proof, rows: [{ objectId: source.postObjectId, publicUrl: 'https://vk.com/wall-240051152_61',
        publishedAt: proof.capturedAt, text: execution.body, media: { assetSha256: execution.binding.assetSha256,
            providerMediaId: source.providerMediaId, acknowledged: true, source } }] };
    const wrap = async () => ({ ...await authority.issue({ ...identity, purpose: 'wall_read' }), operation: 'wall_read' as const, proof: exact });
    const first = await wrap();
    // Transport envelopes contain only the nonce fields and proof, not response metadata.
    const envelope = { challengeId: first.challengeId, nonce: first.nonce, operation: first.operation, proof: first.proof };
    assert.equal(await authority.verifyEvidence(identity, execution, envelope), null);
    assert.equal(downloads, 1);
    verified = true;
    const second = await wrap();
    assert.ok(await authority.verifyEvidence(identity, execution, { challengeId: second.challengeId, nonce: second.nonce,
        operation: second.operation, proof: second.proof }));
    assert.equal(downloads, 2);
});

test('VK017 confirmation attestation requires full matching post/photo proof and is single-use', async () => {
    const { h, identity, authority, proof } = await setup(async () => ({ verified: true }));
    const row = h.jobs.get(identity.jobId); assert.ok(row); row.state = 'executing'; row.attemptId = 51;
    const execution = await h.service.executionPackage(identity);
    const challenge = await authority.issue({ ...identity, purpose: 'post_confirm' });
    const fields = { providerObjectId: '-240051152_61', publicUrl: 'https://vk.com/wall-240051152_61',
        publishedAt: proof.capturedAt, evidenceSha256: 'f'.repeat(64), providerTimestampSource: 'provider' as const,
        postBaselineCapturedAt: proof.startedAt, postBaselineObjectIds: [], postSubmissionStartedAt: proof.startedAt,
        readbackObservedAt: proof.capturedAt, mediaAcknowledgement: { assetSha256: execution.binding.assetSha256,
            providerMediaId: 'photo-240051152_55', acknowledged: true as const, providerObjectId: '-240051152_61' } };
    const args: ConnectorConfirmArgs = { ...identity, ...fields, taskId: 1048, channelId: 117, workItemId: 1699,
        leaseToken: 'ephemeral-fixture-lease', approvalReference: execution.approvalReference, idempotencyKey: 'fixture-confirm',
        contentRevision: 1, textSha256: execution.binding.bodySha256, imageSha256: execution.binding.assetSha256,
        selectedAssetId: 130, placement: 'feed', attemptId: 51, providerAttestation: { challengeId: challenge.challengeId,
            nonce: challenge.nonce, operation: 'post_confirm', proof: { ...fields, mediaSource: {
                originalUrl: 'https://sun9.userapi.com/original.png', capturedAt: proof.capturedAt,
                postObjectId: fields.providerObjectId, providerMediaId: fields.mediaAcknowledgement.providerMediaId } } } };
    assert.equal(await authority.verifyMediaAcknowledgement(args, execution), true);
    assert.equal(await authority.verifyMediaAcknowledgement(args, execution), false);
});

test('VK017 challenge, renewal and rebind remain Publisher/project10 scoped with server-bound actor', () => {
    for (const name of ['ba_issue_vk_connector_challenge','ba_renew_vk_connector_heartbeat','ba_rebind_vk_connector_reconciliation']) {
        const body = { method: 'tools/call', params: { name, arguments: { projectId: 10, actorId: 'user:999' } } };
        assert.equal(scopeRemoteMcpRequest(body, { userId: 2, actorId: 'user:2', projectId: 10, profile: 'planner' }).allowed, false);
        assert.equal(scopeRemoteMcpRequest(body, { userId: 2, actorId: 'user:2', projectId: 7, profile: 'publisher' }).allowed, false);
        const allowed = scopeRemoteMcpRequest(body, { userId: 2, actorId: 'user:2', projectId: 10, profile: 'publisher' });
        assert.equal(allowed.allowed, true);
        if (allowed.allowed) assert.equal(allowed.body.params.arguments.actorId, 'user:2');
    }
});
