import "server-only";
import type { SoundRecording } from "@/lib/recognition";
import { sanitizeSoundPhrase } from "@/lib/sound-presets";

const API = "https://commons.wikimedia.org/w/api.php";
const MEDIA_HOST = "upload.wikimedia.org";
const USER_AGENT = "DrawSound/0.1 (https://github.com/oliverseges/DrawSound; local dev app)";
const TIMEOUT_MS = 5000;
const POSITIVE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_SECONDS = 0.2;
const MAX_SECONDS = 20;
const MAX_CACHE_ENTRIES = 200;

const AUDIO_MIME = new Set([
  "audio/ogg",
  "application/ogg",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/flac",
]);

// Attribution-compatible, no NC/ND, no GFDL-only.
const ACCEPTED_LICENSE = /^(cc0(\s|$)|public domain|pd\b|cc[- ]by(-sa)?[- ]\d(\.\d)?)/i;

type Fetcher = typeof fetch;

type ImageInfo = {
  url?: string;
  descriptionurl?: string;
  mime?: string;
  size?: number;
  duration?: number;
  extmetadata?: Record<string, { value?: string } | undefined>;
};
type Page = { title?: string; imageinfo?: ImageInfo[] };

const stripHtml = (s: string | undefined) =>
  (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

export function isAcceptedLicense(name: string | undefined): boolean {
  if (!name) return false;
  if (/\b(nc|nd)\b/i.test(name)) return false;
  return ACCEPTED_LICENSE.test(name.trim());
}

/** Returns a clean https Commons media URL, or null if the URL is not from the known provider. */
export function validateMediaUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== MEDIA_HOST || u.port) return null;
    if (!u.pathname.startsWith("/wikipedia/commons/")) return null;
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function validatePageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== "commons.wikimedia.org") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function pickRecording(pages: Page[], phrase: string): SoundRecording | null {
  const words = phrase.split(" ").filter((w) => w.length > 2);
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const title = page.title ?? "";
    if (!info || !title) continue;
    if (!info.mime || !AUDIO_MIME.has(info.mime)) continue;
    if (!info.size || info.size > MAX_BYTES) continue;
    if (!info.duration || info.duration < MIN_SECONDS || info.duration > MAX_SECONDS) continue;
    const meta = info.extmetadata ?? {};
    const license = stripHtml(meta.LicenseShortName?.value);
    if (!isAcceptedLicense(license)) continue;
    const url = validateMediaUrl(info.url);
    const pageUrl = validatePageUrl(info.descriptionurl);
    if (!url || !pageUrl) continue;
    const lower = title.toLowerCase();
    if (words.length && !words.some((w) => lower.includes(w))) continue;
    const artist = stripHtml(meta.Artist?.value) || "Unknown author";
    return {
      url,
      title: title.replace(/^File:/, ""),
      credit: artist.slice(0, 120),
      license,
      pageUrl,
    };
  }
  return null;
}

type CacheEntry = { value: SoundRecording | null; expires: number };
const cache = new Map<string, CacheEntry>();
let queue: Promise<unknown> = Promise.resolve();

export function clearSoundCache() {
  cache.clear();
}

async function search(phrase: string, fetcher: Fetcher): Promise<SoundRecording | null> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${phrase} filetype:audio`,
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|mime|size|mediatype|extmetadata",
    format: "json",
    formatversion: "2",
  });
  const res = await fetcher(`${API}?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`Commons responded ${res.status}`);
  const body = (await res.json()) as { query?: { pages?: (Page & { index?: number })[] } };
  const pages = [...(body.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pickRecording(pages, phrase);
}

/**
 * Looks up a licensed Wikimedia Commons recording for a short phrase. Lookups are serial,
 * time-limited and cached. Never throws: returns null when nothing acceptable is found.
 */
export function findRecording(
  rawPhrase: string,
  fetcher: Fetcher = fetch,
  now: () => number = Date.now,
): Promise<SoundRecording | null> {
  const phrase = sanitizeSoundPhrase(rawPhrase);
  if (phrase.length < 2) return Promise.resolve(null);
  const hit = cache.get(phrase);
  if (hit && hit.expires > now()) return Promise.resolve(hit.value);

  const run = queue.then(async () => {
    const again = cache.get(phrase);
    if (again && again.expires > now()) return again.value;
    let value: SoundRecording | null = null;
    let cacheable = true;
    try {
      value = await search(phrase, fetcher);
    } catch {
      cacheable = false;
    }
    if (cacheable) {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(phrase, { value, expires: now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
    }
    return value;
  });
  queue = run.catch(() => undefined);
  return run;
}
