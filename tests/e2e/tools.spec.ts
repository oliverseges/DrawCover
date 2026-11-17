import { expect, test, type Page } from "@playwright/test";

type Rgba = [number, number, number, number];

const px = (page: Page, fx: number, fy: number) =>
  page.evaluate(
    ([fx, fy]) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="drawing-canvas"]')!;
      const d = c.getContext("2d")!.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
      return [d[0], d[1], d[2], d[3]] as Rgba;
    },
    [fx, fy],
  );

async function pt(page: Page, fx: number, fy: number) {
  const b = (await page.getByTestId("drawing-canvas").boundingBox())!;
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

async function drag(page: Page, a: [number, number], b: [number, number], hold?: () => Promise<void>) {
  const p = await pt(page, ...a);
  const q = await pt(page, ...b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(q.x, q.y, { steps: 4 });
  if (hold) await hold();
  await page.mouse.up();
}

async function setSlider(page: Page, name: string, value: number) {
  const thumb = page.getByRole("slider", { name });
  await thumb.focus();
  const cur = Number(await thumb.inputValue());
  await thumb.press(value > cur ? "End" : "Home");
  const ext = Number(await thumb.inputValue());
  const back = ext > value ? "ArrowLeft" : "ArrowRight";
  for (let i = 0, n = Math.abs(ext - value); i < n; i++) await thumb.press(back);
  expect(Number(await thumb.inputValue())).toBe(value);
}

const isDark = (c: Rgba) => c[3] > 200 && c[0] < 60 && c[1] < 60;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
});

test("brush: color, size, opacity", async ({ page }) => {
  await page.getByRole("button", { name: "Choose color" }).click();
  await page.getByRole("button", { name: "Color #ef4444" }).click();
  await page.keyboard.press("Escape");
  await setSlider(page, "Size", 30);
  await setSlider(page, "Opacity", 50);
  await drag(page, [0.2, 0.3], [0.6, 0.3]);
  const c = await px(page, 0.4, 0.3);
  expect(c[0]).toBeGreaterThan(200);
  expect(c[1]).toBeLessThan(90);
  expect(c[3]).toBeGreaterThan(110);
  expect(c[3]).toBeLessThan(145);
  // size 30 on an 800x600 canvas: 12px off-center is painted, 25px off is not
  expect((await px(page, 0.4, 0.3 + 12 / 600))[3]).toBeGreaterThan(0);
  expect((await px(page, 0.4, 0.3 + 25 / 600))[3]).toBe(0);
});

test("eraser, undo, redo, undoable clear", async ({ page }) => {
  await setSlider(page, "Size", 30);
  await drag(page, [0.2, 0.5], [0.8, 0.5]);
  expect(isDark(await px(page, 0.5, 0.5))).toBe(true);
  await page.keyboard.press("e");
  await drag(page, [0.45, 0.5], [0.55, 0.5]);
  expect((await px(page, 0.5, 0.5))[3]).toBe(0);
  await page.keyboard.press("Control+z");
  expect(isDark(await px(page, 0.5, 0.5))).toBe(true);
  await page.keyboard.press("Control+Shift+z");
  expect((await px(page, 0.5, 0.5))[3]).toBe(0);
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Clear" }).click();
  expect((await px(page, 0.3, 0.5))[3]).toBe(0);
  await expect(page.getByRole("button", { name: "What is it?" })).toBeDisabled();
  await page.getByRole("button", { name: /^Undo/ }).click();
  expect(isDark(await px(page, 0.3, 0.5))).toBe(true);
  await expect(page.getByRole("button", { name: "What is it?" })).toBeEnabled();
});

test("line, rectangle, ellipse with live preview and filled toggle", async ({ page }) => {
  await page.keyboard.press("l");
  await drag(page, [0.1, 0.1], [0.4, 0.1]);
  expect(isDark(await px(page, 0.25, 0.1))).toBe(true);

  // live preview: overlay has pixels before pointerup, base does not
  await page.keyboard.press("r");
  await drag(page, [0.1, 0.3], [0.4, 0.6], async () => {
    const overlay = await page.evaluate(() => {
      const c = document.querySelectorAll("canvas")[1];
      const d = c.getContext("2d")!.getImageData(c.width * 0.1, c.height * 0.3 - 4, 8, 8).data;
      return d.some((v, i) => i % 4 === 3 && v > 0);
    });
    expect(overlay).toBe(true);
    expect((await px(page, 0.1, 0.3))[3]).toBe(0);
  });
  expect(isDark(await px(page, 0.1, 0.45))).toBe(true); // outline edge
  expect((await px(page, 0.25, 0.45))[3]).toBe(0); // hollow

  await page.getByRole("switch", { name: "Filled" }).click();
  await drag(page, [0.5, 0.3], [0.8, 0.6]);
  expect(isDark(await px(page, 0.65, 0.45))).toBe(true);

  await page.keyboard.press("o");
  await drag(page, [0.1, 0.7], [0.4, 0.95]);
  expect(isDark(await px(page, 0.25, 0.825))).toBe(true); // filled ellipse
  await page.getByRole("switch", { name: "Filled" }).click();
  await drag(page, [0.5, 0.7], [0.8, 0.95]);
  expect((await px(page, 0.65, 0.825))[3]).toBe(0);
  expect(isDark(await px(page, 0.5, 0.825))).toBe(true);
});

test("bucket fill: stays in closed shape, tolerance, color", async ({ page }) => {
  await page.keyboard.press("r");
  await drag(page, [0.3, 0.3], [0.7, 0.7]);
  await page.keyboard.press("f");
  await page.getByRole("button", { name: "Choose color" }).click();
  await page.getByRole("button", { name: "Color #22c55e" }).click();
  await page.keyboard.press("Escape");
  const p = await pt(page, 0.5, 0.5);
  await page.mouse.click(p.x, p.y);
  const inside = await px(page, 0.5, 0.5);
  expect(inside[1]).toBeGreaterThan(150);
  expect(inside[0]).toBeLessThan(80);
  expect((await px(page, 0.1, 0.1))[3]).toBe(0); // outside untouched
  await expect(page.getByRole("slider", { name: "Fill tolerance" })).toBeVisible();
  await setSlider(page, "Fill tolerance", 0);
  await setSlider(page, "Fill tolerance", 128);
});

test("keyboard shortcuts select tools", async ({ page }) => {
  for (const [k, id] of [["e", "eraser"], ["l", "line"], ["r", "rect"], ["o", "ellipse"], ["f", "fill"], ["b", "brush"]]) {
    await page.keyboard.press(k);
    await expect(page.getByTestId(`tool-${id}`)).toHaveAttribute("aria-pressed", "true");
  }
});

test("undo works for at least 30 steps", async ({ page }) => {
  await setSlider(page, "Size", 4);
  for (let i = 0; i < 32; i++) await drag(page, [0.1, 0.02 + i * 0.03], [0.3, 0.02 + i * 0.03]);
  for (let i = 0; i < 30; i++) await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeDisabled();
});

test("PNG download", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeDisabled();
  await drag(page, [0.2, 0.5], [0.8, 0.5]);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe("drawing.png");
  const path = await dl.path();
  const buf = (await import("node:fs")).readFileSync(path!);
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
});

test("tooltips show shortcuts and controls are keyboard reachable", async ({ page }) => {
  await page.getByTestId("tool-eraser").hover();
  await expect(page.getByText("Eraser (E)")).toBeVisible();
  await page.getByTestId("tool-brush").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Choose color" })).toBeFocused();
});

test("touch input draws", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const a = await pt(page, 0.2, 0.5);
  const b = await pt(page, 0.8, 0.5);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", a.x, a.y);
  for (let i = 1; i <= 10; i++) await touch("touchMove", a.x + ((b.x - a.x) * i) / 10, a.y);
  await touch("touchEnd", b.x, b.y);
  expect(isDark(await px(page, 0.5, 0.5))).toBe(true);
});

test("pen input draws", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const a = await pt(page, 0.2, 0.5);
  const b = await pt(page, 0.8, 0.5);
  const ev = (type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number, buttons: number) =>
    cdp.send("Input.dispatchMouseEvent", {
      type, x, y, button: "left", buttons, pointerType: "pen", clickCount: 1, force: 0.5,
    });
  await ev("mouseMoved", a.x, a.y, 0);
  await ev("mousePressed", a.x, a.y, 1);
  for (let i = 1; i <= 10; i++) await ev("mouseMoved", a.x + ((b.x - a.x) * i) / 10, a.y, 1);
  await ev("mouseReleased", b.x, b.y, 0);
  expect(isDark(await px(page, 0.5, 0.5))).toBe(true);
});
