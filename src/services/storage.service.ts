import { DeleteObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

const SUPABASE_BUCKET = 'post-images';

type StorageProvider = 'r2' | 'supabase';

type StorageServiceDependencies = {
    env?: NodeJS.ProcessEnv;
    r2Client?: Pick<S3Client, 'send'>;
    supabaseClient?: any;
};

type R2Config = {
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBaseUrl: string;
    endpoint: string;
};

function trimSlash(value: string) {
    return value.replace(/\/+$/, '');
}

function normalizeObjectKey(value: string) {
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').includes('..')) {
        throw new Error('[STORAGE_INVALID_PATH] Object path must be a non-empty relative path');
    }
    return normalized;
}

export class StorageService {
    private readonly env: NodeJS.ProcessEnv;
    private supabaseClient?: any;
    private readonly injectedR2Client?: Pick<S3Client, 'send'>;
    private r2Client?: Pick<S3Client, 'send'>;

    constructor(deps: StorageServiceDependencies = {}) {
        this.env = deps.env || process.env;
        this.supabaseClient = deps.supabaseClient;
        this.injectedR2Client = deps.r2Client;
    }

    private r2Config(): R2Config | null {
        if (this.env.R2_ENABLED?.trim().toLowerCase() !== 'true') return null;

        const accountId = this.env.R2_ACCOUNT_ID?.trim();
        const accessKeyId = this.env.R2_ACCESS_KEY_ID?.trim();
        const secretAccessKey = this.env.R2_SECRET_ACCESS_KEY?.trim();
        const bucket = this.env.R2_BUCKET?.trim();
        const publicBaseUrl = this.env.R2_PUBLIC_BASE_URL?.trim();
        if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;

        const jurisdiction = this.env.R2_JURISDICTION?.trim().toLowerCase();
        const jurisdictionPart = jurisdiction && jurisdiction !== 'default' ? `.${jurisdiction}` : '';
        const endpoint = this.env.R2_ENDPOINT?.trim()
            || `https://${accountId}${jurisdictionPart}.r2.cloudflarestorage.com`;
        return {
            accessKeyId,
            secretAccessKey,
            bucket,
            publicBaseUrl: trimSlash(publicBaseUrl),
            endpoint: trimSlash(endpoint)
        };
    }

    private getR2Client(config: R2Config) {
        if (this.injectedR2Client) return this.injectedR2Client;
        if (!this.r2Client) {
            this.r2Client = new S3Client({
                region: 'auto',
                endpoint: config.endpoint,
                credentials: {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey
                }
            });
        }
        return this.r2Client;
    }

    private getSupabaseClient() {
        if (!this.supabaseClient) {
            this.supabaseClient = require('./supabase').supabase;
        }
        return this.supabaseClient;
    }

    getProvider(): StorageProvider {
        return this.r2Config() ? 'r2' : 'supabase';
    }

    async ensureBucketExists() {
        const r2 = this.r2Config();
        if (r2) {
            await this.getR2Client(r2).send(new HeadBucketCommand({ Bucket: r2.bucket }));
            console.log(`[Storage] R2 bucket '${r2.bucket}' is reachable.`);
            return;
        }

        const supabaseClient = this.getSupabaseClient();
        const { error } = await supabaseClient.storage.getBucket(SUPABASE_BUCKET);
        if (!error) {
            console.log(`[Storage] Supabase bucket '${SUPABASE_BUCKET}' exists.`);
            return;
        }

        console.warn(`[Storage] Bucket '${SUPABASE_BUCKET}' not found or not accessible. Ensure it exists in Supabase Dashboard.`);
        const { error: createError } = await supabaseClient.storage.createBucket(SUPABASE_BUCKET, {
            public: true,
            fileSizeLimit: 10485760,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
        });
        if (createError) throw createError;
    }

    async checkHealth() {
        const r2 = this.r2Config();
        if (r2) {
            await this.getR2Client(r2).send(new HeadBucketCommand({ Bucket: r2.bucket }));
            return { provider: 'r2', bucket: r2.bucket, public_base_url: r2.publicBaseUrl };
        }

        const { data, error } = await this.getSupabaseClient().storage.listBuckets();
        if (error) throw error;
        return {
            provider: 'supabase',
            bucket: SUPABASE_BUCKET,
            bucket_count: Array.isArray(data) ? data.length : 0,
            bucket_exists: Array.isArray(data) && data.some((bucket: any) => bucket.name === SUPABASE_BUCKET)
        };
    }

    async uploadFileFromBuffer(buffer: Buffer, mimeType: string, destinationPath: string): Promise<string> {
        const objectKey = normalizeObjectKey(destinationPath);
        const r2 = this.r2Config();
        if (r2) {
            await this.getR2Client(r2).send(new PutObjectCommand({
                Bucket: r2.bucket,
                Key: objectKey,
                Body: buffer,
                ContentType: mimeType,
                CacheControl: 'public, max-age=31536000, immutable'
            }));
            return `${r2.publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
        }

        try {
            const supabaseClient = this.getSupabaseClient();
            const { error } = await supabaseClient.storage
                .from(SUPABASE_BUCKET)
                .upload(objectKey, buffer, { upsert: true, contentType: mimeType });
            if (error) throw error;
            return supabaseClient.storage.from(SUPABASE_BUCKET).getPublicUrl(objectKey).data.publicUrl;
        } catch (error) {
            if (this.env.NODE_ENV === 'production') throw error;
            console.warn('[Storage] Cloud upload failed; using local development fallback.', error);
            const uploadsDir = path.join(process.cwd(), 'uploads');
            fs.mkdirSync(uploadsDir, { recursive: true });
            const filename = path.basename(objectKey) || `file-${Date.now()}.png`;
            fs.writeFileSync(path.join(uploadsDir, filename), buffer);
            return `/uploads/${filename}`;
        }
    }

    async uploadFile(localPath: string, destinationPath: string): Promise<string> {
        const fileContent = fs.readFileSync(localPath);
        return this.uploadFileFromBuffer(fileContent, this.getContentType(localPath), destinationPath);
    }

    async deleteFile(url: string): Promise<void> {
        try {
            const r2 = this.r2Config();
            if (r2 && url.startsWith(`${r2.publicBaseUrl}/`)) {
                const key = decodeURIComponent(url.slice(r2.publicBaseUrl.length + 1));
                await this.getR2Client(r2).send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
                return;
            }

            let objectKey = url;
            const marker = `/storage/v1/object/public/${SUPABASE_BUCKET}/`;
            if (url.includes(marker)) objectKey = url.split(marker)[1];
            const { error } = await this.getSupabaseClient().storage.from(SUPABASE_BUCKET).remove([objectKey]);
            if (error) console.error(`[Storage] Failed to delete file '${objectKey}':`, error);
        } catch (error) {
            console.error(`[Storage] Error deleting file ${url}:`, error);
        }
    }

    private getContentType(filePath: string): string {
        switch (path.extname(filePath).toLowerCase()) {
            case '.png': return 'image/png';
            case '.jpg':
            case '.jpeg': return 'image/jpeg';
            case '.gif': return 'image/gif';
            case '.webp': return 'image/webp';
            default: return 'application/octet-stream';
        }
    }
}

export default new StorageService();
