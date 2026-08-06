import prisma from '../src/db';

async function main() {
    const channels = await prisma.socialChannel.findMany({
        where: {
            OR: [
                { name: { contains: 'thinking' } },
                { name: { contains: 'think' } },
                { name: { contains: 'analyst' } }
            ]
        }
    });

    console.log(`Found ${channels.length} channels:`);
    for (const ch of channels) {
        console.log(`- Project: ${ch.project_id}, ID: ${ch.id}, Name: "${ch.name}", Type: "${ch.type}"`);
        console.log(`  Config:`, JSON.stringify(ch.config, null, 2));
    }
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
