import type { SaveFailedEvent } from "@/lib/posthog/events";

export type SaveErrorClass = SaveFailedEvent["error_class"];

/**
 * The bucket a failed trip save is charted under, from its error message.
 * Both save arms use it, so the dashboards count their failures alike.
 */
export function saveErrorClass(message: string): SaveErrorClass {
  if (/network|fetch|ECONN|timeout|no client session/i.test(message)) return "network";
  if (/rls|row-level|policy|permission|authenticated caller/i.test(message)) return "rls";
  if (/rate.?limit|429/i.test(message)) return "rate_limit";
  if (/invalid|required|missing|validation/i.test(message)) return "validation";
  return "unknown";
}
