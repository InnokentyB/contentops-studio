
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { PrismaClient } from "@prisma/client";
import * as readline from "readline";
import { Writable } from "stream";
import { encryptTelegramAccountSecrets, telegramPhoneHint } from "../src/utils/telegram_account_secrets";
import "../src/bootstrap-env";

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Database connection is required');
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
let suppressInputEcho = false;
const guardedOutput = new Writable({
    write(chunk, _encoding, callback) {
        if (!suppressInputEcho) process.stdout.write(chunk);
        callback();
    }
});
const rl = readline.createInterface({
    input: process.stdin,
    output: guardedOutput,
    terminal: true
});

const ask = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));
const askSecret = (query: string): Promise<string> => {
    process.stdout.write(query);
    suppressInputEcho = true;
    return new Promise(resolve => rl.question('', answer => {
        suppressInputEcho = false;
        process.stdout.write('\n');
        resolve(answer);
    }));
};

async function main() {
    console.log("=== Telegram Account Setup ===");

    const apiIdStr = await ask("Enter API ID: ");
    const apiId = parseInt(apiIdStr);
    if (!Number.isInteger(apiId) || apiId <= 0) throw new Error('API ID must be a positive integer');
    const apiHash = await askSecret("Enter API Hash: ");
    const phoneNumber = await ask("Enter Phone Number (e.g. +1234567890): ");

    console.log("Connecting...");

    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: phoneNumber,
        password: async () => {
            return await askSecret("Enter 2FA Password (if enabled): ");
        },
        phoneCode: async () => {
            return await ask("Enter the code you received: ");
        },
        onError: (err) => console.log(err),
    });

    console.log("Connected!");

    const sessionConfig = client.session.save() as unknown as string;
    const encryptedSecrets = encryptTelegramAccountSecrets(apiHash, sessionConfig);

    console.log("Session generated successfully.");

    // Save to DB
    const projectIdStr = await ask("Enter Project ID to associate with (default 1): ");
    const projectId = parseInt(projectIdStr) || 1;

    await prisma.telegramAccount.upsert({
        where: {
            project_id_phone_number: {
                project_id: projectId,
                phone_number: phoneNumber
            }
        },
        update: {
            session_string: encryptedSecrets.session_string,
            api_id: apiId,
            api_hash: encryptedSecrets.api_hash,
            is_active: true
        },
        create: {
            project_id: projectId,
            phone_number: phoneNumber,
            session_string: encryptedSecrets.session_string,
            api_id: apiId,
            api_hash: encryptedSecrets.api_hash,
            is_active: true
        }
    });
    console.log(`Successfully saved account ${telegramPhoneHint(phoneNumber)} in Project ${projectId}.`);

    await client.disconnect();
    rl.close();
    await prisma.$disconnect();
    await pool.end();
}

main().catch(async (error) => {
    suppressInputEcho = false;
    process.stdout.write('\n');
    console.error(error instanceof Error ? error.message : String(error));
    rl.close();
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
});
