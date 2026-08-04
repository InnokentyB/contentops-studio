import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
async function main() {
  const channels = await prisma.socialChannel.findMany({
    where: { project_id: 10 }
  });
  console.log(JSON.stringify(channels, null, 2));
}
main().finally(() => {
  prisma.$disconnect();
  pool.end();
});
