"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const publisher_service_1 = __importDefault(require("./services/publisher.service"));
async function main() {
    const startedAt = new Date();
    console.log(`[PublicationScheduler] Hourly run started at ${startedAt.toISOString()}`);
    try {
        const inspected = await publisher_service_1.default.processPublicationTasks();
        console.log(JSON.stringify({
            status: 'completed',
            inspected_due_tasks: inspected,
            started_at: startedAt.toISOString(),
            completed_at: new Date().toISOString()
        }));
    }
    catch (error) {
        console.error('[PublicationScheduler] Run failed:', error);
        process.exitCode = 1;
    }
    finally {
        await publisher_service_1.default.closeConnections();
    }
}
main().catch((error) => {
    console.error('[PublicationScheduler] Fatal error:', error);
    process.exit(1);
});
