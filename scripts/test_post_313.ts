import prisma from '../src/db';
import publisherService from '../src/services/publisher.service';

async function main() {
    const id = 313;
    const post = await prisma.post.findUnique({
        where: { id },
        include: { channel: true }
    });

    if (!post) {
        console.log("Post 313 not found");
        return;
    }

    console.log("Post ID:", post.id);
    console.log("Post Channel ID:", post.channel_id);
    console.log("Post Channel Name:", post.channel?.name);
    console.log("Post Channel Type:", post.channel?.type);
    console.log("Post Channel Config:", JSON.stringify(post.channel?.config, null, 2));

    // Try resolving it manually
    let channel = post.channel;
    if (!channel && post.channel_id) {
        channel = await prisma.socialChannel.findUnique({ where: { id: post.channel_id } });
    }
    if (!channel) {
        channel = await prisma.socialChannel.findFirst({
            where: { project_id: post.project_id, type: 'telegram' }
        });
    }

    if (channel) {
        // @ts-ignore
        const resolvedTelegram = await publisherService.resolveTelegramDeliveryConfig(post, channel.config);
        console.log("Resolved Telegram Config:", resolvedTelegram);
    } else {
        console.log("No channel found at all!");
    }
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
