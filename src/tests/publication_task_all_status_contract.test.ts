import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('publication task API supports the unfiltered weekly package projection', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/routes/api.routes.ts'), 'utf8');

    assert.match(source, /status && status !== 'all'/);
    assert.match(source, /is_active: isPublicationTaskActive\(item\)/);
    assert.match(source, /publication_outcome: publicationOutcome/);
});
