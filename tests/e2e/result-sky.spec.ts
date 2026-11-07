import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";
import { isolate } from "./wizard-draft";

/**
 * The plan as a sky, which a link turns on: each day in the light its stops
 * will really have, from the true sunset for that place and date. The plan is
 * the restored Paris draft, so no model is called and nothing is written.
 */

async function restore(page: Page, variant: string) {
  await page.addInitScript((value) => {
    if (sessionStorage.getItem("e2e-draft-seeded")) return;
    localStorage.setItem("monkeytravel-itinerary-draft", JSON.stringify({ ...value, savedAt: Date.now() }));
    sessionStorage.setItem("e2e-draft-seeded", "1");
  }, draft);
  await page.goto(`/trips/new?result_variant=${variant}`);
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
  await page.getByRole("button", { name: "Restore Trip" }).click({ timeout: 30_000 });
}

/**
 * The lowest contrast of any line of words on the sky, against what is drawn
 * right behind it: the gradient as the page drew it, under any background of the
 * words' own (the day pills, over a saturated backdrop), with the words' opacity.
 * Lines clipped out of view and words over a photo are left out. Runs in the page.
 */
function worstLine(): number {
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const parse = (css: string) => {
    const parts = (/rgba?\(([^)]+)\)/.exec(css)?.[1] ?? "0 0 0 / 0").split(/[\s,/]+/).filter(Boolean).map(Number);
    return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 };
  };
  const over = (top: number[], alpha: number, under: number[]) => top.map((v, k) => v * alpha + under[k] * (1 - alpha));
  const saturate = ([r, g, b]: number[], s: number) =>
    [
      (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
      (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
      (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
    ].map((v) => Math.min(255, Math.max(0, v)));

  const root = document.querySelector<HTMLElement>("[data-testid=sky-plan]")!;
  const stops = [...getComputedStyle(root.firstElementChild!).backgroundImage.matchAll(/rgb\(([^)]+)\)\s+(-?[\d.]+)px/g)].map((m) => ({
    rgb: m[1].split(/[\s,]+/).map(Number),
    y: Number(m[2]),
  }));
  const skyAt = (y: number) => {
    const i = stops.findIndex((stop) => stop.y >= y);
    if (i <= 0) return stops[i === 0 ? 0 : stops.length - 1].rgb;
    const [a, b] = [stops[i - 1], stops[i]];
    return over(b.rgb, b.y === a.y ? 1 : (y - a.y) / (b.y - a.y), a.rgb);
  };
  const top = root.getBoundingClientRect().top;
  const photos = [...root.querySelectorAll("img")].map((img) => img.getBoundingClientRect());

  let worst = Infinity;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    const element = text.parentElement!;
    if (!text.textContent?.trim()) continue;
    const ancestors: HTMLElement[] = [];
    for (let e: HTMLElement | null = element; e && e !== root; e = e.parentElement) ancestors.unshift(e);
    const style = getComputedStyle(element);
    const ink = parse(style.color);
    const opacity = ancestors.reduce((product, e) => product * Number(getComputedStyle(e).opacity), ink.alpha);
    const clips = ancestors.filter((e) => getComputedStyle(e).overflow !== "visible").map((e) => e.getBoundingClientRect());
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const line of range.getClientRects()) {
      const middle = (line.top + line.bottom) / 2;
      if (!line.width || clips.some((box) => middle < box.top || middle > box.bottom)) continue;
      if (photos.some((p) => line.left < p.right && line.right > p.left && line.top < p.bottom && line.bottom > p.top)) continue;
      for (const y of [line.top + 1, middle, line.bottom - 1]) {
        let behind = skyAt(y - top);
        for (const e of ancestors) {
          const css = getComputedStyle(e);
          const backdrop = /saturate\(([\d.]+)\)/.exec(css.backdropFilter);
          if (backdrop) behind = saturate(behind, Number(backdrop[1]));
          const background = parse(css.backgroundColor);
          if (background.alpha > 0) behind = over(background.rgb, background.alpha, behind);
        }
        worst = Math.min(worst, contrast(over(ink.rgb, opacity, behind), behind));
      }
    }
  }
  return worst;
}

test.describe("the plan as a sky", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
  });

  test("shows every stop in its real light, opens one, and still saves", async ({ page }) => {
    await restore(page, "sky");
    const sky = page.getByTestId("sky-plan");
    await expect(sky).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Paris" })).toBeVisible();
    for (const day of draft.generatedItinerary.days) {
      for (const activity of day.activities) {
        await expect(sky.getByRole("heading", { level: 3, name: activity.name, exact: true })).toBeAttached();
      }
    }
    // The sun goes down in Paris on 10 May 2027 at 21:17, worked out from the date and the place.
    await expect(sky.getByText(/^The sun sets at 21:1\d$/).first()).toBeVisible();

    const stop = sky.locator('[data-activity-name="Eiffel Tower at Sunset"]');
    await stop.getByRole("button", { expanded: false }).click();
    await expect(stop.getByText("Book summit tickets online 60 days in advance")).toBeVisible();
    await expect(stop.getByRole("button", { name: "Maps" })).toBeVisible();

    // The classic plan isn't drawn underneath it.
    await expect(page.getByRole("heading", { name: "Day by day" })).toHaveCount(0);

    await page.getByRole("button", { name: /Save Trip/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("every line on the sky reads at 4.5 to 1 against what is drawn behind it", async ({ page }) => {
    await restore(page, "sky");
    await expect(page.getByTestId("sky-plan")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(worstLine), { timeout: 10_000 }).toBeGreaterThanOrEqual(4.5);
  });

  test("a link to the classic plan turns it off", async ({ page }) => {
    await restore(page, "classic");
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("sky-plan")).toHaveCount(0);
  });
});
