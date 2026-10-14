/**
 * URL validation for supported YouTube URLs.
 *
 * Supported patterns (HTTPS only, no localhost / private networks):
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   https://m.youtube.com/watch?v=VIDEO_ID
 *
 * Explicitly rejected:
 *   - non-https schemes
 *   - localhost / 127.x / 10.x / 192.168.x / 172.16-31.x
 *   - any host not in the allow-list
 *   - playlist-only URLs without a video ID (may be extended later)
 */

const YOUTUBE_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

// Private / loopback ranges – catches common SSRF targets
const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1|fe80::.*)$/i;

/**
 * Returns a normalised URL string if valid, or throws with a structured error
 * code that callers can map to an HTTP response.
 */
export function validateYouTubeUrl(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw Object.assign(new Error('URL is required'), { code: 'invalid_url' });
  }

  const trimmed = raw.trim();

  // Length guard — no YouTube URL is this long
  if (trimmed.length > 2048) {
    throw Object.assign(new Error('URL too long'), { code: 'invalid_url' });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('Malformed URL'), { code: 'invalid_url' });
  }

  // Only HTTPS
  if (parsed.protocol !== 'https:') {
    throw Object.assign(
      new Error('Only HTTPS URLs are accepted'),
      { code: 'invalid_url' },
    );
  }

  // Block private / loopback hosts (SSRF prevention)
  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(hostname)) {
    throw Object.assign(
      new Error('Private or loopback hosts are not allowed'),
      { code: 'invalid_url' },
    );
  }

  // Must be a known YouTube host
  if (!YOUTUBE_HOSTS.has(hostname)) {
    throw Object.assign(
      new Error(`Unsupported host: ${hostname}`),
      { code: 'unsupported_url' },
    );
  }

  // Extract video ID from supported path patterns
  const videoId = extractVideoId(parsed);
  if (!videoId) {
    throw Object.assign(
      new Error('Could not extract a YouTube video ID from the URL'),
      { code: 'unsupported_url' },
    );
  }

  // Normalise to a canonical watch URL
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function extractVideoId(url: URL): string | null {
  const { hostname, pathname, searchParams } = url;

  // youtu.be/VIDEO_ID
  if (hostname === 'youtu.be') {
    const id = pathname.slice(1).split('/')[0];
    return isValidVideoId(id) ? id : null;
  }

  // /watch?v=VIDEO_ID
  if (pathname === '/watch' || pathname.startsWith('/watch?')) {
    const v = searchParams.get('v');
    return v && isValidVideoId(v) ? v : null;
  }

  // /shorts/VIDEO_ID
  const shortsMatch = pathname.match(/^\/shorts\/([^/?#]+)/);
  if (shortsMatch) {
    return isValidVideoId(shortsMatch[1]) ? shortsMatch[1] : null;
  }

  return null;
}

/** YouTube video IDs are exactly 11 URL-safe Base64 characters */
function isValidVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}
