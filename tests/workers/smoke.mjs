import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

execFileSync(process.execPath, [
  resolve("node_modules/wrangler/bin/wrangler.js"), "deploy",
  "--dry-run", "--outdir", ".open-next/runtime-test",
], {
  stdio: "inherit",
  env: { ...process.env, OPEN_NEXT_DEPLOY: "true", WRANGLER_SEND_METRICS: "false" },
});

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0x8AAAAASUVORK5CYII=";
const image = `data:image/png;base64,${png}`;
const audio = readFileSync(resolve("docs", "media", "first-track.mp3")).toString("base64");
const metadata = {
  title: "Offline album", artist: "Test performer", subtitle: "Calm piano",
  palette: ["#14213D", "#FCA311", "#FFFFFF"],
  tracks: Array.from({ length: 8 }, (_, index) => ({ title: `Orbit ${index + 1}` })),
};
let calls = 0;
const options = convertV4MiniflareOptions({
  name: "drawcover-offline-test",
  modules: true,
  scriptPath: resolve(".open-next/runtime-test/worker.js"),
  compatibilityDate: "2026-11-18",
  compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
  stripCfConnectingIp: false,
  bindings: {
    DRAWCOVER_HOSTED: "true", OPENROUTER_API_KEY: "offline-test-only",
    DRAWCOVER_DAILY_ALBUM_LIMIT: "1", DRAWCOVER_DAILY_TRACK_LIMIT: "1",
  },
  durableObjects: { DRAWCOVER_STATE: { className: "DrawCoverState", useSQLite: true } },
  ratelimits: {
    ALBUM_RATE_LIMITER: { namespace_id: "1", simple: { limit: 2, period: 60 } },
    TRACK_RATE_LIMITER: { namespace_id: "2", simple: { limit: 8, period: 60 } },
  },
  outboundService: async (request) => {
    assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions", "Unexpected outbound network request blocked");
    calls++;
    const body = await request.json();
    if (body.response_format) {
      return Response.json({ choices: [{ message: { content: JSON.stringify(metadata) } }] });
    }
    if (body.modalities?.includes("image")) {
      return Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }] });
    }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { audio: { data: audio } } }] })}\n\ndata: [DONE]\n\n`);
  },
});

async function main() {
  const runtime = new Miniflare(options);
  try {
    const post = (path, body) => runtime.dispatchFetch(`https://drawcover.test${path}`, {
      method: "POST", body: JSON.stringify(body), headers: { "CF-Connecting-IP": "192.0.2.1" },
    });
    const response = await post("/api/drawcover", { image });
    assert.equal(response.status, 200, await response.clone().text());
    const album = await response.json();
    assert.equal(album.cover.source, "ai");
    assert.equal(album.tracks.length, 8);
    const track = await post("/api/drawcover/track", { albumId: album.id, trackIndex: 0 });
    assert.equal(track.status, 200, await track.clone().text());
    assert.equal((await track.json()).dataUrl, `data:audio/mpeg;base64,${audio}`);
    const cached = await post("/api/drawcover/track", { albumId: album.id, trackIndex: 0 });
    assert.equal(cached.status, 200);
    assert.equal(calls, 3, "Replay must not regenerate paid work");
    const capped = await post("/api/drawcover/track", { albumId: album.id, trackIndex: 1 });
    assert.equal(capped.status, 429);
    assert.equal((await capped.json()).reason, "daily_limit");
    assert.equal(calls, 3, "Global cap must reject before any provider call");
    assert.equal((await post("/api/drawcover", { invalid: true })).status, 400);
    const cooldown = await post("/api/drawcover", { invalid: true });
    assert.equal(cooldown.status, 429);
    assert.equal((await cooldown.json()).reason, "cooldown");
    assert.equal(cooldown.headers.get("Retry-After"), "900");
    assert.equal((await post("/api/drawcover/track", { albumId: album.id, trackIndex: 0 })).status, 429);
    assert.equal(calls, 3, "Personal cooldown must reject before any provider call");
    console.log("Actual Worker bundle + SQLite: metadata, AI cover, audio, cache and cap passed with mocked providers. No paid calls.");
  } finally {
    await runtime.dispose();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
