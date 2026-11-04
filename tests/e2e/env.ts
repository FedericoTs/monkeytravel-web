import { existsSync, readFileSync } from "node:fs";

const files = new Map<string, Record<string, string>>();

function fileVars(file: string): Record<string, string> {
  let vars = files.get(file);
  if (!vars) {
    vars = {};
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
    files.set(file, vars);
  }
  return vars;
}

/**
 * A setting a spec needs: from the environment (CI sets them), else from
 * .env.local as on a developer's machine, where a key set twice takes its
 * last value. Empty when neither has it, so the spec can skip itself.
 */
export function envVar(name: string, file = ".env.local"): string {
  return process.env[name] || fileVars(file)[name] || "";
}

/** The Supabase URL and service key the signed-in specs seed and check with. */
export function serviceCreds(): { url: string; key: string } {
  return { url: envVar("NEXT_PUBLIC_SUPABASE_URL"), key: envVar("SUPABASE_SERVICE_ROLE_KEY") };
}

/** A Supabase client with the service key, for seeding and checking. */
export async function serviceDb() {
  const { createClient } = await import("@supabase/supabase-js");
  const { url, key } = serviceCreds();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Where `scripts/e2e-fixtures.mts --seed` writes what it seeded. */
export const MANIFEST = ".auth/e2e-fixtures.json";

type SeededUser = { id: string; email: string; name: string };
/** What the seed wrote: the shared trip, its proposal and first activity, and the three users. */
export interface Manifest {
  tripId: string;
  proposalId: string;
  activityId: string;
  users: Record<"owner" | "mate" | "voter", SeededUser>;
}

/** The seeded fixtures, or null before the seed has run. */
export function readManifest(): Manifest | null {
  return existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest) : null;
}
