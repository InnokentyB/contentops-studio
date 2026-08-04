import prisma from '../src/db';

async function main() {
    const packages = await prisma.weekPackage.findMany({
        where: { project_id: 10 }
    });
    console.log("WeekPackages for project 10:", packages);
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
