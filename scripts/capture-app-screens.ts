/**
 * Capture real app screenshots for video production.
 *
 * Uses Playwright to navigate the live app (monkeytravel.app) and capture
 * key screens at phone resolution for use in Remotion compositions.
 *
 * Strategy:
 *  1. Dismiss cookie consent banner for clean screenshots
 *  2. Capture landing page sections (hero, features, destinations)
 *  3. Open the interactive product tour and capture each slide
 *  4. Capture destination pages and templates
 *
 * Usage: npx tsx scripts/capture-app-screens.ts
 */

import { chromium } from 'playwright';
import path from 'path';

const OUTPUT_DIR = path.resolve(__dirname, '../video/output/screens');
const BASE_URL = 'https://monkeytravel.app';
const VIEWPORT = { width: 430, height: 932 }; // iPhone 15 Pro Max logical
const DEVICE_SCALE = 2; // 2x for retina → 860x1864 actual pixels

async function dismissCookieBanner(page: import('playwright').Page) {
  try {
    const acceptBtn = page.locator('button:has-text("Accept All")');
    if (await acceptBtn.isVisible({ timeout: 3000 })) {
      await acceptBtn.click();
      await page.waitForTimeout(500);
      console.log('    ✓ Cookie banner dismissed');
    }
  } catch {
    // No cookie banner — fine
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  const fs = await import('fs');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('📸 Capturing app screens from', BASE_URL);

  // ─── LANDING PAGE ─────────────────────────────────────────────────
  console.log('\n1. Landing page...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await dismissCookieBanner(page);
  await page.waitForTimeout(500);

  // Hero
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '01-landing-hero.png'),
    fullPage: false,
  });
  console.log('    ✓ 01-landing-hero');

  // Scroll to social proof metrics
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '02-landing-social-proof.png'),
    fullPage: false,
  });
  console.log('    ✓ 02-landing-social-proof');

  // Scroll to "How it works" section
  const howItWorks = page.locator('#how-it-works');
  if (await howItWorks.count() > 0) {
    await howItWorks.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, '03-how-it-works.png'),
      fullPage: false,
    });
    console.log('    ✓ 03-how-it-works');
  }

  // Scroll to features section
  const features = page.locator('#features');
  if (await features.count() > 0) {
    await features.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, '04-features.png'),
      fullPage: false,
    });
    console.log('    ✓ 04-features');
  }

  // Scroll to app preview (3 phones)
  await page.evaluate(() => window.scrollTo(0, 6500));
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '05-app-preview-phones.png'),
    fullPage: false,
  });
  console.log('    ✓ 05-app-preview-phones');

  // ─── PRODUCT TOUR (real app UI) ──────────────────────────────────
  console.log('\n2. Product tour screens...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissCookieBanner(page);
  await page.waitForTimeout(500);

  // Click the primary CTA to open the tour
  const tourTrigger = page.locator('button:has-text("Plan a Trip"), a:has-text("Plan a Trip"), button:has-text("Try It Free"), a:has-text("Try It Free")').first();
  if (await tourTrigger.isVisible({ timeout: 3000 })) {
    await tourTrigger.click();
    await page.waitForTimeout(2000);

    // Capture tour slide 1 — AI Chat / Destination input
    await page.screenshot({
      path: path.join(OUTPUT_DIR, '06-tour-slide1-ai-chat.png'),
      fullPage: false,
    });
    console.log('    ✓ 06-tour-slide1-ai-chat');

    // Navigate through tour slides by clicking right side of screen
    for (let i = 2; i <= 6; i++) {
      // Click the right third of the screen to advance
      await page.click('body', {
        position: { x: VIEWPORT.width * 0.8, y: VIEWPORT.height * 0.5 },
      });
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `0${5 + i}-tour-slide${i}.png`),
        fullPage: false,
      });
      const slideNames = ['', 'ai-chat', 'itinerary', 'map', 'templates', 'collaboration', 'cta'];
      console.log(`    ✓ 0${5 + i}-tour-slide${i}-${slideNames[i] || 'unknown'}`);
    }

    // Close tour
    const skipBtn = page.locator('button:has-text("Skip"), button:has-text("Close"), button[aria-label="Close"]').first();
    if (await skipBtn.isVisible({ timeout: 2000 })) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }
  } else {
    console.log('    ⚠ Tour trigger not found, skipping tour captures');
  }

  // ─── DESTINATION PAGES ───────────────────────────────────────────
  console.log('\n3. Destination pages...');

  const destinations = ['tokyo', 'barcelona', 'paris', 'bali'];
  for (let i = 0; i < destinations.length; i++) {
    const dest = destinations[i];
    console.log(`  → ${dest}...`);
    await page.goto(`${BASE_URL}/destinations/${dest}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await dismissCookieBanner(page);
    await page.waitForTimeout(300);

    // Hero shot
    await page.screenshot({
      path: path.join(OUTPUT_DIR, `${12 + i * 2}-dest-${dest}-hero.png`),
      fullPage: false,
    });
    console.log(`    ✓ ${12 + i * 2}-dest-${dest}-hero`);

    // Scroll down for content
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, `${13 + i * 2}-dest-${dest}-content.png`),
      fullPage: false,
    });
    console.log(`    ✓ ${13 + i * 2}-dest-${dest}-content`);
  }

  // ─── TEMPLATES PAGE ──────────────────────────────────────────────
  console.log('\n4. Templates page...');
  await page.goto(`${BASE_URL}/templates`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissCookieBanner(page);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '20-templates.png'),
    fullPage: false,
  });
  console.log('    ✓ 20-templates');

  // Scroll to see more templates
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '21-templates-more.png'),
    fullPage: false,
  });
  console.log('    ✓ 21-templates-more');

  // ─── TRIP CREATION ───────────────────────────────────────────────
  console.log('\n5. Trip creation...');
  await page.goto(`${BASE_URL}/trips/new`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await dismissCookieBanner(page);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '22-trip-wizard.png'),
    fullPage: false,
  });
  console.log('    ✓ 22-trip-wizard');

  // ─── DONE ────────────────────────────────────────────────────────
  console.log(`\n✅ Done! Screenshots saved to ${OUTPUT_DIR}`);
  const files = fs.readdirSync(OUTPUT_DIR).filter((f: string) => f.endsWith('.png'));
  console.log(`   ${files.length} screenshots captured`);

  await browser.close();
}

main().catch(console.error);
