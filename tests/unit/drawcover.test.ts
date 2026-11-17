// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recognizeDrawing, generateContent, constructAi } = vi.hoisted(() => ({
  recognizeDrawing: vi.fn(),
  generateContent: vi.fn(),
  constructAi: vi.fn(),
}));

vi.mock("@/lib/gemini", () => ({
  DEFAULT_MODEL: "gemini-3.5-flash-lite",
  MissingApiKeyError: class extends Error {},
  recognizeDrawing,
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor(options: unknown) { constructAi(options); }
    models = { generateContent };
  },
}));

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0x8AAAAASUVORK5CYII=";
const IMAGE = `data:image/png;base64,${PNG}`;
const MP3 = Buffer.from("ID3example-mp3-data").toString("base64");
const metadata = () => ({
  title: "Velvet Constellations",
  artist: "The Lunar Cartographers",
  subtitle: "Dreamy cosmic jazz with warm piano and brushed drums",
  palette: ["#14213D", "#FCA311", "#FFFFFF"],
  tracks: Array.from({ length: 8 }, (_, index) => ({ title: `Orbit ${index + 1}` })),
});
const request = (body: unknown, path = "") => new Request(`http://localhost/api/drawcover${path}`, {
  method: "POST",
  body: JSON.stringify(body),
});
const sse = (audio = MP3) => new Response(
  `: keepalive\n\ndata: not-json\n\ndata: ${JSON.stringify({ choices: [{ delta: { audio: { data: audio.slice(0, 8) } } }] })}\n\n` +
  `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: audio.slice(8) } } }] })}\n\ndata: [DONE]\n\n`,
);

let albumPost: typeof import("@/app/api/drawcover/route")["POST"];
let trackPost: typeof import("@/app/api/drawcover/track/route")["POST"];
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("GEMINI_API_KEY", "private-gemini-key");
  vi.stubEnv("OPENROUTER_API_KEY", "private-music-key");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("DRAWCOVER_METADATA_MODEL", "");
  vi.stubEnv("DRAWCOVER_IMAGE_MODEL", "");
  vi.stubEnv("OPENROUTER_IMAGE_MODEL", "");
  vi.stubEnv("OPENROUTER_MUSIC_MODEL", "");
  for (const name of ["DRAWCOVER_METADATA_PROVIDER", "DRAWCOVER_IMAGE_PROVIDER", "DRAWCOVER_MUSIC_PROVIDER", "DRAWCOVER_MUSIC_MODEL", "OPENROUTER_METADATA_MODEL"]) {
    vi.stubEnv(name, "");
  }
  recognizeDrawing.mockReset().mockResolvedValue({
    label: "private-astronaut",
    description: "An astronaut floating.",
  });
  generateContent.mockReset().mockImplementation(({ model }: { model: string }) =>
    model.includes("image")
      ? Promise.resolve({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG } }] } }] })
      : Promise.resolve({ text: JSON.stringify(metadata()) }),
  );
  fetcher = vi.fn().mockImplementation(() => Promise.resolve(sse()));
  vi.stubGlobal("fetch", fetcher);
  albumPost = (await import("@/app/api/drawcover/route")).POST;
  trackPost = (await import("@/app/api/drawcover/track/route")).POST;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function album() {
  const response = await albumPost(request({ image: IMAGE }));
  expect(response.status).toBe(200);
  return response.json();
}

describe("DrawCover album endpoint", () => {
  it("tries OpenRouter image editing before drawing fallback and reports the actual image model", async () => {
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model.includes("image")
        ? Promise.reject(Object.assign(new Error("Gemini unavailable"), { status: 404 }))
        : Promise.resolve({ text: JSON.stringify(metadata()) }),
    );
    fetcher.mockResolvedValue(Response.json({
      choices: [{ message: { images: [{ image_url: { url: IMAGE } }] } }],
    }));
    const result = await album();
    expect(result.cover).toEqual({ source: "ai", dataUrl: IMAGE });
    expect(result.models.image).toBe("google/gemini-3.1-flash-image");
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.messages[0].content).toContainEqual({
      type: "image_url", image_url: { url: IMAGE },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recognizes privately, validates eight titles and three colors, and edits the original image", async () => {
    const response = await albumPost(request({ image: IMAGE }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(result).toEqual({
      id: expect.any(String),
      ...metadata(),
      cover: { source: "ai", dataUrl: IMAGE },
      models: {
        metadata: "gemini-3.5-flash-lite",
        image: "gemini-3.1-flash-image",
        music: "google/lyria-3-clip-preview",
      },
    });
    expect(result.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(result)).not.toContain("private-astronaut");
    expect(recognizeDrawing).toHaveBeenCalledExactlyOnceWith(PNG);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0][0].config.responseMimeType).toBe("application/json");
    expect(generateContent.mock.calls[1][0].contents[0].parts[0]).toEqual({
      inlineData: { mimeType: "image/png", data: PNG },
    });
    expect(generateContent.mock.calls[1][0].config.responseModalities).toEqual(["IMAGE", "TEXT"]);
    expect(constructAi).toHaveBeenCalledWith(expect.objectContaining({
      httpOptions: { timeout: 35_000, retryOptions: { attempts: 1 } },
    }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent and subsequent album requests", async () => {
    const results = await Promise.all([album(), album(), album()]);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect((await album()).id).toBe(results[0].id);
    expect(recognizeDrawing).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("uses configured models and GEMINI_MODEL metadata fallback", async () => {
    vi.stubEnv("GEMINI_MODEL", "custom-metadata");
    vi.stubEnv("DRAWCOVER_IMAGE_MODEL", "custom-image");
    vi.stubEnv("OPENROUTER_MUSIC_MODEL", "custom-music");
    expect((await album()).models).toEqual({
      metadata: "custom-metadata", image: "custom-image", music: "custom-music",
    });
    vi.stubEnv("DRAWCOVER_METADATA_MODEL", "explicit-metadata");
    expect((await album()).models.metadata).toBe("explicit-metadata");
  });

  it("uses the configured OpenRouter model after Gemini fails and caches its successful edit", async () => {
    vi.stubEnv("OPENROUTER_IMAGE_MODEL", "custom/router-image");
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model.includes("image")
        ? Promise.reject(new Error("Gemini failed"))
        : Promise.resolve({ text: JSON.stringify(metadata()) }),
    );
    fetcher.mockImplementation(() => Promise.resolve(Response.json({
      choices: [{ message: { images: [{ image_url: { url: IMAGE } }] } }],
    })));
    const [first, second] = await Promise.all([album(), album()]);
    expect(first.cover).toEqual({ source: "ai", dataUrl: IMAGE });
    expect(first.models.image).toBe("custom/router-image");
    expect(second.id).toBe(first.id);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      model: "custom/router-image",
      modalities: ["image", "text"],
      provider: { allow_fallbacks: false },
      stream: false,
    });
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("only returns a generic warning after both image providers fail and logs safe actual reasons", async () => {
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model.includes("image")
        ? Promise.reject(Object.assign(new Error(JSON.stringify({
          error: { code: 403, message: "Billing disabled for private-gemini-key at https://provider.example?key=private-gemini-key" },
        })), { status: 403 }))
        : Promise.resolve({ text: JSON.stringify(metadata()) }),
    );
    fetcher.mockImplementation(() => Promise.resolve(Response.json({
      error: { message: "Credit limit for private-music-key Bearer private-token" },
    }, { status: 402 })));
    const first = await album();
    expect(first.cover).toEqual({
      dataUrl: null, source: "drawing", warning: expect.stringContaining("not AI artwork"),
    });
    expect(first.models.image).toBe("gemini-3.1-flash-image");
    expect((await album()).id).toBe(first.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith("[DrawCover image]", expect.objectContaining({
      provider: "gemini", model: "gemini-3.1-flash-image", status: 403,
      reason: expect.stringContaining("Billing disabled"),
    }));
    expect(console.warn).toHaveBeenCalledWith("[DrawCover image]", expect.objectContaining({
      provider: "openrouter", model: "google/gemini-3.1-flash-image", status: 402,
      reason: expect.stringContaining("Credit limit"),
    }));
    const diagnostics = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(diagnostics).not.toMatch(/private-gemini-key|private-music-key|private-token|https:/);
    expect(JSON.stringify(first)).not.toMatch(/Billing disabled|Credit limit|private-/);
  });

  it("rejects remote provider image URLs instead of fetching arbitrary image locations", async () => {
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model.includes("image")
        ? Promise.resolve({})
        : Promise.resolve({ text: JSON.stringify(metadata()) }),
    );
    fetcher.mockResolvedValue(Response.json({
      choices: [{ message: { images: [{ image_url: { url: "https://untrusted.example/image.png" } }] } }],
    }));
    expect((await album()).cover.source).toBe("drawing");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds each image provider attempt and falls back without retries", async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(({ model }: { model: string }) =>
      model.includes("image")
        ? new Promise(() => {})
        : Promise.resolve({ text: JSON.stringify(metadata()) }),
    );
    fetcher.mockReturnValue(new Promise(() => {}));
    const pending = albumPost(request({ image: IMAGE }));
    await vi.advanceTimersByTimeAsync(90_001);
    const response = await pending;
    expect(response.status).toBe(200);
    expect((await response.json()).cover.source).toBe("drawing");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith("[DrawCover image]", expect.objectContaining({
      provider: "gemini", status: 504,
    }));
    expect(console.warn).toHaveBeenCalledWith("[DrawCover image]", expect.objectContaining({
      provider: "openrouter", status: 504,
    }));
  });

  it.each(["error", "empty", "invalid"])("clearly marks drawing fallback on %s image output", async (mode) => {
    generateContent.mockImplementation(({ model }: { model: string }) => {
      if (!model.includes("image")) return Promise.resolve({ text: JSON.stringify(metadata()) });
      if (mode === "error") return Promise.reject(new Error("provider secret raw body"));
      if (mode === "empty") return Promise.resolve({});
      return Promise.resolve({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] });
    });
    const result = await album();
    expect(result.cover).toEqual({
      dataUrl: null,
      source: "drawing",
      warning: expect.stringContaining("not AI artwork"),
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    const response = await trackPost(request({ albumId: result.id, trackIndex: 0 }));
    expect(response.status).toBe(200);
  });

  it.each([
    ["seven tracks", (value: ReturnType<typeof metadata>) => { value.tracks.pop(); }],
    ["nine tracks", (value: ReturnType<typeof metadata>) => { value.tracks.push({ title: "Extra" }); }],
    ["empty track", (value: ReturnType<typeof metadata>) => { value.tracks[0].title = " "; }],
    ["duplicate track", (value: ReturnType<typeof metadata>) => { value.tracks[1].title = "orbit 1"; }],
    ["invalid color", (value: ReturnType<typeof metadata>) => { value.palette[0] = "red"; }],
    ["missing color", (value: ReturnType<typeof metadata>) => { value.palette.pop(); }],
    ["empty theme", (value: ReturnType<typeof metadata>) => { value.subtitle = ""; }],
    ["empty artist", (value: ReturnType<typeof metadata>) => { value.artist = " "; }],
    ["oversized artist", (value: ReturnType<typeof metadata>) => { value.artist = "x".repeat(81); }],
    ["artist control characters", (value: ReturnType<typeof metadata>) => { value.artist = "Artist\nCredit"; }],
  ])("rejects and caches invalid metadata: %s", async (_, mutate) => {
    const value = metadata();
    mutate(value);
    generateContent.mockResolvedValue({ text: JSON.stringify(value) });
    for (let count = 0; count < 2; count++) {
      const response = await albumPost(request({ image: IMAGE }));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ message: "The AI service returned invalid album details." });
    }
    expect(recognizeDrawing).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("fails explicitly for invalid metadata JSON and recognition failures", async () => {
    generateContent.mockResolvedValue({ text: "not JSON" });
    expect((await albumPost(request({ image: IMAGE }))).status).toBe(502);
    vi.stubEnv("DRAWCOVER_METADATA_MODEL", "another-model");
    recognizeDrawing.mockRejectedValue({ status: 429, message: "private provider quota detail" });
    const response = await albumPost(request({ image: IMAGE }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      message: "The AI service is rate limiting requests. Please try again later.",
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("requires the generated artist credit and trims its validated value", async () => {
    const missingArtist: Partial<ReturnType<typeof metadata>> = metadata();
    delete missingArtist.artist;
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(missingArtist) });
    expect((await albumPost(request({ image: IMAGE }))).status).toBe(502);
    vi.stubEnv("DRAWCOVER_METADATA_MODEL", "artist-metadata");
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ ...metadata(), artist: "  The Lunar Cartographers  " }),
    });
    expect((await album()).artist).toBe("The Lunar Cartographers");
  });

  it("caches recognition errors without leaking raw provider details", async () => {
    recognizeDrawing.mockRejectedValue(new Error("provider raw secret"));
    for (let index = 0; index < 2; index++) {
      const response = await albumPost(request({ image: IMAGE }));
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("secret");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(recognizeDrawing).toHaveBeenCalledTimes(1);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("bounds recognition wait and caches its timeout", async () => {
    vi.useFakeTimers();
    recognizeDrawing.mockReturnValue(new Promise(() => {}));
    const pending = albumPost(request({ image: IMAGE }));
    await vi.advanceTimersByTimeAsync(35_001);
    expect((await pending).status).toBe(504);
    expect((await albumPost(request({ image: IMAGE }))).status).toBe(504);
    expect(recognizeDrawing).toHaveBeenCalledTimes(1);
  });

  it("limits simultaneous album generation without duplicating pending drawings", async () => {
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    recognizeDrawing.mockImplementation(async () => {
      await ready;
      return { label: "private subject", description: "A private drawing." };
    });
    const first = albumPost(request({ image: IMAGE }));
    await vi.waitFor(() => expect(recognizeDrawing).toHaveBeenCalledTimes(1));
    vi.stubEnv("DRAWCOVER_METADATA_MODEL", "second");
    const second = albumPost(request({ image: IMAGE }));
    await vi.waitFor(() => expect(recognizeDrawing).toHaveBeenCalledTimes(2));
    vi.stubEnv("DRAWCOVER_METADATA_MODEL", "third");
    expect((await albumPost(request({ image: IMAGE }))).status).toBe(503);
    finish();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it("evicts old albums at the memory bound", async () => {
    const first = await album();
    for (let index = 0; index < 8; index++) {
      vi.stubEnv("DRAWCOVER_METADATA_MODEL", `metadata-${index}`);
      await album();
    }
    expect((await trackPost(request({ albumId: first.id, trackIndex: 0 }))).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { image: "data:image/jpeg;base64,AAAA" },
    { image: "data:image/png;base64,AAAA" },
    { image: IMAGE + "=" },
    { image: IMAGE, prompt: "arbitrary prompt" },
  ])("rejects invalid PNG input before provider calls: %j", async (input) => {
    const response = await albumPost(request(input));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "A valid PNG drawing is required." });
    expect(recognizeDrawing).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, oversized bodies, and oversized input images", async () => {
    const malformed = new Request("http://localhost/api/drawcover", { method: "POST", body: "{" });
    expect((await albumPost(malformed)).status).toBe(400);
    const declared = request({});
    declared.headers.set("content-length", "99999999");
    expect((await albumPost(declared)).status).toBe(413);
    const huge = request({ image: "data:image/png;base64," + Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64") });
    expect((await albumPost(huge)).status).toBe(413);
    const oversizedBody = request({ padding: " ".repeat(6 * 1024 * 1024) });
    expect((await albumPost(oversizedBody)).status).toBe(413);
    expect(recognizeDrawing).not.toHaveBeenCalled();
  });

  it("rejects PNG dimensions that exceed bounded raster size", async () => {
    const image = Buffer.from(PNG, "base64");
    image.writeUInt32BE(5000, 16);
    expect((await albumPost(request({ image: `data:image/png;base64,${image.toString("base64")}` }))).status).toBe(400);
    expect(recognizeDrawing).not.toHaveBeenCalled();
  });

  it("rejects truncated PNG chunks despite a valid signature", async () => {
    const truncated = Buffer.from(PNG, "base64").subarray(0, -4).toString("base64");
    expect((await albumPost(request({ image: `data:image/png;base64,${truncated}` }))).status).toBe(400);
    expect(recognizeDrawing).not.toHaveBeenCalled();
  });

  it("reports missing configuration without provider calls", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const response = await albumPost(request({ image: IMAGE }));
    expect(response.status).toBe(503);
    expect(recognizeDrawing).not.toHaveBeenCalled();
  });

  describe("DrawCover provider choices", () => {
    const directMusic = () => Response.json({
      steps: [
        { type: "thought", content: [{ type: "text", text: "not audio" }] },
        { type: "model_output", content: [{ type: "audio", mime_type: "audio/mpeg", data: MP3 }] },
      ],
    });

    it("runs the entire album with only a direct Gemini key and caches its Lyria clip", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      fetcher.mockImplementation(() => Promise.resolve(directMusic()));
      const result = await album();
      expect(result.models.music).toBe("lyria-3-clip-preview");
      const input = { albumId: result.id, trackIndex: 0 };
      const response = await trackPost(request(input));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ dataUrl: `data:audio/mpeg;base64,${MP3}`, model: "lyria-3-clip-preview" });
      expect((await trackPost(request(input))).status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, options] = fetcher.mock.calls[0];
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
      expect(options.headers).toMatchObject({ "x-goog-api-key": "private-gemini-key", "Api-Revision": "2026-05-20" });
      expect(JSON.parse(options.body)).toMatchObject({ model: "lyria-3-clip-preview", store: false });
      expect(JSON.parse(options.body).input).toContain("Instrumental only");
    });

    it("runs vision metadata, artwork and music with only an OpenRouter key", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");
      fetcher.mockImplementation((_url, options) => {
        const body = JSON.parse(options.body);
        if (body.response_format) return Promise.resolve(Response.json({ choices: [{ message: { content: JSON.stringify(metadata()) } }] }));
        if (body.modalities.includes("image")) return Promise.resolve(Response.json({ choices: [{ message: { images: [{ image_url: { url: IMAGE } }] } }] }));
        return Promise.resolve(sse());
      });
      const result = await album();
      expect(result.models.metadata).toBe("google/gemini-3.5-flash-lite");
      expect(result.models.image).toBe("google/gemini-3.1-flash-image");
      expect(result.cover.source).toBe("ai");
      expect((await trackPost(request({ albumId: result.id, trackIndex: 0 }))).status).toBe(200);
      expect(recognizeDrawing).not.toHaveBeenCalled();
      expect(generateContent).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(3);
      const payload = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(payload.messages[0].content).toContainEqual({ type: "image_url", image_url: { url: IMAGE } });
      expect(payload.response_format.json_schema).toMatchObject({ strict: true, name: "album" });
    });

    it("honors explicit mixed choices and the direct music model override", async () => {
      vi.stubEnv("DRAWCOVER_METADATA_PROVIDER", "openrouter");
      vi.stubEnv("OPENROUTER_METADATA_MODEL", "custom/vision");
      vi.stubEnv("DRAWCOVER_IMAGE_PROVIDER", "gemini");
      vi.stubEnv("DRAWCOVER_MUSIC_PROVIDER", "gemini");
      vi.stubEnv("DRAWCOVER_MUSIC_MODEL", "custom-direct-music");
      fetcher.mockImplementation((url) => Promise.resolve(
        url.includes("interactions") ? directMusic() : Response.json({ choices: [{ message: { content: JSON.stringify(metadata()) } }] }),
      ));
      const result = await album();
      expect(result.models).toMatchObject({ metadata: "custom/vision", music: "custom-direct-music" });
      expect(recognizeDrawing).not.toHaveBeenCalled();
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect((await trackPost(request({ albumId: result.id, trackIndex: 0 }))).status).toBe(200);
      expect(fetcher.mock.calls[1][0]).toContain("generativelanguage.googleapis.com");
    });

    it("never tries the other image provider when Gemini is explicitly selected", async () => {
      vi.stubEnv("DRAWCOVER_IMAGE_PROVIDER", "gemini");
      generateContent.mockImplementation(({ model }: { model: string }) =>
        model.includes("image") ? Promise.reject(new Error("unavailable")) : Promise.resolve({ text: JSON.stringify(metadata()) }),
      );
      expect((await album()).cover.source).toBe("drawing");
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("can select OpenRouter artwork directly without spending a Gemini image call", async () => {
      vi.stubEnv("DRAWCOVER_IMAGE_PROVIDER", "openrouter");
      fetcher.mockImplementation(() => Promise.resolve(Response.json({ choices: [{ message: { images: [{ image_url: { url: IMAGE } }] } }] })));
      expect((await album()).models.image).toBe("google/gemini-3.1-flash-image");
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("supports an intentional local drawing remix without an AI-failure warning", async () => {
      vi.stubEnv("DRAWCOVER_IMAGE_PROVIDER", "drawing");
      expect((await album()).cover).toEqual({ source: "drawing", dataUrl: null });
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(["DRAWCOVER_METADATA_PROVIDER", "DRAWCOVER_IMAGE_PROVIDER", "DRAWCOVER_MUSIC_PROVIDER"])(
      "rejects invalid %s before spending credits", async (name) => {
        vi.stubEnv(name, "typo");
        const response = await albumPost(request({ image: IMAGE }));
        expect(response.status).toBe(503);
        expect((await response.json()).message).toContain(name);
        expect(generateContent).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
      },
    );

    it("does not bypass an explicitly selected provider whose key is missing", async () => {
      vi.stubEnv("DRAWCOVER_METADATA_PROVIDER", "gemini");
      vi.stubEnv("GEMINI_API_KEY", "");
      const response = await albumPost(request({ image: IMAGE }));
      expect(response.status).toBe(503);
      expect((await response.json()).message).toContain("GEMINI_API_KEY");
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(["empty", "wrong-format", "http"])("isolates direct music %s failures without another paid provider call", async (mode) => {
      vi.stubEnv("DRAWCOVER_MUSIC_PROVIDER", "gemini");
      const result = await album();
      fetcher.mockImplementation(() => Promise.resolve(mode === "http" ? new Response("private", { status: 403 })
        : Response.json({ steps: [{ type: "model_output", content: mode === "empty" ? [] : [{ type: "audio", mime_type: "audio/wav", data: MP3 }] }] })));
      const input = { albumId: result.id, trackIndex: 0 };
      expect((await trackPost(request(input))).status).toBe(502);
      expect((await trackPost(request(input))).status).toBe(502);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    });
  });
});

describe("DrawCover lazy track endpoint", () => {
  it("generates music only when requested, parses SSE chunks, deduplicates and caches MP3", async () => {
    const result = await album();
    expect(fetcher).not.toHaveBeenCalled();
    const input = { albumId: result.id, trackIndex: 0 };
    const responses = await Promise.all([trackPost(request(input)), trackPost(request(input))]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ dataUrl: `data:audio/mpeg;base64,${MP3}`, model: result.models.music });
    }
    expect((await trackPost(request(input))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({ model: result.models.music, modalities: ["text", "audio"], stream: true });
    expect(payload.messages[0].content).toContain("MUSIC");
    expect(payload.messages[0].content).toContain("30 seconds");
    expect(payload.messages[0].content).toContain("Instrumental only: no lyrics, vocals, singing, speech or spoken narration.");
    expect(payload.messages[0].content).toContain("Orbit 1");
    expect(options.redirect).toBe("error");
    expect((await trackPost(request({ albumId: result.id, trackIndex: 1 }))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["http", "network", "empty", "format", "stream-error"])("caches %s track failures without breaking album", async (mode) => {
    const result = await album();
    if (mode === "http") fetcher.mockResolvedValue(new Response("secret credit response", { status: 403 }));
    if (mode === "network") fetcher.mockRejectedValue(new Error("private provider details"));
    if (mode === "empty") fetcher.mockResolvedValue(new Response("data: [DONE]\n\n"));
    if (mode === "format") fetcher.mockImplementation(() => Promise.resolve(sse(Buffer.from("WAVE").toString("base64"))));
    if (mode === "stream-error") fetcher.mockResolvedValue(new Response('data: {"error":{"message":"secret"}}\n\n'));
    for (let index = 0; index < 2; index++) {
      const response = await trackPost(request({ albumId: result.id, trackIndex: 0 }));
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(Object.keys(body)).toEqual(["message"]);
      expect(body.message).not.toMatch(/secret|private/);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await album()).id).toBe(result.id);
    fetcher.mockImplementation(() => Promise.resolve(sse()));
    expect((await trackPost(request({ albumId: result.id, trackIndex: 1 }))).status).toBe(200);
  });

  it("bounds music generation time and caches its timeout", async () => {
    const result = await album();
    vi.useFakeTimers();
    fetcher.mockReturnValue(new Promise(() => {}));
    const pending = trackPost(request({ albumId: result.id, trackIndex: 0 }));
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await pending).status).toBe(504);
    expect((await trackPost(request({ albumId: result.id, trackIndex: 0 }))).status).toBe(504);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds streamed provider audio size and caches the failure", async () => {
    const result = await album();
    fetcher.mockImplementation(() => Promise.resolve(new Response("x".repeat(4 * 1024 * 1024 + 1))));
    for (let index = 0; index < 2; index++) {
      const response = await trackPost(request({ albumId: result.id, trackIndex: 0 }));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ message: "Generated music was too large." });
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves safe provider rate-limit status and caches failures briefly", async () => {
    const result = await album();
    fetcher.mockImplementation(() => Promise.resolve(new Response("raw secret", { status: 429 })));
    const input = { albumId: result.id, trackIndex: 0 };
    expect((await trackPost(request(input))).status).toBe(429);
    expect((await trackPost(request(input))).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1);
    fetcher.mockImplementation(() => Promise.resolve(sse()));
    expect((await trackPost(request(input))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("limits simultaneous music generations", async () => {
    const result = await album();
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    fetcher.mockImplementation(async () => { await ready; return sse(); });
    const pending = [0, 1, 2, 3].map((trackIndex) => trackPost(request({ albumId: result.id, trackIndex })));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    const excess = await trackPost(request({ albumId: result.id, trackIndex: 4 }));
    expect(excess.status).toBe(503);
    finish();
    expect((await Promise.all(pending)).every((response) => response.ok)).toBe(true);
  });

  it("rejects arbitrary billing prompts and invalid indices", async () => {
    const result = await album();
    for (const input of [
      { albumId: result.id, trackIndex: -1 },
      { albumId: result.id, trackIndex: 8 },
      { albumId: result.id, trackIndex: 0.1 },
      { albumId: result.id, trackIndex: "0" },
      { albumId: result.id, trackIndex: 0, prompt: "anything" },
      { albumId: "unknown", trackIndex: 0 },
    ]) {
      expect((await trackPost(request(input))).status).toBe(400);
    }
    expect((await trackPost(request({ albumId: "8a45da04-ddf5-4e1b-b824-98d3be452544", trackIndex: 0 }))).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds track request size and reports missing music configuration", async () => {
    const result = await album();
    expect((await trackPost(request({ payload: "x".repeat(1025) }))).status).toBe(413);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect((await trackPost(request({ albumId: result.id, trackIndex: 0 }))).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("expires albums and rejects track requests without billing", async () => {
    const result = await album();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect((await trackPost(request({ albumId: result.id, trackIndex: 0 }))).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
