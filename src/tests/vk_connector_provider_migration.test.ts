import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
const migration = (name: string) => fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations', name, 'migration.sql'), 'utf8');
const columns = '20261013100000_vk_connector_provider_fencing';
const mode = '20261013110000_vk_connector_provider_mode';
const fixture = `CREATE SCHEMA planner;
CREATE TABLE planner.projects(id INTEGER PRIMARY KEY);
CREATE TABLE planner.content_items(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.social_channels(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.work_items(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.image_assets(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.delivery_attempts(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.publication_facts(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
INSERT INTO planner.projects VALUES(10);
INSERT INTO planner.content_items VALUES(1048,10);
INSERT INTO planner.social_channels VALUES(117,10);
INSERT INTO planner.work_items VALUES(1699,10);
INSERT INTO planner.image_assets VALUES(130,10);`;
const insert = `INSERT INTO planner.connector_dispatch_jobs
(id,project_id,content_item_id,channel_id,work_item_id,content_revision,selected_asset_id,package_sha256,binding,idempotency_key,state,generation,receipt_at,blocker_code,updated_at)
VALUES('3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de',10,1048,117,1699,1,130,repeat('a',64),
jsonb_build_object('projectId',10,'taskId',1048,'channelId',117,'revision',1,'selectedAssetId',130,'communityId',-240051152,'placement','feed','bodySha256',repeat('a',64),'assetSha256',repeat('b',64),'releaseSha256',repeat('c',64)),
'preserve-existing','blocked',1,'2026-10-12T19:48:02.088Z','PROVIDER_CONTROL_DENIED',CURRENT_TIMESTAMP);
INSERT INTO planner.connector_host_status(project_id,host_id,instance_id,build_version,heartbeat_at,mode)
VALUES(10,'vk-connector-local-1048','instance-test','016',CURRENT_TIMESTAMP,'infrastructure_only');`;
test('VK017-DB: lease columns preserve existing blocked job and retain old hostmode until reader rollout', async () => {
    const db = new PGlite();
    try {
        await db.exec(fixture); await db.exec(migration('20261012190000_add_vk_connector_dispatch')); await db.exec(insert);
        const query = 'SELECT id,state,generation,receipt_at,blocker_code,binding FROM planner.connector_dispatch_jobs';
        const before = (await db.query(query)).rows;
        await db.exec(migration(columns));
        assert.deepEqual((await db.query(query)).rows, before);
        assert.deepEqual((await db.query('SELECT canonical_lease_sha256,canonical_lease_expires_at FROM planner.connector_dispatch_jobs')).rows,
            [{canonical_lease_sha256:null,canonical_lease_expires_at:null}]);
        await assert.rejects(db.exec("UPDATE planner.connector_host_status SET mode='vk_feed_provider'"), /check/i);
        await assert.rejects(db.exec("UPDATE planner.connector_dispatch_jobs SET canonical_lease_sha256='raw-lease-token'"), /check/i);
        await db.exec(migration(mode));
        await db.exec("UPDATE planner.connector_host_status SET mode='vk_feed_provider'");
        await assert.rejects(db.exec("UPDATE planner.connector_host_status SET mode='unrestricted_provider'"), /check/i);
        assert.deepEqual((await db.query(query)).rows, before);
        await db.exec("UPDATE planner.connector_host_status SET mode='infrastructure_only'");
        assert.equal((await db.query<{count:number}>('SELECT count(*)::INTEGER AS count FROM planner.delivery_attempts')).rows[0].count, 0);
        assert.equal((await db.query<{count:number}>('SELECT count(*)::INTEGER AS count FROM planner.publication_facts')).rows[0].count, 0);
    } finally { await db.close(); }
});
test('VK017-DB: additive rollback keeps all jobs, canonical leases and publication history', () => {
    const sql = `${migration(columns)}\n${migration(mode)}`.replace(/--[^\n]*/g, '');
    assert.doesNotMatch(sql, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|CASCADE)\b/i);
    assert.doesNotMatch(sql, /^\s*(?:UPDATE|INSERT INTO)\s+planner\.(?:content_items|work_items|publication_facts)/mi);
    assert.doesNotMatch(sql, /\b(?:access_token|lease_token|cookies|authorization_header)\s+(?:TEXT|JSONB)/i);
});
test('VK017-DB: competing transport lease bindings cannot win the same generation twice', async () => {
    const db = new PGlite();
    try {
        await db.exec(fixture); await db.exec(migration('20261012190000_add_vk_connector_dispatch'));
        await db.exec(insert); await db.exec(migration(columns));
        const update = `UPDATE planner.connector_dispatch_jobs SET state='ready',generation=2,
            canonical_lease_sha256=$1,canonical_lease_expires_at='2026-10-13T20:00:00Z'
            WHERE id='3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de' AND generation=1 AND state='blocked' RETURNING id`;
        const results = await Promise.all([db.query(update, ['a'.repeat(64)]), db.query(update, ['b'.repeat(64)])]);
        assert.equal(results.reduce((sum, result) => sum + result.rows.length, 0), 1);
        const rows = await db.query<{generation:number;canonical_lease_sha256:string}>('SELECT generation,canonical_lease_sha256 FROM planner.connector_dispatch_jobs');
        assert.equal(rows.rows[0].generation, 2); assert.equal(rows.rows[0].canonical_lease_sha256, 'a'.repeat(64));
        assert.equal((await db.query<{count:number}>('SELECT count(*)::INTEGER AS count FROM planner.work_items WHERE id=1699')).rows[0].count, 1);
    } finally { await db.close(); }
});
