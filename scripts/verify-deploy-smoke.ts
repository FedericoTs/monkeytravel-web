#!/usr/bin/env tsx
/**
 * verify-deploy-smoke.ts — cross-platform post-deploy smoke probe.
 *
 * TypeScript twin of scripts/verify-deploy-smoke.sh. Same routes, same logic,
 * same exit codes. Use this on Windows (where bash isn't always available) or
 * wire it into npm scripts via `npm run verify:deploy`.
 *
 * Why this exists: cycle-5's SSR-500 incident shipped because the deploy
 * pipeline reported "success" while every React-rendered route was throwing
 * at request time (useContext returned undefined in SessionTracker because
 * AuthProvider lived under app/[locale]/layout.tsx, not app/layout.tsx).
 * Neither `next build` nor `tsc --noEmit` catches that — only a live HTTP
 * probe of the rendered routes does.
 *
 * Usage:
 *   tsx scripts/verify-deploy-smoke.ts                          # prod
 *   tsx scripts/verify-deploy-smoke.ts https://monkeytravel.app
 *   tsx scripts/verify-deploy-smoke.ts http://localhost:3000
 *   npm run verify:deploy
 *
 * Exit codes:
 *   0 — every route returned 2xx or 3xx
 *   1 — one or more routes returned 4xx/5xx or timed out
 */

const TIMEOUT_MS = 10_000;

const ROUTES = [
  "/",
  "/blog",
  "/it",
  "/es",
  "/it/explore",
  "/it/backpacker",
  "/api/health",
  "/robots.txt",
  "/sitemap.xml",
] as const;

type ProbeResult = {
  route: string;
  status: number;
  ttfbSec: number;
  pass: boolean;
  reason?: string;
};

async function probe(baseUrl: string, route: string): Promise<ProbeResult> {
  const url = `${baseUrl}${route}`;
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // redirect: "manual" — we treat 3xx as pass without following.
    //   Following redirects could mask redirect loops, and locale roots
    //   like / → /it or /it → /it/somewhere are valid green signals.
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "monkeytravel-deploy-smoke/1.0" },
    });
    const ttfbSec = (performance.now() - started) / 1000;
    const status = res.status;
    const pass = status >= 200 && status < 400;
    return {
      route,
      status,
      ttfbSec,
      pass,
      reason: pass ? undefined : `HTTP ${status}`,
    };
  } catch (err) {
    const ttfbSec = (performance.now() - started) / 1000;
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout after ${TIMEOUT_MS}ms`
          : err.message
        : "unknown fetch error";
    return { route, status: 0, ttfbSec, pass: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

function pad(s: string | number, width: number): string {
  const str = String(s);
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

async function main(): Promise<void> {
  const rawBase = process.argv[2] ?? "https://monkeytravel.app";
  const baseUrl = rawBase.replace(/\/$/, "");

  console.log(
    `verify-deploy-smoke: probing ${baseUrl} (timeout ${TIMEOUT_MS / 1000}s)`,
  );
  console.log("");
  console.log(`${pad("ROUTE", 22)} ${pad("STATUS", 7)} ${pad("TTFB(s)", 10)}`);
  console.log(
    `${pad("----------------------", 22)} ${pad("------", 7)} ${pad("----------", 10)}`,
  );

  // Probe sequentially so output table stays readable and we don't accidentally
  // hammer the edge with 9 simultaneous warm-up requests on a cold deploy.
  const results: ProbeResult[] = [];
  for (const route of ROUTES) {
    const r = await probe(baseUrl, route);
    results.push(r);
    const mark = r.pass
      ? "OK"
      : r.status === 0
        ? "TIMEOUT/CONN"
        : "FAIL";
    console.log(
      `${pad(r.route, 22)} ${pad(r.status, 7)} ${pad(r.ttfbSec.toFixed(3), 10)} ${mark}`,
    );
  }

  console.log("");
  const failures = results.filter((r) => !r.pass);
  if (failures.length === 0) {
    console.log("SMOKE PASS");
    process.exit(0);
  }

  const failSummary = failures
    .map((f) => `${f.route}(${f.status === 0 ? "timeout" : f.status})`)
    .join(" ");
  console.log(`SMOKE FAIL: ${failSummary}`);
  console.log(`First failing route: ${failures[0].route}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("verify-deploy-smoke: unhandled error", err);
  process.exit(1);
});
