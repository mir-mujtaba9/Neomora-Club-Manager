import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
 
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly useS3: boolean;
 
  constructor(private readonly configService: ConfigService) {
    // Check if S3 credentials are configured
    this.useS3 =
      !!configService.get<string>('storage.accessKeyId') &&
      !!configService.get<string>('storage.secretAccessKey') &&
      !!configService.get<string>('storage.bucketName');
 
    if (!this.useS3) {
      this.logger.warn(
        'S3 not configured — using local filesystem storage. ' +
          'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET_NAME to enable S3.',
      );
    }
  }
 
  /**
   * Generate a signed/pre-signed download URL for a storage key.
   *
   * When S3 is configured it returns a real pre-signed URL (15 min TTL).
   * Without S3 it returns a signed local-download URL that the documents
   * controller validates and streams from disk.
   */
  async getSignedUrl(
    storageKey: string,
    expiresInSeconds = 900,
  ): Promise<{ url: string; expiresIn: number }> {
    if (this.useS3) {
      return this.getS3SignedUrl(storageKey, expiresInSeconds);
    }
    return this.getLocalSignedUrl(storageKey, expiresInSeconds);
  }
 
  // ─── S3 path (only used when credentials are present) ──────────────────────
 
  private async getS3SignedUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<{ url: string; expiresIn: number }> {
    // Use require() via any to avoid compile-time resolution of optional packages.
    // These packages (@aws-sdk/client-s3, @aws-sdk/s3-request-presigner) are
    // already in node_modules via @aws-sdk/client-s3 which is listed in package.json.
    // s3-request-presigner must be installed separately when S3 is needed:
    //   npm install @aws-sdk/s3-request-presigner
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { S3Client, GetObjectCommand } = (require as any)('@aws-sdk/client-s3');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSignedUrl } = (require as any)('@aws-sdk/s3-request-presigner');
 
    const client = new S3Client({
      region: this.configService.get<string>('storage.region') || 'us-east-1',
      credentials: {
        accessKeyId: this.configService.get<string>('storage.accessKeyId')!,
        secretAccessKey: this.configService.get<string>(
          'storage.secretAccessKey',
        )!,
      },
      ...(this.configService.get<string>('storage.endpoint')
        ? { endpoint: this.configService.get<string>('storage.endpoint') }
        : {}),
    });
 
    const command = new GetObjectCommand({
      Bucket: this.configService.get<string>('storage.bucketName')!,
      Key: storageKey,
    });
 
    const url = await getSignedUrl(client, command, {
      expiresIn: expiresInSeconds,
    });
 
    return { url, expiresIn: expiresInSeconds };
  }
 
  // ─── Local filesystem path ──────────────────────────────────────────────────
 
  /**
   * Returns a URL of the form:
   *   /api/v1/documents/download?key=<encoded-key>&token=<hmac>&exp=<unix-ts>
   *
   * The HMAC is signed with APP_SECRET (or a default dev secret) so the
   * download endpoint can verify authenticity without touching the DB.
   */
  private getLocalSignedUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): { url: string; expiresIn: number } {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const secret =
      this.configService.get<string>('app.jwtSecret') ||
      process.env.APP_SECRET ||
      'local-dev-secret-change-me';
 
    const payload = `${storageKey}:${exp}`;
    const token = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
 
    const encodedKey = encodeURIComponent(storageKey);
    const url = `/api/v1/documents/download?key=${encodedKey}&token=${token}&exp=${exp}`;
 
    return { url, expiresIn: expiresInSeconds };
  }
 
  /**
   * Verify a local signed URL token and return the storage key if valid.
   * Throws if expired or tampered.
   */
  verifyLocalToken(
    storageKey: string,
    token: string,
    exp: number,
  ): boolean {
    if (Math.floor(Date.now() / 1000) > exp) return false;
 
    const secret =
      this.configService.get<string>('app.jwtSecret') ||
      process.env.APP_SECRET ||
      'local-dev-secret-change-me';
 
    const payload = `${storageKey}:${exp}`;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
 
    // Timing-safe compare
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }
 
  /** Absolute path on disk for a given storage key */
  localPath(storageKey: string): string {
    return path.join(process.cwd(), 'storage', storageKey);
  }
 
  localFileExists(storageKey: string): boolean {
    return fs.existsSync(this.localPath(storageKey));
  }
}