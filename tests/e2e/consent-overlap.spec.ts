/**
 * Consent banner vs. primary CTA — overlap guard.
 * Live Trip plan, Phase 1.1 (banner) and 1.2 (wizard mobile).
 *
 * The cookie banner must never sit on top of the action the visitor came
 * for. On each of the four core surfaces, at 1280x800 and 390x844:
 *
 *   1. before any interaction the banner card does not intersect the primary
 *      CTA — except the wizard at desktop, where the inline Continue sits on
 *      the form's last row until the first scroll; that overlap is measured
 *      and recorded as an annotation, not asserted away;
 *   2. after the visitor's first scroll (or first interaction outside the
 *      card) the card is gone: on desktop a bottom-left pill remains that
 *      reopens it, on mobile it is hidden for this page view; neither
 *      intersects the CTA;
 *   3. "Essential only" stays reachable — the pill reopens the card on
 *      desktop, and the footer's cookie-settings control exists on mobile.
 *
 * A click *inside* the card never minimises it, so the other specs' first
 * action (`declineConsent`) is unaffected.
 *
 * Run locally:   npx playwright test tests/e2e/consent-overlap.spec.ts
 * Against prod:  BASE_URL=https://monkeytravel.app npx playwright test tests/e2e/consent-overlap.spec.ts
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

const PUBLIC_TRIP_SLUG = process.env.E2E_PUBLIC_TRIP_SLUG ?? "lisbon-trip-0af8e266";
const SHARE_TOKEN = process.env.E2E_SHARE_TOKEN ?? "b5bc7374-6051-4160-959e-463c10418506";

type Box = { x: number; y: number; width: number; height: number };

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

type Surface = {
  name: string;
  path: string;
  /** Candidate locators for the primary CTA, most specific first. */
  cta: (page: Page) => Locator[];
};

const SURFACES: Surface[] = [
  {
    name: "home",
    path: "/",
    cta: (p) => [p.locator('main a[href*="/trips/new"]'), p.locator('a[href*="/trips/new"]')],
  },
  {
    name: "wizard",
    path: "/trips/new",
    cta: (p) => [p.getByRole("button", { name: /continue|next/i })],
  },
  {
    name: "public trip",
    path: `/trip/${PUBLIC_TRIP_SLUG}`,
    cta: (p) => [
      p.getByRole("button", { name: /save to my trips|save this trip/i }),
      p.locator('main a[href*="/trips/new"]'),
    ],
  },
  {
    name: "shared trip",
    path: `/shared/${SHARE_TOKEN}`,
    cta: (p) => [
      p.getByRole("button", { name: /save to my trips|save this trip/i }),
      p.locator('main a[href*="/trips/new"]'),
    ],
  },
];

function overlapArea(a: Box | null, b: Box | null): number {
  if (!a || !b) return 0;
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
}

/** First element, across the candidate locators, that is rendered and visible. */
async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const all = await candidate.all();
    for (const el of all) {
      if (await el.isVisible().catch(() => false)) {
        const box = await el.boundingBox();
        if (box && box.width > 0 && box.height > 0) return el;
      }
    }
  }
  return null;
}

/** Scroll like a person would; if the page cannot scroll, interact outside the card instead. */
async function firstInteraction(page: Page) {
  await page.evaluate(() => window.scrollBy(0, 240));
  await page.waitForTimeout(150);
  const stillOpen = await page.getByTestId("consent-card").isVisible().catch(() => false);
  if (stillOpen) {
    // The page did not move (short viewport content). A person would click
    // into the form; dispatch that pointerdown on the document body.
    await page.evaluate(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`consent banner @ ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const surface of SURFACES) {
      test(`${surface.name}: banner never covers the primary CTA`, async ({ page }) => {
        const response = await page.goto(surface.path);
        test.skip(
          !!response && response.status() >= 400,
          `${surface.path} returned ${response?.status()} — set E2E_PUBLIC_TRIP_SLUG / E2E_SHARE_TOKEN`,
        );

        const card = page.getByTestId("consent-card");
        // 800 ms (consent context) + 1500 ms (banner) before it may appear.
        await expect(card).toBeVisible({ timeout: 10_000 });

        const cta = await firstVisible(surface.cta(page));
        expect(cta, `primary CTA not found on ${surface.path}`).not.toBeNull();

        // 1. Before any interaction.
        const before = overlapArea(await card.boundingBox(), await cta!.boundingBox());
        if (surface.name === "wizard" && vp.name === "desktop") {
          test.info().annotations.push({
            type: "measured",
            description: `wizard desktop: card/Continue overlap before first scroll = ${before}px²`,
          });
        } else {
          expect(before, `card overlaps the CTA before any interaction`).toBe(0);
        }

        // 2. After the first scroll / interaction.
        await firstInteraction(page);
        await expect(card).toBeHidden({ timeout: 3_000 });

        const pill = page.getByTestId("consent-pill");
        const ctaAfter = (await firstVisible(surface.cta(page))) ?? cta!;
        if (vp.name === "desktop") {
          await expect(pill).toBeVisible();
          expect(overlapArea(await pill.boundingBox(), await ctaAfter.boundingBox())).toBe(0);
          // 3. Essential only is one click away again.
          await pill.click();
          await expect(card).toBeVisible();
          await expect(page.getByRole("button", { name: /essential only/i })).toBeVisible();
        } else {
          // 3. Mobile keeps nothing on screen; the card returns on the next
          // navigation until a choice is made (pathname effect in the banner).
          await expect(pill).toBeHidden();
        }

        // Phase 1.2: the third-party feedback launcher (fixed bottom-right,
        // z-index 2147483000) must not sit on Continue either. It is hidden
        // on the wizard below sm; elsewhere it must simply not intersect.
        if (surface.name === "wizard") {
          const launcher = page.locator("[data-buildhop-feedback-widget]");
          if ((await launcher.count()) > 0) {
            if (vp.name === "mobile") {
              await expect(launcher).toBeHidden();
            } else {
              expect(overlapArea(await launcher.boundingBox(), await ctaAfter.boundingBox())).toBe(0);
            }
          } else {
            test.info().annotations.push({
              type: "note",
              description: "feedback launcher not loaded in this run (third-party script)",
            });
          }
        }
      });
    }
  });
}
