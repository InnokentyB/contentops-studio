import assert from 'node:assert/strict';
import test from 'node:test';
import { getVkConnectorRecordedRestriction } from '../services/vk_connector_recorded_restriction';
const record = { platform: 'vk', ownerId: '-82001', operation: 'publication', observedAt: '2026-10-17T10:00:00Z', basis: 'Synthetic recorded action denial' };
test('VK022 recorded restrictions match actual owner and action data, never all tenants', () => {
    assert.deepEqual(getVkConnectorRecordedRestriction({ communityId: -82001 }, [record]), record);
    assert.equal(getVkConnectorRecordedRestriction({ communityId: -82002 }, [record]), null);
    assert.equal(getVkConnectorRecordedRestriction({ communityId: -82001 }, [record], 'search'), null);
    assert.equal(getVkConnectorRecordedRestriction({ communityId: -82001 }, []), null);
});
test('VK022 malformed restriction data fails closed without returning raw payload', () => {
    assert.throws(() => getVkConnectorRecordedRestriction({ communityId: -82001 }, [{ ...record, ownerId: '*' }]), /VK_RECORDED_RESTRICTION_INPUT_INVALID/);
});
