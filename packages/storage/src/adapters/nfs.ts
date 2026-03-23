import { createReadStream, createWriteStream } from 'node:fs'
import { unlink, stat, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHmac } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { StorageAdapter } from '../interface'

export interface NfsAdapterConfig {
  mountPath: string
  apiBaseUrl: string
  tokenSecret: string
}

export class NfsAdapter implements StorageAdapter {
  protected readonly mountPath: string
  private readonly apiBaseUrl: string
  private readonly tokenSecret: string

  constructor(config: NfsAdapterConfig) {
    this.mountPath = config.mountPath
    this.apiBaseUrl = config.apiBaseUrl
    this.tokenSecret = config.tokenSecret
  }

  protected resolvePath(key: string): string {
    // Prevent directory traversal
    const normalized = key.replace(/\.\./g, '').replace(/^\/+/, '')
    return join(this.mountPath, normalized)
  }

  async upload(key: string, stream: Readable, _meta?: Record<string, string>): Promise<void> {
    const filePath = this.resolvePath(key)
    // Ensure parent directory exists
    await mkdir(dirname(filePath), { recursive: true })

    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath)
      stream.pipe(writeStream)
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
      stream.on('error', reject)
    })
  }

  async download(key: string): Promise<Readable> {
    const filePath = this.resolvePath(key)
    // Verify file exists before creating stream
    await stat(filePath)
    return createReadStream(filePath)
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key)
    await unlink(filePath)
  }

  async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.resolvePath(key)
      await stat(filePath)
      return true
    } catch {
      return false
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds

    // Build a payload string: key + expiry
    const payload = `${key}:${expiresAt}`

    // Sign with HMAC-SHA256 using the tokenSecret
    const signature = createHmac('sha256', this.tokenSecret)
      .update(payload)
      .digest('hex')

    // Encode all parts into a URL-safe token: base64(key):expiry:signature
    const encodedKey = Buffer.from(key).toString('base64url')
    const token = `${encodedKey}.${expiresAt}.${signature}`

    return `${this.apiBaseUrl}/storage/serve/${token}`
  }
}
