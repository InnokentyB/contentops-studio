import assert from 'node:assert/strict';
import test from 'node:test';
import { DeleteObjectCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { StorageService } from '../services/storage.service';

function r2Harness() {
    const commands: any[] = [];
    const service = new StorageService({
        env: {
            R2_ENABLED: 'true',
            R2_ACCOUNT_ID: 'account-id',
            R2_ACCESS_KEY_ID: 'access-key',
            R2_SECRET_ACCESS_KEY: 'secret-key',
            R2_BUCKET: 'planner-media',
            R2_PUBLIC_BASE_URL: 'https://media.example.com/'
        },
        r2Client: { send: async (command: any) => { commands.push(command); return {}; } }
    });
    return { service, commands };
}

test('R2 is selected from complete configuration and returns a public URL', async () => {
    const { service, commands } = r2Harness();
    assert.equal(service.getProvider(), 'r2');
    const url = await service.uploadFileFromBuffer(Buffer.from('image'), 'image/png', '/generated/post image.png');
    assert.equal(url, 'https://media.example.com/generated/post%20image.png');
    assert.ok(commands[0] instanceof PutObjectCommand);
    assert.equal(commands[0].input.Bucket, 'planner-media');
    assert.equal(commands[0].input.Key, 'generated/post image.png');
});

test('R2 health and deletion use the configured bucket', async () => {
    const { service, commands } = r2Harness();
    const health = await service.checkHealth();
    await service.deleteFile('https://media.example.com/generated/post%20image.png');
    assert.deepEqual(health, { provider: 'r2', bucket: 'planner-media', public_base_url: 'https://media.example.com' });
    assert.ok(commands[0] instanceof HeadBucketCommand);
    assert.ok(commands[1] instanceof DeleteObjectCommand);
    assert.equal(commands[1].input.Key, 'generated/post image.png');
});

test('incomplete R2 configuration keeps Supabase as the provider', () => {
    const service = new StorageService({ env: { R2_ENABLED: 'true', R2_ACCOUNT_ID: 'account-id' } });
    assert.equal(service.getProvider(), 'supabase');
});

test('disabled R2 configuration keeps Supabase as the provider', () => {
    const service = new StorageService({
        env: {
            R2_ENABLED: 'false',
            R2_ACCOUNT_ID: 'REPLACE_ME',
            R2_ACCESS_KEY_ID: 'REPLACE_ME',
            R2_SECRET_ACCESS_KEY: 'REPLACE_ME',
            R2_BUCKET: 'planner-media',
            R2_PUBLIC_BASE_URL: 'https://media.example.com'
        }
    });
    assert.equal(service.getProvider(), 'supabase');
});

test('object traversal is rejected before upload', async () => {
    const { service } = r2Harness();
    await assert.rejects(
        service.uploadFileFromBuffer(Buffer.from('x'), 'image/png', '../secret.png'),
        /STORAGE_INVALID_PATH/
    );
});
