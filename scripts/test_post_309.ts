import prisma from '../src/db';

async function main() {
    const id = 309;
    const post = await prisma.post.findUnique({
        where: { id },
        include: { week: true }
    });

    if (!post) {
        console.log("Post 309 not found");
        return;
    }

    let weekPackageId = null;
    if (post.week) {
        const weekPackage = await prisma.weekPackage.findFirst({
            where: {
                project_id: post.project_id,
                week_start: {
                    gte: post.week.week_start,
                    lte: post.week.week_end
                }
            }
        });
        weekPackageId = weekPackage?.id || null;
    }

    console.log("Post ID:", post.id);
    console.log("Post Project ID:", post.project_id);
    console.log("Post Week ID (V1):", post.week_id);
    console.log("Resolved V2 week_package_id:", weekPackageId);
    console.log("Post Week Details:", post.week);

    // Let's also check if there is any WeekPackage in this project
    const packages = await prisma.weekPackage.findMany({
        where: { project_id: post.project_id }
    });
    console.log("All V2 WeekPackages for project:", post.project_id);
    packages.forEach(p => {
        console.log(`ID: ${p.id}, week_start: ${p.week_start}, week_end: ${p.week_end}, Theme: ${p.week_theme}`);
    });
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
