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
 * Shared PostgreSQL connection pool with connection timeout, sizing, and error handling.
 */
export const pool = new Pool({
    connectionString,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// Attach unhandled error listener to prevent process crashes on idle client disconnects
pool.on('error', (err) => {
    console.error('[PostgreSQL Pool] Unexpected error on idle client:', err?.message || err);
});

const adapter = new PrismaPg(pool);

/**
 * Shared singleton PrismaClient instance.
 */
export const prisma = new PrismaClient({ adapter });

export default prisma;

