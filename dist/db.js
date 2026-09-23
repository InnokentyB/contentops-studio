"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = exports.pool = void 0;
/**
 * Database connection module providing a shared PostgreSQL connection pool
 * and a singleton PrismaClient instance across the entire application.
 */
require("./bootstrap-env");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
/**
 * Shared PostgreSQL connection pool with connection timeout.
 */
exports.pool = new pg_1.Pool({
    connectionString,
    connectionTimeoutMillis: 5000
});
const adapter = new adapter_pg_1.PrismaPg(exports.pool);
/**
 * Shared singleton PrismaClient instance.
 */
exports.prisma = new client_1.PrismaClient({ adapter });
exports.default = exports.prisma;
