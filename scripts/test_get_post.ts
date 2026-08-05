import prisma from '../src/db';

async function main() {
    const id = '308';
    const post = await prisma.post.findUnique({
        where: { id: parseInt(id) },
        include: { week: true }
    });

    if (!post) {
        console.log("Post not found");
        return;
    }

    let weekPackageId = null;
    if (post.week) {
        const weekPackage = await prisma.weekPackage.findFirst({
            where: {
                project_id: post.project_id,
                week_start: post.week.week_start,
                week_end: post.week.week_end
            }
        });
        weekPackageId = weekPackage?.id || null;
    }

    console.log("Post ID:", post.id);
    console.log("Post Project ID:", post.project_id);
    console.log("Post Week ID (V1):", post.week_id);
    console.log("Resolved V2 week_package_id:", weekPackageId);
    console.log("Post Week Details:", post.week);
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
