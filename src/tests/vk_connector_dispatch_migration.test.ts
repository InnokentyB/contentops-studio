import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = path.resolve(__dirname, '../../prisma/migrations/20261012190000_add_vk_connector_dispatch/migration.sql');
const fixture = `CREATE SCHEMA planner;
CREATE TABLE planner.projects(id INTEGER PRIMARY KEY);
CREATE TABLE planner.content_items(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.social_channels(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.work_items(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.image_assets(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.delivery_attempts(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
CREATE TABLE planner.publication_facts(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL);
INSERT INTO planner.projects VALUES(10),(7);
INSERT INTO planner.content_items VALUES(900,10),(901,7);
INSERT INTO planner.social_channels VALUES(120,10),(121,7);
INSERT INTO planner.work_items VALUES(42,10),(43,7);
INSERT INTO planner.image_assets VALUES(98,10),(99,7);
INSERT INTO planner.delivery_attempts VALUES(51,10),(52,7);
INSERT INTO planner.publication_facts VALUES(61,10),(62,7);`;
const uuid = '00000000-0000-4000-8000-000000000001';
const insert = `INSERT INTO planner.connector_dispatch_jobs
(id,project_id,content_item_id,channel_id,work_item_id,content_revision,selected_asset_id,package_sha256,binding,idempotency_key,updated_at)
VALUES($1,10,$2,120,42,1,98,$3,jsonb_build_object('projectId',10,'taskId',$2::INTEGER,'channelId',120,'revision',1,'selectedAssetId',98,'communityId',-240051152,'placement','feed','bodySha256',repeat('a',64),'assetSha256',repeat('b',64),'releaseSha256',repeat('c',64)),$5,$4)`;
test('DISPATCH-016-DB additive migration enforces package uniqueness and project-scoped immutable references', async () => {
    const db = new PGlite();
    try {
        await db.exec(fixture);
        await db.exec(fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '');
        await db.query(insert, [uuid, 900, 'a'.repeat(64), new Date('2026-10-12T10:00:00Z'), 'test-key']);
        const result = await db.query<{ state: string; generation: number }>('SELECT state,generation FROM planner.connector_dispatch_jobs');
        assert.deepEqual(result.rows, [{ state: 'queued', generation: 0 }]);
        await assert.rejects(db.query(insert, ['00000000-0000-4000-8000-000000000002', 900, 'a'.repeat(64), new Date(), 'different-key']), /unique/i);
        await assert.rejects(db.query(insert, ['00000000-0000-4000-8000-000000000003', 901, 'b'.repeat(64), new Date(), 'foreign-key']), /foreign key/i);
        await assert.rejects(db.query(insert, ['00000000-0000-4000-8000-000000000004', 900, 'c'.repeat(64), new Date(), 'test-key']), /unique/i);
        for (const [field,value] of [['channel_id',121],['work_item_id',43],['selected_asset_id',99],['attempt_id',52],['publication_fact_id',62]] as const) {
            const bindingKey = field === 'channel_id' ? 'channelId' : field === 'selected_asset_id' ? 'selectedAssetId' : null;
            const bindingUpdate = bindingKey ? `,binding=jsonb_set(binding,'{${bindingKey}}','${value}')` : '';
            await assert.rejects(db.exec(`UPDATE planner.connector_dispatch_jobs SET ${field}=${value}${bindingUpdate} WHERE id='${uuid}'`), /foreign key/i);
        }
        for (const [table,id] of [['projects',10],['content_items',900],['social_channels',120],['work_items',42],['image_assets',98]] as const) {
            await assert.rejects(db.exec(`DELETE FROM planner.${table} WHERE id=${id}`), /foreign key/i);
        }
        await db.exec("INSERT INTO planner.connector_host_status(project_id,host_id,instance_id,build_version,heartbeat_at,mode) VALUES(10,'host-test','instance-test','test-build',CURRENT_TIMESTAMP,'infrastructure_only')");
        await assert.rejects(db.exec("INSERT INTO planner.connector_host_status(project_id,host_id,instance_id,build_version,heartbeat_at,mode) VALUES(10,'host-test','other-instance','test-build',CURRENT_TIMESTAMP,'infrastructure_only')"), /unique/i);
        await assert.rejects(db.exec("UPDATE planner.connector_host_status SET mode='provider_ready'"), /check/i);
        await assert.rejects(db.exec("UPDATE planner.connector_dispatch_jobs SET state='invented_success'"), /check/i);
        await assert.rejects(db.exec("UPDATE planner.connector_dispatch_jobs SET state='confirmed'"), /check/i);
        await assert.rejects(db.exec("UPDATE planner.connector_dispatch_jobs SET binding=binding || '{\"access_token\":\"test-secret\"}'::jsonb"), /check/i);
        await assert.rejects(db.exec("UPDATE planner.connector_dispatch_jobs SET generation=-1"), /check/i);
    } finally { await db.close(); }
});
test('DISPATCH-016-DB migration preserves history and contains no destructive rollback', () => {
    const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8').replace(/--[^\n]*/g, '') : '';
    assert.match(sql, /CREATE TABLE.*connector_dispatch_jobs/s);
    assert.match(sql, /CREATE TABLE.*connector_host_status/s);
    assert.doesNotMatch(sql, /(?:^|\n)\s*(?:DROP|TRUNCATE|DELETE)\b|\bCASCADE\b/i);
    assert.doesNotMatch(sql, /^\s*(?:UPDATE|INSERT INTO)\s+planner\.(?:content_items|work_items|publication_facts)/mi);
    assert.doesNotMatch(sql, /\b(?:access_token|lease_token|cookies|authorization_header)\s+(?:TEXT|JSONB)/i);
});
