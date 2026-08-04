import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const failedRuns = await prisma.agentRun.findMany({
        where: {
            status: 'failed'
        },
        orderBy: {
            created_at: 'desc'
        },
        take: 5
    });
    console.log('Most Recent Failed Agent Runs:');
    console.log(JSON.stringify(failedRuns, null, 2));
}

main().catch(console.error).finally(() => {
    prisma.$disconnect();
    pool.end();
});
