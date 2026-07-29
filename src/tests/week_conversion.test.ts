import test from 'node:test';
import assert from 'node:assert/strict';
import plannerService, { prisma } from '../services/planner.service';

test('convertWeekPackageToV1 throws error if V2 WeekPackage not found', async () => {
    const originalFindUnique = prisma.weekPackage.findUnique;
    Object.defineProperty(prisma.weekPackage, 'findUnique', {
        value: async () => null,
        configurable: true,
        writable: true
    });

    try {
        await assert.rejects(
            async () => {
                await plannerService.convertWeekPackageToV1(1, 999);
            },
            /V2 WeekPackage not found/
        );
    } finally {
        Object.defineProperty(prisma.weekPackage, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
    }
});

test('convertWeekPackageToV1 returns existing weekId and reused: true if V1 Week already exists', async () => {
    const mockWeekPackage = {
        id: 100,
        project_id: 1,
        week_theme: 'Strategic Theme',
        week_start: new Date('2026-06-01T00:00:00Z'),
        week_end: new Date('2026-06-07T00:00:00Z')
    };

    const mockExistingWeek = {
        id: 500,
        project_id: 1,
        theme: 'Strategic Theme',
        week_start: new Date('2026-06-01T00:00:00Z'),
        week_end: new Date('2026-06-07T00:00:00Z'),
        status: 'planning'
    };

    const originalFindUnique = prisma.weekPackage.findUnique;
    const originalFindFirst = prisma.week.findFirst;

    Object.defineProperty(prisma.weekPackage, 'findUnique', {
        value: async () => mockWeekPackage,
        configurable: true,
        writable: true
    });

    Object.defineProperty(prisma.week, 'findFirst', {
        value: async () => mockExistingWeek,
        configurable: true,
        writable: true
    });

    try {
        const result = await plannerService.convertWeekPackageToV1(1, 100);

        assert.deepEqual(result, {
            weekId: 500,
            reused: true
        });
    } finally {
        Object.defineProperty(prisma.weekPackage, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
        Object.defineProperty(prisma.week, 'findFirst', {
            value: originalFindFirst,
            configurable: true,
            writable: true
        });
    }
});

test('convertWeekPackageToV1 creates V1 Week and slots if none exist', async () => {
    const mockWeekPackage = {
        id: 100,
        project_id: 1,
        week_theme: 'Strategic Theme',
        week_start: new Date('2026-06-01T00:00:00Z'),
        week_end: new Date('2026-06-07T00:00:00Z')
    };

    const mockNewWeek = {
        id: 600,
        project_id: 1,
        theme: 'Strategic Theme',
        week_start: new Date('2026-06-01T00:00:00Z'),
        week_end: new Date('2026-06-07T00:00:00Z'),
        status: 'planning'
    };

    const originalFindUnique = prisma.weekPackage.findUnique;
    const originalFindFirstWeek = prisma.week.findFirst;
    const originalCreateWeek = prisma.week.create;
    const originalFindFirstChannel = prisma.socialChannel.findFirst;
    const originalCreateManyPosts = prisma.post.createMany;

    Object.defineProperty(prisma.weekPackage, 'findUnique', {
        value: async () => mockWeekPackage,
        configurable: true,
        writable: true
    });

    Object.defineProperty(prisma.week, 'findFirst', {
        value: async () => null,
        configurable: true,
        writable: true
    });

    Object.defineProperty(prisma.week, 'create', {
        value: async () => mockNewWeek,
        configurable: true,
        writable: true
    });

    Object.defineProperty(prisma.socialChannel, 'findFirst', {
        value: async () => null,
        configurable: true,
        writable: true
    });

    let slotsCreated = false;
    Object.defineProperty(prisma.post, 'createMany', {
        value: async (params: any) => {
            assert.equal(params.data.length, 14);
            slotsCreated = true;
            return { count: 14 };
        },
        configurable: true,
        writable: true
    });

    try {
        const result = await plannerService.convertWeekPackageToV1(1, 100);

        assert.deepEqual(result, {
            weekId: 600,
            reused: false
        });
        assert.ok(slotsCreated);
    } finally {
        Object.defineProperty(prisma.weekPackage, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
        Object.defineProperty(prisma.week, 'findFirst', {
            value: originalFindFirstWeek,
            configurable: true,
            writable: true
        });
        Object.defineProperty(prisma.week, 'create', {
            value: originalCreateWeek,
            configurable: true,
            writable: true
        });
        Object.defineProperty(prisma.socialChannel, 'findFirst', {
            value: originalFindFirstChannel,
            configurable: true,
            writable: true
        });
        Object.defineProperty(prisma.post, 'createMany', {
            value: originalCreateManyPosts,
            configurable: true,
            writable: true
        });
    }
});
