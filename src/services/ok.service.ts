import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface OKConfig {
    access_token: string;
    application_key: string;
    application_secret_key: string;
    group_id: string;
}

interface PhotoUploadUrlResponse {
    upload_url: string;
    photo_ids: string[];
}

interface PhotoUploadResponse {
    photos: Record<string, { token: string }>;
}

class OKService {
    /**
     * Helper to compute OK API request signature (sig).
     */
    private calculateSig(
        params: Record<string, string>,
        accessToken: string,
        appSecret: string
    ): string {
        const sessionSecretKey = crypto
            .createHash('md5')
            .update(accessToken + appSecret)
            .digest('hex');

        const sortedKeys = Object.keys(params).sort();
        let paramString = '';
        for (const key of sortedKeys) {
            paramString += `${key}=${params[key]}`;
        }

        const stringToSign = paramString + sessionSecretKey;
        return crypto.createHash('md5').update(stringToSign).digest('hex');
    }

    /**
     * Helper to resolve local/remote image URLs to a Blob or Buffer for upload.
     */
    private async resolveImageBuffer(imageUrl: string): Promise<Buffer> {
        if (imageUrl.startsWith('data:')) {
            const base64Data = imageUrl.split(',')[1];
            return Buffer.from(base64Data, 'base64');
        }

        if (imageUrl.startsWith('/uploads/')) {
            const filename = imageUrl.split('/').pop();
            const localPath = path.join(__dirname, '../../uploads', filename || '');
            if (fs.existsSync(localPath)) {
                return fs.readFileSync(localPath);
            }
            throw new Error(`Local image file not found: ${localPath}`);
        }

        if (imageUrl.startsWith('http')) {
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch remote image: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }

        throw new Error(`Unsupported image URL format: ${imageUrl}`);
    }

    /**
     * Uploads an image to Odnoklassniki.
     */
    private async uploadImage(
        config: OKConfig,
        imageUrl: string
    ): Promise<string> {
        const imageBuffer = await this.resolveImageBuffer(imageUrl);

        // 1. Get upload URL
        const requestParams: Record<string, string> = {
            application_key: config.application_key,
            method: 'photosV2.getUploadUrl',
            gid: config.group_id,
            count: '1'
        };

        const sig = this.calculateSig(requestParams, config.access_token, config.application_secret_key);
        const queryParams = new URLSearchParams({
            ...requestParams,
            sig,
            access_token: config.access_token
        });

        const getUrlResponse = await fetch(`https://api.ok.ru/fb.do?${queryParams.toString()}`);
        if (!getUrlResponse.ok) {
            throw new Error(`Failed to get OK upload URL: ${await getUrlResponse.text()}`);
        }

        const getUrlData = (await getUrlResponse.json()) as PhotoUploadUrlResponse;
        if (!getUrlData.upload_url) {
            throw new Error(`OK upload url response missing upload_url: ${JSON.stringify(getUrlData)}`);
        }

        // 2. Upload file via multipart/form-data
        const formData = new FormData();
        formData.append('pic1', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'photo.jpg');

        const uploadResponse = await fetch(getUrlData.upload_url, {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            throw new Error(`OK photo upload failed: ${await uploadResponse.text()}`);
        }

        const uploadData = (await uploadResponse.json()) as PhotoUploadResponse;
        const photoKey = Object.keys(uploadData.photos || {})[0];
        const token = uploadData.photos?.[photoKey]?.token;
        if (!token) {
            throw new Error(`OK photo upload response missing token: ${JSON.stringify(uploadData)}`);
        }

        return token;
    }

    /**
     * Publishes a post to Odnoklassniki (OK.ru) group wall.
     * @param config The OK connection config
     * @param text The post text
     * @param imageUrl Optional photo/image attachment
     * @returns The generated OK post URL
     */
    async publishPost(
        config: OKConfig,
        text: string,
        imageUrl?: string
    ): Promise<string> {
        let photoToken: string | null = null;

        if (imageUrl) {
            try {
                photoToken = await this.uploadImage(config, imageUrl);
            } catch (err: unknown) {
                console.error('[OKService] Failed to upload image, falling back to text only:', err);
            }
        }

        // Construct attachment object
        const mediaItems: Array<{ type: string; text?: string; list?: Array<{ id: string }> }> = [
            { type: 'text', text }
        ];

        if (photoToken) {
            mediaItems.push({
                type: 'photo',
                list: [{ id: photoToken }]
            });
        }

        const attachment = {
            media: mediaItems
        };

        const requestParams: Record<string, string> = {
            application_key: config.application_key,
            method: 'mediatopic.post',
            type: 'GROUP_THEME',
            gid: config.group_id,
            attachment: JSON.stringify(attachment)
        };

        const sig = this.calculateSig(requestParams, config.access_token, config.application_secret_key);
        const queryParams = new URLSearchParams({
            ...requestParams,
            sig,
            access_token: config.access_token
        });

        const response = await fetch(`https://api.ok.ru/fb.do?${queryParams.toString()}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OK publication failed: ${errorText}`);
        }

        const responseText = await response.text();
        let data: { topic_id?: string; error_code?: number; error_msg?: string };
        try {
            data = JSON.parse(responseText);
        } catch (_err) {
            throw new Error(`OK publication returned invalid JSON: ${responseText}`);
        }

        if (data.error_code) {
            throw new Error(`OK API error ${data.error_code}: ${data.error_msg}`);
        }

        const topicId = data.topic_id;
        if (!topicId) {
            throw new Error(`OK publication response missing topic_id: ${responseText}`);
        }

        return `https://ok.ru/group/${config.group_id}/topic/${topicId}`;
    }
}

export default new OKService();
