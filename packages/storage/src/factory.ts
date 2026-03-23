import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { StorageAdapter } from './interface'
import { S3Adapter } from './adapters/s3'
import { NfsAdapter } from './adapters/nfs'
import { LocalAdapter } from './adapters/local'
import type { StorageProfile } from '@sitepilot/db'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits is the recommended IV size for GCM
const TAG_LENGTH = 16 // 128-bit authentication tag

export interface EncryptedConfig {
  iv: string
  tag: string
  data: string
}

function getEncryptionKey(): Buffer {
  const keyHex = process.env['STORAGE_ENCRYPTION_KEY']
  if (!keyHex) {
    throw new Error('STORAGE_ENCRYPTION_KEY environment variable is required')
  }
  if (keyHex.length !== 64) {
    throw new Error('STORAGE_ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters)')
  }
  return Buffer.from(keyHex, 'hex')
}

/**
 * Encrypts a config object using AES-256-GCM.
 * Returns the IV, authentication tag, and ciphertext as hex strings.
 */
export function encryptConfig(config: object): EncryptedConfig {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const plaintext = JSON.stringify(config)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  }
}

/**
 * Decrypts an encrypted config object using AES-256-GCM.
 * Throws if the authentication tag is invalid (tampered data).
 */
export function decryptConfig(encrypted: EncryptedConfig): object {
  const key = getEncryptionKey()
  const iv = Buffer.from(encrypted.iv, 'hex')
  const tag = Buffer.from(encrypted.tag, 'hex')
  const data = Buffer.from(encrypted.data, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(decrypted.toString('utf8')) as object
}

/**
 * StorageAdapterFactory creates the appropriate storage adapter
 * based on a decrypted storage profile record.
 */
export class StorageAdapterFactory {
  static create(profile: StorageProfile): StorageAdapter {
    const encryptedConfig = profile.config as EncryptedConfig
    const config = decryptConfig(encryptedConfig) as Record<string, string>

    const apiBaseUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
    const tokenSecret = process.env['STORAGE_ENCRYPTION_KEY'] ?? ''

    switch (profile.type) {
      case 's3':
        return new S3Adapter({
          bucket: config['bucket'] ?? '',
          region: config['region'] ?? '',
          endpoint: config['endpoint'] ?? '',
          accessKeyId: config['accessKeyId'] ?? '',
          secretAccessKey: config['secretAccessKey'] ?? '',
        })

      case 'nfs':
        return new NfsAdapter({
          mountPath: config['mountPath'] ?? '',
          apiBaseUrl,
          tokenSecret,
        })

      case 'local':
        return new LocalAdapter({
          directory: config['directory'],
          apiBaseUrl,
          tokenSecret,
        })

      default:
        throw new Error(`Unknown storage profile type: ${profile.type}`)
    }
  }
}
