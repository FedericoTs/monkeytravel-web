import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The invite lookups return who an invite was sent to and the inviter's note,
 * so only the service role may call them. These guards fail if a caller moves
 * to a client that holds the public key, or if a migration opens them again.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");
const LOOKUPS = ["get_invite_by_token", "get_invite_status_by_token"];
const CALL = /(\w+)\s*\.rpc\(\s*"(get_invite_by_token|get_invite_status_by_token)"/g;
const MIGRATIONS = path.join("supabase", "migrations");
const CLOSING = "20261010120000_invite_lookups_service_role_only.sql";
const revokeLine = (fn: string) => `revoke execute on function public.${fn}(text) from public, anon, authenticated;`;

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.vitest\.tsx?$/.test(name) ? [rel] : [];
  });
}

describe("invite lookups run on the service role", () => {
  const callers = ["app", "lib", "components"]
    .flatMap(sourceFiles)
    .filter((f) => LOOKUPS.some((fn) => read(f).includes(`"${fn}"`)));

  it("only the invite routes and the invite page call them", () => {
    expect([...callers].sort()).toEqual(
      [
        path.join("app", "[locale]", "(app)", "invite", "[token]", "page.tsx"),
        path.join("app", "api", "invites", "[token]", "route.ts"),
        path.join("app", "api", "invites", "[token]", "sign-in-link", "route.ts"),
      ].sort()
    );
  });

  it("every call goes through a client built with the service-role key", () => {
    for (const file of callers) {
      const src = read(file);
      const receivers = new Set([...src.matchAll(CALL)].map((m) => m[1]));
      expect(receivers.size, file).toBeGreaterThan(0);
      for (const name of receivers) {
        const serviceClient = new RegExp(
          `const ${name} = \\w+\\(\\s*process\\.env\\.NEXT_PUBLIC_SUPABASE_URL!,\\s*process\\.env\\.SUPABASE_SERVICE_ROLE_KEY!`
        );
        expect(src, `${file}: ${name}`).toMatch(serviceClient);
      }
    }
  });
});

describe("invite lookups are closed to the public key", () => {
  it.each(LOOKUPS)("%s is revoked from public, anon and authenticated, and kept for the service role", (fn) => {
    const sql = read(path.join(MIGRATIONS, CLOSING));
    expect(sql).toContain(revokeLine(fn));
    expect(sql).toContain(`grant execute on function public.${fn}(text) to service_role;`);
  });

  it.each(LOOKUPS)("no later migration opens %s again", (fn) => {
    const later = readdirSync(path.join(ROOT, MIGRATIONS)).filter((name) => name > CLOSING);
    const reopened = later.filter((name) => {
      const sql = read(path.join(MIGRATIONS, name)).toLowerCase();
      const granted = new RegExp(`grant\\s+(execute|all)[^;]*public\\.${fn}\\b[^;]*\\bto\\b[^;]*\\b(public|anon|authenticated)\\b`).test(sql);
      // A re-created function can come back with the default grants.
      const recreated = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${fn}\\(`).test(sql);
      return granted || (recreated && !sql.includes(revokeLine(fn)));
    });
    expect(reopened).toEqual([]);
  });
});
