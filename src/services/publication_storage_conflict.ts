import {Prisma} from '@prisma/client';
import {z} from 'zod';
const rawConflict=z.union([
    z.object({code:z.literal('40001')}),
    z.object({driverAdapterError:z.object({cause:z.object({originalCode:z.literal('40001')})})})
]);
/** Recognize only documented serialization conflicts; never inspect or disclose raw SQL messages. */
export function isPublicationStorageConflict(error:unknown):boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code==='P2034'||error.code==='P2010'&&rawConflict.safeParse(error.meta).success);
}
