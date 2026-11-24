// The display name of an uploaded image (`media.name`). Pure, so the upload dialog shows what the
// server will store. The stored file keeps its random name (`<hex>.<ext>`); this is only a label.

export const MEDIA_NAME_MAX = 120

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i

/** The extension of a file name, lower case with the dot (".jpg"), or "". */
export function extensionOf(filename: string): string {
  const match = /\.[a-z0-9]{1,5}$/i.exec(filename)
  return match ? match[0].toLowerCase() : ''
}

/**
 * Tidies a name typed or taken from a file: no control characters or path separators, spaces
 * collapsed, a trailing image extension dropped (the type is shown separately), at most 120
 * characters. Returns null when nothing is left.
 */
export function cleanMediaName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw
    .replace(/[\u0000-\u001f\u007f/\\]/g, ' ')
    // Trimmed before the extension check, so "photo.jpg " loses its ".jpg" too.
    .trim()
    .replace(IMAGE_EXTENSION, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEDIA_NAME_MAX)
    .trim()
  return text || null
}
