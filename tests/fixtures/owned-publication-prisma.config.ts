import {defineConfig} from 'prisma/config';
export default defineConfig({schema:'/workspace/prisma/schema.prisma',datasource:{url:process.env.DATABASE_URL}});
