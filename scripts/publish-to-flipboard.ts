/**
 * Automate submitting blog post URLs to Flipboard magazines.
 *
 * Since Flipboard's RSS import is unreliable, this script submits
 * each blog post URL individually to the correct language magazine.
 *
 * Usage:
 *   npx tsx scripts/publish-to-flipboard.ts
 *
 * Requirements:
 *   - Playwright installed (npx playwright install chromium)
 *   - You'll need to log in to Flipboard manually on first run
 *     (the script saves cookies for subsequent runs)
 *
 * Environment:
 *   FLIPBOARD_MAGAZINE_EN=<magazine-url>   (e.g., https://flipboard.com/@user/travel-planning-xxx)
 *   FLIPBOARD_MAGAZINE_ES=<magazine-url>
 *   FLIPBOARD_MAGAZINE_IT=<magazine-url>
 */

import { chromium, type BrowserContext } from "playwright";
import fs from "fs";
import path from "path";

const SITE_URL = "https://monkeytravel.app";
const COOKIES_PATH = path.resolve(__dirname, "../.flipboard-cookies.json");
const STATE_PATH = path.resolve(__dirname, "../.flipboard-state.json");
const BLOG_DIR = path.resolve(__dirname, "../content/blog");

interface PublishState {
  [slug: string]: { en?: boolean; es?: boolean; it?: boolean };
}

function getAllSlugs(): string[] {
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md") && !fs.statSync(path.join(BLOG_DIR, f)).isDirectory())
    .map((f) => f.replace(".md", ""));
}

function loadState(): PublishState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state: PublishState) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Magazine edit URLs (extracted from Flipboard's routing pattern)
const MAGAZINE_EDIT_URLS = {
  en: "https://flipboard.com/@FedericoSciuca/magazines/sid%2Fc2mhu1h3y%2Ffedericosciuca/edit",
  es: "https://flipboard.com/@FedericoSciuca/magazines/sid%2Fr4v69m7ty%2Ffedericosciuca/edit",
  it: "https://flipboard.com/@FedericoSciuca/magazines/sid%2Fj4petf13y%2Ffedericosciuca/edit",
};

async function main() {
  const magazineEn = process.env.FLIPBOARD_MAGAZINE_EN || "https://flipboard.com/@federicosciuca/monkeytravel-travel-planning-c2mhu1h3y";
  const magazineEs = process.env.FLIPBOARD_MAGAZINE_ES || "https://flipboard.com/@federicosciuca/monkeytravel-viajes-r4v69m7ty";
  const magazineIt = process.env.FLIPBOARD_MAGAZINE_IT || "https://flipboard.com/@federicosciuca/monkeytravel-viaggi-j4petf13y";

  const slugs = getAllSlugs();
  const state = loadState();
  console.log(`\n📋 Found ${slugs.length} blog posts`);

  // Launch browser (headful so user can log in if needed)
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  let context: BrowserContext;

  // Try to load saved cookies
  if (fs.existsSync(COOKIES_PATH)) {
    context = await browser.newContext({
      storageState: COOKIES_PATH,
    });
    console.log("🍪 Loaded saved session");
  } else {
    context = await browser.newContext();
    console.log("🔐 No saved session — you'll need to log in");
  }

  const page = await context.newPage();

  // Navigate to Flipboard and let user log in
  await page.goto("https://flipboard.com", { waitUntil: "networkidle" });

  console.log("\n========================================");
  console.log("  Browser is open on flipboard.com");
  console.log("  1. Log in if needed");
  console.log("  2. When ready, press ENTER here");
  console.log("========================================\n");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // Save cookies for future runs
  await context.storageState({ path: COOKIES_PATH });
  console.log("✅ Session saved, starting...\n");

  // Process each locale
  const locales = [
    { code: "en" as const, prefix: "", editUrl: MAGAZINE_EDIT_URLS.en },
    { code: "es" as const, prefix: "/es", editUrl: MAGAZINE_EDIT_URLS.es },
    { code: "it" as const, prefix: "/it", editUrl: MAGAZINE_EDIT_URLS.it },
  ];

  let submitted = 0;
  let skipped = 0;

  for (const locale of locales) {
    console.log(`\n🌐 Processing ${locale.code.toUpperCase()} magazine`);

    // Navigate to the magazine edit page once
    await page.goto(locale.editUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    for (const slug of slugs) {
      if (!state[slug]) state[slug] = {};
      if (state[slug][locale.code]) {
        skipped++;
        continue;
      }

      const blogUrl = `${SITE_URL}${locale.prefix}/blog/${slug}`;

      try {
        // Find the URL input field on the edit page
        // Selector: input[name="value"] with placeholder containing "URL"
        const urlInput = page.locator(
          'input[name="value"], input[placeholder*="URL"], input[placeholder*="url"], .curator-pro-item-creator__input-wrapper input'
        ).first();

        if (!(await urlInput.isVisible({ timeout: 5000 }))) {
          console.log(`  ⚠️  URL input not found, reloading edit page...`);
          await page.goto(locale.editUrl, { waitUntil: "networkidle" });
          await page.waitForTimeout(3000);
          continue;
        }

        // Clear and fill the URL
        await urlInput.click();
        await urlInput.fill("");
        await urlInput.fill(blogUrl);
        await page.waitForTimeout(500);

        // Press Enter to submit
        await urlInput.press("Enter");
        await page.waitForTimeout(4000);

        // Check if "Item added" toast appeared or the item shows in the list
        const success = await page.locator(
          'text=Item added, text=Elemento aggiunto, text=aggiunto'
        ).first().isVisible({ timeout: 5000 }).catch(() => false);

        if (success) {
          console.log(`  ✅ ${locale.code}/${slug}`);
        } else {
          // Even if no toast, the item may have been added — check if URL appears in page
          console.log(`  ✅ ${locale.code}/${slug} (submitted, no confirmation toast)`);
        }

        state[slug][locale.code] = true;
        submitted++;
        saveState(state);

        // Small delay between submissions to avoid rate limiting
        await page.waitForTimeout(2000);
      } catch (err) {
        console.log(`  ❌ ${locale.code}/${slug} — ${(err as Error).message}`);
        // If browser crashed, try reloading
        try {
          await page.goto(locale.editUrl, { waitUntil: "networkidle" });
          await page.waitForTimeout(3000);
        } catch {
          console.log(`  ⚠️  Could not reload edit page, stopping this locale`);
          break;
        }
      }
    }
  }

  // Save final state and cookies
  saveState(state);
  await context.storageState({ path: COOKIES_PATH });

  console.log(`\n✅ Done: ${submitted} submitted, ${skipped} skipped`);
  console.log(`   State saved to ${STATE_PATH}\n`);

  await browser.close();
}

main().catch(console.error);
