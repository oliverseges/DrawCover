// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoStore, type DemoStorage } from "@/cloudflare/demo-store";
import { publicDemoGuard } from "@/cloudflare/public-guard";
import { cooldownResponse } from "@/lib/generation-limit";
import { localGenerationLimit } from "@/lib/drawcover-local-limit";

function storage() {
  const data = new Map<string, unknown>();
  const backend: DemoStorage = {
    kv: {
      get: <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
      put: (key, value) => { data.set(key, structuredClone(value)); },
      delete: (key) => data.delete(key),
      list: <T>({ prefix }: { prefix: string }) =>
        [...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T] as [string, T]),
    },
    transactionSync: (callback) => {
      const before = structuredClone(data);
      try { return callback(); } catch (error) {
        data.clear();
        before.forEach((value, key) => data.set(key, value));
        throw error;
      }
    },
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
  return { backend, data };
}
const albumKey = (n: number) => `album:${n.toString(16).padStart(64, "0")}`;
const id = "550e8400-e29b-41d4-a716-446655440000";
const trackKey = (n: number) => `track:${id}:${n}`;
const post = (store: DemoStore, path: string, body: unknown) =>
  store.fetch(new Request(`https://state${path}`, { method: "POST", body: JSON.stringify(body) }));
const claim = (store: DemoStore, key: string, kind = "album") => post(store, "/claim", { key, kind });
async function complete(store: DemoStore, key: string, value: unknown, albumId?: string) {
  const response = await claim(store, key, key.startsWith("album") ? "album" : "track");
  expect(response.status).toBe(200);
  const { lease } = await response.json();
  expect((await post(store, "/complete", { key, lease, value, albumId })).status).toBe(200);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.__drawcoverLocalLimit;
});

describe("shared public-demo generation store", () => {
  it("counts one normal album/listening flow once, with free cache reads, polling and in-flight retries", async () => {
    const { backend } = storage();
    const store = new DemoStore(backend, { albums: "25", tracks: "40" });
    await complete(store, albumKey(1), { title: "Record" });
    for (let index = 0; index < 8; index++) {
      const key = trackKey(index);
      const pending = await claim(store, key, "track");
      const { lease } = await pending.json();
      expect((await claim(store, key, "track")).status).toBe(409);
      await post(store, "/complete", { key, lease, value: { dataUrl: "cached audio" } });
      expect(await (await claim(store, key, "track")).json()).toHaveProperty("cached");
    }
    for (let poll = 0; poll < 20; poll++) {
      const usage = await (await store.fetch(new Request("https://state/usage"))).json();
      expect(usage).toMatchObject({ used: { album: 1, track: 8 }, limits: { album: 25, track: 40 } });
      expect((await claim(store, albumKey(1))).status).toBe(200);
    }
  });

  it("raises the configured ceiling without resetting existing daily reservations", async () => {
    const { backend } = storage();
    const original = new DemoStore(backend, { albums: "10", tracks: "40" });
    for (let index = 0; index < 10; index++) await complete(original, albumKey(index), { title: `Record ${index}` });
    expect((await claim(original, albumKey(10))).status).toBe(429);
    const updated = new DemoStore(backend, { albums: "25", tracks: "40" });
    expect(await (await updated.fetch(new Request("https://state/usage"))).json()).toMatchObject({
      used: { album: 10, track: 0 }, limits: { album: 25, track: 40 },
    });
    expect((await claim(updated, albumKey(10))).status).toBe(200);
  });

  it("shares a 15-minute network cooldown across instances without extending denied attempts", async () => {
    vi.useFakeTimers();
    const { backend } = storage();
    const first = new DemoStore(backend, { albums: "10", tracks: "40" });
    const network = "c".repeat(64);
    const response = await post(first, "/access", { network, blocked: true });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    vi.advanceTimersByTime(4 * 60_000);
    const second = new DemoStore(backend, { albums: "10", tracks: "40" });
    const again = await post(second, "/access", { network, blocked: true });
    expect(again.headers.get("retry-after")).toBe("660");
    expect(await again.json()).toMatchObject({ reason: "cooldown", retryAfterSeconds: 660 });
    vi.advanceTimersByTime(11 * 60_000);
    expect((await post(second, "/access", { network, blocked: false })).status).toBe(200);
  });

  it("enforces the local cooldown before the API can read input or call a provider", async () => {
    vi.useFakeTimers();
    expect(localGenerationLimit()).toBeNull();
    expect(localGenerationLimit()).toBeNull();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("@/app/api/drawcover/route");
    const response = await POST(new Request("http://localhost/api/drawcover", { method: "POST", body: "{}" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(fetcher).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * 60_000);
    expect(localGenerationLimit(true)?.headers.get("retry-after")).toBe("600");
    vi.advanceTimersByTime(10 * 60_000);
    expect(localGenerationLimit()).toBeNull();
  });

  it("keeps albums and chunked tracks available after a Worker/store instance restarts", async () => {
    const { backend } = storage();
    const first = new DemoStore(backend, { albums: "10", tracks: "40" });
    const album = { album: { id, title: "Test" }, musicProvider: "openrouter" };
    const track = { dataUrl: "a".repeat(220_000), model: "test/music" };
    await complete(first, albumKey(1), album, id);
    await complete(first, trackKey(0), track);
    const second = new DemoStore(backend, { albums: "10", tracks: "40" });
    const loaded = await second.fetch(new Request(`https://state/album?id=${id}`));
    expect(await loaded.json()).toEqual(album);
    expect(await (await claim(second, trackKey(0), "track")).json()).toEqual({ cached: track });
    expect(await (await claim(second, albumKey(1))).json()).toEqual({ cached: album });
  });

  it("reserves each job once, rejects parallel duplicates and prevents stale completions", async () => {
    const { backend } = storage();
    const store = new DemoStore(backend, { albums: "10", tracks: "40" });
    const responses = await Promise.all([claim(store, albumKey(1)), claim(store, albumKey(1))]);
    expect(responses.map((response) => response.status)).toEqual([200, 409]);
    expect((await post(store, "/complete", { key: albumKey(1), lease: "wrong", value: {} })).status).toBe(409);
  });

  it("enforces strict global UTC daily caps across instances, counting failures but not cache hits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T23:59:00Z"));
    const { backend } = storage();
    const one = new DemoStore(backend, { albums: "1", tracks: "1" });
    const two = new DemoStore(backend, { albums: "1", tracks: "1" });
    const { lease } = await (await claim(one, albumKey(1))).json();
    await post(one, "/fail", { key: albumKey(1), lease, error: { status: 502, message: "Failed safely" } });
    expect((await claim(two, albumKey(1))).status).toBe(502);
    expect((await claim(two, albumKey(2))).status).toBe(429);
    await complete(one, trackKey(0), { audio: "cached" });
    expect((await claim(two, trackKey(0), "track")).status).toBe(200);
    expect((await claim(two, trackKey(1), "track")).status).toBe(429);
    vi.setSystemTime(new Date("2026-11-19T00:00:01Z"));
    expect((await claim(two, albumKey(2))).status).toBe(200);
    expect((await claim(two, trackKey(1), "track")).status).toBe(200);
  });

  it("expires data and album lookup with alarms, without erasing today's counters", async () => {
    vi.useFakeTimers();
    const { backend, data } = storage();
    const store = new DemoStore(backend, { albums: "1", tracks: "1" });
    await complete(store, albumKey(1), { title: "Gone later" }, id);
    vi.advanceTimersByTime(31 * 60_000);
    await store.alarm();
    expect([...data.keys()].every((key) => key.startsWith("day:"))).toBe(true);
    expect((await store.fetch(new Request(`https://state/album?id=${id}`))).status).toBe(404);
    expect((await claim(store, albumKey(2))).status).toBe(429);
  });

  it("fails closed for missing/invalid caps, and bounds simultaneous generation", async () => {
    const { backend } = storage();
    expect((await claim(new DemoStore(backend, {}), albumKey(1))).status).toBe(429);
    expect((await claim(new DemoStore(backend, { albums: "invalid" }), albumKey(1))).status).toBe(429);
    const store = new DemoStore(backend, { albums: "10", tracks: "40" });
    expect((await claim(store, albumKey(1))).status).toBe(200);
    expect((await claim(store, albumKey(2))).status).toBe(200);
    expect((await claim(store, albumKey(3))).status).toBe(503);
  });
});

describe("public Worker guard", () => {
  function env() {
    const access = vi.fn(async (_url: string, init?: RequestInit) =>
      init && JSON.parse(String(init.body)).blocked ? cooldownResponse(Date.now() + 900_000) : Response.json({ allowed: true }),
    );
    return {
      DRAWCOVER_HOSTED: "true", DRAWCOVER_STATE: { idFromName: vi.fn(), get: vi.fn().mockReturnValue({ fetch: access }) },
      OPENROUTER_API_KEY: "unit-test-key",
      ALBUM_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
      TRACK_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    };
  }
  const request = (path = "/api/drawcover", headers: Record<string, string> = {}) => new Request(`https://drawcover.oeng.dev${path}`, {
    method: "POST", body: "{}", headers: { "CF-Connecting-IP": "192.0.2.1", ...headers },
  });

  it("applies the documented per-network limiter to album and track requests", async () => {
    const bindings = env();
    expect(await publicDemoGuard(request(), bindings)).toBeNull();
    expect(bindings.ALBUM_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "192.0.2.1" });
    bindings.TRACK_RATE_LIMITER.limit.mockResolvedValue({ success: false });
    const response = await publicDemoGuard(request("/api/drawcover/track"), bindings);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("900");
  });

  it("fails closed without key, shared state, edge IP or limiter, never calling a provider", async () => {
    const bindings = env();
    expect((await publicDemoGuard(request(), { ...bindings, OPENROUTER_API_KEY: "" }))?.status).toBe(503);
    expect((await publicDemoGuard(request(), { ...bindings, DRAWCOVER_STATE: undefined }))?.status).toBe(503);
    expect((await publicDemoGuard(request(), { ...bindings, ALBUM_RATE_LIMITER: undefined }))?.status).toBe(503);
    expect((await publicDemoGuard(new Request("https://drawcover.oeng.dev/api/drawcover", { method: "POST" }), bindings))?.status).toBe(503);
    expect(bindings.ALBUM_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("rejects oversized or cross-origin requests before rate checks", async () => {
    const bindings = env();
    expect((await publicDemoGuard(request("/api/drawcover/track", { "content-length": "1025" }), bindings))?.status).toBe(413);
    expect((await publicDemoGuard(request("/api/drawcover", { "content-length": "9999999" }), bindings))?.status).toBe(413);
    expect((await publicDemoGuard(request("/api/drawcover", { origin: "https://other.example" }), bindings))?.status).toBe(403);
    expect(bindings.ALBUM_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("disables both legacy paid/recognition routes and hides the AI button", async () => {
    const bindings = env();
    expect((await publicDemoGuard(request("/api/recognize"), bindings))?.status).toBe(503);
    expect((await publicDemoGuard(request("/api/sound/generate?q=cat"), bindings))?.status).toBe(503);
    const response = await publicDemoGuard(new Request("https://drawcover.oeng.dev/api/sound/config"), bindings);
    expect(await response?.json()).toEqual({ aiEnabled: false });
    expect(await publicDemoGuard(new Request("https://drawcover.oeng.dev/"), bindings)).toBeNull();
  });

  it("forces the hosted provider/model selection regardless of local Gemini overrides", async () => {
    vi.stubEnv("DRAWCOVER_HOSTED", "true");
    vi.stubEnv("DRAWCOVER_METADATA_PROVIDER", "gemini");
    vi.stubEnv("DRAWCOVER_IMAGE_PROVIDER", "gemini");
    vi.stubEnv("DRAWCOVER_MUSIC_PROVIDER", "gemini");
    vi.stubEnv("OPENROUTER_MUSIC_MODEL", "expensive/override");
    const { drawCoverConfig } = await import("@/lib/drawcover-config");
    expect(drawCoverConfig()).toMatchObject({
      metadataProvider: "openrouter", musicProvider: "openrouter", imageProvider: "openrouter",
      models: { music: "google/lyria-3-clip-preview" },
    });
  });
});
