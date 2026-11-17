// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();

vi.mock("@google/genai", async (orig) => {
  const actual = await orig<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

import { ApiError } from "@google/genai";
import { POST } from "@/app/api/recognize/route";

const B64 = Buffer.from("fake-png-bytes").toString("base64");
const req = (body: unknown) =>
  new Request("http://localhost/api/recognize", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const good = { image: `data:image/png;base64,${B64}` };

describe("POST /api/recognize", () => {
  beforeEach(() => {
    generateContent.mockReset();
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GEMINI_MODEL;
  });

  it("returns the validated result and passes the image to the SDK", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        label: "cat",
        confidence: 0.9,
        description: "A cat.",
        alternatives: ["dog", "fox", "bear", "wolf"],
        soundPhrase: "Cat meow!!",
        soundPreset: "meow",
      }),
    });
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      label: "cat",
      confidence: 0.9,
      description: "A cat.",
      alternatives: ["dog", "fox", "bear"],
      sound: { phrase: "cat meow", preset: "meow" },
    });
    const arg = generateContent.mock.calls[0][0];
    expect(arg.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/png", data: B64 });
  });

  it("keeps an unrestricted label and falls back for a bad sound preset", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        label: "unicorn",
        confidence: 0.5,
        description: "x",
        alternatives: [],
        soundPreset: "laser-cannon",
      }),
    });
    const body = await (await POST(req(good))).json();
    expect(body.label).toBe("unicorn");
    expect(body.sound).toEqual({ phrase: "unicorn sound", preset: "tone" });
  });

  it("400 for invalid image", async () => {
    for (const body of ["not json", {}, { image: "data:image/jpeg;base64,AAAA" }]) {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_image");
    }
  });

  it("413 for oversized image", async () => {
    const big = Buffer.alloc(4 * 1024 * 1024 + 10).toString("base64");
    const res = await POST(req({ image: `data:image/png;base64,${big}` }));
    expect(res.status).toBe(413);
  });

  it("500 when the key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(req(good));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("missing_api_key");
  });

  it("429 on rate limit", async () => {
    generateContent.mockRejectedValue(new ApiError({ message: "quota", status: 429 }));
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
  });

  it("502 on upstream error and on invalid JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateContent.mockRejectedValueOnce(new Error("boom"));
    expect((await POST(req(good))).status).toBe(502);
    generateContent.mockResolvedValueOnce({ text: "not json" });
    expect((await POST(req(good))).status).toBe(502);
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ label: "x" }) });
    expect((await POST(req(good))).status).toBe(502);
  });
});
