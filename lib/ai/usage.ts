/**
 * Records each AI assistant request in ai_usage.
 */

import { createClient } from "@/lib/supabase/server";
import { logWriteError } from "@/lib/supabase/log-write-error";

export async function recordUsage(params: {
  userId: string;
  tripId?: string;
  modelId: string;
  action: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}): Promise<void> {
  const supabase = await createClient();

  logWriteError("ai usage", await supabase.from("ai_usage").insert({
    user_id: params.userId,
    trip_id: params.tripId,
    model_id: params.modelId,
    action: params.action,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_cents: params.costCents,
    created_at: new Date().toISOString(),
  }));
}
