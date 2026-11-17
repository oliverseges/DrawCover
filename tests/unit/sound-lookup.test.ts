// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSoundCache,
  findRecording,
  isAcceptedLicense,
  validateMediaUrl,
} from "@/lib/sound-lookup";
import { GET } from "@/app/api/sound/route";

const page = (over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => ({
  title: "File:Meow.ogg",
  index: 1,
  imageinfo: [
    {
      url: "https://upload.wikimedia.org/wikipedia/commons/6/62/Meow.ogg?utm_source=x",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Meow.ogg",
      mime: "application/ogg",
      size: 14000,
      duration: 1.2,
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 3.0" },
        Artist: { value: '<a href="x">Some <b>Person</b></a>' },
      },
      ...info,
    },
  ],
  ...over,
});

const respond = (pages: unknown[], ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ query: { pages } }) }) as Response);

describe("validation helpers", () => {
  it("accepts only https upload.wikimedia.org commons media URLs", () => {
    expect(validateMediaUrl("https://upload.wikimedia.org/wikipedia/commons/a/b/C.ogg?x=1")).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/a/b/C.ogg",
    );
    for (const bad of [
      "http://upload.wikimedia.org/wikipedia/commons/a.ogg",
      "https://evil.example/wikipedia/commons/a.ogg",
      "https://upload.wikimedia.org.evil.example/wikipedia/commons/a.ogg",
      "https://upload.wikimedia.org/other/a.ogg",
      "javascript:alert(1)",
      "",
    ])
      expect(validateMediaUrl(bad)).toBeNull();
  });

  it("allows open licenses and rejects NC/ND/unknown", () => {
    for (const ok of ["CC0", "Public domain", "CC BY 4.0", "CC BY-SA 3.0"]) expect(isAcceptedLicense(ok)).toBe(true);
    for (const bad of ["CC BY-NC 4.0", "CC BY-ND 2.0", "GFDL", "All rights reserved", undefined])
      expect(isAcceptedLicense(bad)).toBe(false);
  });
});

describe("findRecording", () => {
  beforeEach(() => clearSoundCache());

  it("returns a validated recording with plain-text credit and identified User-Agent", async () => {
    const f = respond([page()]);
    const rec = await findRecording("cat meow", f);
    expect(rec).toEqual({
      url: "https://upload.wikimedia.org/wikipedia/commons/6/62/Meow.ogg",
      title: "Meow.ogg",
      credit: "Some Person",
      license: "CC BY-SA 3.0",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Meow.ogg",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://commons.wikimedia.org/w/api.php?")).toBe(true);
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("DrawSound");
  });

  it("skips unacceptable candidates and picks the next good one", async () => {
    const pages = [
      page({ title: "File:Cat meow nc.ogg" }, { extmetadata: { LicenseShortName: { value: "CC BY-NC 4.0" } } }),
      page({ title: "File:Cat meow html.mp3" }, { mime: "text/html" }),
      page({ title: "File:Cat meow huge.ogg" }, { size: 50_000_000 }),
      page({ title: "File:Cat meow evil.ogg" }, { url: "https://evil.example/wikipedia/commons/a.ogg" }),
      page({ title: "File:Unrelated thing.ogg" }),
      page({ title: "File:Cat meow good.ogg" }),
    ];
    const rec = await findRecording("cat meow", respond(pages));
    expect(rec?.title).toBe("Cat meow good.ogg");
  });

  it("returns null when nothing is acceptable, and caches the miss", async () => {
    const f = respond([]);
    expect(await findRecording("quiet thing", f)).toBeNull();
    expect(await findRecording("quiet thing", f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("returns null on network/HTTP failure without caching it", async () => {
    const bad = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await findRecording("cat meow", bad as unknown as typeof fetch)).toBeNull();
    expect(await findRecording("cat meow", respond([page()]))).not.toBeNull();
    expect(await findRecording("dog bark", respond([], false))).toBeNull();
  });

  it("sanitizes the phrase and refuses too-short input", async () => {
    const f = respond([page()]);
    await findRecording("Cat MEOW!! <script>", f);
    const url = (f.mock.calls[0] as unknown as [string])[0];
    expect(new URL(url).searchParams.get("gsrsearch")).toBe("cat meow script filetype:audio");
    expect(await findRecording("!", f)).toBeNull();
  });
});

describe("GET /api/sound", () => {
  it("400 without a usable query", async () => {
    const res = await GET(new Request("http://localhost/api/sound?q=%21"));
    expect(res.status).toBe(400);
  });
});
