/** Maximum POST body size in bytes (decompressed) */
export const MAX_BODY_SIZE_BYTES = 128 * 1024 // 128 KB

/** Maximum length of a single NDJSON line (NB. characters not bytes) */
export const MAX_LINE_LENGTH = 16 * 1024 // ~16 KB

/** Cloudflare Queue maximum message size in bytes */
export const QUEUE_MAX_MESSAGE_SIZE = 128 * 1024 // 128 KB

/** Conservative overhead estimate for queue message metadata and differences
 * between our estimate of message size and Cloudflare's actual message size */
export const QUEUE_MESSAGE_OVERHEAD_BYTES = 2 * 1024
