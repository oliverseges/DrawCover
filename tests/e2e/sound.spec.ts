import { expect, test, type Page } from "@playwright/test";

const REC = {
  url: "https://upload.wikimedia.org/wikipedia/commons/6/62/Meow.ogg",
  title: "Meow.ogg",
  credit: "Some Person",
  license: "CC BY-SA 3.0",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Meow.ogg",
};

async function drawDot(page: Page) {
  const box = (await page.getByTestId("drawing-canvas").boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 8 });
  await page.mouse.up();
}

// Records play/pause calls and Web Audio starts so tests can assert audible playback.
async function instrument(page: Page, playMode: "ok" | "blocked" | "fail") {
  await page.addInitScript((mode) => {
    const w = window as unknown as { __audio: string[] };
    w.__audio = [];
    HTMLMediaElement.prototype.play = function () {
      w.__audio.push("media-play:" + (this as HTMLMediaElement).src);
      if (mode === "blocked") return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      if (mode === "fail") return Promise.reject(new DOMException("bad", "NotSupportedError"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      w.__audio.push("media-pause");
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) {
      w.__audio.push("synth-osc");
      return start.apply(this, a);
    };
  }, playMode);
}

let generateCalls = 0;
test.beforeEach(() => {
  generateCalls = 0;
});

const GEN = { phrase: "cat meow", dataUrl: "data:audio/mpeg;base64,SUQzBAAAAAAA", model: "google/lyria-3-clip-preview" };

// Generation is unavailable unless a clip is given, so recording/synth tests stay deterministic.
async function mockApis(page: Page, recording: unknown, generated: unknown = null, aiEnabled = true) {
  await page.route("**/api/recognize", (route) =>
    route.fulfill({
      json: {
        label: "cat",
        confidence: 0.9,
        description: "A cat.",
        alternatives: [],
        sound: { phrase: "cat meow", preset: "meow" },
      },
    }),
  );
  await page.route("**/api/sound**", (route) => route.fulfill({ json: { phrase: "cat meow", recording } }));
  await page.route("**/api/sound/config", (route) => route.fulfill({ json: { aiEnabled } }));
  await page.route("**/api/sound/generate**", (route) => {
    generateCalls++;
    return generated
      ? route.fulfill({ json: generated })
      : route.fulfill({ status: 401, json: { error: "upstream_error", message: "AI sound generation failed (HTTP 401) (the API key is invalid or expired)." } });
  });
}

const log = (page: Page) => page.evaluate(() => (window as unknown as { __audio: string[] }).__audio);
async function recognize(page: Page) {
  await page.goto("/drawsound");
  await page.waitForLoadState("networkidle");
  await drawDot(page);
  await page.getByRole("button", { name: "What is it?" }).click();
}

test("plays a real recording with credit, then stop and replay", async ({ page }) => {
  await instrument(page, "ok");
  await mockApis(page, REC);
  await recognize(page);
  await expect(page.getByTestId("sound-status")).toHaveText("Playing");
  await expect(page.getByTestId("sound-source")).toContainText("Real recording");
  await expect(page.getByTestId("sound-source")).toContainText("Some Person");
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute("href", REC.pageUrl);
  expect(await log(page)).toContain("media-play:" + REC.url);

  await page.getByRole("button", { name: "Stop sound" }).click();
  await expect(page.getByTestId("sound-status")).toHaveText("Stopped");
  await page.getByRole("button", { name: "Replay sound" }).click();
  await expect(page.getByTestId("sound-status")).toHaveText("Playing");
  expect((await log(page)).filter((l) => l.startsWith("media-play")).length).toBe(2);
});

test("offers Play when autoplay is blocked", async ({ page }) => {
  await instrument(page, "blocked");
  await mockApis(page, REC);
  await recognize(page);
  await expect(page.getByTestId("sound-status")).toContainText("blocked");
  await expect(page.getByRole("button", { name: "Play sound" })).toBeEnabled();
});

test("synthesizes with a clear label when no recording exists", async ({ page }) => {
  await instrument(page, "ok");
  await mockApis(page, null);
  await recognize(page);
  await expect(page.getByTestId("sound-source")).toContainText("not a real recording");
  await expect(page.getByTestId("result-label")).toHaveText("cat");
  await expect.poll(() => log(page)).toContain("synth-osc");
});

test("falls back to synthesis when the recording fails, and clear stops audio", async ({ page }) => {
  await instrument(page, "fail");
  await mockApis(page, REC);
  await recognize(page);
  await expect(page.getByTestId("sound-source")).toContainText("not a real recording");
  await expect(page.getByTestId("sound-source")).toContainText("could not be played");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Clear/ }).click();
  await expect(page.getByTestId("sound-status")).toHaveText("Stopped");
});

test("default recognition plays the recording and never calls AI", async ({ page }) => {
  await instrument(page, "ok");
  await mockApis(page, REC, GEN);
  await recognize(page);
  await expect(page.getByTestId("sound-source")).toContainText("Real recording");
  await page.getByRole("button", { name: "Stop sound" }).click();
  await page.getByRole("button", { name: "Replay sound" }).click();
  await page.getByRole("button", { name: "Synth" }).click();
  await expect(page.getByTestId("sound-source")).toContainText("not a real recording");
  expect(generateCalls).toBe(0);
});

test("only an explicit click generates with AI, and replay reuses the clip", async ({ page }) => {
  await instrument(page, "ok");
  await mockApis(page, REC, GEN);
  await recognize(page);
  await expect(page.getByTestId("generate-ai")).toBeEnabled();
  await page.getByTestId("generate-ai").click();
  await expect(page.getByTestId("sound-source")).toContainText("AI-generated audio");
  await expect(page.getByTestId("sound-source")).toContainText("google/lyria-3-clip-preview");
  expect(await log(page)).toContain("media-play:" + GEN.dataUrl);
  expect(generateCalls).toBe(1);
  await page.getByRole("button", { name: "Stop sound" }).click();
  await page.getByRole("button", { name: "Replay sound" }).click();
  await expect(page.getByTestId("sound-status")).toHaveText("Playing");
  expect(generateCalls).toBe(1);
  // A new recognition goes back to the free sources without calling AI.
  await page.getByRole("button", { name: "What is it?" }).click();
  await expect(page.getByTestId("sound-source")).toContainText("Real recording");
  expect(generateCalls).toBe(1);
});

test("AI button is disabled with a setup hint when no key is configured", async ({ page }) => {
  await instrument(page, "ok");
  await mockApis(page, REC, GEN, false);
  await recognize(page);
  await expect(page.getByTestId("generate-ai")).toBeDisabled();
  await expect(page.getByTestId("ai-setup-hint")).toContainText("OPENROUTER_API_KEY");
  expect(generateCalls).toBe(0);
});

test("an expired key shows an error and keeps free sources playing", async ({ page }) => {
  await instrument(page, "ok");
  await mockApis(page, REC);
  await recognize(page);
  await page.getByTestId("generate-ai").click();
  await expect(page.getByTestId("sound-note")).toContainText("invalid or expired");
  await expect(page.getByTestId("sound-source")).toContainText("Real recording");
});