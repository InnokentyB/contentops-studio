import { z } from 'zod';

/**
 * Zod validation schema for updating week metadata.
 */
export const UpdateWeekSchema = z.object({
    theme: z.string().optional(),
    status: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional()
}).passthrough();

export type UpdateWeekInput = z.infer<typeof UpdateWeekSchema>;

/**
 * Zod validation schema for updating post content.
 */
export const UpdatePostSchema = z.object({
    title: z.string().optional(),
    text: z.string().optional(),
    publish_at: z.union([z.string(), z.date(), z.null()]).optional(),
    status: z.string().optional(),
    channel_id: z.union([z.number(), z.null()]).optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
    assets: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

/**
 * Zod validation schema for approving posts with optional schedule/channel modifications.
 */
export const ApprovePostSchema = z.object({
    publish_at: z.union([z.string(), z.date(), z.null()]).optional(),
    text: z.string().optional(),
    channel_id: z.union([z.number(), z.null()]).optional()
}).passthrough();

export type ApprovePostInput = z.infer<typeof ApprovePostSchema>;

/**
 * Zod validation schema for posting user or agent comments.
 */
export const CreateCommentSchema = z.object({
    entityType: z.string().min(1, 'Entity type is required'),
    entityId: z.union([z.number(), z.string()]).refine((val) => {
        const parsed = typeof val === 'string' ? parseInt(val, 10) : val;
        return !Number.isNaN(parsed) && Number.isInteger(parsed);
    }, { message: 'Invalid entity ID' }).transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val)),
    text: z.string().min(1, 'Comment text cannot be empty')
});

export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

/**
 * Zod validation schema for recording publication outcome facts.
 */
export const RecordPublicationFactSchema = z.object({
    published_link: z.string().url().optional(),
    platform_post_id: z.string().optional(),
    actual_published_at: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export type RecordPublicationFactInput = z.infer<typeof RecordPublicationFactSchema>;

/**
 * Zod validation schema for creating social channels on a project.
 */
export const CreateChannelSchema = z.object({
    type: z.string().min(1, 'Channel type is required'),
    name: z.string().min(1, 'Channel name is required'),
    config: z.record(z.string(), z.unknown()).default({})
});

export type CreateChannelInput = z.infer<typeof CreateChannelSchema>;

/**
 * Zod validation schema for generating topics for a week.
 */
export const GenerateTopicsSchema = z.object({
    promptPresetId: z.number().int().positive().optional(),
    overwrite: z.boolean().optional(),
    additionalContext: z.string().max(2000, 'Additional context cannot exceed 2000 characters').optional()
}).passthrough();

export type GenerateTopicsInput = z.infer<typeof GenerateTopicsSchema>;

/**
 * Zod validation schema for strategy chat messages (DoS and token inflation prevention).
 */
export const StrategyChatMessageSchema = z.object({
    message: z.string().min(1, 'Message is required').max(4000, 'Message cannot exceed 4000 characters'),
    language: z.enum(['en', 'ru']).optional()
});

export type StrategyChatMessageInput = z.infer<typeof StrategyChatMessageSchema>;

/**
 * Zod validation schema for user registration.
 */
export const RegisterSchema = z.object({
    email: z.string().trim().toLowerCase().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters long').max(100, 'Password cannot exceed 100 characters'),
    name: z.string().trim().max(100, 'Name cannot exceed 100 characters').optional()
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Zod validation schema for user login.
 */
export const LoginSchema = z.object({
    email: z.string().trim().toLowerCase().email('Invalid email address'),
    password: z.string().min(1, 'Password is required').max(100, 'Password cannot exceed 100 characters')
});

export type LoginInput = z.infer<typeof LoginSchema>;

