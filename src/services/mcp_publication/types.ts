/**
 * Types for MCP publication service.
 */

export type PublicationOutcome = 'published' | 'blocked' | 'removed' | 'restricted';

export interface DirectPublishParams {
    projectId: number;
    channelId?: number;
    channelType?: string;
    title?: string;
    text: string;
    subreddit?: string;
    imageUrl?: string;
    dryRun?: boolean;
}

export type ProjectRole = 'owner' | 'editor' | 'viewer';
