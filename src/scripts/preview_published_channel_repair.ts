import publishedChannelRepairService from '../services/published_channel_repair.service';
import prisma, { pool } from '../db';

function requiredArg(name: string) {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (!value) throw new Error(`Missing --${name}`);
    return value;
}

function positiveInteger(name: string) {
    const value = Number(requiredArg(name));
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid --${name}`);
    return value;
}

function snapshotGuards(value: string) {
    const entries = value.split(',').map((entry) => {
        const [id, channelId, extra] = entry.split(':').map(Number);
        if (extra !== undefined || !Number.isInteger(id) || id <= 0 || !Number.isInteger(channelId) || channelId <= 0) {
            throw new Error('Invalid --expected-snapshots; use id:channel,id:channel');
        }
        return { id, channelId };
    });
    if (!entries.length) throw new Error('Missing --expected-snapshots');
    return entries;
}

async function main() {
    const result = await publishedChannelRepairService.preview({
        projectId: positiveInteger('project'),
        actorId: requiredArg('actor'),
        taskId: positiveInteger('task'),
        expectedCurrentChannelId: positiveInteger('expected-channel'),
        targetChannelId: positiveInteger('target-channel'),
        expectedPublicationFactId: positiveInteger('expected-fact'),
        expectedPublicUrl: requiredArg('expected-public-url'),
        expectedSnapshots: snapshotGuards(requiredArg('expected-snapshots'))
    });
    console.log(JSON.stringify(result, null, 2));
}

main()
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
