/**
 * Should the anonymous assistant offer the planner anything, and what?
 *
 * An offer gated on `editState === "applied"` (inside the edit-preview card)
 * never reaches a session that only ASKED questions (no proposed edit,
 * nothing to apply), and sessions that are offered the bridge save more
 * often.
 *
 * The decision lives here rather than in the 365-line panel so the guarantee
 * that matters ("a question-only conversation still gets an offer") is pinned
 * by a test instead of by reading JSX.
 */

export type AssistantBridgeMode = "edit_applied" | "qa_only";
/** PostHog `source` on save_nudge_shown / save_nudge_action, kept as the existing vocabulary. */
export type AssistantBridgeSource = "post_edit" | "post_qa";

export interface AssistantBridgeMessage {
  role: "user" | "assistant";
  editState?: "pending" | "applied" | "discarded";
}

export interface AssistantBridgeInput {
  messages: AssistantBridgeMessage[];
  /** The parent can still persist (unsaved, and the manual arm owns saving). */
  canSave: boolean;
  /** The parent supplied a deliverable — a share link needing no account. */
  canShare: boolean;
}

export interface AssistantBridgeDecision {
  show: boolean;
  mode: AssistantBridgeMode;
  source: AssistantBridgeSource;
}

export function decideAssistantBridge(input: AssistantBridgeInput): AssistantBridgeDecision {
  const { messages, canSave, canShare } = input;
  const editApplied = messages.some((m) => m.editState === "applied");
  const mode: AssistantBridgeMode = editApplied ? "edit_applied" : "qa_only";
  const source: AssistantBridgeSource = editApplied ? "post_edit" : "post_qa";

  // The assistant must have actually answered: investment is what earns the
  // ask, and a bridge under an unanswered question is just clutter.
  const hasAnswer = messages.some((m) => m.role === "assistant");
  // Nothing to offer means no bridge. Once the trip is saved the parent passes
  // neither, which retroactively hides it — that is deliberate.
  const hasSomethingToOffer = canSave || canShare;

  return { show: hasAnswer && hasSomethingToOffer, mode, source };
}
