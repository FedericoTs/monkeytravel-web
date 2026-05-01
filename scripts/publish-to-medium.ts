/**
 * Automate importing blog posts to Medium via the Import Story feature.
 *
 * Medium's API is dead (archived March 2023), so this uses Playwright
 * to automate the browser-based "Import a story" flow, which
 * automatically sets the canonical URL.
 *
 * Usage (run from Windows CMD, not WSL):
 *   npx tsx scripts/publish-to-medium.ts
 *   npx tsx scripts/publish-to-medium.ts --limit 5
 *   npx tsx scripts/publish-to-medium.ts --slug where-to-go-in-june
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import fs from "fs";
import path from "path";

const SITE_URL = "https://monkeytravel.app";
const COOKIES_PATH = path.resolve(__dirname, "../.medium-cookies.json");
const STATE_PATH = path.resolve(__dirname, "../.medium-state.json");

interface PublishState {
  [slug: string]: { importedAt: string; mediumUrl?: string };
}

// Top posts by GSC performance — ordered by priority
const TOP_POSTS = [
  "where-to-go-in-june",
  "cheapest-destinations-in-europe",
  "cheapest-destinations-in-asia",
  "paris-vs-rome",
  "monsoon-season-where-to-go-and-avoid",
  "where-to-go-in-july",
  "where-to-go-in-december",
  "best-honeymoon-destinations-2026",
  "coolcation-destinations-2026",
  "fifa-world-cup-2026-travel-guide",
  "chatgpt-vs-ai-trip-planners",
  "solo-female-travel-safety-guide-2026",
  "etias-europe-travel-authorization-2026",
  "us-tariffs-impact-travel-costs-2026",
  "is-it-safe-to-travel-to-the-us-2026",
  "where-to-go-in-april",
  "where-to-go-in-november",
  "where-to-go-in-october",
  "where-to-go-in-september",
  "passport-power-index-2026",
  "best-places-to-see-northern-lights",
  "tokyo-4-day-itinerary",
  "paris-vs-barcelona",
  "lisbon-vs-porto",
  "tokyo-vs-seoul",
  "cheapest-southeast-asia-backpackers-2026",
  "cheapest-european-cities-for-food-2026",
  "best-summer-destinations-2026",
  "bali-7-day-itinerary",
  "midnight-sun-best-destinations",
];

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

async function importStory(
  page: Page,
  blogUrl: string,
  slug: string,
  state: PublishState
): Promise<boolean> {
  try {
    // Navigate to Medium's import page
    await page.goto("https://medium.com/p/import", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    // Find the URL input — try multiple selectors
    const urlInput = page.locator(
      'input[type="url"], input[type="text"], input[placeholder*="URL"], input[placeholder*="url"], input[placeholder*="Enter"], input[placeholder*="enter"], input[placeholder*="Paste"], input[placeholder*="paste"]'
    ).first();

    if (!(await urlInput.isVisible({ timeout: 10000 }))) {
      console.log(`  ⚠️  No URL input found on import page`);
      return false;
    }

    // Fill the URL
    await urlInput.click();
    await urlInput.fill(blogUrl);
    await page.waitForTimeout(1000);

    // Try clicking an Import/Submit button, or press Enter
    const importBtn = page.locator(
      'button:has-text("Import"), button:has-text("import"), button[type="submit"]'
    ).first();

    if (await importBtn.isVisible({ timeout: 3000 })) {
      await importBtn.click();
    } else {
      await urlInput.press("Enter");
    }

    // Wait for Medium to process (it fetches and parses the page)
    console.log(`  ⏳ Importing ${slug}...`);
    await page.waitForTimeout(15000);

    // Check if we landed on the editor (success) or stayed on import page (failure)
    const currentUrl = page.url();
    if (
      currentUrl.includes("/edit") ||
      currentUrl.includes("/draft") ||
      currentUrl.includes("/p/") ||
      currentUrl !== "https://medium.com/p/import"
    ) {
      console.log(`  ✅ ${slug} → imported as draft`);
      console.log(`     ${currentUrl}`);
      state[slug] = {
        importedAt: new Date().toISOString(),
        mediumUrl: currentUrl,
      };
      saveState(state);
      return true;
    } else {
      // Check for error messages on the page
      const errorText = await page.locator('.error, [role="alert"], .notification--error').textContent().catch(() => "");
      console.log(`  ❌ ${slug} — stayed on import page${errorText ? `: ${errorText}` : ""}`);
      return false;
    }
  } catch (err) {
    console.log(`  ❌ ${slug} — ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const slugIdx = args.indexOf("--slug");

  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : TOP_POSTS.length;
  const specificSlug = slugIdx >= 0 ? args[slugIdx + 1] : null;

  const state = loadState();
  const postsToImport = specificSlug
    ? [specificSlug]
    : TOP_POSTS.filter((slug) => !state[slug]).slice(0, limit);

  if (postsToImport.length === 0) {
    console.log("✅ All posts already imported. Use --slug <name> to import a specific post.");
    return;
  }

  console.log(`\n📝 Will import ${postsToImport.length} posts to Medium as drafts\n`);

  // Launch browser (headful for login)
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  let context: BrowserContext;

  if (fs.existsSync(COOKIES_PATH)) {
    context = await browser.newContext({ storageState: COOKIES_PATH });
    console.log("🍪 Loaded saved session");
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();

  // Navigate to Medium
  await page.goto("https://medium.com", { waitUntil: "domcontentloaded", timeout: 60000 });

  console.log("\n========================================");
  console.log("  Browser is open on medium.com");
  console.log("  1. Log in if needed");
  console.log("  2. When ready, press ENTER here");
  console.log("========================================\n");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // Save cookies
  await context.storageState({ path: COOKIES_PATH });
  console.log("✅ Session saved, starting imports...\n");

  let imported = 0;
  let failed = 0;

  for (const slug of postsToImport) {
    const blogUrl = `${SITE_URL}/blog/${slug}`;
    console.log(`\n📥 [${imported + failed + 1}/${postsToImport.length}] ${slug}`);

    const success = await importStory(page, blogUrl, slug, state);
    if (success) {
      imported++;
    } else {
      failed++;
    }

    // Rate limit — Medium may block rapid imports
    await page.waitForTimeout(3000);
  }

  // Save cookies for next run
  await context.storageState({ path: COOKIES_PATH });

  console.log(`\n✅ Done: ${imported} imported, ${failed} failed`);
  console.log(`   Posts are saved as DRAFTS — review and publish on Medium.`);
  console.log(`   State saved to ${STATE_PATH}\n`);

  await browser.close();
}

main().catch(console.error);
