import prisma from '../src/db';

async function main() {
    const post = await prisma.post.findUnique({
        where: { id: 308 }
    });
    if (!post) {
        console.log("Post 308 not found.");
        return;
    }
    const text = post.final_text || post.generated_text || '';
    console.log(`Length of text: ${text.length}`);
    console.log(`=== Content ===\n${text}`);
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
