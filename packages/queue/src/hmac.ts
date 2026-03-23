import { createHmac, createHash, createDecipheriv } from 'node:crypto'

const ENC_KEY = Buffer.from(
  process.env['STORAGE_ENCRYPTION_KEY'] ?? '0'.repeat(64),
  'hex',
)

/**
 * Decrypts an AES-256-GCM encrypted companion token stored in the database.
 * Format: `${iv_hex}:${tag_hex}:${ciphertext_hex}`
 */
export function decryptToken(stored: string): string {
  const [ivHex, tagHex, encHex] = stored.split(':')
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid encrypted token format')
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8')
}

/**
 * WordPress verifies signatures against WP_REST_Request::get_route(), which is
 * the registered REST route path without the `/wp-json` prefix and without any
 * query string. Normalize outbound paths so the backend signs the exact same
 * canonical value the companion plugin reconstructs.
 */
export function normalizeWordPressRestPath(path: string): string {
  const [withoutQuery] = path.split(/[?#]/, 1)
  const normalized = withoutQuery && withoutQuery.length > 0 ? withoutQuery : path
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`

  if (withLeadingSlash === '/wp-json') {
    return '/'
  }

  if (withLeadingSlash.startsWith('/wp-json/')) {
    return withLeadingSlash.slice('/wp-json'.length)
  }

  return withLeadingSlash
}

/**
 * Signs an outbound request to the companion plugin using HMAC-SHA256.
 *
 * Message format: `${timestamp}.${METHOD}.${path}.${sha256(body)}`
 *
 * The companion plugin verifies this signature on every incoming request
 * to prevent unauthorized access and replay attacks (5-minute timestamp window).
 */
export function signRequest(params: {
  method: string
  path: string
  body: string
  token: string
}): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const canonicalPath = normalizeWordPressRestPath(params.path)

  const bodyHash = createHash('sha256').update(params.body, 'utf8').digest('hex')
  const message = `${timestamp}.${params.method.toUpperCase()}.${canonicalPath}.${bodyHash}`

  const signature = createHmac('sha256', params.token).update(message).digest('hex')

  return { timestamp, signature }
}

/**
 * Verifies an HMAC-SHA256 signature. Used for testing and debugging.
 * The companion plugin implements its own verification in PHP.
 */
export function verifySignature(params: {
  timestamp: string
  signature: string
  method: string
  path: string
  body: string
  token: string
}): boolean {
  // Check timestamp is within ±5 minutes
  const now = Math.floor(Date.now() / 1000)
  const ts = parseInt(params.timestamp, 10)
  if (Math.abs(now - ts) > 300) {
    return false
  }

  const canonicalPath = normalizeWordPressRestPath(params.path)
  const bodyHash = createHash('sha256').update(params.body, 'utf8').digest('hex')
  const message = `${params.timestamp}.${params.method.toUpperCase()}.${canonicalPath}.${bodyHash}`
  const expected = createHmac('sha256', params.token).update(message).digest('hex')

  // Use a constant-time comparison to prevent timing attacks
  return expected.length === params.signature.length &&
    Buffer.from(expected).equals(Buffer.from(params.signature))
}
