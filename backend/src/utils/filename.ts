import sanitize from 'sanitize-filename';

/**
 * Produce a safe filename for Content-Disposition headers.
 *
 * Rules:
 * - Strip/replace characters that are unsafe on Windows, macOS, or Linux.
 * - Collapse whitespace to underscores.
 * - Limit length so the full path stays well under OS limits.
 * - Always append the provided extension.
 * - Fall back to "download" when the sanitised name is empty.
 */
export function safeFilename(title: string, ext: string): string {
  // sanitize-filename handles the OS-unsafe characters
  const cleaned = sanitize(title, { replacement: '_' })
    .replace(/\s+/g, '_')       // spaces → underscores
    .replace(/\.\./g, '_')      // collapse any remaining double-dot sequences (path traversal)
    .replace(/_{2,}/g, '_')     // collapse consecutive underscores
    .replace(/^_+|_+$/g, '')    // trim leading/trailing underscores
    .slice(0, 200);             // cap base name length

  const base = cleaned || 'download';
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);

  return `${base}.${safeExt || 'mp4'}`;
}

/**
 * Produces an ASCII-only fallback filename for the legacy `filename="..."` parameter
 * in the HTTP Content-Disposition header.
 *
 * Browsers following RFC 5987 / RFC 6266 will prefer `filename*=UTF-8''...`,
 * but Node.js throws ERR_INVALID_CHAR if `filename="..."` contains characters > 255.
 */
export function toAsciiFilename(filename: string): string {
  // Replace quotes and backslashes to avoid header injection
  const safe = filename.replace(/["\\]/g, '_');
  // Extract extension
  const extMatch = safe.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : 'mp4';
  const nameWithoutExt = extMatch ? safe.slice(0, -extMatch[0].length) : safe;

  // Keep only printable ASCII characters (0x20 to 0x7E)
  const asciiBase = nameWithoutExt
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();

  const finalBase = asciiBase || 'download';
  return `${finalBase}.${ext}`;
}
