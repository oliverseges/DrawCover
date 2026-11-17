import { expect, test, type Page } from "@playwright/test";

async function drawCircle(page: Page) {
  const box = (await page.getByTestId("drawing-canvas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 80, cy);
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    await page.mouse.move(cx + 80 * Math.cos(a), cy + 80 * Math.sin(a));
  }
  await page.mouse.up();
}

test("draws, recognizes and shows the result", async ({ page }) => {
  await page.route("**/api/recognize", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    await route.fulfill({
      json: { label: "sun", confidence: 0.82, description: "A round sun.", alternatives: ["ball"] },
    });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "What is it?" });
  await expect(button).toBeDisabled();
  await drawCircle(page);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByTestId("result-label")).toHaveText("sun");
  await expect(page.getByText("82%")).toBeVisible();
  await expect(page.getByText("ball")).toBeVisible();
});

test("shows the missing-key message", async ({ page }) => {
  await page.route("**/api/recognize", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "missing_api_key", message: "The Gemini API key isn't configured." },
    }),
  );
  await page.goto("/");
  await drawCircle(page);
  await page.getByRole("button", { name: "What is it?" }).click();
  await expect(page.getByTestId("result-error")).toContainText("API key isn't configured");
});

test("undo, redo shortcuts and tool shortcuts", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("e");
  await expect(page.getByTestId("tool-eraser")).toHaveAttribute("aria-pressed", "true");
  await drawCircle(page);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /^Redo/ })).toBeEnabled();
  await page.keyboard.press("Control+y");
  await expect(page.getByRole("button", { name: /^Redo/ })).toBeDisabled();
});
