"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const planner_service_1 = __importStar(require("../services/planner.service"));
(0, node_test_1.default)('convertWeekPackageToV1 throws error if V2 WeekPackage not found', async () => {
    const originalFindUnique = planner_service_1.prisma.weekPackage.findUnique;
    Object.defineProperty(planner_service_1.prisma.weekPackage, 'findUnique', {
        value: async () => null,
        configurable: true,
        writable: true
    });
    try {
        await strict_1.default.rejects(async () => {
            await planner_service_1.default.convertWeekPackageToV1(1, 999);
        }, /V2 WeekPackage not found/);
    }
    finally {
        Object.defineProperty(planner_service_1.prisma.weekPackage, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
    }
});
(0, node_test_1.default)('convertWeekPackageToV1 returns existing weekId and reused: true if V1 Week already exists', async () => {
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
    const originalFindUnique = planner_service_1.prisma.weekPackage.findUnique;
    const originalFindFirst = planner_service_1.prisma.week.findFirst;
    Object.defineProperty(planner_service_1.prisma.weekPackage, 'findUnique', {
        value: async () => mockWeekPackage,
        configurable: true,
        writable: true
    });
    Object.defineProperty(planner_service_1.prisma.week, 'findFirst', {
        value: async () => mockExistingWeek,
        configurable: true,
        writable: true
    });
    try {
        const result = await planner_service_1.default.convertWeekPackageToV1(1, 100);
        strict_1.default.deepEqual(result, {
            weekId: 500,
            reused: true
        });
    }
    finally {
        Object.defineProperty(planner_service_1.prisma.weekPackage, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
        Object.defineProperty(planner_service_1.prisma.week, 'findFirst', {
            value: originalFindFirst,
            configurable: true,
            writable: true
        });
    }
});
(0, node_test_1.default)('convertWeekPackageToV1 creates V1 Week and slots if none exist', async () => {
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
    const originalFindUnique = planner_service_1.prisma.weekPackage.findUnique;
    const originalFindFirstWeek = planner_service_1.prisma.week.findFirst;
    const originalCreateWeek = planner_service_1.prisma.week.create;
    const originalFindFirstChannel = planner_service_1.prisma.socialChannel.findFirst;
    const originalCreateManyPosts = planner_service_1.prisma.post.createMany;
    Object.defineProperty(planner_service_1.prisma.weekPackage, 'findUnique', {
        value: async () => mockWeekPackage,
        configurable: true,
        writable: true
    });
    Object.defineProperty(planner_service_1.prisma.week, 'findFirst', {
        value: async () => null,
        configurable: true,
        writable: true
    });
    Object.defineProperty(planner_service_1.prisma.week, 'create', {
        value: async () => mockNewWeek,
        configurable: true,
        writable: true
    });
    Object.defineProperty(planner_service_1.prisma.socialChannel, 'findFirst', {
        value: async () => null,
        configurable: true,
        writable: true
    });
    let slotsCreated = false;
    Object.defineProperty(planner_service_1.prisma.post, 'createMany', {
        value: async (params) => {
            strict_1.default.equal(params.data.length, 14);
            slotsCreated = true;
            return { count: 14 };
        },
        configurable: true,
        writable: true
    });
    try {
        const result = await planner_service_1.default.convertWeekPackageToV1(1, 100);
        strict_1.default.deepEqual(result, {
            weekId: 600,
            reused: false
        });
        strict_1.default.ok(slotsCreated);
    }
    finally {
        Object.defineProperty(planner_service_1.prisma.weekPackage, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
        Object.defineProperty(planner_service_1.prisma.week, 'findFirst', {
            value: originalFindFirstWeek,
            configurable: true,
            writable: true
        });
        Object.defineProperty(planner_service_1.prisma.week, 'create', {
            value: originalCreateWeek,
            configurable: true,
            writable: true
        });
        Object.defineProperty(planner_service_1.prisma.socialChannel, 'findFirst', {
            value: originalFindFirstChannel,
            configurable: true,
            writable: true
        });
        Object.defineProperty(planner_service_1.prisma.post, 'createMany', {
            value: originalCreateManyPosts,
            configurable: true,
            writable: true
        });
    }
});
