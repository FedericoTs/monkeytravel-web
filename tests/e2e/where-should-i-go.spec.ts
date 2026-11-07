import { test, expect, type Page } from "@playwright/test";
import { translator } from "./browser-translator";
import { isolate } from "./wizard-draft";

/**
 * "Where should I go?": six taps to a place, a plan with the answers already in,
 * and a friend's way back in. Nothing is stored and nothing is written: the
 * answers are the address.
 */

const OLD_STREETS_WITH_FRIENDS = ["Getting lost in old streets", "A long dinner and a good bottle", "March to May", "Comfortable", "Friends", "Anywhere"];

async function answer(page: Page, labels: readonly string[]) {
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

test.describe("the match", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
  });

  test("six taps give a place, and its plan opens with the answers already in", async ({ page }) => {
    await page.goto("/where-should-i-go");
    await page.getByRole("button", { name: "Find my place" }).click();
    await answer(page, OLD_STREETS_WITH_FRIENDS);

    // The address is the answers, without the mark of a new result once it's been read.
    await expect(page).toHaveURL(/\/where-should-i-go\/100122[eamfox]$/);

    const place = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
    expect(place).not.toBe("");
    await expect(page.getByText(/^\d+%$/)).toBeVisible();
    await page.getByRole("link", { name: `Plan ${place} in 30 seconds` }).click();

    await expect(page).toHaveURL(/\/trips\/new\?destination=[^&]+.*from=match.*who=group/);
    await expect(page.getByPlaceholder(/Paris/).first()).toHaveValue(new RegExp(place));
    await expect(page.getByRole("button", { name: /With friends/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("back goes to the question before, and the new answer is the one that counts", async ({ page }) => {
    await page.goto("/where-should-i-go");
    await page.getByRole("button", { name: "Find my place" }).click();
    await page.getByRole("button", { name: "Swimming before breakfast", exact: true }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Swimming before breakfast", exact: true })).toHaveAttribute("aria-pressed", "true");

    await answer(page, ["Already on a trail", "Early night, early start", "Not sure yet", "Tight: I'd rather stay longer", "Just me", "Anywhere"]);
    await expect(page).toHaveURL(/\/where-should-i-go\/334002[eamfox]$/);
  });

  test("whoever got the result keeps it on reload, with a way to share it", async ({ page }) => {
    await page.goto("/where-should-i-go");
    await page.getByRole("button", { name: "Find my place" }).click();
    await answer(page, OLD_STREETS_WITH_FRIENDS);
    await expect(page.getByRole("button", { name: "Share my result" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Share my result" })).toBeVisible();
    await expect(page.getByText("This is a friend's place. What's yours?")).toHaveCount(0);
  });

  test("a friend's link asks for theirs, then shows where they'd go together", async ({ page }) => {
    await page.goto("/where-should-i-go/100122x");
    await expect(page.getByText("This is a friend's place. What's yours?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Share my result" })).toHaveCount(0);

    await page.getByRole("link", { name: "Find my place" }).click();
    await expect(page).toHaveURL(/\/where-should-i-go\?with=100122x$/);
    await expect(page.getByText("A friend already found theirs.", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Find my place" }).click();
    await answer(page, ["Swimming before breakfast", "Dancing until it gets light", "June to August", "Tight: I'd rather stay longer", "Friends", "Far: the long flight is part of it"]);

    await expect(page).toHaveURL(/\/where-should-i-go\/011021[eamfox]\?with=100122x$/);
    await expect(page.getByText("Who's in")).toBeVisible();
    await expect(page.getByText("Person 2")).toBeVisible();

    const place = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
    const plan = page.getByRole("link", { name: `Plan ${place} together` });
    await expect(plan).toHaveAttribute("href", /who=group/);
    await expect(page.getByRole("button", { name: "Share with the group" })).toBeVisible();
  });

  test("only real answers open a result", async ({ page }) => {
    const refused = await page.goto("/where-should-i-go/999999e");
    expect(refused?.status()).toBe(404);

    // Nonsense beside a real code is ignored, and so is someone's own code twice over.
    const opened = await page.goto(`/where-should-i-go/100122x?with=${encodeURIComponent("<script>,100122x,999999e")}`);
    expect(opened?.status()).toBe(200);
    await expect(page.getByText("Who's in")).toHaveCount(0);
  });

  test("a browser translating the page still reaches the result, and the words keep up", async ({ page }) => {
    await page.goto("/where-should-i-go");
    await page.evaluate(translator);
    await expect(page.locator("h1 font").first()).toBeAttached();

    await page.getByRole("button", { name: "Find my place" }).click();
    await expect(page.getByText("Question 1 of 6")).toBeVisible();
    await answer(page, OLD_STREETS_WITH_FRIENDS.slice(0, 1));
    await expect(page.getByText("Question 2 of 6")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Question 1 of 6")).toBeVisible();
    await answer(page, OLD_STREETS_WITH_FRIENDS);
    await expect(page).toHaveURL(/\/where-should-i-go\/100122[eamfox]$/);

    await page.getByRole("button", { name: "Share my result" }).click();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
    });
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  });

  test("it speaks the page's language", async ({ page }) => {
    await page.goto("/es/where-should-i-go");
    await expect(page.getByRole("heading", { name: "¿A dónde deberías ir?" })).toBeVisible();
    await page.getByRole("button", { name: "Encontrar mi lugar" }).click();
    await expect(page.getByRole("button", { name: "Nadar antes de desayunar" })).toBeVisible();
  });
});

test.describe("on a phone, before any cookie choice", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the cookie bar never sits on an answer", async ({ page }) => {
    await isolate(page);
    await page.goto("/where-should-i-go");
    await page.getByTestId("consent-mini").waitFor();
    await page.getByRole("button", { name: "Find my place" }).click();

    const bar = page.getByTestId("consent-mini");
    for (const label of OLD_STREETS_WITH_FRIENDS) {
      const option = page.getByRole("button", { name: label, exact: true });
      await option.waitFor();
      await page.waitForTimeout(450); // The question's rise, so the positions are final.
      const answers = await page.getByRole("group").getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().bottom));
      const barBox = await bar.boundingBox();
      expect(barBox).not.toBeNull();
      expect(Math.max(...answers)).toBeLessThanOrEqual(barBox!.y);

      // A raw tap at that spot, as a thumb would: a click that scrolled first would hide an overlap.
      const box = await option.boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    }
    await expect(page).toHaveURL(/\/where-should-i-go\/100122[eamfox]/);
  });
});

test.describe("the ways in", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
  });

  test("an article for people choosing where to go offers it, and a guide to one city doesn't", async ({ page }) => {
    await page.goto("/blog/where-to-go-in-january");
    const invite = page.getByRole("link", { name: /^Not sure where to go yet\?/ });
    await expect(invite).toBeVisible();
    await invite.click();
    await expect(page).toHaveURL(/\/where-should-i-go$/);

    await page.goto("/blog/bangkok-5-day-itinerary");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Not sure where to go yet\?/ })).toHaveCount(0);
  });

  test("the destinations page offers it, in the page's language", async ({ page }) => {
    await page.goto("/it/destinations");
    await page.getByRole("link", { name: /^Non sai quale scegliere\?/ }).click();
    await expect(page).toHaveURL(/\/it\/where-should-i-go$/);
  });
});

test.describe("the card", () => {
  test("a result is a picture small enough for a link preview, in each size", async ({ request }) => {
    const link = await request.get("/api/og/match?c=100122x&locale=en");
    expect(link.status()).toBe(200);
    expect(link.headers()["content-type"]).toBe("image/jpeg");
    expect((await link.body()).byteLength).toBeLessThan(300_000);

    const story = await request.get("/api/og/match?c=100122x&locale=it&format=story");
    expect(story.status()).toBe(200);
    expect(story.headers()["content-type"]).toBe("image/jpeg");
  });

  test("anything but a real code draws the invitation, never the text it was given", async ({ request }) => {
    const invite = await request.get("/api/og/match?locale=en");
    const forged = await request.get(`/api/og/match?locale=en&c=${encodeURIComponent("Free iPhone at evil.example")}`);
    expect(forged.status()).toBe(200);
    expect((await forged.body()).equals(await invite.body())).toBe(true);
  });
});
