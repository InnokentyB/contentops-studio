import prisma from '../src/db';

async function main() {
    const projects = await prisma.project.findMany();
    console.log("Projects:", projects);
}

main()
    .catch(err => console.error(err))
    .finally(() => prisma.$disconnect());
