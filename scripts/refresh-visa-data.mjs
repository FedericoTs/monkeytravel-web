#!/usr/bin/env node
/**
 * Refresh the Visa Checker dataset from imorte/passport-index-data.
 *
 * Usage:
 *   node scripts/refresh-visa-data.mjs            # default: write changes
 *   node scripts/refresh-visa-data.mjs --check    # exit 1 if data drifted (CI use)
 *
 * Runs locally OR from the nightly GitHub Action
 * (.github/workflows/refresh-visa-data.yml).
 *
 * **What this does**
 * - Fetches passport-index.json from the MIT-licensed imorte upstream.
 * - Sanity-checks the shape (must be a non-empty object of uppercase
 *   ISO-2 → ISO-2 → { status, days? } cells) so a corrupted upstream
 *   never silently overwrites our snapshot.
 * - Compares to lib/visa/matrix.json. If different, writes the new
 *   file and prints a one-line summary of what changed.
 *
 * **Why we keep a snapshot** (vs fetching at request time)
 * - The dataset is 2.4MB. Bundling it into the server means lookups are
 *   synchronous + a server cold start doesn't depend on a remote fetch.
 * - Upstream changes are slow (low single-digit edits per month) — a
 *   nightly PR is plenty of freshness for a planning-aid tool.
 *
 * Disclaimer the UI already shows: visa rules change without notice.
 * The matrix is a planning aid, not legal advice; users must verify
 * with the official source.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MATRIX_PATH = path.join(REPO_ROOT, "lib", "visa", "matrix.json");
const UPSTREAM_URL =
  "https://raw.githubusercontent.com/imorte/passport-index-data/main/passport-index.json";

const VALID_STATUSES = new Set([
  "visa free",
  "visa on arrival",
  "eta",
  "e-visa",
  "visa required",
  "no admission",
]);

const ISO2_RE = /^[A-Z]{2}$/;

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");

async function main() {
  console.log(`[refresh-visa] Fetching ${UPSTREAM_URL}`);
  const res = await fetch(UPSTREAM_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Upstream fetch failed: ${res.status} ${res.statusText}`);
  }
  const fresh = await res.json();

  validateShape(fresh);

  const currentRaw = await fs.readFile(MATRIX_PATH, "utf8").catch(() => null);
  if (!currentRaw) {
    console.log(`[refresh-visa] matrix.json missing — writing fresh copy`);
    if (!CHECK_ONLY) await writePretty(MATRIX_PATH, fresh);
    return CHECK_ONLY ? exit(1) : exit(0);
  }

  const current = JSON.parse(currentRaw);
  const diff = diffMatrices(current, fresh);

  if (diff.changed === 0) {
    console.log(`[refresh-visa] No changes vs current snapshot.`);
    return exit(0);
  }

  console.log(`[refresh-visa] Detected changes:`);
  console.log(`  passports added:        ${diff.passportsAdded.join(", ") || "(none)"}`);
  console.log(`  passports removed:      ${diff.passportsRemoved.join(", ") || "(none)"}`);
  console.log(`  destination cells diff: ${diff.changed}`);
  console.log(`  sample diffs (first 10):`);
  for (const d of diff.samples) {
    console.log(`    ${d.passport}→${d.destination}: ${d.before} → ${d.after}`);
  }

  if (CHECK_ONLY) {
    console.log(`[refresh-visa] --check mode: exiting 1 because data drifted.`);
    exit(1);
  }

  await writePretty(MATRIX_PATH, fresh);
  console.log(`[refresh-visa] Wrote ${MATRIX_PATH}`);
}

function validateShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Upstream root is not an object");
  }
  const passports = Object.keys(data);
  if (passports.length < 150) {
    throw new Error(
      `Upstream looks truncated — only ${passports.length} passports (expected ~199)`
    );
  }
  for (const p of passports) {
    if (!ISO2_RE.test(p)) {
      throw new Error(`Bad passport code: ${JSON.stringify(p)}`);
    }
  }
  // Spot-check a few rows.
  for (const p of passports.slice(0, 3)) {
    const row = data[p];
    if (!row || typeof row !== "object") {
      throw new Error(`Row ${p} is not an object`);
    }
    const dests = Object.keys(row);
    for (const d of dests.slice(0, 3)) {
      if (!ISO2_RE.test(d)) {
        throw new Error(`Bad destination code under ${p}: ${JSON.stringify(d)}`);
      }
      const cell = row[d];
      // Cell can be a number (-1 = same country) or { status, days? }
      if (typeof cell === "number") continue;
      if (!cell || typeof cell.status !== "string") {
        throw new Error(`Cell ${p}→${d} has no status string`);
      }
      if (!VALID_STATUSES.has(cell.status)) {
        // Don't throw — upstream may add a status. Warn instead so we
        // notice via the PR description.
        console.warn(
          `[refresh-visa] WARN: unknown status "${cell.status}" at ${p}→${d}`
        );
      }
    }
  }
}

function diffMatrices(a, b) {
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  const passportsAdded = [...bKeys].filter((k) => !aKeys.has(k)).sort();
  const passportsRemoved = [...aKeys].filter((k) => !bKeys.has(k)).sort();

  let changed = 0;
  const samples = [];
  for (const p of bKeys) {
    const rowA = a[p] || {};
    const rowB = b[p] || {};
    const cellKeys = new Set([...Object.keys(rowA), ...Object.keys(rowB)]);
    for (const d of cellKeys) {
      const before = serializeCell(rowA[d]);
      const after = serializeCell(rowB[d]);
      if (before !== after) {
        changed += 1;
        if (samples.length < 10) samples.push({ passport: p, destination: d, before, after });
      }
    }
  }
  return { changed, samples, passportsAdded, passportsRemoved };
}

function serializeCell(cell) {
  if (cell === undefined || cell === null) return "(missing)";
  if (typeof cell === "number") return String(cell);
  return `${cell.status}${cell.days != null ? `:${cell.days}` : ""}`;
}

async function writePretty(target, data) {
  const sorted = sortObjectDeep(data);
  await fs.writeFile(target, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

/** Stable key order so the diff in PRs is meaningful + minimal. */
function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortObjectDeep(value[key]);
    }
    return out;
  }
  return value;
}

function exit(code) {
  process.exit(code);
}

main().catch((err) => {
  console.error(`[refresh-visa] FAILED: ${err.message}`);
  process.exit(2);
});
