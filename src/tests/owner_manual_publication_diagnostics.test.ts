import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseDirectPublicationError } from '../services/direct_publication_error_diagnostics';
import { browserErrorDiagnostic } from '../services/browser_actionable_diagnostics';
import { vkConnectorErrorDiagnostic } from '../services/vk_connector_error_diagnostics';
import { publicationAdapterDiagnosticResult } from '../mcp/tools/publication_adapter_diagnostic_result';

const codes = ['MANUAL_PUBLICATION_TRANSPORT_PRESERVED', 'MANUAL_PUBLICATION_OBJECT_CONFLICT',
    'MANUAL_PUBLICATION_POLICY_INVALID', 'MANUAL_PUBLICATION_POLICY_REQUIRED'];
for (const code of codes) {
    for (const [route, diagnose] of Object.entries({ direct: diagnoseDirectPublicationError,
        browser: browserErrorDiagnostic, vk: vkConnectorErrorDiagnostic })) {
        test(`manual accounting ${route} retains exact ${code} cause with safe remedy`, () => {
            const result = diagnose(new Error(`[${code}] bearer private-provider-payload`));
            assert.equal(result.code, code);
            assert.equal(result.retry_allowed, false);
            assert.equal(result.reasons[0]?.code, code);
            assert.match(result.reasons[0]!.action, /Owner|owner/);
            assert.match(result.reasons[0]!.action, /not|never/i);
            assert.doesNotMatch(JSON.stringify(result), /private-provider-payload|bearer/);
        });
    }
    test(`manual accounting adapter boundary exposes ${code} without raw exception`, async () => {
        const result = await publicationAdapterDiagnosticResult(async () => {
            throw new Error(`[${code}] private-provider-payload`);
        });
        assert.equal(result.isError, true);
        const payload = JSON.parse(result.content[0]!.text as string);
        assert.equal(payload.code, code);
        assert.equal(payload.retry_allowed, false);
        assert.doesNotMatch(JSON.stringify(result), /private-provider-payload/);
    });
}
