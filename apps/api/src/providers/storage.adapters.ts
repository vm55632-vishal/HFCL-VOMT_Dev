import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Client as MinioClient } from 'minio';
import type { AppConfig } from '@vop/config';
import type { StorageProvider } from './contracts';

/** Reject keys that could escape the storage root. Keys are opaque, app-generated (never filenames). */
function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || path.isAbsolute(key) || /[\0\\]/.test(key)) {
    throw new Error('Invalid storage key.');
  }
}

/**
 * Local filesystem storage — the zero-dependency default for dev and simple on-prem installs.
 * Files live outside the web root under a base directory, keyed by opaque app-generated keys.
 */
export class LocalFsStorage implements StorageProvider {
  private readonly root: string;

  constructor(baseDir = path.resolve(process.cwd(), '.storage')) {
    this.root = baseDir;
  }

  private full(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const target = this.full(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.full(key));
      return true;
    } catch {
      return false;
    }
  }

  presignGet(_key: string, _ttlSeconds: number): Promise<string> {
    // Local storage cannot presign; downloads go through the authorized streaming endpoint.
    return Promise.reject(
      new Error('Local storage does not support presigned URLs; use the streaming download.'),
    );
  }
}

/**
 * MinIO / S3-compatible storage — the on-prem object-store adapter, and the same client works
 * against AWS S3. Bucket and credentials come from config.
 */
export class MinioStorage implements StorageProvider {
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    const { storage } = config;
    const url = new URL(storage.endpoint);
    this.bucket = storage.bucket;
    this.client = new MinioClient({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
      accessKey: storage.accessKey ?? '',
      secretKey: storage.secretKey ?? '',
      region: storage.region,
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.putObject(this.bucket, key, data, data.length, {
      'Content-Type': contentType,
    });
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.removeObject(this.bucket, key);
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  presignGet(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    return this.client.presignedGetObject(this.bucket, key, ttlSeconds);
  }
}

/**
 * Cloudflare R2 storage — R2 exposes an S3-compatible API, so we drive it with the AWS S3 SDK v3
 * (Cloudflare's recommended client; it signs requests the way R2 expects, unlike some MinIO-client
 * quirks). Point `VOP_STORAGE_ENDPOINT` at the account S3 endpoint
 * (https://<accountid>.r2.cloudflarestorage.com), set the access key id / secret from an R2 API
 * token, keep `VOP_STORAGE_REGION=auto`, and name the bucket in `VOP_STORAGE_BUCKET`.
 *
 * Objects are stored under opaque, app-generated keys; downloads still stream through the
 * authorized endpoint (DocumentsService.download), so access control + audit are never bypassed.
 * presignGet is available for short-lived direct links where a deployment opts into them.
 */
export class R2Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    const { storage } = config;
    this.bucket = storage.bucket;
    this.client = new S3Client({
      // R2 ignores the region but the SDK requires one; "auto" is Cloudflare's documented value.
      region: storage.region || 'auto',
      endpoint: storage.endpoint,
      credentials: {
        accessKeyId: storage.accessKey ?? '',
        secretAccessKey: storage.secretKey ?? '',
      },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentLength: data.length,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  presignGet(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}

/** Cloud object-store adapters (Azure Blob, GCS) — stubbed until the cloud is chosen (Phase 6). */
export class NotImplementedStorage implements StorageProvider {
  constructor(private readonly name: string) {}
  put(): Promise<void> {
    return Promise.reject(this.tryFail());
  }
  get(): Promise<Buffer> {
    return Promise.reject(this.tryFail());
  }
  remove(): Promise<void> {
    return Promise.reject(this.tryFail());
  }
  exists(): Promise<boolean> {
    return Promise.reject(this.tryFail());
  }
  presignGet(): Promise<string> {
    return Promise.reject(this.tryFail());
  }
  private tryFail(): Error {
    return new Error(`${this.name} StorageProvider is not implemented yet (stub).`);
  }
}

/** Deterministic object key: random ULID-like prefix + content hash, never a user filename. */
export function objectKey(prefix: string, data: Buffer): string {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  return `${prefix}/${Date.now()}-${hash}`;
}
