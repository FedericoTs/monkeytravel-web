/**
 * Open a real signup-confirmation link in a FRESH browser and report what the
 * user actually ends up looking at, and whether they are signed in.
 *
 * A fresh context is exactly the common case: the signup happened on a laptop,
 * the email is opened on a phone. Nothing is carried over.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const probe = JSON.parse(readFileSync(".auth/signup-probe.json", "utf8"));
const link = probe.actionLink;

const browser = await chromium.launch();
const ctx = await browser.newContext(); // no cookies, no storage: a second device
const page = await ctx.newPage();

const chain = [];
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) chain.push(f.url());
});

await page.goto(link, { waitUntil: "domcontentloaded" });
// Give any client-side session detection a chance to run and redirect.
await page.waitForTimeout(8000);

const finalUrl = page.url();
const visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);

// Is there a Supabase auth cookie, i.e. did a session actually get established?
const cookies = await ctx.cookies();
const authCookies = cookies
  .filter((c) => /sb-.*auth-token/.test(c.name))
  .map((c) => c.name);

console.log("\n=== what the user experiences ===");
console.log("final URL:", finalUrl.replace(/#.*$/, "#<fragment>"));
console.log("fragment survived to final URL:", finalUrl.includes("access_token") ? "yes" : "no");
console.log("supabase auth cookies:", authCookies.length ? authCookies.join(", ") : "NONE");
console.log("signed in:", authCookies.length > 0 ? "YES" : "NO");
console.log("\n--- visible page text ---");
console.log(visibleText.replace(/\n{2,}/g, "\n"));
console.log("\n--- navigation chain ---");
for (const u of chain) console.log("  ", u.replace(/#.*$/, "#<fragment>"));

await browser.close();
