import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { MAX_KEPT_PLAN_BYTES, parseKeptPlan, type KeptPlan } from "@/lib/plans/kept-plan";

/** A new plan's token (in its link) and key (held by the browser that kept it). */
export function newKeptPlanSecrets(): { token: string; key: string } {
  return { token: randomBytes(16).toString("base64url"), key: randomBytes(32).toString("base64url") };
}

/** What the table stores instead of the key. */
export function keptPlanKeyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The plan in a request body `{ plan }`, or why there is none. */
export async function readKeptPlanBody(request: NextRequest): Promise<{ plan: KeptPlan } | { error: string }> {
  const raw = await request.text();
  if (raw.length > MAX_KEPT_PLAN_BYTES) return { error: "Plan is too large to keep." };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: "Invalid JSON body." };
  }
  const plan = parseKeptPlan((body as { plan?: unknown } | null)?.plan);
  return plan ? { plan } : { error: "Not a plan that can be kept." };
}
