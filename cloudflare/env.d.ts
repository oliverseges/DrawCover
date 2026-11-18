import type { DurableObjectNamespace, Fetcher, RateLimit } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    ASSETS: Fetcher;
    WORKER_SELF_REFERENCE: Fetcher;
    DRAWCOVER_STATE: DurableObjectNamespace;
    ALBUM_RATE_LIMITER: RateLimit;
    TRACK_RATE_LIMITER: RateLimit;
    DRAWCOVER_HOSTED: string;
    DRAWCOVER_DAILY_ALBUM_LIMIT: string;
    DRAWCOVER_DAILY_TRACK_LIMIT: string;
    OPENROUTER_API_KEY?: string;
  }
}
