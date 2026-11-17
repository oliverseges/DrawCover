import { expect, test, type Page } from "@playwright/test";

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
  subtitle: "Warm analog loops and golden-hour daydreams.",
  palette: ["#344838", "#b6c798", "#f0bf74"],
  tracks: ["First Light", "Paper Horizon", "Solar Flare", "Golden Hour", "Sunroom", "Long Shadows", "Afterglow", "Until Tomorrow"].map((title) => ({ title })),
  cover: { dataUrl: png, source: "ai" },
  models: { metadata: "mock", image: "mock", music: "mock" },
};

async function draw(page: Page) {
  await page.goto("/");
  const go = page.getByRole("button", { name: "GO", exact: true });
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
  await page.getByRole("button", { name: "GO", exact: true }).click();
  await expect(page.getByRole("heading", { name: album.title })).toBeVisible();
  await expect(page.getByRole("img", { name: `Album artwork for ${album.title}` })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tracklist" }).getByRole("listitem")).toHaveCount(8);
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
  await page.getByRole("button", { name: "GO", exact: true }).click();
  await expect(page.getByText("Your track is ready. Press play to listen.")).toBeVisible();
  await expect(page.getByLabel("Album audio player")).toHaveAttribute("controls", "");
  await expect(page.getByText(/AI artwork was unavailable/)).toBeVisible();
  await expect(page.getByRole("img", { name: `Album artwork for ${album.title}` })).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.getByRole("button", { name: "Play track 2: Paper Horizon" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Music service unavailable." })).toBeVisible();
  await expect(page.getByRole("heading", { name: album.title })).toBeVisible();
  await page.getByRole("button", { name: "Play track 3: Solar Flare" }).click();
  await expect(page.getByText("Your track is ready. Press play to listen.")).toBeVisible();
});

test("album failure keeps the drawing and allows a deliberate retry", async ({ page }) => {
  await page.route("**/api/drawcover", (route) => route.fulfill({ status: 502, json: { message: "The studio is unavailable." } }));
  await draw(page);
  await page.getByRole("button", { name: "GO", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The studio is unavailable." })).toBeVisible();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "GO", exact: true })).toBeEnabled();
});
