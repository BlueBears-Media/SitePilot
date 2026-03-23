import type { Readable } from 'node:stream'

export interface StorageAdapter {
  upload(key: string, stream: Readable, meta?: Record<string, string>): Promise<void>
  download(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  signedUrl(key: string, expiresInSeconds: number): Promise<string>
}
