import { test, expect, type Page } from "@playwright/test";
import { stubGeneration } from "./generation-stub";
import { isolate } from "./wizard-draft";

/**
 * A planner the visitor's browser is translating still goes from step to step and
 * makes a plan. Translators take each text node off the page and put a <font> in
 * its place, on the page as it is and on whatever is added later; this does the
 * same and keeps the words, so the test can still find what it's looking for.
 */
function translator() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "FONT"]);
  const sweep = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found: Text[] = [];
    while (walker.nextNode()) found.push(walker.currentNode as Text);
    for (const text of found) {
      const parent = text.parentNode;
      if (!parent || SKIP.has(parent.nodeName) || !text.nodeValue?.trim()) continue;
      const outer = document.createElement("font");
      const inner = document.createElement("font");
      inner.textContent = text.nodeValue;
      outer.appendChild(inner);
      parent.replaceChild(outer, text);
    }
  };
  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(sweep, 50);
  }).observe(document.body, { childList: true, subtree: true });
  sweep();
}

async function acceptEssentialOnly(page: Page) {
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
}

test.describe("a page the browser translates", () => {
  test("the planner goes on to the next step and to a plan", async ({ page }) => {
    await isolate(page);
    await stubGeneration(page);

    await page.goto("/trips/new");
    await acceptEssentialOnly(page);
    const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
    const place = (await pick.getAttribute("aria-label"))?.match(/^Start a trip to (.+) — /)?.[1];
    expect(place, "the pick names its place").toBeTruthy();

    await page.evaluate(translator);
    await expect(page.locator("h1 font").first()).toBeAttached();

    await pick.click();
    await expect(page.getByRole("combobox").first()).toHaveValue(place!);
    await page.getByRole("button", { name: /^Continue/ }).click();
    await expect(page.getByRole("heading", { name: "Set your travel style" })).toBeVisible();
    // Words that change with the step change here too, instead of staying in the old translation.
    await expect(page.getByText("2/2")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Continue/ })).toHaveCount(0);

    const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
    const generate = page.getByRole("button", { name: "Generate Itinerary" });
    await expect(async () => {
      if (await generate.isDisabled()) await foodie.click();
      await expect(generate).toBeEnabled({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await generate.click();

    await expect(page.getByRole("heading", { level: 1, name: place })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });
});
