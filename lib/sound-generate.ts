import "server-only";
import { sanitizeSoundPhrase } from "@/lib/sound-presets";

export const DEFAULT_SFX_MODEL = "google/lyria-3-clip-preview";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 25_000;
const MAX_RESPONSE_CHARS = 4_000_000;
const MAX_CACHE_ENTRIES = 20;
const SUCCESS_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 1000;

export type GeneratedSound = { dataUrl: string; model: string; mime: "audio/mpeg" };

export class GenerationError extends Error {
  constructor(
    public code: "not_configured" | "upstream_error" | "timeout" | "no_audio" | "too_large",
    message: string,
  ) {
    super(message);
  }
}

type Entry = { value?: GeneratedSound; error?: GenerationError; expires: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<GeneratedSound>>();

export function clearGenerationCache() {
  cache.clear();
  inflight.clear();
}

function buildPrompt(phrase: string) {
  return (
    `Generate a short sound effect (about 3 seconds): ${phrase}. ` +
    "A realistic non-musical sound effect only: no music, no melody, no vocals, no speech."
  );
}

// OpenRouter delivers audio output only as SSE chunks with base64 in delta.audio.data.
function parseAudio(raw: string): string {
  let audio = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") break;
    try {
      const delta = JSON.parse(data)?.choices?.[0]?.delta;
      if (typeof delta?.audio?.data === "string") audio += delta.audio.data;
    } catch {
      // ignore non-JSON keep-alive lines
    }
  }
  return audio;
}

async function request(phrase: string, fetcher: typeof fetch): Promise<GeneratedSound> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new GenerationError("not_configured", "AI sound generation isn't configured.");
  const model = process.env.OPENROUTER_SFX_MODEL || DEFAULT_SFX_MODEL;

  let res: Response;
  try {
    res = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: buildPrompt(phrase) }],
        modalities: ["text", "audio"],
        stream: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new GenerationError(
      timedOut ? "timeout" : "upstream_error",
      timedOut ? "AI sound generation timed out." : "Couldn't reach the AI sound service.",
    );
  }
  if (!res.ok) {
    const hint = res.status === 402 || res.status === 403 ? " (credit or key limit)" : "";
    throw new GenerationError("upstream_error", `AI sound generation failed (HTTP ${res.status})${hint}.`);
  }
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new GenerationError("timeout", "AI sound generation timed out.");
  }
  if (raw.length > MAX_RESPONSE_CHARS) throw new GenerationError("too_large", "Generated audio was too large.");
  const audio = parseAudio(raw);
  if (!audio) throw new GenerationError("no_audio", "The model returned no audio.");
  // Lyria returns MP3; reject anything else rather than guessing a MIME type.
  const head = Buffer.from(audio.slice(0, 16), "base64");
  const isMp3 = head.subarray(0, 3).toString("latin1") === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  if (!isMp3) throw new GenerationError("no_audio", "The model returned an unsupported audio format.");
  return { dataUrl: `data:audio/mpeg;base64,${audio}`, model, mime: "audio/mpeg" };
}

/**
 * One bounded, billed OpenRouter call per phrase: no retries, results and failures are cached,
 * and concurrent requests for the same phrase share one call.
 */
export function generateSound(
  rawPhrase: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<GeneratedSound> {
  const phrase = sanitizeSoundPhrase(rawPhrase);
  if (phrase.length < 2) return Promise.reject(new GenerationError("no_audio", "Missing sound phrase."));
  const key = `${process.env.OPENROUTER_SFX_MODEL || DEFAULT_SFX_MODEL}:${phrase}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now()) return hit.value ? Promise.resolve(hit.value) : Promise.reject(hit.error);
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = request(phrase, fetcher)
    .then((value) => {
      store(key, { value, expires: now() + SUCCESS_TTL_MS });
      return value;
    })
    .catch((error: GenerationError) => {
      if (error.code !== "not_configured") store(key, { error, expires: now() + FAILURE_TTL_MS });
      throw error;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

function store(key: string, entry: Entry) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
}
