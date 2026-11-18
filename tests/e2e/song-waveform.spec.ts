import { expect, test } from "@playwright/test";

declare global {
  interface Window { __songSourceCreates: number }
}

function recording(frequency: number) {
  const rate = 8000;
  const bytes = Buffer.alloc(44 + rate * 8 * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let sample = 0; sample < rate * 8; sample++) {
    const time = sample / rate;
    const tone = time < 2 || time >= 5 && time < 7.6;
    bytes.writeInt16LE(tone ? Math.round(Math.sin(time * frequency * Math.PI * 2) * 8192) : 0, 44 + sample * 2);
  }
  return `data:audio/wav;base64,${bytes.toString("base64")}`;
}

test("song bars follow actual loud and silent audio across seeking, pause and track changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    window.__songSourceCreates = 0;
    const create = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (element) {
      window.__songSourceCreates++;
      return create.call(this, element);
    };
  });
  const recordings = [recording(440), recording(880)];
  let trackRequests = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/drawcover/track") {
      trackRequests++;
      return route.fulfill({ json: { dataUrl: recordings[route.request().postDataJSON().trackIndex], model: "local-fixture" } });
    }
    if (path !== "/api/drawcover") return route.abort("blockedbyclient");
    return route.fulfill({ json: {
      id: "local-waveform-fixture", title: "Signal Test", artist: "Local Fixture",
      subtitle: "Known loud and silent sections. No generated music.",
      palette: ["#344838", "#b6c798", "#f0bf74"],
      tracks: Array.from({ length: 8 }, (_, index) => ({ title: `Signal ${index + 1}` })),
      cover: { source: "ai", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" },
      models: { metadata: "mock", image: "mock", music: "local-fixture" },
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(page.getByRole("button", { name: "Line", exact: true })).toHaveAttribute("aria-pressed", "true");
  const canvas = (await page.getByTestId("drawing-canvas").boundingBox())!;
  await page.mouse.move(canvas.x + 30, canvas.y + 30);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 100, canvas.y + 80);
  await page.mouse.up();
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await page.getByRole("heading", { name: "Signal Test" }).waitFor();
  await expect(page.locator(".player-toggle")).toBeEnabled();
  const audio = page.getByLabel("Album audio player");
  const seek = (time: number) => audio.evaluate((element, value) => {
    if (!(element instanceof HTMLMediaElement)) throw new Error("Missing music element");
    element.currentTime = value;
  }, time);
  const level = () => page.locator(".player-waveform i").evaluateAll(bars => Math.max(...bars.map(bar => {
    const transform = getComputedStyle(bar).transform;
    return transform === "none" ? 1 : Number(transform.split(",")[3]);
  })));
  if (await audio.evaluate(element => element instanceof HTMLMediaElement && element.paused)) {
    await page.getByRole("button", { name: "Play current track" }).click();
  }
  await expect.poll(() => audio.evaluate(element => element instanceof HTMLMediaElement ? element.readyState : 0)).toBeGreaterThanOrEqual(1);
  await seek(.15);
  await expect.poll(level).toBeGreaterThan(.15);
  const loud = await level();
  await page.screenshot({ path: "output/playwright/song-waveform-LOUD-LOCAL-FIXTURE.png" });
  await seek(2.3);
  await expect.poll(level).toBeLessThanOrEqual(.12);
  const silent = await audio.evaluate(element => element instanceof HTMLMediaElement ? { time: element.currentTime, paused: element.paused } : null);
  expect(silent?.paused).toBe(false);
  expect(silent!.time).toBeLessThan(5);
  await page.screenshot({ path: "output/playwright/song-waveform-SILENT-LOCAL-FIXTURE.png" });
  await seek(.15);
  await expect.poll(level).toBeGreaterThan(.15);
  await page.getByRole("button", { name: "Pause track" }).click();
  await expect.poll(level).toBeLessThanOrEqual(.12);
  const paused = await level();
  await page.waitForTimeout(100);
  expect(await level()).toBe(paused);
  await page.getByRole("button", { name: "Play track 2: Signal 2" }).click();
  await expect(page.getByRole("button", { name: "Pause track" })).toBeVisible();
  await seek(.15);
  await expect.poll(level).toBeGreaterThan(.15);
  await seek(7.95);
  await expect(page.getByRole("button", { name: "Play current track" })).toBeVisible();
  await expect.poll(level).toBeLessThanOrEqual(.12);
  expect(await page.evaluate(() => window.__songSourceCreates)).toBe(1);
  expect(trackRequests).toBe(2);
  console.log("Native song waveform:", { loud, silent, resting: await level(), sourceConnections: 1, mockedTrackRequests: trackRequests });
});
