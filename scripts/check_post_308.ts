import prisma from '../src/db';

async function main() {
    console.log("=== Checking Post 308 ===");
    const post = await prisma.post.findUnique({
        where: { id: 308 }
    });

    if (!post) {
        console.log("Post 308 not found.");
        return;
    }

    console.log("Post:", {
        id: post.id,
        topic: post.topic,
        status: post.status,
        project_id: post.project_id,
        channel_id: post.channel_id,
        publish_at: post.publish_at
    });

    console.log("=== Checking Channel ===");
    if (post.channel_id) {
        const channel = await prisma.socialChannel.findUnique({
            where: { id: post.channel_id }
        });
        if (channel) {
            console.log("Channel:", {
                id: channel.id,
                type: channel.type,
                name: channel.name,
                config: channel.config
            });
        } else {
            console.log(`Channel with ID ${post.channel_id} not found.`);
        }
    } else {
        console.log("Post 308 does not have a channel_id assigned.");
    }
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
