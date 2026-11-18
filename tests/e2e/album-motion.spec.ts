import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

function dynamicRecording() {
  const rate = 16000;
  const samples = rate * 14;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const time = index / rate;
    const beat = time % .46;
    const note = [220, 261.63, 329.63, 293.66][Math.floor(time / .46) % 4];
    const phrase = [1, .12, .8, .2, 1, .08, .65, 1][Math.floor(time / 1.05) % 8];
    const chord = (Math.sin(time * note * Math.PI * 2) + .4 * Math.sin(time * note * 3 * Math.PI)) * .2;
    const bass = Math.sin(time * 55 * Math.PI * 2) * .17;
    const kick = Math.sin(time * 70 * Math.PI * 2) * Math.exp(-beat * 30) * .55;
    const percussion = Math.sin(index * 17.13) * Math.exp(-(time % .115) * 90) * .23;
    const sample = time >= 8.4 ? 0 : (chord + bass + kick + percussion) * phrase;
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2);
  }
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

test("album motion flows calmly with dynamic audio and visibly drifts in the rendered background", async ({ browser, baseURL }) => {
  test.setTimeout(40000);
  const phase = process.env.MOTION_EVIDENCE ?? "after";
  const context = await browser.newContext({
    baseURL, viewport: { width: 1280, height: 720 }, reducedMotion: "no-preference",
    recordVideo: { dir: "output/playwright", size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/drawcover/track") return route.fulfill({ json: { dataUrl: dynamicRecording(), model: "local-dynamics-fixture" } });
    if (path !== "/api/drawcover") return route.abort("blockedbyclient");
    return route.fulfill({ json: {
      id: "ambient-motion-fixture", title: "Slow Current", artist: "Local Fixture",
      subtitle: "Original local bass, chords, percussion, changing dynamics and silence. No AI.",
      palette: ["#163b54", "#c56a49", "#f6ca83"],
      tracks: Array.from({ length: 8 }, (_, index) => ({ title: `Current ${index + 1}` })),
      cover: { source: "ai", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" },
      models: { metadata: "mock", image: "mock", music: "local-dynamics-fixture" },
    } });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await expect(page.getByRole("button", { name: "Line", exact: true })).toHaveAttribute("aria-pressed", "true");
    const box = (await page.getByTestId("drawing-canvas").boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 80);
    await page.mouse.up();
    await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
    await page.getByRole("heading", { name: "Slow Current" }).waitFor();
    await expect(page.locator(".player-toggle")).toBeEnabled();
    await expect(page.locator(".has-album")).toHaveCSS("opacity", "1");
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (!(animation instanceof CSSAnimation) || animation.animationName !== "album-gradient-drift") animation.pause();
      }
    });
    await page.mouse.move(0, 0);
    await page.evaluate(label => {
      const badge = document.createElement("div");
      badge.textContent = `${label.toUpperCase()} / LOCAL DYNAMIC AUDIO / SILENT VIDEO / MOCKED ALBUM`;
      Object.assign(badge.style, { position: "fixed", bottom: "0", right: "0", zIndex: "999", padding: "5px", background: "#fff1bd", color: "#29261b", font: "9px monospace" });
      document.body.append(badge);
    }, phase);
    const audio = page.getByLabel("Album audio player");
    if (await audio.evaluate(element => (element as HTMLMediaElement).paused)) {
      await page.getByRole("button", { name: "Play current track" }).click();
    }
    await audio.evaluate(element => { (element as HTMLMediaElement).currentTime = 0; });
    const strip = { x: 0, y: 65, width: 1280, height: 38 };
    const first = await page.screenshot({ clip: strip });
    await writeFile(`output/playwright/album-motion-${phase}-gradient-0s.png`, first);
    await page.screenshot({ path: `output/playwright/album-motion-${phase}-start.png` });
    const laterBackground = page.waitForTimeout(6000).then(() => page.screenshot({ clip: strip }));
    const samples = await page.evaluate(() => new Promise<{ dt: number; bars: number[] }[]>(resolve => {
      const frames: { dt: number; bars: number[] }[] = [];
      const start = performance.now();
      let previous = start;
      const tick = (now: number) => {
        frames.push({ dt: now - previous, bars: Array.from(document.querySelectorAll(".player-waveform i"), bar => Number(getComputedStyle(bar).transform.split(",")[3])) });
        previous = now;
        if (now - start < 11000) requestAnimationFrame(tick);
        else resolve(frames);
      };
      requestAnimationFrame(tick);
    }));
    const last = await laterBackground;
    await writeFile(`output/playwright/album-motion-${phase}-gradient-6s.png`, last);
    await page.screenshot({ path: `output/playwright/album-motion-${phase}-end.png` });
    const comparePixels = (images: Buffer[]) => page.evaluate(async images => {
      const pixels = await Promise.all(images.map(async source => {
        const image = new Image();
        image.src = `data:image/png;base64,${source}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      }));
      let difference = 0;
      for (let index = 0; index < pixels[0].length; index++) {
        if (index % 4 !== 3) difference += Math.abs(pixels[0][index] - pixels[1][index]);
      }
      return difference / (pixels[0].length * .75);
    }, images.map(image => image.toString("base64")));
    const pixelChange = await comparePixels([first, last]);
    const steps = samples.slice(1).flatMap((frame, index) => frame.bars.map((value, bar) => Math.abs(value - samples[index].bars[bar]) * 16.667 / Math.max(8, frame.dt))).sort((a, b) => a - b);
    const metrics = {
      baseURL, phase, frameCount: samples.length,
      backgroundProbe: "Visible empty strip; page fade finished and all other CSS motion paused.",
      peakFrameStep: steps.at(-1), p99FrameStep: steps[Math.floor(steps.length * .99)],
      meanFrameStep: steps.reduce((sum, step) => sum + step, 0) / steps.length,
      min: Math.min(...samples.flatMap(frame => frame.bars)), max: Math.max(...samples.flatMap(frame => frame.bars)),
      renderedBackgroundMeanRgbChangeInSixSeconds: pixelChange,
      silentLevel: samples.at(-1)!.bars.reduce((max, value) => Math.max(max, value), 0),
    };
    await writeFile(`output/playwright/album-motion-${phase}-metrics.json`, JSON.stringify(metrics, null, 2));
    console.log("Rendered album motion:", metrics);
    expect.soft(metrics.p99FrameStep, "bar movement should flow rather than flicker").toBeLessThan(.045);
    expect.soft(metrics.max, "transient peaks should be softened").toBeLessThan(.85);
    expect.soft(metrics.max - metrics.min, "real musical dynamics must remain visible").toBeGreaterThan(.1);
    expect.soft(metrics.silentLevel, "silent audio settles to rest").toBeLessThanOrEqual(.121);
    expect.soft(pixelChange, "the visible gradient should perceptibly change in six seconds, not only its CSS matrix").toBeGreaterThan(2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => page.locator(".album-atmosphere").evaluate(element => getComputedStyle(element, "::before").transform)).toBe("none");
    const still = await page.screenshot({ clip: strip });
    await page.waitForTimeout(400);
    expect(await comparePixels([still, await page.screenshot({ clip: strip })])).toBe(0);
  } finally {
    const video = page.video();
    await context.close();
    await video?.saveAs(`output/playwright/album-motion-${phase}-SILENT.webm`);
  }
});
