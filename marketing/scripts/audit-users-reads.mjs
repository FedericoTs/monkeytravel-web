/**
 * For every file that reads public.users, determine which Supabase client it
 * uses — that decides whether column-level GRANTs would affect it.
 *
 *   SERVICE       -> service_role key: bypasses RLS *and* column grants.
 *   server(anon)  -> anon key + user cookies; runs as anon or authenticated.
 *   browser(anon) -> anon key in the browser; same roles.
 *
 * Only the non-SERVICE readers can break when we revoke columns from anon /
 * authenticated, so those are what the report highlights.
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
for (const d of ["app", "lib", "components"]) walk(d);

const rows = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  if (!/from\(["']users["']\)/.test(s)) continue;
  const client = /createAdminClient|SERVICE_ROLE|service_role/.test(s)
    ? "SERVICE"
    : /@\/lib\/supabase\/server/.test(s)
      ? "server(anon)"
      : /@\/lib\/supabase\/client/.test(s)
        ? "browser(anon)"
        : "?";
  const cols = [
    ...s.matchAll(/from\(["']users["']\)[\s\S]{0,200}?\.select\(\s*([`"'])([\s\S]*?)\1/g),
  ].map((m) => m[2].replace(/\s+/g, " ").trim());
  rows.push({ f: f.split("\\").join("/"), client, cols: [...new Set(cols)] });
}
rows.sort((a, b) => a.client.localeCompare(b.client) || a.f.localeCompare(b.f));

// Columns we intend to keep readable by anon/authenticated.
const PUBLIC_COLS = new Set(["id", "display_name", "avatar_url", "username", "privacy_settings", "show_on_leaderboard", "leaderboard_visibility"]);

console.log("CLIENT         FILE");
console.log("               :: columns\n");
const risky = [];
for (const r of rows) {
  const needs = r.cols.flatMap((c) => c.split(",").map((x) => x.trim().replace(/[^a-z_]/gi, ""))).filter(Boolean);
  const beyond = [...new Set(needs.filter((c) => c && !PUBLIC_COLS.has(c)))];
  const flag = r.client !== "SERVICE" && beyond.length ? `  <-- NEEDS: ${beyond.join(", ")}` : "";
  if (flag) risky.push({ f: r.f, beyond });
  console.log(`${r.client.padEnd(14)} ${r.f}\n               :: ${r.cols.join(" | ") || "(no literal select)"}${flag}\n`);
}

console.log(`${rows.length} files read public.users`);
for (const k of ["SERVICE", "server(anon)", "browser(anon)", "?"]) {
  console.log(`  ${k.padEnd(14)} ${rows.filter((r) => r.client === k).length}`);
}
console.log(`\nNON-SERVICE readers needing columns beyond the public set: ${risky.length}`);
for (const r of risky) console.log(`  ${r.f}  ->  ${r.beyond.join(", ")}`);
