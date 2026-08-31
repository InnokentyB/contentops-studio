import assert from 'node:assert/strict';
import test from 'node:test';
import { visualStorageFailureCode } from '../services/visual_storage_incident.service';

test('storage quota and capacity failures become explicit readiness reasons', () => {
    assert.equal(visualStorageFailureCode({ statusCode: 402, message: 'Payment Required' }), 'storage_quota_exceeded');
    assert.equal(visualStorageFailureCode(new Error('exceed_egress_quota')), 'storage_quota_exceeded');
    assert.equal(visualStorageFailureCode(new Error('connection reset')), 'storage_ingest_failed');
});
