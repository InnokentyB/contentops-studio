import prisma from '../src/db';

async function main() {
    const id = '308';
    const post = await prisma.post.findUnique({
        where: { id: parseInt(id) },
        include: { week: true }
    });

    if (!post || !post.week) {
        console.log("Post or week not found");
        return;
    }

    const weekPackage = await prisma.weekPackage.findFirst({
        where: {
            project_id: post.project_id,
            week_start: {
                gte: post.week.week_start,
                lte: post.week.week_end
            }
        }
    });

    console.log("Post V1 week dates:", post.week.week_start, "to", post.week.week_end);
    console.log("Found V2 WeekPackage:", weekPackage ? `ID: ${weekPackage.id}, Theme: ${weekPackage.week_theme}` : 'Not Found');
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
