import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Miniflare, convertV4MiniflareOptions, kCurrentWorker } from "miniflare";
import sharp from "sharp";

const image = `data:image/png;base64,${(await sharp(readFileSync(resolve("docs/media/front.webp"))).png().toBuffer()).toString("base64")}`;
const audio = readFileSync(resolve("docs/media/first-track.mp3")).toString("base64");
assert.ok(image.length > 300_000 && audio.length > 900_000, "Use realistic cover/music payloads");
const metadata = {
  title: "Offline Browser Record", artist: "The Worker Ensemble", subtitle: "Calm piano",
  palette: ["#14213D", "#FCA311", "#FFFFFF"],
  tracks: Array.from({ length: 8 }, (_, index) => ({ title: `Orbit ${index + 1}` })),
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const slow = process.env.WORKER_SLOW_PROBE === "true";
const results = [];
const browser = await chromium.launch();
try {
  for (const cutPath of slow ? ["/api/drawcover/track"] : [null, "/api/drawcover", "/api/drawcover/track"]) {
    const musicMode = cutPath === "/api/drawcover/track" ? "lyrics" : "instrumental";
    let calls = 0;
    let cut = false;
    const runtime = new Miniflare(convertV4MiniflareOptions({
      name: "drawcover-browser-test", port: 0, host: "127.0.0.1",
      modules: true, scriptPath: resolve(".open-next/runtime-test/worker.js"),
      compatibilityDate: "2026-11-18",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      stripCfConnectingIp: false,
      bindings: {
        DRAWCOVER_HOSTED: "true", OPENROUTER_API_KEY: "offline-test-only",
        DRAWCOVER_DAILY_ALBUM_LIMIT: "25", DRAWCOVER_DAILY_TRACK_LIMIT: "40",
      },
      assets: {
        directory: resolve(".open-next/assets"), binding: "ASSETS",
        routerConfig: { has_user_worker: true },
      },
      serviceBindings: { WORKER_SELF_REFERENCE: kCurrentWorker },
      durableObjects: { DRAWCOVER_STATE: { className: "DrawCoverState", useSQLite: true } },
      ratelimits: {
        ALBUM_RATE_LIMITER: { namespace_id: "1", simple: { limit: 2, period: 60 } },
        TRACK_RATE_LIMITER: { namespace_id: "2", simple: { limit: 8, period: 60 } },
      },
      outboundService: async request => {
        assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions", "Unapproved outbound traffic blocked");
        calls++;
        const body = await request.json();
        await wait(300);
        if (body.response_format) return Response.json({ choices: [{ message: { content: JSON.stringify({
          ...metadata, ...(musicMode === "lyrics" ? { genre: "pop" } : {}),
        }) } }] });
        if (body.modalities?.includes("image")) return Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }] });
        assert.ok(body.messages[0].content.includes(musicMode === "lyrics" ? "recognizable pop song" : "Instrumental only"));
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(": provider heartbeat\n\n"));
            await wait(slow ? 50_000 : 700);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { audio: { data: audio } } }] })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }));
      },
    }));
    const origin = await runtime.ready;
    const proxy = createServer((request, response) => {
      const upstream = httpRequest(new URL(request.url, origin), {
        method: request.method, headers: request.headers,
      }, result => {
        response.writeHead(result.statusCode, result.headers);
        if (!cut && cutPath === request.url && result.statusCode === 200) {
          cut = true;
          response.flushHeaders();
          result.once("data", chunk => {
            response.write(chunk.subarray(0, 10000));
            setTimeout(() => response.destroy(), 100);
          });
          result.resume();
        } else result.pipe(response);
      });
      upstream.on("error", () => response.destroy());
      request.pipe(upstream);
    }).listen(0, "127.0.0.1");
    const listening = once(proxy, "listening");
    const context = await browser.newContext();
    try {
      await listening;
      const base = `http://127.0.0.1:${proxy.address().port}`;
      const page = await context.newPage();
      const postReceipts = [];
      const network = [];
      page.on("request", request => {
        if (request.method() === "POST") postReceipts.push(request.headers()["x-drawcover-recording"]);
      });
      page.on("requestfailed", request => network.push({
        path: new URL(request.url()).pathname, error: request.failure()?.errorText,
      }));
      const started = Date.now();
      await page.goto(base);
      const box = await page.getByTestId("drawing-canvas").boundingBox();
      await page.mouse.move(box.x + box.width * .3, box.y + box.height * .4);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .7, box.y + box.height * .6, { steps: 10 });
      await page.mouse.up();
      if (musicMode === "lyrics") await page.getByText("Lyrics", { exact: true }).click();
      await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
      await page.waitForFunction(() => {
        const audio = document.querySelector("audio");
        return audio && !audio.paused && audio.currentTime > .25;
      }, null, { timeout: slow ? 80_000 : 25_000 });
      const playback = await page.locator("audio").evaluate(audio => ({
        readyState: audio.readyState, currentTime: audio.currentTime, duration: audio.duration,
      }));
      assert.equal(cut, Boolean(cutPath));
      assert.equal(calls, 3, "Exactly one metadata/art/music call, including after interrupted delivery");
      assert.equal(postReceipts.length, 2, "One album POST and one track POST; never automatically regenerate");
      if (cutPath) assert.ok(network.some(event => event.error?.includes("ERR_INCOMPLETE_CHUNKED_ENCODING")));
      // Reloaded/concurrent consumers can only read the original operation.
      await page.reload();
      const restored = await Promise.all(postReceipts.flatMap(id =>
        Array.from({ length: 3 }, () => context.request.get(`${base}/api/drawcover/recording?id=${id}`)),
      ));
      assert.ok(restored.every(response => response.status() === 200));
      const usage = await (await context.request.get(`${base}/api/drawcover/status`)).json();
      assert.deepEqual(usage.daily.used, { album: 1, track: 1 });
      assert.equal(calls, 3);
      results.push({ cutPath, musicMode, elapsedMs: Date.now() - started, providerCalls: calls, usage: usage.daily.used, playback, network });
    } finally {
      await context.close();
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
      await runtime.dispose();
    }
  }
} finally {
  await browser.close();
}
mkdirSync(resolve("output/playwright"), { recursive: true });
writeFileSync(resolve(`output/playwright/worker-browser-recovery${slow ? "-slow" : ""}.json`), JSON.stringify(results, null, 2));
console.log("Actual Worker/browser one-click native playback, truncated album/track bodies, reload and concurrent free recovery:", JSON.stringify(results));
