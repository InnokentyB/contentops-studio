import prisma from '../src/db';

async function main() {
    const ch = await prisma.socialChannel.findUnique({
        where: { id: 111 }
    });

    if (!ch) {
        console.log("Channel 111 not found");
        return;
    }

    console.log(`Channel ID 111 details:`);
    console.log(`- Name: "${ch.name}"`);
    console.log(`- Created At: ${ch.created_at.toISOString()}`);
    console.log(`- Updated At: ${ch.updated_at.toISOString()}`);
    console.log(`- Config:`, JSON.stringify(ch.config, null, 2));
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
