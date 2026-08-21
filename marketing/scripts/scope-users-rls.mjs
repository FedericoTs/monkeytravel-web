/**
 * Scope the `authenticated` side of the public.users exposure.
 *
 * The anon hole is closed (776fe9b). What remains: `authenticated` still has
 * SELECT on all 48 columns under a USING (true) row policy, so any signed-in
 * user can read every row.
 *
 * The candidate fix is a row policy of `id = auth.uid()` plus a public view
 * for cross-user reads. Whether that is cheap or expensive depends entirely on
 * how many call sites read OTHER people's rows — those are the ones that break.
 *
 * This classifies every users-table query as:
 *   OWN-ROW   filtered by the current user's id -> unaffected by the change
 *   CROSS     reads other people's rows          -> must be repointed
 *   SERVICE   service_role                       -> bypasses RLS entirely
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

const own = [], cross = [], service = [], unclear = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!/from\(["']users["']\)/.test(src)) continue;
  const isService = /createAdminClient|SERVICE_ROLE|service_role/.test(src);
  const rel = f.split("\\").join("/");

  // Each users query and the ~300 chars after it (where the filter lives).
  for (const m of src.matchAll(/from\(["']users["']\)([\s\S]{0,320})/g)) {
    const tail = m[1];
    // Stop at the end of the statement so we don't read a neighbouring query.
    const stmt = tail.split(/;\s*\n/)[0];
    const isRead = /\.select\(/.test(stmt);
    if (!isRead) continue;

    const cols = (stmt.match(/\.select\(\s*([`"'])([\s\S]*?)\1/) || [])[2]?.replace(/\s+/g, " ").trim() || "(dynamic)";

    if (isService) { service.push({ rel, cols }); continue; }

    // Scoped to the caller: .eq("id", user.id) / userId / session user.
    const ownRow = /\.eq\(\s*["']id["']\s*,\s*[^)]*\b(user\.id|userId|user_id|session\.user\.id|data\.user\.id|authUser\.id|currentUser\.id)\b/.test(stmt);
    // Reads keyed off someone else, or unfiltered (list queries).
    const explicitOther = /\.eq\(\s*["']id["']\s*,\s*[^)]*\b(referral|referrer|creator|owner|invit|target|other)/i.test(stmt);
    const noIdFilter = !/\.eq\(\s*["']id["']/.test(stmt);

    if (ownRow) own.push({ rel, cols });
    else if (explicitOther || noIdFilter) cross.push({ rel, cols, why: explicitOther ? "keyed off another user" : "no id filter (list/scan)" });
    else unclear.push({ rel, cols });
  }
}

const uniq = (a) => [...new Map(a.map((x) => [x.rel + "|" + x.cols, x])).values()];

console.log("=== CROSS-USER reads on a NON-service client — these BREAK under id = auth.uid() ===");
for (const c of uniq(cross)) console.log(`  ${c.rel}\n      ${c.cols}   [${c.why}]`);
console.log(`\n  subtotal: ${uniq(cross).length}`);

console.log("\n=== UNCLEAR — needs a human read ===");
for (const c of uniq(unclear)) console.log(`  ${c.rel}\n      ${c.cols}`);
console.log(`\n  subtotal: ${uniq(unclear).length}`);

console.log("\n=== OWN-ROW (unaffected) ===");
console.log(`  ${uniq(own).length} call sites`);
console.log("\n=== SERVICE (bypasses RLS entirely, unaffected) ===");
console.log(`  ${uniq(service).length} call sites`);

// Which columns would a public view need to expose?
const needed = new Set();
for (const c of uniq(cross)) c.cols.split(",").forEach((x) => needed.add(x.trim().replace(/[^a-z_]/gi, "")));
needed.delete("");
console.log("\n=== columns a public_profiles view would have to expose ===");
console.log("  " + [...needed].sort().join(", "));
