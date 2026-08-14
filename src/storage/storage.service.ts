import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { AllConfigType } from '../config/config.type';

const VIEW_URL_TTL_SECONDS = 300;
const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Cloudflare R2 (S3-compatible). The browser PUTs straight to R2 with a presigned URL —
 * the server never streams the file — and only the object key is persisted.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    const accessKeyId = this.configService.get('file.accessKeyId', {
      infer: true,
    });
    const secretAccessKey = this.configService.get('file.secretAccessKey', {
      infer: true,
    });
    this.bucket =
      this.configService.get('file.awsDefaultS3Bucket', { infer: true }) ?? '';

    if (!accessKeyId || !secretAccessKey || !this.bucket) {
      this.logger.warn(
        'Object storage is not configured; receipt and QR uploads are disabled',
      );
      this.client = null;
      return;
    }

    this.client = new S3Client({
      region:
        this.configService.get('file.awsS3Region', { infer: true }) || 'auto',
      endpoint: this.configService.get('file.r2Endpoint', { infer: true }),
      credentials: { accessKeyId, secretAccessKey },
      // R2 rejects the AWS SDK's default CRC32 checksum on presigned PUTs.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  objectKeyFor(prefix: string, fileName: string): string {
    const extension = fileName.includes('.')
      ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
      : '';

    return `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
  }

  async createUploadUrl(
    prefix: string,
    fileName: string,
    contentType: string,
  ): Promise<{ objectKey: string; uploadUrl: string }> {
    if (!this.client) {
      throw new Error('Object storage is not configured');
    }

    const objectKey = this.objectKeyFor(prefix, fileName);

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return { objectKey, uploadUrl };
  }

  /** Short-lived read URL for viewing a stored object. */
  async createViewUrl(objectKey: string): Promise<string | null> {
    if (!this.client || !objectKey) return null;

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: VIEW_URL_TTL_SECONDS },
    );
  }
}
