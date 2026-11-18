// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { build } from "vite";

// Bundle an isolated React fixture in memory: no app server, network or providers.
const entry = `
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AlbumWaveform } from "/components/album-waveform.tsx";
const audio = document.createElement("audio");
audio.controls = true;
document.body.append(audio);
const host = document.createElement("div");
document.body.append(host);
const audioRef = { current: audio };
let root = createRoot(host);
function render() {
  root.render(React.createElement(StrictMode, null,
    React.createElement(AlbumWaveform, { audioRef, playing: !audio.paused })));
}
for (const name of ["play", "pause", "ended"]) audio.addEventListener(name, render);
window.fixture = {
  audio,
  unmount() { root.unmount(); },
  remount() { root = createRoot(host); render(); },
};
render();
`;

// Six seconds: loud tone / silence / quieter tone. No encoded fixtures or downloads.
function wav(silent = false) {
  const rate = 24000;
  const samples = rate * 6;
  const bytes = Buffer.alloc(44 + samples * 2);
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
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const time = index / rate;
    const amplitude = silent || (time >= 2 && time < 4) ? 0 : time < 2 ? 0.65 : 0.08;
    bytes.writeInt16LE(Math.round(Math.sin(time * 440 * Math.PI * 2) * amplitude * 32767), 44 + index * 2);
  }
  return `data:audio/wav;base64,${bytes.toString("base64")}`;
}

declare global {
  interface Window {
    fixture: {
      audio: HTMLAudioElement;
      unmount(): void;
      remount(): void;
    };
    probe: {
      sources: number;
      destinationConnections: number;
      disconnects: number;
      reads: number;
      frames: number;
      contexts: AudioContext[];
      blockUnlock: boolean;
      pendingUnlock: boolean;
    };
  }
}

let browser: Browser;
let page: Page;
let bundle: string;
let errors: string[];

beforeAll(async () => {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [{
      name: "waveform-test-fixture",
      resolveId: (id) => id.endsWith("virtual:waveform-test") ? "\0waveform-test" : undefined,
      load: (id) => id === "\0waveform-test" ? entry : undefined,
    }],
    build: {
      write: false,
      minify: false,
      lib: { entry: "virtual:waveform-test", name: "WaveformTest", formats: ["iife"] },
    },
  });
  const result = Array.isArray(output) ? output[0] : output;
  if (!("output" in result)) throw new Error("Expected one browser bundle");
  bundle = result.output.map((chunk) => chunk.type === "chunk" ? chunk.code : "").join("\n");
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
}, 30000);

beforeEach(async () => {
  page = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 844 } });
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<button id="gesture">Unlock audio</button>');
  await page.evaluate(() => {
    window.probe = {
      sources: 0, destinationConnections: 0, disconnects: 0, reads: 0, frames: 0,
      contexts: [], blockUnlock: false, pendingUnlock: false,
    };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.probe.contexts.push(this);
        if (window.probe.blockUnlock || window.probe.pendingUnlock) void this.suspend();
      }
      resume() {
        if (window.probe.pendingUnlock) return new Promise<void>(() => {});
        if (window.probe.blockUnlock) return Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
        return super.resume();
      }
      createMediaElementSource(audio: HTMLMediaElement) {
        window.probe.sources++;
        const source = super.createMediaElementSource(audio);
        const connect = source.connect.bind(source);
        source.connect = ((target: AudioNode) => {
          if (target === this.destination) window.probe.destinationConnections++;
          return connect(target);
        }) as typeof source.connect;
        const disconnect = source.disconnect.bind(source);
        source.disconnect = (() => {
          window.probe.disconnects++;
          disconnect();
        }) as typeof source.disconnect;
        return source;
      }
    };
    const read = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (data) {
      window.probe.reads++;
      return read.call(this, data);
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      window.probe.frames++;
      return raf(callback);
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector(".player-waveform i", { state: "attached", timeout: 3000 });
});

afterEach(async () => {
  await page?.close();
  expect(errors ?? []).toEqual([]);
});
afterAll(async () => { await browser?.close(); });

async function heights() {
  return page.locator(".player-waveform i").evaluateAll((bars) => bars.map((bar) => ({
    transform: (bar as HTMLElement).style.transform,
    opacity: (bar as HTMLElement).style.opacity,
  })));
}

async function level() {
  return page.locator(".player-waveform i").evaluateAll((bars) =>
    bars.reduce((sum, bar) => sum + Number((bar as HTMLElement).style.transform.match(/scaleY\(([\d.]+)\)/)?.[1] ?? 0), 0) / bars.length);
}

async function play(src = wav()) {
  await page.evaluate((src) => { window.fixture.audio.src = src; }, src);
  await page.locator("#gesture").click();
  await page.evaluate(() => window.fixture.audio.play());
}

async function seek(time: number) {
  await page.evaluate(async (time) => {
    const audio = window.fixture.audio;
    await new Promise<void>((resolve) => {
      audio.addEventListener("seeked", () => resolve(), { once: true });
      audio.currentTime = time;
    });
  }, time);
}

describe("AlbumWaveform real browser audio", () => {
  it("renders 36 decorative full-height bars at rest and follows actual loud/silent/quiet samples and seeks", async () => {
    expect(await page.locator('.player-waveform[aria-hidden="true"] i').count()).toBe(36);
    expect(await page.locator(".player-waveform i").first().evaluate((bar) =>
      (bar as HTMLElement).style.getPropertyValue("--bar-height"))).toBe("100%");
    const resting = await heights();
    await play();
    await expect.poll(level).toBeGreaterThan(0.5);
    await seek(2.5);
    await expect.poll(heights).toEqual(resting);
    await page.waitForTimeout(100);
    expect(await heights()).toEqual(resting);
    await seek(4.2);
    await expect.poll(level).toBeGreaterThan(0.15);
    expect(await level()).toBeLessThan(0.5);
    await seek(0.3);
    await expect.poll(level).toBeGreaterThan(0.5);
  });

  it("rests on pause/end, resumes and handles src changes without creating another media source", async () => {
    const resting = await heights();
    await play();
    await expect.poll(level).toBeGreaterThan(0.5);
    await page.evaluate(() => window.fixture.audio.pause());
    await expect.poll(heights).toEqual(resting);
    const frames = await page.evaluate(() => window.probe.frames);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.probe.frames)).toBe(frames);
    await page.evaluate(() => window.fixture.audio.play());
    await expect.poll(level).toBeGreaterThan(0.5);
    await play(wav(true));
    await expect.poll(heights).toEqual(resting);
    await play();
    await expect.poll(level).toBeGreaterThan(0.5);
    await seek(5.85);
    await expect.poll(() => page.evaluate(() => window.fixture.audio.ended)).toBe(true);
    await expect.poll(heights).toEqual(resting);
    expect(await page.evaluate(() => window.probe.sources)).toBe(1);
    expect(await page.evaluate(() => window.probe.destinationConnections)).toBe(1);
  });

  it("preserves native autoplay on rejected unlock and retries only on a real keyboard gesture", async () => {
    const resting = await heights();
    await page.evaluate(() => { window.probe.blockUnlock = true; });
    await page.evaluate(async (src) => {
      window.fixture.audio.src = src;
      await window.fixture.audio.play();
    }, wav());
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.fixture.audio.paused)).toBe(false);
    expect(await page.evaluate(() => window.probe.sources)).toBe(0);
    expect(await heights()).toEqual(resting);
    await page.evaluate(() => {
      window.probe.blockUnlock = false;
      document.dispatchEvent(new Event("pointerdown"));
    });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.probe.sources)).toBe(0);
    // A genuine keyboard gesture, not a synthetic dispatchEvent.
    await page.locator("#gesture").focus();
    await page.keyboard.press("Space");
    await expect.poll(level).toBeGreaterThan(0.5);
    expect(await page.evaluate(() => window.probe.sources)).toBe(1);
  });

  it("retries a pending unlock via genuine mobile touch and recovers an interrupted context", async () => {
    const resting = await heights();
    await page.evaluate(() => { window.probe.pendingUnlock = true; });
    await play();
    expect(await page.evaluate(() => window.probe.sources)).toBe(0);
    expect(await heights()).toEqual(resting);
    await page.evaluate(() => { window.probe.pendingUnlock = false; });
    await page.locator("#gesture").tap();
    await expect.poll(level).toBeGreaterThan(0.5);
    await page.evaluate(() => window.probe.contexts[0].suspend());
    await expect.poll(heights).toEqual(resting);
    const frames = await page.evaluate(() => window.probe.frames);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.probe.frames)).toBe(frames);
    await page.locator("#gesture").tap();
    await expect.poll(level).toBeGreaterThan(0.5);
    await page.evaluate(() => { window.fixture.audio.muted = true; });
    await expect.poll(heights).toEqual(resting);
    await page.evaluate(() => { window.fixture.audio.muted = false; });
    await expect.poll(level).toBeGreaterThan(0.5);
    expect(await page.evaluate(() => window.probe.sources)).toBe(1);
  });

  it("does not attach a late-unlocked source after cleanup", async () => {
    await page.evaluate(() => { window.probe.pendingUnlock = true; });
    await play();
    await page.evaluate(() => window.fixture.unmount());
    await page.evaluate(async () => {
      window.probe.pendingUnlock = false;
      await window.probe.contexts[0].resume();
    });
    await page.locator("#gesture").tap();
    expect(await page.evaluate(() => window.probe.sources)).toBe(0);
    expect(await page.evaluate(() => window.probe.frames)).toBe(0);
    await page.evaluate(() => window.fixture.remount());
    await expect.poll(level).toBeGreaterThan(0.5);
    expect(await page.evaluate(() => window.probe.sources)).toBe(1);
  });

  it("reuses the passthrough across StrictMode/remount and stops all work on cleanup", async () => {
    await play();
    await expect.poll(level).toBeGreaterThan(0.5);
    await page.evaluate(() => window.fixture.unmount());
    const before = await page.evaluate(() => ({
      frames: window.probe.frames, time: window.fixture.audio.currentTime,
    }));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.probe.frames)).toBe(before.frames);
    expect(await page.evaluate(() => window.fixture.audio.currentTime)).toBeGreaterThan(before.time);
    expect(await page.evaluate(() => window.probe.disconnects)).toBe(0);
    await page.locator("#gesture").click();
    expect(await page.evaluate(() => window.probe.frames)).toBe(before.frames);
    await page.evaluate(() => window.fixture.remount());
    await expect.poll(level).toBeGreaterThan(0.5);
    expect(await page.evaluate(() => window.probe.sources)).toBe(1);
  });

  it("stays still without RAF for reduced motion and hidden tabs, recovering when visible", async () => {
    const resting = await heights();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await play();
    await page.waitForTimeout(100);
    expect(await heights()).toEqual(resting);
    expect(await page.evaluate(() => window.probe.frames)).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(level).toBeGreaterThan(0.5);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(heights).toEqual(resting);
    const frames = await page.evaluate(() => window.probe.frames);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.probe.frames)).toBe(frames);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(level).toBeGreaterThan(0.5);
  });

  it("leaves native playback alone when Web Audio is unavailable", async () => {
    await page.evaluate(() => {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
    });
    const resting = await heights();
    await play();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.fixture.audio.paused)).toBe(false);
    expect(await heights()).toEqual(resting);
    expect(await page.evaluate(() => window.probe.sources)).toBe(0);
  });
});
