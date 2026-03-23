import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'node:stream'
import type { StorageAdapter, StorageUploadOptions } from '../interface'

export interface S3AdapterConfig {
  bucket: string
  region: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
}

export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: S3AdapterConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Required for MinIO path-style addressing
      forcePathStyle: true,
    })
  }

  async upload(key: string, stream: Readable, options?: StorageUploadOptions): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: stream,
      Metadata: options?.metadata,
      ContentLength: options?.contentLength,
    })
    await this.client.send(command)
  }

  async download(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })
    const response = await this.client.send(command)
    if (!response.Body) {
      throw new Error(`Object not found: ${key}`)
    }
    // The SDK body is a ReadableStream (Web API) or Readable depending on environment
    // Cast to Readable for Node.js compatibility
    return response.Body as unknown as Readable
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })
    await this.client.send(command)
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
      await this.client.send(command)
      return true
    } catch (error) {
      const errorName = error instanceof Error ? error.name : ''
      const statusCode = getAwsHttpStatusCode(error)

      if (
        errorName === 'NotFound' ||
        errorName === 'NoSuchKey' ||
        (statusCode === 404 && errorName !== 'NoSuchBucket')
      ) {
        return false
      }

      throw error
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds })
  }
}

function getAwsHttpStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) {
    return undefined
  }

  const metadata = error.$metadata
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) {
    return undefined
  }

  const httpStatusCode = metadata.httpStatusCode
  return typeof httpStatusCode === 'number' ? httpStatusCode : undefined
}
