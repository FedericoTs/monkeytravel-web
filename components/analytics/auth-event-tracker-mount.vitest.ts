import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * AuthEventTracker is the ONLY thing that turns the OAuth callback's
 * ?auth_event=... parameter into a PostHog signup/login event. It used to be
 * mounted on a single page (components/trips/TripsPageClient.tsx, i.e.
 * /trips), which made it unreachable by construction:
 *
 *   app/auth/callback/route.ts:336
 *     const finalRedirect = next !== "/trips" ? next : "/trips/new";
 *
 * A newly signed-up user is therefore ALWAYS redirected somewhere other than
 * /trips, so the tracker never mounted on the landing page and the event was
 * never fired. Measured over the 30 days to 2026-08-21: 146 real signups in
 * auth.users, 4 user_signed_up events in PostHog (2.7%). Correctly-wired
 * events over the same window captured ~59% (148 trips created -> 87
 * trip_created), so the missing ~95 points were this bug, not consent loss.
 *
 * These tests pin the two properties that keep it working.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const layout = fs.readFileSync(
  path.join(repoRoot, "app", "[locale]", "layout.tsx"),
  "utf8"
);

/**
 * Scan once at module load, not inside a test.
 *
 * A recursive sync walk of app/ + components/ takes milliseconds on an idle
 * machine but blew past vitest's 5s default timeout when the suite ran with
 * ~40 worker processes competing for the disk. Doing it per-test made this
 * file fail for reasons that had nothing to do with the assertion.
 */
const mountSites: string[] = (() => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.tsx$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        // The JSX element, not the import or a comment mentioning it.
        if (/<AuthEventTracker\s*\/>/.test(src)) hits.push(path.relative(repoRoot, full));
      }
    }
  };
  for (const r of ["app", "components"]) walk(path.join(repoRoot, r));
  return hits;
})();

describe("AuthEventTracker mount point", () => {
  it("is mounted in the locale layout, so it sees every landing page", () => {
    expect(
      layout,
      "AuthEventTracker must be mounted in app/[locale]/layout.tsx — mounting it on an individual page makes OAuth signup tracking unreachable"
    ).toMatch(/<AuthEventTracker\s*\/>/);
  });

  it("is wrapped in Suspense, which useSearchParams requires", () => {
    // Next.js throws a build-time error for useSearchParams outside a
    // Suspense boundary. Assert the tracker sits inside one.
    const mount = layout.indexOf("<AuthEventTracker");
    const suspenseOpen = layout.lastIndexOf("<Suspense", mount);
    const suspenseClose = layout.indexOf("</Suspense>", mount);

    expect(suspenseOpen, "no <Suspense> opens before <AuthEventTracker />").toBeGreaterThan(-1);
    expect(suspenseClose, "no </Suspense> closes after <AuthEventTracker />").toBeGreaterThan(mount);
  });

  it("is mounted exactly once across the app, so signups are not double-counted", () => {
    expect(
      mountSites,
      `AuthEventTracker should be rendered in exactly one place; found: ${mountSites.join(", ")}`
    ).toHaveLength(1);
  });
});
