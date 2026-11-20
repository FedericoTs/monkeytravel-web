/**
 * What the trip page's assistant may say about its own messages: the
 * traveller's real numbers, the ones the counter under the chat shows. Asked
 * how many free questions they get, a traveller was told the assistant is
 * unlimited and that the counter on their screen means nothing, because the
 * assistant had never been given the numbers.
 */
import type { UsageCheckResult } from "@/lib/usage-limits/types";

export type AssistantAllowance =
  | { left: number; limit: number; period: "daily" | "monthly"; renews: string }
  | { unlimited: true };

/** The traveller's messages after this one (as the counter shows them), or none at all for a plan with no limit. */
export function allowanceFrom(usage: Pick<UsageCheckResult, "remaining" | "limit" | "resetAt"> & { periodType?: string }): AssistantAllowance {
  if (usage.limit < 0) return { unlimited: true };
  return {
    left: Math.max(0, usage.remaining - 1),
    limit: usage.limit,
    period: usage.periodType === "daily" ? "daily" : "monthly",
    renews: usage.resetAt,
  };
}

/** One line for the assistant's instructions: answer questions about itself from these numbers only. */
export function allowanceRule(allowance: AssistantAllowance | undefined): string {
  if (!allowance) {
    return "Asked about this assistant's own limits or price: you can't see this traveller's numbers here, so say so instead of guessing, and never say it is unlimited or that they can ask as many questions as they like.";
  }
  if ("unlimited" in allowance) {
    return "Asked about this assistant itself (how many messages, whether it's free): this traveller's messages have no limit.";
  }
  const when = allowance.period === "daily" ? "today" : "this month";
  return `Asked about this assistant itself (how many messages, whether it's free, when they renew): this traveller has ${allowance.left} of ${allowance.limit} messages left ${when}, and they renew on ${allowance.renews.slice(0, 10)}. Answer only from these numbers, which the counter under the chat shows too: never call it unlimited, never say they can ask as many questions as they like, and never say the counter means something else.`;
}
