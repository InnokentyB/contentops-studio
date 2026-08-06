import prisma from '../src/db';

async function main() {
    const post = await prisma.post.findUnique({
        where: { id: 313 }
    });

    if (!post) {
        console.log("Post 313 not found");
        return;
    }

    const channels = await prisma.socialChannel.findMany({
        where: { project_id: post.project_id }
    });

    console.log(`Channels in Project ${post.project_id}:`);
    for (const ch of channels) {
        console.log(`- ID: ${ch.id}, Name: "${ch.name}", Type: "${ch.type}", Active: ${ch.is_active}`);
        console.log(`  Config:`, JSON.stringify(ch.config, null, 2));
    }
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
