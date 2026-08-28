/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The two controls that stand between this cron and a bad mass send.
 *
 * Asserted against the SOURCE rather than by importing the route, following
 * reminder-i18n.vitest.ts: the module pulls next/server and the Supabase
 * service client at import time, so loading it here would test the harness
 * rather than the route. These are guards against the controls being removed
 * or quietly weakened, which is the realistic failure — not a subtle logic
 * bug in four lines of counter.
 */

const SRC = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("inline verification gate", () => {
  it("passes a verify callback to dispatchEmail", () => {
    // The gate that cannot be skipped. Without this the audit is advisory
    // and a defect reaches the inbox the moment nobody remembers to run it.
    expect(SRC).toContain("verify:");
    expect(SRC).toContain("verifyRenderedEmail");
  });

  it("uses the SHARED verifier, not a local reimplementation", () => {
    expect(SRC).toContain('from "@/lib/email/verify-render"');
    // A local copy of the poison list would drift from the audit's.
    expect(SRC).not.toMatch(/const POISON\s*=/);
  });

  it("blocks on blocking defects only", () => {
    // A long subject must never hold back a send; only `block` severity does.
    expect(SRC).toContain("blockingDefects");
  });

  it("builds the containment corpus from this trip's own values", () => {
    expect(SRC).toContain("ownEnrichmentStrings");
    // JSON.stringify would escape embedded quotes and break containment for
    // any trip whose copy contains one.
    expect(SRC).not.toMatch(/ownStrings:\s*JSON\.stringify/);
  });
});

describe("canary send cap", () => {
  it("reads TRIP_NOTIFICATIONS_SEND_CAP", () => {
    expect(SRC).toContain("TRIP_NOTIFICATIONS_SEND_CAP");
  });

  it("counts sends, not rows examined", () => {
    // A cap of 5 must mean five real emails. If it counted rows, a run where
    // most rows were suppressed would burn the budget without sending
    // anything, and the canary would prove nothing.
    expect(SRC).toMatch(/sent\s*>=\s*cap/);
  });

  it("treats a malformed cap as zero, never as unlimited", () => {
    // The dangerous direction: a typo in the env var turning the canary into
    // a full send. sendCap() returns 0 for anything unparseable.
    const fn = SRC.slice(SRC.indexOf("function sendCap"));
    expect(fn).toContain("Number.isFinite");
    expect(fn).toMatch(/:\s*0;/);
  });

  it("reports what it deferred instead of truncating silently", () => {
    // A run that sent 5 of 40 must not read like a run that had 5 to send.
    expect(SRC).toContain("deferredByCap");
  });

  it("leaves capped rows pending rather than marking them", () => {
    // `break` before processRow means the row is never touched, so it simply
    // goes out on a later run with no state to repair. A `continue` that
    // persisted an outcome would strand them.
    const loop = SRC.slice(SRC.indexOf("for (const row of dueRows)"));
    const capBlock = loop.slice(0, loop.indexOf("try {"));
    expect(capBlock).toContain("break");
    expect(capBlock).not.toContain("persistOutcome");
  });
});

describe("a cancelled trip must never generate mail", () => {
  it("suppresses a queued row whose trip has since been cancelled", () => {
    // Checked at DISPATCH, not only at enqueue, because cancelling happens
    // after the cascade is already queued. Measured 2026-08-28: five
    // cancelled trips still held 23 scheduled rows, all future-dated, none
    // muted — including a Sicily trip cancelled in July that would have sent
    // "Three days to Palermo" in August.
    expect(SRC).toContain("trip_cancelled");
    expect(SRC).toMatch(/trip\.status === "cancelled"/);
  });

  it("selects status so the check has something to read", () => {
    // The guard is silently dead without this: trip.status would be
    // undefined and the comparison always false.
    expect(SRC).toMatch(/reminders_muted,\s*status/);
  });

  it("does NOT gate on 'planning' or require 'confirmed'", () => {
    // 'planning' is the DEFAULT (302 of 394 live trips) and means only that
    // nobody touched a control most users never see. Gating on 'confirmed'
    // would silence ~84% of legitimate reminders.
    expect(SRC).not.toMatch(/status === "planning"/);
    expect(SRC).not.toMatch(/status !== "confirmed"/);
  });
});

describe("the post-trip exit condition survives", () => {
  it("still suppresses once the user plans another trip", () => {
    expect(SRC).toContain("user_has_new_trip");
  });
});
