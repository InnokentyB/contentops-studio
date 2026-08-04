import prisma from '../src/db';

async function main() {
    const post = await prisma.post.update({
        where: { id: 308 },
        data: { status: 'scheduled' }
    });
    console.log(`Successfully reset Post 308 status to: ${post.status}`);
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
