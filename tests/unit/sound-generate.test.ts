// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGenerationCache, generateSound, GenerationError } from "@/lib/sound-generate";
import { GET } from "@/app/api/sound/generate/route";

const MP3_B64 = Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000fake-mp3-bytes").toString("base64");
const sse = (...chunks: string[]) =>
  chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: c } } }] })}\n\n`).join("") +
  "data: [DONE]\n\n";
const ok = (body: string) => vi.fn(async () => new Response(body, { status: 200 }));

beforeEach(() => {
  clearGenerationCache();
  process.env.OPENROUTER_API_KEY = "test-key";
  delete process.env.OPENROUTER_SFX_MODEL;
});
afterEach(() => vi.unstubAllGlobals());

describe("generateSound", () => {
  it("joins streamed chunks into an mp3 data URL and sends a bounded request", async () => {
    const half = Math.floor(MP3_B64.length / 2);
    const f = ok(sse(MP3_B64.slice(0, half), MP3_B64.slice(half)));
    const r = await generateSound("Cat Meow!", f);
    expect(r).toEqual({
      dataUrl: `data:audio/mpeg;base64,${MP3_B64}`,
      model: "google/lyria-3-clip-preview",
      mime: "audio/mpeg",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ stream: true, modalities: ["text", "audio"] });
    expect(body.messages[0].content).toContain("cat meow");
  });

  it("uses OPENROUTER_SFX_MODEL when set", async () => {
    process.env.OPENROUTER_SFX_MODEL = "vendor/other-model";
    const f = ok(sse(MP3_B64));
    expect((await generateSound("cat meow", f)).model).toBe("vendor/other-model");
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model).toBe(
      "vendor/other-model",
    );
  });

  it("caches successes and shares concurrent calls (one billed request)", async () => {
    const f = ok(sse(MP3_B64));
    await Promise.all([generateSound("cat meow", f), generateSound("cat meow", f)]);
    await generateSound("cat meow", f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP errors, caches the failure briefly and never retries", async () => {
    const f = vi.fn(async () => new Response("no credit", { status: 402 }));
    await expect(generateSound("dog bark", f)).rejects.toMatchObject({ code: "upstream_error" });
    await expect(generateSound("dog bark", f)).rejects.toThrow(/credit or key limit/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("maps timeouts", async () => {
    const f = vi.fn(async () => {
      throw new DOMException("t", "TimeoutError");
    });
    await expect(generateSound("dog bark", f as unknown as typeof fetch)).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects empty, non-mp3 and oversized responses", async () => {
    await expect(generateSound("a b", ok("data: [DONE]\n\n"))).rejects.toMatchObject({ code: "no_audio" });
    const wav = Buffer.from("RIFFxxxxWAVEfmt ").toString("base64");
    await expect(generateSound("c d", ok(sse(wav)))).rejects.toMatchObject({ code: "no_audio" });
    await expect(generateSound("e f", ok("x".repeat(4_100_000)))).rejects.toMatchObject({ code: "too_large" });
  });

  it("is not configured without a key and makes no request", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const f = ok(sse(MP3_B64));
    await expect(generateSound("cat meow", f)).rejects.toMatchObject({ code: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("GET /api/sound/generate", () => {
  const get = (q: string) => GET(new Request(`http://localhost/api/sound/generate?q=${q}`));

  it("400 without a usable query and 503 when not configured", async () => {
    expect((await get("%21")).status).toBe(400);
    delete process.env.OPENROUTER_API_KEY;
    const res = await get("cat+meow");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });

  it("returns the clip, and a plain error body on upstream failure", async () => {
    vi.stubGlobal("fetch", ok(sse(MP3_B64)));
    const res = await get("cat+meow");
    expect(res.status).toBe(200);
    expect((await res.json()).dataUrl).toContain("data:audio/mpeg;base64,");
    clearGenerationCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    const bad = await get("owl+hoot");
    expect(bad.status).toBe(502);
    expect(JSON.stringify(await bad.json())).not.toContain("test-key");
  });
});

void GenerationError;
