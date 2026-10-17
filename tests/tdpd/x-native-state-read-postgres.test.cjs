const test = require('node:test'), assert = require('node:assert/strict');
const { db, pool, deps, getXNativeState, setup, install, fingerprint, wrappedDb, sha } = require('./x-native-state-read.fixture.cjs');
test.after(async () => { await db.$disconnect(); await pool.end(); });

test('READ-04/05/09: exact complete DTO, READ ONLY RepeatableRead, zero writes or secret fields', async t => {
    const s = await setup(t), before = await fingerprint(s), queries = [];
    const guarded = wrappedDb(async ({ operation, query, call, tx }) => {
        queries.push({ operation, sql: query.sql ?? query.join?.('') });
        const result = await call();
        if (queries.length === 2) {
            const rows = await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS isolation`;
            assert.deepEqual(rows, [{ ro: 'on', isolation: 'repeatable read' }]);
        }
        return result;
    });
    const value = await getXNativeState(s.args, { ...deps, db: guarded });
    assert.equal(value.complete, true); assert.equal(value.binding.status, 'consistent');
    assert.deepEqual(value.installations, { complete: true, totalCount: 0, candidateState: 'absent', otherActivePresent: false, rows: [] });
    assert.equal(value.taskState.status, 'known');
    assert.ok(Object.entries(value.taskState).filter(([key]) => key !== 'status').every(([, value]) => value === false));
    assert.ok(Object.values(value.effects).every(value => value === false));
    assert.equal(await fingerprint(s), before); assert.ok(queries.filter(q => q.operation === '$queryRaw').length <= 24);
    assert.match(queries[0].sql, /SET TRANSACTION READ ONLY/);
    assert.ok(!JSON.stringify(value).includes('hidden-synthetic'));
    await db.socialChannel.update({ where: { id: s.channel.id }, data: { is_active: false } });
    assert.equal((await getXNativeState(s.args, deps)).binding.channelActive, false);
});

test('READ-02/04: real owner membership and exact tenant/channel/task are required', async t => {
    const s = await setup(t), foreign = await setup(t);
    await assert.rejects(getXNativeState({ ...s.args, actorId: foreign.args.actorId }, deps), /OWNER_REQUIRED/);
    await assert.rejects(getXNativeState({ ...s.args, taskId: foreign.task.id }, deps), /STATE_SCOPE_DENIED/);
    await assert.rejects(getXNativeState({ ...s.args, channelId: foreign.channel.id }, deps), /STATE_SCOPE_DENIED/);
    await db.projectMember.update({ where: { project_id_user_id: { project_id: s.project.id, user_id: Number(s.args.actorId.slice(5)) } }, data: { role: 'publisher' } });
    await assert.rejects(getXNativeState(s.args, deps), /OWNER_REQUIRED/);
    await db.projectMember.update({ where: { project_id_user_id: { project_id: s.project.id, user_id: Number(s.args.actorId.slice(5)) } }, data: { role: 'owner' } });
    await db.socialChannel.update({ where: { id: s.channel.id }, data: { type: 'telegram' } });
    await assert.rejects(getXNativeState(s.args, deps), /STATE_SCOPE_DENIED/);
});

test('READ-09: PostgreSQL rejects a scoped write inside the actual diagnostics transaction', async t => {
    const s = await setup(t), before = await fingerprint(s); let probed = false;
    const database = wrappedDb(async ({ operation, call, tx }) => {
        const value = await call();
        if (!probed && operation === '$queryRaw') {
            probed = true;
            await tx.$executeRaw`UPDATE planner.project_settings SET value = 'forbidden' WHERE project_id = ${s.project.id}`;
        }
        return value;
    });
    await assert.rejects(getXNativeState(s.args, { ...deps, db: database }), /read-only transaction/);
    assert.equal(probed, true); assert.equal(await fingerprint(s), before);
    assert.equal((await getXNativeState(s.args, deps)).complete, true);
});

test('READ-06: audited same/other-owner keys, sticky revocation and missing/mismatched records', async t => {
    const s = await setup(t), first = await install(s);
    const value = await getXNativeState({ ...s.args, candidateInstallationId: first.record.installationId }, deps);
    assert.equal(value.installations.candidateState, 'active');
    assert.equal(value.installations.rows[0].registeredByCaller, true);
    assert.ok(!JSON.stringify(value).includes(first.record.publicKey.x));
    const other = await install(s, { actorId: 'user:2147483646' });
    assert.equal((await getXNativeState({ ...s.args, candidateInstallationId: first.record.installationId }, deps)).installations.otherActivePresent, true);
    const key = `${s.channel.id}:${first.record.installationId}`;
    await db.workflowEvent.create({ data: { project_id: s.project.id, actor_id: s.args.actorId,
        command: 'x_native_revoke_installation', idempotency_key: key, after_state: {} } });
    assert.equal((await getXNativeState({ ...s.args, candidateInstallationId: first.record.installationId }, deps)).installations.candidateState, 'revoked');
    await db.projectSettings.delete({ where: { id: other.setting.id } });
    const broken = await getXNativeState(s.args, deps);
    assert.equal(broken.complete, false); assert.equal(broken.installations.candidateState, 'unknown');
    assert.equal(broken.installations.otherActivePresent, null);
    assert.equal(broken.installations.rows.find(row => row.installationId === other.record.installationId).effectiveState, 'untrusted');
    await db.projectSettings.update({ where: { id: first.setting.id }, data: { value: JSON.stringify({ ...first.record, revoked: true }) } });
    assert.equal((await getXNativeState(s.args, deps)).installations.rows.find(row => row.installationId === first.record.installationId).effectiveState, 'revoked');
});

test('READ-07: invalid prefix suffix, oversized values and21-ID cap never become empty complete', async t => {
    const s = await setup(t);
    await db.projectSettings.create({ data: { project_id: s.project.id, key: `x_native:installation:v1:${s.channel.id}:bad`, value: '{}' } });
    let value = await getXNativeState(s.args, deps);
    assert.equal(value.complete, false); assert.equal(value.installations.totalCount, null);
    assert.equal(value.installations.candidateState, 'unknown'); assert.ok(value.warnings.includes('INVALID_RECORD'));
    await db.projectSettings.deleteMany({ where: { project_id: s.project.id } });
    const item = await install(s);
    await db.projectSettings.update({ where: { id: item.setting.id }, data: { value: ' '.repeat(2049) } });
    value = await getXNativeState(s.args, deps);
    assert.equal(value.complete, false); assert.equal(value.installations.otherActivePresent, null);
    for (let n = 2; n <= 22; n++) await db.projectSettings.create({ data: { project_id: s.project.id,
        key: `x_native:installation:v1:${s.channel.id}:${sha(String(n))}`, value: '{}' } });
    value = await getXNativeState(s.args, deps);
    assert.equal(value.installations.rows.length, 20); assert.ok(value.warnings.includes('INVENTORY_OVERFLOW'));
    assert.equal(value.installations.candidateState, 'unknown');
});

test('READ-06/07: audit hash mismatch, malformed JSON and key fingerprint mismatch stay untrusted', async t => {
    const s = await setup(t), item = await install(s);
    const args = { ...s.args, candidateInstallationId: item.record.installationId };
    await db.workflowEvent.update({ where: { id: item.event.id }, data: { after_state: { registration_sha256: '0'.repeat(64) } } });
    let value = await getXNativeState(args, deps);
    assert.equal(value.installations.candidateState, 'untrusted');
    assert.equal(value.installations.rows[0].auditStatus, 'mismatch'); assert.equal(value.complete, false);
    await db.projectSettings.update({ where: { id: item.setting.id }, data: { value: '{"invalid"' } });
    value = await getXNativeState(args, deps);
    assert.ok(value.warnings.includes('INVALID_RECORD')); assert.equal(value.installations.candidateState, 'untrusted');
    await db.projectSettings.update({ where: { id: item.setting.id }, data: { value: JSON.stringify({ ...item.record, installationId: 'f'.repeat(64) }) } });
    value = await getXNativeState(args, deps);
    assert.equal(value.installations.candidateState, 'untrusted'); assert.equal(value.installations.totalCount, null);
    await db.projectSettings.update({ where: { id: item.setting.id }, data: { value: 'é'.repeat(1025) } });
    assert.equal((await getXNativeState(args, deps)).complete, false, '2048-byte cap is UTF8, not character count');
});

test('READ-07: revocation beyond audit row80 is still exhaustive, never active', async t => {
    const s = await setup(t), item = await install(s), key = `${s.channel.id}:${item.record.installationId}`;
    for (let n = 1; n <= 80; n++) await db.workflowEvent.create({ data: { project_id: s.project.id,
        actor_id: `user:${100000 + n}`, command: 'x_native_register_installation', idempotency_key: key,
        after_state: { registration_sha256: '0'.repeat(64) } } });
    await db.workflowEvent.create({ data: { project_id: s.project.id, actor_id: s.args.actorId,
        command: 'x_native_revoke_installation', idempotency_key: key, after_state: {} } });
    const value = await getXNativeState({ ...s.args, candidateInstallationId: item.record.installationId }, deps);
    assert.ok(value.warnings.includes('AUDIT_OVERFLOW')); assert.equal(value.complete, false);
    assert.equal(value.installations.candidateState, 'revoked');
    assert.equal(value.installations.rows[0].effectiveState, 'revoked');
});

test('READ-07: oversized or non-object audit metadata cannot prove active enrollment', async t => {
    const s = await setup(t), item = await install(s), args = { ...s.args, candidateInstallationId: item.record.installationId };
    await db.workflowEvent.update({ where: { id: item.event.id }, data: { after_state: {
        registration_sha256: sha(JSON.stringify(item.record)), oversized: 'é'.repeat(1025) } } });
    let value = await getXNativeState(args, deps);
    assert.equal(value.complete, false); assert.notEqual(value.installations.candidateState, 'active');
    await db.workflowEvent.update({ where: { id: item.event.id }, data: { after_state: ['malformed-secret-value'] } });
    value = await getXNativeState(args, deps);
    assert.equal(value.complete, false); assert.equal(value.installations.rows[0].effectiveState, 'untrusted');
    await db.workflowEvent.create({ data: { project_id: s.project.id, actor_id: s.args.actorId,
        command: 'x_native_revoke_installation', idempotency_key: `${s.channel.id}:${item.record.installationId}`,
        after_state: ['malformed-revocation-still-wins'] } });
    assert.equal((await getXNativeState(args, deps)).installations.candidateState, 'revoked');
});

test('READ-08: exact-task historical delivery predicates, unrelated jobs excluded and malformed release unknown', async t => {
    const s = await setup(t), unrelated = await db.contentItem.create({ data: { project_id: s.project.id, channel_id: s.channel.id, type: 'publication' } });
    await db.deliveryAttempt.create({ data: { project_id: s.project.id, content_item_id: unrelated.id, channel_id: s.channel.id, status: 'pending' } });
    assert.equal((await getXNativeState(s.args, deps)).taskState.attemptPresent, false);
    const oldChannel = await db.socialChannel.create({ data: { project_id: s.project.id, name: 'old', type: 'x', config: {} } });
    await db.deliveryAttempt.create({ data: { project_id: s.project.id, content_item_id: s.task.id, channel_id: oldChannel.id, status: 'pending' } });
    const wi = await db.workItem.create({ data: { project_id: s.project.id, content_item_id: s.task.id,
        item_key: 'synthetic-historical', kind: 'browser_publish', state: 'claimed', assignee_role: 'browser_publisher',
        input_context_version: 1, lease_token: 'hidden-synthetic-lease', result_payload: { secret: 'hidden-synthetic-payload' } } });
    const asset = await db.imageAsset.create({ data: { project_id: s.project.id, content_item_id: s.task.id, prompt: 'synthetic' } });
    await db.connectorDispatchJob.create({ data: { project_id: s.project.id, content_item_id: s.task.id,
        channel_id: s.channel.id, work_item_id: wi.id, content_revision: 1, selected_asset_id: asset.id,
        package_sha256: '0'.repeat(64), binding: {}, idempotency_key: 'synthetic-stray', state: 'queued' } });
    let value = await getXNativeState(s.args, deps);
    assert.equal(value.taskState.attemptPresent, true); assert.equal(value.taskState.unresolvedAttemptPresent, true);
    assert.equal(value.taskState.nonterminalBrowserWorkPresent, true); assert.equal(value.taskState.nonterminalDispatchJobPresent, true);
    assert.ok(!JSON.stringify(value).includes('hidden-synthetic'));
    await db.contentItem.update({ where: { id: s.task.id }, data: { published_link: 'https://x.com/synthetic_x/status/123',
        quality_report: { browser_identity_binding: { identity: s.identity }, browser_release: {} } } });
    value = await getXNativeState(s.args, deps);
    assert.equal(value.taskState.currentReleasePresent, true); assert.equal(value.taskState.publishedLinkPresent, true);
    await db.publicationFact.create({ data: { project_id: s.project.id, content_item_id: s.task.id,
        channel_id: oldChannel.id, artifact_kind: 'social_post', outcome: 'published',
        confirmation_mode: 'synthetic', confirmed_by: s.args.actorId, evidence_ref: 'hidden-synthetic-proof' } });
    assert.equal((await getXNativeState(s.args, deps)).taskState.publicationFactPresent, true);
    await db.contentItem.update({ where: { id: s.task.id }, data: { quality_report: { browser_release: 'malformed-secret-must-not-escape' } } });
    value = await getXNativeState(s.args, deps);
    assert.equal(value.taskState.status, 'unknown'); assert.equal(value.taskState.currentReleasePresent, null); assert.equal(value.complete, false);
});

test('READ-09: concurrent insert is not mixed into the earlier RepeatableRead snapshot', async t => {
    const s = await setup(t); let inserted = false;
    const database = wrappedDb(async ({ query, call }) => {
        const result = await call();
        if (!inserted && query.sql?.includes('FROM planner.social_channels')) { inserted = true; await install(s); }
        return result;
    });
    assert.equal((await getXNativeState(s.args, { ...deps, db: database })).installations.totalCount, 0);
    assert.equal((await getXNativeState(s.args, deps)).installations.totalCount, 1);
});

test('READ-10: exactly2 in-flight reads, third BUSY; errors/timeouts release capacity', async t => {
    const s = await setup(t); let held = 0, both;
    const entered = new Promise(resolve => { both = resolve; }); let release;
    const gate = new Promise(resolve => { release = resolve; });
    const database = wrappedDb(async ({ operation, call }) => {
        const result = await call();
        if (operation === '$executeRaw' && ++held <= 2) { if (held === 2) both(); await gate; }
        return result;
    });
    const first = getXNativeState(s.args, { ...deps, db: database }), second = getXNativeState(s.args, { ...deps, db: database });
    await entered;
    await assert.rejects(getXNativeState(s.args, deps), /STATE_BUSY/);
    release(); await Promise.all([first, second]);
    let delay = true;
    const slow = wrappedDb(async ({ operation, call, tx }) => {
        const result = await call();
        if (delay && operation === '$queryRaw') { delay = false; await tx.$queryRaw`SELECT pg_sleep(1.1)`; }
        return result;
    });
    const start = Date.now();
    await assert.rejects(getXNativeState(s.args, { ...deps, db: slow }));
    assert.ok(Date.now() - start < 2100);
    assert.equal((await getXNativeState(s.args, deps)).complete, true);
});
