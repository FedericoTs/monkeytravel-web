// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Notification links.
 *
 * Vote and proposal notifications (in-app, email and push) linked to
 * /trips/<id>/edit, a page that never existed: every one 404'd. They now link
 * to /trips/<id>, and /trips/<id>/edit redirects there so links already sent
 * keep working.
 */

class Redirect extends Error {
  constructor(public url: string) {
    super(url);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

async function open(locale: string) {
  const { default: TripEditRedirect } = await import("./page");
  try {
    await TripEditRedirect({ params: Promise.resolve({ id: "trip-1", locale }) });
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  return null;
}

describe("/trips/<id>/edit", () => {
  it("redirects to the trip, keeping the locale", async () => {
    expect(await open("en")).toBe("/trips/trip-1");
    expect(await open("it")).toBe("/it/trips/trip-1");
    expect(await open("pt")).toBe("/pt/trips/trip-1");
  });
});

describe("no code builds /trips/<id>/edit links any more", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..", "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.vitest\.tsx?$/.test(name)) files.push(full);
    }
  };
  for (const dir of ["app", "lib", "components"]) walk(join(ROOT, dir));

  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  // Reads every source file: give it room when the whole suite runs at once.
  it("no template builds a /trips/${...}/edit path", () => {
    const offenders = files.filter((f) => /\/trips\/\$\{[^}]+\}\/edit/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  }, 30_000);
});
