import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const connectorFiles = [
    'src/services/mcp_publication.service.ts',
    'src/services/publisher.service.ts',
    'src/services/telegram_client.service.ts'
];

test('long Telegram media publications do not render the caption again as a reply preview', () => {
    for (const relativePath of connectorFiles) {
        const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

        assert.doesNotMatch(
            source,
            /reply_to_message_id\s*:/,
            `${relativePath} must send overflow as a standalone continuation`
        );
        assert.doesNotMatch(
            source,
            /replyTo\s*:/,
            `${relativePath} must not attach an MTProto reply preview to overflow`
        );
    }
});

test('MCP direct publication uses the canonical MTProto-first Telegram route', () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), 'src/services/mcp_publication.service.ts'),
        'utf8'
    );

    assert.match(source, /publisherService\.publishDirectTelegram\s*\(/);
    assert.doesNotMatch(source, /require\(['"]\.\/telegram\.service['"]\)/);
    assert.doesNotMatch(source, /telegramService\.send(?:Message|Photo)\s*\(/);
});
