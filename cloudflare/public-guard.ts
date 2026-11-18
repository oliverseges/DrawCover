import type { DurableObjectNamespace } from "@cloudflare/workers-types";

export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
type GuardEnv = {
  ALBUM_RATE_LIMITER?: RateLimiter;
  TRACK_RATE_LIMITER?: RateLimiter;
  OPENROUTER_API_KEY?: string;
  DRAWCOVER_STATE?: Pick<DurableObjectNamespace, "get" | "idFromName">;
  DRAWCOVER_HOSTED?: string;
};

export async function publicDemoGuard(request: Request, env: GuardEnv): Promise<Response | null> {
  const path = decodeURIComponent(new URL(request.url).pathname).replace(/\/+/g, "/").replace(/\/+$/, "");
  const fail = (status: number, message: string, retry?: string) => Response.json(
    { message }, {
      status,
      headers: { "Cache-Control": "no-store", ...(retry ? { "Retry-After": retry } : {}) },
    },
  );
  if (path === "/api/drawcover/status") {
    const configured = env.DRAWCOVER_HOSTED === "true" && Boolean(
      env.DRAWCOVER_STATE && env.OPENROUTER_API_KEY?.trim() && env.ALBUM_RATE_LIMITER && env.TRACK_RATE_LIMITER,
    );
    let daily;
    if (configured && env.DRAWCOVER_STATE) {
      const stub = env.DRAWCOVER_STATE.get(env.DRAWCOVER_STATE.idFromName("public-demo-v1"));
      const response = await stub.fetch("https://state/usage");
      if (!response.ok) return fail(503, "Shared demo allowance information is unavailable.");
      daily = await response.json();
    }
    return Response.json(
      { publicDemo: true, configured, provider: "openrouter", daily },
      { status: configured ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (["/api/recognize", "/api/sound/generate"].includes(path)) {
    return fail(503, "Legacy AI generation is disabled on this public demo. Use DrawCover instead.");
  }
  if (path === "/api/sound/config") {
    return Response.json({ aiEnabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!["/api/drawcover", "/api/drawcover/track"].includes(path)) return null;
  if (request.method !== "POST") return fail(405, "Use POST to generate.");
  if (env.DRAWCOVER_HOSTED !== "true" || !env.DRAWCOVER_STATE || !env.OPENROUTER_API_KEY?.trim()) {
    return fail(503, "The public demo isn't configured yet.");
  }
  const track = path.endsWith("/track");
  const length = request.headers.get("content-length");
  const maximum = track ? 1024 : Math.ceil(4 * 1024 * 1024 / 3) * 4 + 1024;
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    return fail(413, "The request is too large.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "Use the demo from its own website.");
  const ip = request.headers.get("CF-Connecting-IP");
  const limiter = track ? env.TRACK_RATE_LIMITER : env.ALBUM_RATE_LIMITER;
  if (!ip || !limiter) return fail(503, "Public request protection is unavailable. Please try again later.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const network = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const stub = env.DRAWCOVER_STATE.get(env.DRAWCOVER_STATE.idFromName("public-demo-v1"));
  const access = async (blocked: boolean) => {
    const response = await stub.fetch("https://state/access", {
      method: "POST", body: JSON.stringify({ network, blocked }),
    });
    return response.ok ? null : Response.json(await response.json(), {
      status: response.status,
      headers: { "Cache-Control": "no-store", "Retry-After": response.headers.get("Retry-After") ?? "60" },
    });
  };
  const coolingDown = await access(false);
  if (coolingDown) return coolingDown;
  const { success } = await limiter.limit({ key: ip });
  return success ? null : await access(true) ?? fail(503, "Public request protection is unavailable.");
}
