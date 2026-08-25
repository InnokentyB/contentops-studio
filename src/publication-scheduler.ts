import publisherService from './services/publisher.service';

async function main() {
    const startedAt = new Date();
    console.log(`[PublicationScheduler] Hourly run started at ${startedAt.toISOString()}`);

    try {
        const inspected = await publisherService.processPublicationTasks();
        console.log(JSON.stringify({
            status: 'completed',
            inspected_due_tasks: inspected,
            started_at: startedAt.toISOString(),
            completed_at: new Date().toISOString()
        }));
    } catch (error) {
        console.error('[PublicationScheduler] Run failed:', error);
        process.exitCode = 1;
    } finally {
        await publisherService.closeConnections();
    }
}

main().catch((error) => {
    console.error('[PublicationScheduler] Fatal error:', error);
    process.exit(1);
});
