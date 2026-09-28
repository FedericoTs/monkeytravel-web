import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addBananas, addCollaborationBananas } from "./transactions";

const client = (rpcResult: { data?: unknown; error?: unknown }) => {
  const rpc = vi.fn<(fn: string, params: Record<string, unknown>) => Promise<typeof rpcResult>>(async () => rpcResult);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
};

afterEach(() => vi.restoreAllMocks());

describe("addBananas", () => {
  it("credits through the add_bananas function and reports the new balance", async () => {
    const { supabase, rpc } = client({ data: [{ new_balance: 75, transaction_id: "tx-1" }], error: null });
    const result = await addBananas(supabase, "user-1", 50, "collaboration", "collab-1", "Friend joined your trip");
    expect(result).toEqual({ success: true, newBalance: 75, transactionId: "tx-1" });
    expect(rpc).toHaveBeenCalledWith("add_bananas", {
      p_user_id: "user-1",
      p_amount: 50,
      p_type: "collaboration",
      p_reference_id: "collab-1",
      p_description: "Friend joined your trip",
    });
  });

  it("treats a credit that already exists as already awarded, quietly", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = client({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "uniq_banana_tx_credit_idempotency"' },
    });
    const result = await addBananas(supabase, "user-1", 50, "collaboration", "collab-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("already_awarded");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("still logs any other database error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = client({ data: null, error: { code: "42501", message: "permission denied" } });
    const result = await addBananas(supabase, "user-1", 50, "collaboration", "collab-1");
    expect(result).toMatchObject({ success: false, error: "permission denied" });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("addCollaborationBananas", () => {
  it("keys the award by the friend's join, so one link can reward several friends", async () => {
    const { supabase, rpc } = client({ data: [{ new_balance: 50, transaction_id: "tx-1" }], error: null });
    await addCollaborationBananas(supabase, "inviter-1", "collab-row-1");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_type: "collaboration", p_reference_id: "collab-row-1" });
  });
});
