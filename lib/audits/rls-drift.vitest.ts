/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { anonWritablePolicies, rlsDrift, type RlsSnapshot } from "./rls-drift";

const policy = (name: string, cmd: string, extra: Record<string, unknown> = {}) => ({
  name,
  cmd,
  permissive: true,
  roles: ["authenticated"],
  using: "(user_id = auth.uid())",
  with_check: null,
  ...extra,
});

const table = (name: string, policies: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  table: name,
  rls_enabled: true,
  rls_forced: false,
  grants: { authenticated: ["SELECT"] },
  policies,
  ...extra,
});

const baseline: RlsSnapshot = [
  table("trips", [policy("trips_select_own", "SELECT"), policy("trips_update_own", "UPDATE")]),
  table("votes", [policy("votes_select", "SELECT")]),
];

describe("rlsDrift", () => {
  it("is silent when the live snapshot matches, whatever the table order", () => {
    expect(rlsDrift(baseline, [...baseline].reverse())).toEqual([]);
  });

  it("names every kind of change on one line each", () => {
    const live: RlsSnapshot = [
      table("trips", [policy("trips_select_own", "SELECT", { using: "true" }), policy("trips_delete_own", "DELETE")], {
        rls_enabled: false,
        grants: { authenticated: ["SELECT", "UPDATE"] },
      }),
      table("audit_log", []),
    ];
    const lines = rlsDrift(baseline, live);
    expect(lines.map((l) => l.split("\n")[0])).toEqual([
      "NEW TABLE  audit_log  (rls_enabled=true, 0 policies)",
      "DROPPED TABLE  votes",
      "RLS TOGGLED  trips  true -> false",
      "GRANTS CHANGED  trips",
      "POLICY CHANGED  trips.trips_select_own",
      "NEW POLICY  trips.trips_delete_own  DELETE roles=[\"authenticated\"] using=(user_id = auth.uid()) check=null",
      "POLICY REMOVED  trips.trips_update_own",
    ]);
    expect(lines.find((l) => l.startsWith("GRANTS CHANGED"))).toContain('now:  {"authenticated":["SELECT","UPDATE"]}');
  });
});

describe("anonWritablePolicies", () => {
  it("flags a permissive write policy that is literally true for anon or public, and nothing else", () => {
    const live: RlsSnapshot = [
      table("open", [
        policy("open_insert", "INSERT", { roles: ["anon"], using: null, with_check: "true" }),
        policy("open_all", "ALL", { roles: ["public"], using: "true" }),
        policy("open_select", "SELECT", { roles: ["anon"], using: "true" }),
        policy("open_restrictive", "UPDATE", { roles: ["anon"], using: "true", permissive: false }),
        policy("own_insert", "INSERT", { roles: ["authenticated"], with_check: "true" }),
      ]),
    ];
    expect(anonWritablePolicies(live)).toEqual(["open.open_insert (INSERT, roles=anon)", "open.open_all (ALL, roles=public)"]);
    expect(anonWritablePolicies(baseline)).toEqual([]);
  });
});
