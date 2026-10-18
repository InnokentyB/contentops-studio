import { Prisma } from '@prisma/client';
/** Provider filtering precedes legacy decoding, including unversioned historical rows. */
export function legacyProviderJobWhere(provider: string): Prisma.ConnectorDispatchJobWhereInput {
    return { channel: { type: provider }, OR: [
        { binding: { path: ['protocol'], equals: Prisma.DbNull } },
        { binding: { path: ['protocol'], equals: Prisma.JsonNull } }
    ] };
}
