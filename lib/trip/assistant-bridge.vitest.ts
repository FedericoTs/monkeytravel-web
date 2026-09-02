/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { decideAssistantBridge, type AssistantBridgeMessage } from "./assistant-bridge";

const q: AssistantBridgeMessage = { role: "user" };
const a: AssistantBridgeMessage = { role: "assistant" };
const applied: AssistantBridgeMessage = { role: "assistant", editState: "applied" };
const pending: AssistantBridgeMessage = { role: "assistant", editState: "pending" };
const discarded: AssistantBridgeMessage = { role: "assistant", editState: "discarded" };

const decide = (messages: AssistantBridgeMessage[], canSave = true, canShare = true) =>
  decideAssistantBridge({ messages, canSave, canShare });

describe("the half that used to be offered nothing", () => {
  it("shows a bridge after a question-only exchange", () => {
    const d = decide([q, a]);
    expect(d.show).toBe(true);
    expect(d.mode).toBe("qa_only");
    expect(d.source).toBe("post_qa");
  });

  it("still shows it when an edit was proposed but never applied", () => {
    // 50 sessions/30d looked like this and saw nothing under the old gate.
    expect(decide([q, pending]).show).toBe(true);
    expect(decide([q, pending]).mode).toBe("qa_only");
    expect(decide([q, discarded]).mode).toBe("qa_only");
  });
});

describe("the applied-edit half keeps its existing behaviour", () => {
  it("shows the edit-flavoured bridge and the post_edit source", () => {
    const d = decide([q, applied]);
    expect(d.show).toBe(true);
    expect(d.mode).toBe("edit_applied");
    expect(d.source).toBe("post_edit");
  });

  it("prefers edit_applied when a conversation contains both", () => {
    expect(decide([q, a, q, applied]).mode).toBe("edit_applied");
  });
});

describe("when there is nothing to say", () => {
  it("stays hidden before the assistant has answered", () => {
    expect(decide([]).show).toBe(false);
    expect(decide([q]).show).toBe(false);
  });

  it("stays hidden once the trip is saved — the parent offers neither path", () => {
    expect(decide([q, applied], false, false).show).toBe(false);
    expect(decide([q, a], false, false).show).toBe(false);
  });

  it("shows when only one of the two offers is available", () => {
    expect(decide([q, a], true, false).show).toBe(true);
    expect(decide([q, a], false, true).show).toBe(true);
  });

  it("reports a mode and source even while hidden, so callers can log without branching", () => {
    const d = decide([], false, false);
    expect(d.mode).toBe("qa_only");
    expect(d.source).toBe("post_qa");
  });
});
