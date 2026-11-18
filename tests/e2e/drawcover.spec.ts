import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

declare global {
  interface Window {
    __criticAudioProbe: { context: AudioContext; meter: AnalyserNode; starts: number }[];
  }
}

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const wav = Buffer.alloc(844, 128);
wav.write("RIFF", 0);
wav.writeUInt32LE(836, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34);
wav.write("data", 36);
wav.writeUInt32LE(800, 40);
const audio = `data:audio/wav;base64,${wav.toString("base64")}`;
const album = {
  id: "test-record",
  title: "Where the Sun Sleeps",
  artist: "The Paper Horizon",
  subtitle: "Warm analog loops and golden-hour daydreams.",
  palette: ["#344838", "#b6c798", "#f0bf74"],
  tracks: ["First Light", "Paper Horizon", "Solar Flare", "Golden Hour", "Sunroom", "Long Shadows", "Afterglow", "Until Tomorrow"].map((title) => ({ title })),
  cover: { dataUrl: png, source: "ai" },
  models: { metadata: "mock", image: "mock", music: "mock" },
};

async function draw(page: Page) {
  await page.goto("/");
  const go = page.getByRole("button", { name: "PRESS RECORD", exact: true });
  await expect(go).toBeDisabled();
  const box = (await page.getByTestId("drawing-canvas").boundingBox())!;
  const toolbarBox = (await page.getByRole("toolbar").boundingBox())!;
  expect(box.y).toBeGreaterThan(toolbarBox.y + toolbarBox.height);
  expect(box.height).toBeGreaterThan(150);
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .6, { steps: 10 });
  await page.mouse.up();
  await expect(go).toBeEnabled();
}

async function setup(page: Page, blocked = false) {
  await page.addInitScript((blocked) => {
    const state = window as unknown as { __plays: number };
    state.__plays = 0;
    HTMLMediaElement.prototype.play = function () {
      state.__plays++;
      return blocked ? Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError")) : Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  }, blocked);
  await page.route("**/api/drawcover", (route) => {
    expect(route.request().postDataJSON().image).toMatch(/^data:image\/png;base64,/);
    return route.fulfill({ json: album });
  });
}

for (const width of [1280, 390]) {
  test(`vocal choice defaults to Instrumental and retains Lyrics on the album at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    await page.route("**/api/drawcover", route => {
      expect(route.request().postDataJSON().musicMode).toBe("lyrics");
      return route.fulfill({ json: { ...album, musicMode: "lyrics", genre: "pop" } });
    });
    await page.route("**/api/drawcover/track", route => {
      expect(route.request().postDataJSON()).toEqual({ albumId: album.id, trackIndex: 0 });
      return route.fulfill({ json: { dataUrl: audio, model: "mock" } });
    });
    await draw(page);
    const instrumental = page.getByRole("radio", { name: "Instrumental", exact: true });
    const lyrics = page.getByRole("radio", { name: "Lyrics", exact: true });
    await expect(instrumental).toBeChecked();
    await instrumental.focus();
    await page.keyboard.press("ArrowRight");
    await expect(lyrics).toBeChecked();
    await expect(lyrics).toBeFocused();
    await expect(page.getByRole("group", { name: "Song vocals" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
    await expect(page.locator(".jacket-front .content-note")).toContainText("WITH LYRICS");
    await expect(page.locator(".jacket-back .content-note")).toContainText("VOCALS REQUESTED");
    await expect(page.locator(".content-note").first()).toHaveAttribute("aria-label", /not an official age certification or clean-content guarantee/i);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(1);
  });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 720 }]) {
  test(`vocal toggle is below the button at 70 percent width and fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const button = (await page.getByRole("button", { name: "PRESS RECORD", exact: true }).boundingBox())!;
    const toggle = (await page.getByRole("group", { name: "Song vocals" }).boundingBox())!;
    expect(toggle.y).toBeGreaterThanOrEqual(button.y + button.height + 8);
    expect(toggle.width / button.width).toBeCloseTo(.7, 2);
    expect(Math.abs(toggle.x + toggle.width / 2 - button.x - button.width / 2)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("link", { name: "Critic mode", exact: false })).toBeVisible();
  });
}

for (const reducedMotion of [false, true]) {
  test(`critic rounds preserve drawings, bind a verdict and return to normal (${reducedMotion ? "reduced motion, no WebGL" : "animated"})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    if (reducedMotion) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: function (this: HTMLCanvasElement, ...args: unknown[]) {
          if (String(args[0]).includes("webgl")) return null;
          return Reflect.apply(getContext, this, args);
        } });
      });
    }
    await setup(page);
    let albumCalls = 0;
    let trackCalls = 0;
    await page.route("**/api/drawcover", route => {
      albumCalls++;
      expect(route.request().postDataJSON()).toMatchObject({ criticId: "jax", musicMode: "lyrics" });
      return route.fulfill({ json: { ...album, musicMode: "lyrics", genre: "rock", criticReview: {
        criticId: "jax", basis: "concept", score: 9, headline: "A new cover story.",
        text: "On paper, Where the Sun Sleeps brings raw rock energy. This is a concept verdict, not a listening review.",
        preferences: "Guitar-driven rock; raw energy and dark artwork.", breakdown: { direction: 4, mood: 3, palette: 2 },
      } } });
    });
    await page.route("**/api/drawcover/track", route => {
      trackCalls++;
      return route.fulfill({ json: { dataUrl: audio, model: "mock" } });
    });
    await draw(page);
    const before = await page.getByTestId("drawing-canvas").evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
    await page.getByRole("link", { name: "Critic mode", exact: false }).click();
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.getByRole("heading", { name: "Mara Moss" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mute critic", exact: true })).toBeVisible();
    const change = page.getByRole("button", { name: "Change critic", exact: true });
    await expect(change).toBeInViewport();
    await change.click();
    await expect(page.getByRole("heading", { name: "Jax Static" })).toBeVisible();
    expect(await page.locator('[data-testid="drawing-canvas"]:visible').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).toBe(before);
    expect(albumCalls).toBe(0);
    expect(trackCalls).toBe(0);
    await expect(page.getByText("Guitar-driven rock; raw energy and dark artwork.")).toHaveCount(0);
    await page.locator("main:visible").getByText("Lyrics", { exact: true }).click();
    await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reveal verdict" })).toBeVisible();
    await expect(change).toBeDisabled();
    if (!reducedMotion) {
      await page.getByRole("button", { name: "Show full critic message" }).waitFor();
      await expect(page.getByRole("button", { name: "Play current track" })).toBeEnabled();
      await page.locator("audio").evaluate(audio => {
        if (!(audio instanceof HTMLMediaElement)) throw new Error("Missing music player");
        audio.dataset.pauseCalls = "0";
        const pause = audio.pause.bind(audio);
        audio.pause = () => { audio.dataset.pauseCalls = String(Number(audio.dataset.pauseCalls) + 1); pause(); };
        audio.dispatchEvent(new Event("play"));
      });
      await expect(page.getByRole("button", { name: "Pause track" })).toBeVisible();
      const text = page.locator(".critic-bubble > span");
      const characters = (await text.textContent())!.length;
      expect(characters).toBeLessThan((await page.locator(".critic-speech [role=status]").textContent())!.length);
      await page.getByRole("button", { name: "Mute critic", exact: true }).click();
      await expect(page.locator("audio")).toHaveAttribute("data-pause-calls", "0");
      await expect(page.getByRole("button", { name: "Pause track" })).toBeVisible();
      await expect.poll(async () => (await text.textContent())!.length).toBeGreaterThan(characters);
    }
    await page.getByRole("button", { name: "Reveal verdict" }).click();
    await expect(page.getByRole("region", { name: "Critic's review" })).toContainText("9/10");
    await expect(page.getByText("Concept judging only. No audio listening.")).toBeVisible();
    await page.getByText("What won (or lost) them over").click();
    await expect(page.getByText("Guitar-driven rock; raw energy and dark artwork.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show full critic message" })).toBeVisible();
    expect(await page.locator(".critic-result").evaluate(element => element.parentElement?.getAttribute("aria-label"))).toBe("Your generated album");
    if (!reducedMotion) {
      for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth)).toBe(true);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await page.evaluate(() => {
      const label = document.createElement("div");
      label.textContent = "MOCKED ALBUM / REVIEW - UI EVIDENCE";
      label.setAttribute("data-mock-evidence", "");
      Object.assign(label.style, { position: "fixed", top: "0", right: "0", background: "#fff1bd", color: "#29261b", padding: "5px 10px", font: "10px monospace", zIndex: "999" });
      document.body.append(label);
    });
    await page.screenshot({ path: `output/playwright/critic-review-mocked-${reducedMotion ? "mobile" : "desktop"}.png`, fullPage: true });
    await page.locator("[data-mock-evidence]").evaluate(element => element.remove());
    await page.getByRole("button", { name: "Another round", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Nova Vale" })).toBeVisible();
    await expect(page.getByRole("button", { name: "PRESS RECORD", exact: true })).toBeEnabled();
    await page.getByRole("link", { name: "Normal mode", exact: false }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.locator('[data-testid="drawing-canvas"]:visible').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).toBe(before);
    await expect(page.getByRole("complementary", { name: "Your fictional music critic" })).toHaveCount(0);
    expect(albumCalls).toBe(1);
    expect(trackCalls).toBe(1);
  });
}

test("album critic and speech keep a larger stable frame as a long review reveals", async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 940 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setup(page, true);
  await page.route("**/api/drawcover", route => route.fulfill({ json: {
    ...album,
    criticReview: {
      criticId: "mara", basis: "concept", score: 8, headline: "A place for this sleeve.",
      text: "Fixture concept review: warm musical ideas and an inviting sleeve. ".repeat(30),
      preferences: "Warm folk and thoughtful sleeves.", breakdown: { direction: 3, mood: 3, palette: 2 },
    },
  } }));
  await page.route("**/api/drawcover/track", route => route.fulfill({ json: { dataUrl: audio, model: "mock" } }));
  await draw(page);
  await page.getByRole("link", { name: "Critic mode", exact: false }).click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByRole("heading", { name: "Mara Moss" })).toBeVisible();
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  const speech = page.getByRole("button", { name: "Show full critic message" });
  await page.getByRole("button", { name: "Reveal verdict" }).waitFor();
  await speech.waitFor();
  const critic = page.locator(".critic-result");
  const stage = critic.locator("canvas");
  const before = (await stage.boundingBox())!;
  expect(before.height).toBeGreaterThan(220);
  const bubble = (await speech.boundingBox())!;
  await page.getByRole("button", { name: "Reveal verdict" }).click();
  await page.getByRole("region", { name: "Critic's review" }).waitFor();
  const next = critic.getByRole("button", { name: "Another round", exact: true });
  const action = (await next.boundingBox())!;
  await speech.click();
  await expect.poll(() => speech.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await stage.boundingBox())!).toEqual(before);
  expect((await speech.boundingBox())!).toEqual(bubble);
  expect((await next.boundingBox())!).toEqual(action);
  const column = (await critic.boundingBox())!;
  const right = (await page.locator(".record-column").boundingBox())!;
  expect(Math.abs(column.y - right.y)).toBeLessThan(1);
  expect(Math.abs(column.height - right.height)).toBeLessThan(1);
  const metrics = [{ viewport: page.viewportSize(), stage: before, speech: bubble, column, right }];
  await page.evaluate(() => {
    const label = document.createElement("div");
    label.textContent = "MOCKED ALBUM / LONG REVIEW - UI EVIDENCE";
    Object.assign(label.style, { position: "fixed", top: "0", right: "0", background: "#fff1bd", color: "#29261b", padding: "5px 10px", font: "10px monospace", zIndex: "999" });
    document.body.append(label);
  });
  await page.screenshot({ path: "output/playwright/critic-fixed-stage-MOCKED-desktop.png" });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(750);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    if (viewport.width >= 1000) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
      metrics.push({ viewport, stage: (await stage.boundingBox())!, speech: (await speech.boundingBox())!, column: (await critic.boundingBox())!, right: (await page.locator(".record-column").boundingBox())! });
    }
    if (viewport.width === 390) await page.screenshot({ path: "output/playwright/critic-fixed-stage-MOCKED-mobile.png", fullPage: true });
  }
  await writeFile("output/playwright/critic-fixed-stage-metrics.json", JSON.stringify(metrics, null, 2));
});

test("the first mode gesture unlocks non-silent babble with growing text and actual mouth movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    window.__criticAudioProbe = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      measurement: Window["__criticAudioProbe"][number];
      constructor(options?: AudioContextOptions) {
        super(options);
        const meter = super.createAnalyser();
        meter.fftSize = 256;
        meter.connect(this.destination);
        this.measurement = { context: this, meter, starts: 0 };
        window.__criticAudioProbe.push(this.measurement);
      }
      createGain() {
        const gain = super.createGain();
        const connect = gain.connect.bind(gain);
        Object.defineProperty(gain, "connect", { value: (target: AudioNode, ...args: unknown[]) => Reflect.apply(connect, gain, [target === this.destination ? this.measurement.meter : target, ...args]) });
        return gain;
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => { this.measurement.starts++; start(when); };
        return oscillator;
      }
    };
  });
  await page.route("**/api/**", route => route.abort("blockedbyclient"));
  await page.goto("/");
  await page.getByRole("link", { name: "Critic mode", exact: false }).click();
  await page.getByRole("button", { name: "Show full critic message" }).waitFor();
  const samples = [];
  for (let index = 0; index < 22; index++) {
    samples.push(await page.evaluate(() => ({
      text: document.querySelector(".critic-bubble > span")!.textContent!.length,
      mouth: Number(document.querySelector(".critic-portrait canvas")?.getAttribute("data-mouth-open") ?? 0),
      audio: window.__criticAudioProbe.map(probe => {
        const values = new Float32Array(256);
        probe.meter.getFloatTimeDomainData(values);
        return { running: probe.context.state === "running", rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) };
      }),
    })));
    await page.waitForTimeout(35);
  }
  expect(samples.some(sample => sample.audio.some(audio => audio.running && audio.rms > .0005))).toBe(true);
  expect(Math.max(...samples.map(s => s.text)) - Math.min(...samples.map(s => s.text))).toBeGreaterThan(3);
  expect(Math.max(...samples.map(s => s.mouth)) - Math.min(...samples.map(s => s.mouth))).toBeGreaterThan(.01);
  await page.getByRole("button", { name: "Mute critic", exact: true }).click();
  await page.getByRole("button", { name: "Change critic", exact: true }).click();
  await page.getByRole("heading", { name: "Jax Static" }).waitFor();
  const bubble = page.locator(".critic-bubble > span");
  await page.getByRole("button", { name: "Show full critic message" }).waitFor();
  const before = (await bubble.textContent())!.length;
  const starts = await page.evaluate(() => window.__criticAudioProbe.reduce((sum, probe) => sum + probe.starts, 0));
  await expect.poll(async () => (await bubble.textContent())!.length).toBeGreaterThan(before + 2);
  expect(await page.evaluate(() => window.__criticAudioProbe.reduce((sum, probe) => sum + probe.starts, 0))).toBe(starts);
  await page.getByRole("button", { name: "Show full critic message" }).click();
  await expect(bubble).toHaveText("Show me a record with something to say.");
  await page.reload();
  await expect(page.getByRole("button", { name: "Unmute critic" })).toBeVisible();
});

test("critic layout reserves drawing space and survives a reload interrupted by a mode change", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const normal = (await page.getByTestId("drawing-canvas").boundingBox())!;
  await page.getByRole("link", { name: "Critic mode", exact: false }).click();
  const critic = page.getByRole("complementary", { name: "Your fictional music critic" });
  await expect(page.getByRole("button", { name: "Change critic", exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator('[data-testid="drawing-canvas"]:visible').boundingBox())!.x).toBeGreaterThan(normal.x + 30);
  const canvas = (await page.locator('[data-testid="drawing-canvas"]:visible').boundingBox())!;
  const panel = (await critic.boundingBox())!;
  expect(panel.x + panel.width).toBeLessThan(canvas.x);
  expect(Math.abs(panel.y + panel.height / 2 - canvas.y - canvas.height / 2)).toBeLessThan(4);
  const centers = await critic.evaluate(element => {
    const center = (node: Element) => { const rect = node.getBoundingClientRect(); return rect.left + rect.width / 2; };
    return [element.querySelector(".critic-portrait canvas"), element.querySelector('[aria-label="Change critic"]'), element.querySelector(".critic-sound"), element.querySelector(".critic-name")].map(node => center(node!));
  });
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(6);
  await expect.poll(() => critic.locator("canvas").count()).toBe(1);
  expect(await critic.locator("svg").evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height <= 44))).toBe(true);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    console.info("Critic viewport", await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth,
      roomHeight: document.querySelector(".critic-mode .drawing-room")?.getBoundingClientRect().height,
      mainPadding: getComputedStyle(document.querySelector(".critic-mode")!).padding,
    })));
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "output/playwright/critic-drawing-desktop.png" });
  await page.getByRole("button", { name: "Change critic", exact: true }).click();
  await page.getByRole("link", { name: "Normal mode", exact: false }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Critic mode", exact: false }).click();
  await expect(page.getByRole("button", { name: "Change critic", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Change critic", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Jax Static" })).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const mobileCanvas = (await page.locator('[data-testid="drawing-canvas"]:visible').boundingBox())!;
    const mobilePanel = (await critic.boundingBox())!;
    expect(mobilePanel.y + mobilePanel.height).toBeLessThanOrEqual(mobileCanvas.y);
    expect(mobileCanvas.width).toBeGreaterThanOrEqual(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Change critic", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Mute critic", exact: true })).toBeInViewport();
    const switchBox = (await page.getByRole("link", { name: "Normal mode", exact: false }).boundingBox())!;
    const goBox = (await page.getByRole("button", { name: "PRESS RECORD", exact: true }).boundingBox())!;
    expect(switchBox.y >= goBox.y + goBox.height || switchBox.x >= goBox.x + goBox.width || switchBox.x + switchBox.width <= goBox.x).toBe(true);
    await page.screenshot({ path: `output/playwright/critic-drawing-mobile-${viewport.width}.png`, fullPage: true });
  }
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`floating GitHub link stays accessible beside both screens and notifications at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await page.route("**/api/drawcover/track", route => route.request().postDataJSON().trackIndex === 0
      ? route.fulfill({ json: { dataUrl: audio, model: "mock" } })
      : route.fulfill({ status: 429, json: { reason: "cooldown", retryAfterSeconds: 900 } }));
    await draw(page);
    const link = page.getByRole("link", { name: "View DrawCover on GitHub (opens in a new tab)" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://github.com/oliverseges/DrawCover");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("title", /GitHub/);
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("position", "fixed");
    const original = (await link.boundingBox())!;
    expect(original.width).toBeGreaterThanOrEqual(44);
    expect(original.x).toBeGreaterThanOrEqual(12);
    expect(original.y + original.height).toBeLessThanOrEqual(viewport.height - 12);
    await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
    await expect(page.getByRole("heading", { name: album.title })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const after = (await link.boundingBox())!;
    expect(after.x).toBe(original.x);
    expect(after.y).toBe(original.y);
    const overlapsFooter = await link.evaluate(element => {
      const a = element.getBoundingClientRect();
      return [...document.querySelectorAll(".album-footer span")].some(span => {
        const b = span.getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      });
    });
    expect(overlapsFooter).toBe(false);
    await page.getByRole("button", { name: "Play track 2: Paper Horizon" }).click();
    const notification = page.locator("[data-sonner-toast]");
    await expect(notification).toBeVisible();
    await expect.poll(async () => {
      const a = (await link.boundingBox())!, b = (await notification.boundingBox())!;
      return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    }).toBe(false);
    await expect(link).toBeVisible();
  });
}

test("drawing becomes eight tracks, autoplays first, and lazily caches another", async ({ page }) => {
  await setup(page);
  const requests: number[] = [];
  await page.route("**/api/drawcover/track", (route) => {
    const body = route.request().postDataJSON();
    expect(body.albumId).toBe(album.id);
    requests.push(body.trackIndex);
    return route.fulfill({ json: { dataUrl: audio, model: "mock" } });
  });
  await draw(page);
  await expect(page.getByText("sun", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await expect(page.getByRole("heading", { name: album.title })).toBeVisible();
  await expect(page.getByRole("button", { name: `Flip album artwork for ${album.title} to back cover` })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tracklist" }).getByRole("listitem")).toHaveCount(8);
  await expect(page.locator(".track-glass canvas")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(1);
  expect(requests).toEqual([0]);
  const second = page.getByRole("button", { name: "Play track 2: Paper Horizon" });
  await second.click();
  await expect(second).toBeEnabled();
  await expect.poll(() => requests.length).toBe(2);
  await page.getByRole("button", { name: "Play track 1: First Light" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(3);
  expect(requests).toEqual([0, 1]);
  await expect(page.locator("main")).toHaveCSS("--album-a", album.palette[0]);
});

test("blocked autoplay retains visible player, track failure is isolated, fallback preserves drawing", async ({ page }) => {
  await setup(page, true);
  await page.route("**/api/drawcover", (route) => route.fulfill({
    json: { ...album, cover: { dataUrl: null, source: "drawing", warning: "Image service unavailable." } },
  }));
  await page.route("**/api/drawcover/track", (route) => route.request().postDataJSON().trackIndex === 1
    ? route.fulfill({ status: 502, json: { message: "Music service unavailable." } })
    : route.fulfill({ json: { dataUrl: audio, model: "mock" } }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await expect(page.getByText("Your track is ready. Press play to listen.")).toBeVisible();
  await expect(page.getByLabel("Album audio player")).toHaveAttribute("controls", "");
  await expect(page.getByText(/AI artwork was unavailable/)).toBeVisible();
  await expect(page.locator(".album-art")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.getByRole("button", { name: "Play track 2: Paper Horizon" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Music service unavailable." })).toBeVisible();
  await expect(page.getByRole("heading", { name: album.title })).toBeVisible();
  await page.getByRole("button", { name: "Play track 3: Solar Flare" }).click();
  await expect(page.getByText("Your track is ready. Press play to listen.")).toBeVisible();
});

test("album failure keeps the drawing and allows a deliberate retry", async ({ page }) => {
  await page.route("**/api/drawcover", (route) => route.fulfill({ status: 502, json: { message: "The studio is unavailable." } }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The studio is unavailable." })).toBeVisible();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "PRESS RECORD", exact: true })).toBeEnabled();
});

test("a server cooldown shows a Sonner break toast with the actual remaining time", async ({ page }) => {
  await page.route("**/api/drawcover", (route) => route.fulfill({
    status: 429, headers: { "Retry-After": "660" },
    json: { reason: "cooldown", retryAfterSeconds: 660, message: "Time for a break." },
  }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  const toast = page.locator("[data-sonner-toast]");
  await expect(toast).toContainText("Time for a break");
  await expect(toast).toContainText("11 minutes");
  await expect(page.locator(".studio-error")).toHaveCount(0);
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
});

test("shared daily exhaustion is not presented as a personal cooldown", async ({ page }) => {
  await setup(page);
  await page.route("**/api/drawcover/track", (route) => route.fulfill({
    status: 429, headers: { "Retry-After": "3600" },
    json: { reason: "daily_limit", retryAfterSeconds: 3600, message: "Today's allowance is used up." },
  }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  const toast = page.locator("[data-sonner-toast]");
  await expect(toast).toContainText("The shared demo allowance is used up");
  await expect(toast).toContainText("not a personal cooldown");
  await expect(page.locator(".track-error")).toHaveCount(0);
});

test("a stalled first-track body recovers and plays without manual Retry or a second POST", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let first = true;
    window.fetch = (...args) => {
      if (String(args[0]).endsWith("/api/drawcover/track") && first) {
        first = false;
        return Promise.resolve(new Response(new ReadableStream(), { status: 200 }));
      }
      return original(...args);
    };
  });
  let requests = 0;
  await page.route("**/api/drawcover/track", route => {
    requests++;
    return route.fulfill({ json: { dataUrl: audio, model: "mock" } });
  });
  let reads = 0;
  await page.route("**/api/drawcover/recording?*", route => {
    reads++;
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { dataUrl: audio, model: "mock" } });
  });
  await draw(page);
  await page.clock.install();
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await expect(page.getByText("MAKING", { exact: true })).toBeVisible();
  await page.clock.fastForward(75_001);
  await expect(page.locator(".track-error")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(1);
  expect(requests).toBe(0);
  expect(reads).toBe(1);
});

for (const scheme of ["light", "dark"] as const) {
  test(`daily-limit toast remains readable and dismissible in ${scheme} system mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.route("**/api/drawcover", route => route.fulfill({
      status: 429, json: { reason: "daily_limit", retryAfterSeconds: 48_480 },
    }));
    await draw(page);
    await page.clock.install();
    await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toContainText("13h 28m");
    const ratios = await toast.evaluate(element => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const rgb = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const luminance = (values: number[]) => values.map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const background = rgb(getComputedStyle(element).backgroundColor);
      return ["[data-title]", "[data-description]"].map(selector => {
        const style = getComputedStyle(element.querySelector(selector)!);
        const alpha = Number(style.opacity);
        const foreground = rgb(style.color).map((value, index) => value * alpha + background[index] * (1 - alpha));
        const a = luminance(background), b = luminance(foreground);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
    });
    expect(ratios[0]).toBeGreaterThanOrEqual(4.5);
    expect(ratios[1], await toast.evaluate(element => JSON.stringify({
      toast: element.className, parent: element.parentElement?.className,
      description: getComputedStyle(element.querySelector("[data-description]")!).color,
      background: getComputedStyle(element).backgroundColor,
      scoped: element.matches(".toaster [data-sonner-toast][data-styled=true]"),
    }))).toBeGreaterThanOrEqual(4.5);
    await page.clock.fastForward(30_000);
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: /close/i }).click();
    await expect(toast).toHaveCount(0);
  });
}

test("physical cover has title and artist, flips by keyboard and keeps playback outside", async ({ page }) => {
  await setup(page);
  const requested: number[] = [];
  await page.route("**/api/drawcover/track", (route) => {
    requested.push(route.request().postDataJSON().trackIndex);
    return route.fulfill({ json: { dataUrl: audio, model: "mock" } });
  });
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await expect(page.locator(".cover-front-title")).toHaveText(album.title);
  await expect(page.locator(".cover-artist")).toHaveText(album.artist);
  await expect(page.locator(".album-jacket")).toHaveAttribute("data-renderer", "three", { timeout: 20_000 });
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.locator(".jacket-front .content-note")).toContainText("NO LYRICS REQUESTED");
  await page.getByRole("button", { name: `Flip album artwork for ${album.title} to back cover` }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: `Flip album artwork for ${album.title} to front cover` })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".back-cover-tracks li")).toHaveCount(8);
  await expect(page.locator(".back-cover-tracks button")).toHaveCount(0);
  await expect(page.locator(".back-cover-imprint")).toContainText("FICTIONAL RELEASE");
  const third = page.getByRole("button", { name: "Play track 3: Solar Flare", exact: true });
  await expect(third).toBeEnabled();
  await third.click();
  await expect.poll(() => requested.includes(2)).toBe(true);
  await page.getByRole("button", { name: `Flip album artwork for ${album.title} to front cover` }).click();
  await expect(page.locator(".album-jacket")).toHaveAttribute("data-flipped", "false");
});

test("reduced motion bypasses GPU effects and flips without 3D motion on mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, true);
  await page.route("**/api/drawcover/track", (route) => route.fulfill({ json: { dataUrl: audio, model: "mock" } }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await expect(page.getByRole("heading", { name: album.title })).toBeVisible();
  await expect(page.locator(".album-embers canvas, .cover-particles canvas, .track-glass canvas, .physical-album-canvas")).toHaveCount(0);
  await page.getByRole("button", { name: `Flip album artwork for ${album.title} to back cover` }).click();
  await expect(page.locator(".jacket-rotator")).toHaveCSS("transform", "none");
  await expect(page.locator(".jacket-back")).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "Play track 8: Until Tomorrow", exact: true })).toBeVisible();
  const backPrint = await page.locator(".jacket-back").boundingBox();
  const imprint = await page.locator(".back-cover-imprint").boundingBox();
  expect(imprint!.y + imprint!.height).toBeLessThanOrEqual(backPrint!.y + backPrint!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByRole("button", { name: `Flip album artwork for ${album.title} to front cover` }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".album-jacket")).toHaveAttribute("data-flipped", "false");
});

test("unavailable WebGL retains static covers and decorative-only back tracklist", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (this: HTMLCanvasElement, type: string, options?: unknown) {
        return type.startsWith("webgl") ? null : Reflect.apply(getContext, this, [type, options]);
      },
    });

  });
  await setup(page, true);
  await page.route("**/api/drawcover/track", (route) => route.fulfill({ json: { dataUrl: audio, model: "mock" } }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  const jacket = page.locator(".album-jacket");
  await expect(jacket).toHaveAttribute("data-renderer", "2d");
  await jacket.click();
  await expect(jacket).toHaveAttribute("data-flipped", "true");
  await expect(page.locator(".jacket-back")).toHaveCSS("opacity", "1");
  await expect(page.locator(".back-cover-tracks li")).toHaveCount(8);
  await expect(page.locator(".back-cover-tracks :is(button,a,input)")).toHaveCount(0);
});

test("album fits desktop and laptop viewport heights without document scrolling", async ({ page }) => {
  await setup(page, true);
  await page.route("**/api/drawcover/track", (route) => route.fulfill({ json: { dataUrl: audio, model: "mock" } }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await expect(page.getByRole("heading", { name: album.title })).toBeVisible();
  const measurements = [];
  for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
    await expect(page.getByLabel("Album audio player")).toBeInViewport();
    await expect(page.locator(".album-jacket")).toBeInViewport();
    await page.getByRole("button", { name: "Play track 8: Until Tomorrow" }).scrollIntoViewIfNeeded();
    const measured = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      overflowWidth: document.documentElement.scrollWidth > window.innerWidth,
      tracks: (() => {
        const list = document.querySelector(".track-glass")!;
        return { scrollHeight: list.scrollHeight, clientHeight: list.clientHeight };
      })(),
    }));
    expect(measured.scrollHeight).toBeLessThanOrEqual(measured.innerHeight);
    expect(measured.overflowWidth).toBe(false);
    if (height >= 900) {
      expect(measured.tracks.scrollHeight).toBe(measured.tracks.clientHeight);
      expect(await page.locator(".track-glass").evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll(".track-button")].every(row => {
          const box = row.getBoundingClientRect();
          return box.top >= bounds.top && box.bottom <= bounds.bottom;
        });
      })).toBe(true);
    }
    measurements.push({ width, ...measured });
  }
  console.log("Album viewport measurements:", JSON.stringify(measurements));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(844);
  await page.getByLabel("Album audio player").scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Album audio player")).toBeInViewport();
});

test("track rows keep scrolling only when a short album layout genuinely needs it", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await setup(page, true);
  const crowded = { ...album, title: "Where the Sun Sleeps Beyond the Last Lighthouse" };
  await page.route("**/api/drawcover", route => route.fulfill({ json: crowded }));
  await page.route("**/api/drawcover/track", route => route.fulfill({ json: { dataUrl: audio, model: "mock" } }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await page.getByRole("heading", { name: crowded.title }).waitFor();
  const metrics = () => page.locator(".track-glass").evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect((await metrics()).scrollHeight).toBeGreaterThan((await metrics()).clientHeight);
  await page.getByRole("button", { name: "Play track 8: Until Tomorrow" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Play track 8: Until Tomorrow" })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await metrics()).scrollHeight).toBe((await metrics()).clientHeight);
});

test("the readable W/C wordmark overlaps subtly and the album gradient respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setup(page, true);
  await page.route("**/api/drawcover/track", route => route.fulfill({ json: { dataUrl: audio, model: "mock" } }));
  await draw(page);
  await page.getByRole("button", { name: "PRESS RECORD", exact: true }).click();
  await page.getByRole("heading", { name: album.title }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".wordmark")).toHaveText("DRAWCOVER");
    const pair = await page.locator(".wordmark-pair").evaluate(element => {
      const w = element.firstElementChild!.getBoundingClientRect();
      const c = element.lastElementChild!.getBoundingClientRect();
      return { overlap: w.right - c.left, cWidth: c.width, cut: getComputedStyle(element.lastElementChild!).clipPath };
    });
    expect(pair.overlap).toBeGreaterThan(0);
    expect(pair.overlap).toBeLessThan(pair.cWidth * .4);
    expect(pair.cut).not.toBe("none");
  }
  const transform = () => page.locator(".album-atmosphere").evaluate(element => getComputedStyle(element, "::before").transform);
  const before = await transform();
  await expect.poll(transform).not.toBe(before);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(transform).toBe("none");
});
