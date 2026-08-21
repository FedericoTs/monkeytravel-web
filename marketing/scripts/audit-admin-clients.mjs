/**
 * Which client does each ADMIN / analytics surface use to reach public.users?
 *
 * Constraint from Federico: emails are admin-only, and the admin dashboard +
 * analytics pages must keep working. That makes this the deciding question for
 * the RLS change:
 *
 *   service_role  -> bypasses RLS entirely. Safe under ANY row policy.
 *   anon/cookie   -> runs as `authenticated`. BREAKS under id = auth.uid(),
 *                    because an admin reading other people's rows is exactly
 *                    what that policy forbids.
 *
 * Anything in the second bucket must be migrated to the service client BEFORE
 * the row policy changes, or the admin dashboard goes blank — silently, since
 * RLS denial returns empty rows rather than an error.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p) && !/vitest|\.test\./.test(p)) files.push(p);
  }
}
walk("app");
walk("lib");

const rows = [];
for (const f of files) {
  const rel = f.split("\\").join("/");
  // Admin dashboard, analytics, stats, growth, cron reporting.
  if (!/\/admin\/|analytics|\/stats|\/growth|\/costs|leaderboard/i.test(rel)) continue;
  const src = readFileSync(f, "utf8");
  if (!/from\(["'](users|trips|api_request_logs|referral_events)["']\)/.test(src)) continue;

  const service = /createAdminClient|SERVICE_ROLE|service_role/.test(src);
  const cookie = /@\/lib\/supabase\/server/.test(src);
  const browser = /@\/lib\/supabase\/client/.test(src);
  const readsEmail = /\bemail\b/.test((src.match(/from\(["']users["'][\s\S]{0,300}/) || [""])[0]);
  const tables = [...new Set([...src.matchAll(/from\(["']([a-z_]+)["']\)/g)].map((m) => m[1]))];

  rows.push({
    rel,
    client: service ? "SERVICE" : cookie ? "cookie(authenticated)" : browser ? "browser(authenticated)" : "?",
    readsEmail,
    tables: tables.slice(0, 6),
  });
}
rows.sort((a, b) => a.client.localeCompare(b.client) || a.rel.localeCompare(b.rel));

const breaks = rows.filter((r) => r.client !== "SERVICE");
console.log("=== ADMIN / ANALYTICS surfaces touching user data ===\n");
for (const r of rows) {
  const mark = r.client === "SERVICE" ? "     " : " !!! ";
  console.log(`${mark}${r.client.padEnd(23)} ${r.rel}`);
  console.log(`      tables: ${r.tables.join(", ")}${r.readsEmail ? "   [reads users.email]" : ""}`);
}
console.log(`\n${rows.length} admin/analytics surfaces`);
console.log(`  SERVICE (safe under any policy): ${rows.length - breaks.length}`);
console.log(`  NON-service (WOULD BREAK):       ${breaks.length}`);
if (breaks.length) {
  console.log("\n  Must move to the service client before the row policy changes:");
  for (const b of breaks) console.log(`    - ${b.rel}${b.readsEmail ? "  (reads email)" : ""}`);
}
