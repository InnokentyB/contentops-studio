import prisma from '../src/db';

async function main() {
    const posts = await prisma.post.findMany({
        where: {
            status: 'published'
        },
        orderBy: {
            updated_at: 'desc'
        },
        take: 3
    });
    console.log("Recently published posts:");
    posts.forEach(p => {
        console.log(`ID: ${p.id}, Topic: ${p.topic}, Tags: ${p.tags}`);
        console.log(`Image URL: ${p.image_url}`);
        console.log(`Text Length: ${p.final_text?.length || p.generated_text?.length}`);
        console.log(`Text End:`, (p.final_text || p.generated_text || '').slice(-200));
        console.log("------------------------");
    });
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
