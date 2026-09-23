"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const date_fns_1 = require("date-fns");
const dotenv_1 = require("dotenv");
const db_1 = __importDefault(require("../db"));
exports.prisma = db_1.default;
(0, dotenv_1.config)();
class PlannerService {
    async getCurrentWeekRange() {
        const today = new Date();
        const start = (0, date_fns_1.startOfWeek)(today, { weekStartsOn: 1 }); // Monday
        const end = (0, date_fns_1.endOfWeek)(start, { weekStartsOn: 1 }); // Sunday
        return { start, end };
    }
    async getNextWeekRange() {
        const today = new Date();
        const start = (0, date_fns_1.nextMonday)(today);
        const end = (0, date_fns_1.nextSunday)(start);
        return { start, end };
    }
    async getWeekRangeForDate(date) {
        const start = (0, date_fns_1.startOfWeek)(date, { weekStartsOn: 1 });
        const end = (0, date_fns_1.endOfWeek)(date, { weekStartsOn: 1 });
        return { start, end };
    }
    async createWeek(projectId, theme, start, end) {
        return db_1.default.week.create({
            data: {
                project_id: projectId,
                theme,
                week_start: start,
                week_end: end,
                status: 'planning', // Initial status, will move to topics_generated shortly
            },
        });
    }
    async generateSlots(weekId, projectId, start, count = 14, startIndex = 0, explicitChannelId) {
        const slots = [];
        let channelId = explicitChannelId || null;
        if (!channelId) {
            // Fetch default channel setting
            const defaultChannelSetting = await db_1.default.projectSettings.findFirst({
                where: { project_id: projectId, key: 'default_channel_id' }
            });
            if (defaultChannelSetting?.value) {
                const configuredChannelId = parseInt(defaultChannelSetting.value);
                if (!isNaN(configuredChannelId)) {
                    const exists = await db_1.default.socialChannel.findUnique({
                        where: { id: configuredChannelId, project_id: projectId }
                    });
                    if (exists) {
                        channelId = configuredChannelId;
                    }
                }
            }
        }
        if (!channelId) {
            // Fallback to default channel (Telegram)
            const channel = await db_1.default.socialChannel.findFirst({
                where: { project_id: projectId, type: 'telegram' }
            });
            channelId = channel ? channel.id : null;
        }
        for (let i = 0; i < count; i++) {
            // Distribute 2 slots per day for 7 days (Total 14)
            // i=0,1 -> Mon (offset 0)
            // i=2,3 -> Tue (offset 1)
            // ...
            const dayOffset = Math.floor(i / 2);
            const date = (0, date_fns_1.addDays)(start, dayOffset);
            const publishAt = new Date(date);
            // Even index = Morning (10:00), Odd index = Evening (18:00)
            const hour = i % 2 === 0 ? 10 : 18;
            publishAt.setHours(hour, 0, 0, 0);
            slots.push({
                project_id: projectId,
                week_id: weekId,
                channel_id: channelId,
                slot_date: date,
                slot_index: startIndex + i + 1,
                publish_at: publishAt,
                topic_index: startIndex + i + 1,
                status: 'planned'
            });
        }
        // Bulk insert
        if (slots.length > 0) {
            await db_1.default.post.createMany({
                data: slots
            });
        }
    }
    async findWeekByDate(projectId, date) {
        return db_1.default.week.findFirst({
            where: {
                project_id: projectId,
                week_start: { lte: date },
                week_end: { gte: date }
            },
            include: { posts: { orderBy: { topic_index: 'asc' } } }
        });
    }
    async updateWeekStatus(weekId, status) {
        return db_1.default.week.update({
            where: { id: weekId },
            data: { status }
        });
    }
    async saveTopics(weekId, topics, startIndex = 0) {
        const posts = await db_1.default.post.findMany({
            where: { week_id: weekId },
            orderBy: { topic_index: 'asc' }
        });
        // Filter posts to only those we want to update (from startIndex)
        // Note: topic_index is 1-based usually
        const targetPosts = posts.filter(p => p.topic_index > startIndex && p.topic_index <= startIndex + topics.length);
        const updates = targetPosts.map((post, i) => {
            // i here is index in targetPosts, which matches index in topics
            if (topics[i]) {
                return db_1.default.post.update({
                    where: { id: post.id },
                    data: {
                        topic: topics[i].topic,
                        category: topics[i].category,
                        tags: topics[i].tags,
                        status: 'topics_generated'
                    }
                });
            }
            return Promise.resolve();
        });
        await Promise.all(updates);
        await this.updateWeekStatus(weekId, 'topics_generated');
    }
    async getWeekPosts(weekId) {
        return db_1.default.post.findMany({
            where: { week_id: weekId },
            orderBy: { topic_index: 'asc' }
        });
    }
    async getPostById(postId) {
        return db_1.default.post.findUnique({
            where: { id: postId },
            include: { week: true }
        });
    }
    async updatePost(postId, data) {
        return db_1.default.post.update({
            where: { id: postId },
            data
        });
    }
    async convertWeekPackageToV1(projectId, weekPackageId) {
        const weekPackage = await db_1.default.weekPackage.findUnique({
            where: { id: weekPackageId, project_id: projectId }
        });
        if (!weekPackage) {
            throw new Error('V2 WeekPackage not found');
        }
        // Check if a V1 week already exists for the same dates and project
        let week = await db_1.default.week.findFirst({
            where: {
                project_id: projectId,
                week_start: weekPackage.week_start,
                week_end: weekPackage.week_end
            }
        });
        if (week) {
            return {
                weekId: week.id,
                reused: true
            };
        }
        // Create V1 week
        week = await this.createWeek(projectId, weekPackage.week_theme || 'Импортированная тема', weekPackage.week_start, weekPackage.week_end);
        // Generate default 14 slots for this week
        await this.generateSlots(week.id, projectId, weekPackage.week_start, 14, 0);
        return {
            weekId: week.id,
            reused: false
        };
    }
}
exports.default = new PlannerService();
