import type { Readable } from 'node:stream'

export interface StorageUploadOptions {
  metadata?: Record<string, string>
  contentLength?: number
}

export interface StorageAdapter {
  upload(key: string, stream: Readable, options?: StorageUploadOptions): Promise<void>
  download(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  signedUrl(key: string, expiresInSeconds: number): Promise<string>
}
