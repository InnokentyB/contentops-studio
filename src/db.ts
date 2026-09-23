/**
 * Database connection module providing a shared PostgreSQL connection pool
 * and a singleton PrismaClient instance across the entire application.
 */
import './bootstrap-env';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

/**
 * Shared PostgreSQL connection pool with connection timeout.
 */
export const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000
});

const adapter = new PrismaPg(pool);

/**
 * Shared singleton PrismaClient instance.
 */
export const prisma = new PrismaClient({ adapter });

export default prisma;

