import { expect, test, type Page } from "@playwright/test";

const SIZES = [
  { name: "mobile", width: 375, height: 740 },
  { name: "tablet", width: 820, height: 1100 },
  { name: "wide", width: 1600, height: 900 },
];

async function drawDot(page: Page) {
  const box = (await page.getByTestId("drawing-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 6 });
  await page.mouse.up();
}

const bitmap = (page: Page) =>
  page.getByTestId("drawing-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL());

for (const s of SIZES) {
  test(`layout at ${s.name} has no horizontal overflow and a usable canvas`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = (await page.getByTestId("drawing-canvas").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(s.width);
    expect(box.width).toBeGreaterThan(s.width * 0.5);
    expect(Math.abs(box.width / box.height - 4 / 3)).toBeLessThan(0.02);
    if (s.name === "wide") {
      expect(box.width).toBeGreaterThan(900);
      expect(box.y + box.height).toBeLessThanOrEqual(s.height);
    }
  });
}

test("resizing keeps the drawing and the canvas stays drawable", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await drawDot(page);
  const before = await bitmap(page);
  for (const s of [SIZES[0], SIZES[2], SIZES[1]]) {
    await page.setViewportSize({ width: s.width, height: s.height });
    expect(await bitmap(page)).toBe(before);
  }
  await drawDot(page);
  expect(await bitmap(page)).not.toBe(before);
});
