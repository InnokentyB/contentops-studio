import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import '../src/bootstrap-env';
import {
    encryptTelegramAccountSecrets,
    telegramAccountSecretsAreEncrypted
} from '../src/utils/telegram_account_secrets';

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Database connection is required');
    if (!process.env.CHANNEL_SECRETS_KEY?.trim()) throw new Error('CHANNEL_SECRETS_KEY is required');

    const pool = new Pool({ connectionString });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        const accounts = await prisma.telegramAccount.findMany({
            select: { id: true, api_hash: true, session_string: true }
        });
        let updated = 0;

        for (const account of accounts) {
            if (telegramAccountSecretsAreEncrypted(account)) continue;
            const encrypted = encryptTelegramAccountSecrets(account.api_hash, account.session_string);
            await prisma.telegramAccount.update({
                where: { id: account.id },
                data: encrypted
            });
            updated += 1;
        }

        await prisma.$executeRawUnsafe('ALTER TABLE "planner"."telegram_accounts" VALIDATE CONSTRAINT "telegram_accounts_api_hash_encrypted"');
        await prisma.$executeRawUnsafe('ALTER TABLE "planner"."telegram_accounts" VALIDATE CONSTRAINT "telegram_accounts_session_encrypted"');

        console.log(JSON.stringify({ total: accounts.length, encrypted: updated, status: 'ok' }));
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
