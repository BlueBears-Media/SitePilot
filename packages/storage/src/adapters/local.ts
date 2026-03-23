import { join } from 'node:path'
import { NfsAdapter, type NfsAdapterConfig } from './nfs'

export interface LocalAdapterConfig {
  directory?: string
  apiBaseUrl: string
  tokenSecret: string
}

/**
 * LocalAdapter — identical to NfsAdapter but defaults the storage
 * directory to ./data/backups. Suitable for development and single-server installs.
 */
export class LocalAdapter extends NfsAdapter {
  constructor(config: LocalAdapterConfig) {
    const nfsConfig: NfsAdapterConfig = {
      mountPath: config.directory ?? join(process.cwd(), 'data', 'backups'),
      apiBaseUrl: config.apiBaseUrl,
      tokenSecret: config.tokenSecret,
    }
    super(nfsConfig)
  }
}
