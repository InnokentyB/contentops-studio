import { defineConfig } from 'prisma/config';
import { resolve } from 'path';
// Disposable integration DB only. Deliberately no dotenv or production config import.
export default defineConfig({ schema: resolve(__dirname, '../../prisma/schema.prisma'),
    datasource: { url: process.env.DZEN1002_TEST_DATABASE_URL } });
