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

test('publication week options expose publication task counts instead of all package records', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/routes/api.routes.ts'), 'utf8');

    assert.match(source, /publication_task_count: countByWeekId\.get\(week\.id\) \|\| 0/);
    assert.match(source, /type: \{ not: 'week_theme' \}/);
    assert.match(source, /item_key: \{ startsWith: 'week-topic:' \}/);
});

test('publication task UI keeps week dates date-only and localizes the empty detail state', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'frontend/src/pages/PublicationTasks.tsx'), 'utf8');

    assert.match(source, /function formatWeekDate/);
    assert.match(source, /timeZone: 'UTC'/);
    assert.match(source, /\{copy\.selectTask\}/);
    assert.match(source, /\{copy\.selectTaskHelp\}/);
    assert.doesNotMatch(source, /<h3[^>]*>Select a task<\/h3>/);
});

test('desktop sidebar toggle uses glyphs bundled by the application font', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'frontend/src/components/Layout.tsx'), 'utf8');

    assert.match(source, /sidebarCollapsed \? 'chevron_right' : 'chevron_left'/);
    assert.doesNotMatch(source, /left_panel_(?:open|close)/);
});
