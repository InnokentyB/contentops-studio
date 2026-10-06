#!/usr/bin/env node
// Uses the configured publisher credential in memory; never writes or prints it.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function main() {
    const flags = process.argv.slice(2);
    if (flags.some(flag => flag !== '--confirm') || flags.length > 1) throw new Error('Invalid arguments');
    const token = process.env.MCP_PUBLISHER_AUTH_TOKEN;
    if (!token) throw new Error('Configured publisher credential unavailable');
    const client = new Client({ name: 'dzen999-existing-draft-recovery', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('https://planner-mcp-production.up.railway.app/mcp/publisher'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } }
    });
    await client.connect(transport);
    try {
        const { tools } = await client.listTools();
        const name = 'ba_resume_dzen_task999_existing_draft';
        if (!tools.some(tool => tool.name === name)) throw new Error('Deployment capability not available');
        const result = await client.callTool({ name, arguments: {
            projectId: 10, taskId: 999, actorId: 'user:2',
            idempotencyKey: 'dzen-999-owner-approved-live-20261006-v1', confirm: flags.includes('--confirm')
        } });
        console.log(JSON.stringify(result));
        if (result.isError) process.exitCode = 1;
    } finally {
        await client.close();
    }
}

main().catch(() => {
    console.error('Scoped Dzen999 recovery call failed. Never repeat live submission without reconciliation.');
    process.exitCode = 1;
});
