import { describe, it, expect } from "vitest";
import { createUndoLedger } from "./assistant-undo";

const plan = (name: string) => ({ name });

describe("createUndoLedger", () => {
  it("hands back the plan before an edit while the plan is still that edit's result", () => {
    const ledger = createUndoLedger<{ name: string }, string>();
    const before = plan("original");
    const after = plan("with day 2 changed");
    const id = ledger.record(before, after, "2026-11-14");
    expect(ledger.take(id, after)).toEqual({ before, after, extra: "2026-11-14" });
  });

  it("refuses once the plan has changed since, so nothing later is wiped", () => {
    const ledger = createUndoLedger<{ name: string }, string>();
    const after = plan("with day 2 changed");
    const id = ledger.record(plan("original"), after, "");
    expect(ledger.take(id, plan("new dates since"))).toBeNull();
  });

  it("undoes edits newest first, each back to the one before", () => {
    const ledger = createUndoLedger<{ name: string }, string>();
    const p0 = plan("original");
    const p1 = plan("first edit");
    const p2 = plan("second edit");
    const first = ledger.record(p0, p1, "");
    const second = ledger.record(p1, p2, "");
    expect(ledger.take(first, p2)).toBeNull();
    expect(ledger.take(second, p2)?.before).toBe(p1);
    expect(ledger.take(first, p1)?.before).toBe(p0);
  });

  it("undoes an edit once", () => {
    const ledger = createUndoLedger<{ name: string }, string>();
    const after = plan("edited");
    const id = ledger.record(plan("original"), after, "");
    expect(ledger.take(id, after)).not.toBeNull();
    expect(ledger.take(id, after)).toBeNull();
  });
});
