"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const generator_service_1 = __importDefault(require("../services/generator.service"));
const dotenv_1 = require("dotenv");
const db_1 = __importDefault(require("../db"));
(0, dotenv_1.config)();
async function main() {
    const retryFailed = process.argv.includes('--retry-failed');
    const targetStatus = retryFailed ? 'failed' : 'planned';
    console.log(`[Factory Sweep] Starting generation sweep for APPROVED v2 plans (target status: ${targetStatus})...`);
    try {
        const itemsToProcess = await db_1.default.contentItem.findMany({
            where: {
                status: targetStatus,
                week_package: {
                    approval_status: 'approved'
                }
            },
            take: 5 // Process in batches to avoid rate limits
        });
        if (itemsToProcess.length === 0) {
            console.log(`[Factory Sweep] No approved '${targetStatus}' items found. Exiting.`);
            return;
        }
        console.log(`[Factory Sweep] Found ${itemsToProcess.length} items to generate.`);
        for (const item of itemsToProcess) {
            console.log(` -> Generating text for ContentItem ${item.id} [${item.type}]...`);
            try {
                await generator_service_1.default.generateContentItemText(item.id);
                console.log(`    ✅ Success: Item ${item.id} moved to 'drafted'.`);
            }
            catch (err) {
                const errMsg = err?.message || err?.toString() || '';
                if (errMsg.toLowerCase().includes('quota') || errMsg.includes('429')) {
                    console.error(`    ❌ [API Quota Exceeded] on item ${item.id}. Please check your OpenAI billing.`);
                }
                else {
                    console.error(`    ❌ Error on item ${item.id}:`, errMsg);
                }
                // Mark failed
                await db_1.default.contentItem.update({
                    where: { id: item.id },
                    data: { status: 'failed' }
                });
            }
        }
        console.log(`[Factory Sweep] Batch complete.`);
    }
    catch (err) {
        console.error("Sweep error:", err);
    }
    finally {
        await db_1.default.$disconnect();
    }
}
main();
