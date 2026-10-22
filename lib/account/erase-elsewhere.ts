import { Resend } from "resend";

/**
 * Removes the copies of a deleted account that other services hold: its
 * Resend contact, and its PostHog person with that person's events and
 * recordings. delete_user_account() clears our own tables; it cannot reach
 * these.
 *
 * Runs after the account is gone, so nothing here throws: each step reports
 * what happened, and a step whose keys are not set is skipped.
 */

export type EraseOutcome = "removed" | "absent" | "skipped" | "failed";

export interface EraseResult {
  resendContact: EraseOutcome;
  posthogPerson: EraseOutcome;
}

export async function eraseElsewhere(user: { id: string; email: string }): Promise<EraseResult> {
  const [resendContact, posthogPerson] = await Promise.all([
    removeResendContact(user.email),
    deletePostHogPerson(user.id),
  ]);
  return { resendContact, posthogPerson };
}

async function removeResendContact(email: string): Promise<EraseOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) return "skipped";
  try {
    const { error } = await new Resend(apiKey).contacts.remove({ email, audienceId });
    if (!error) return "removed";
    if (error.name === "not_found") return "absent";
    console.error("[Account erase] Resend contact removal failed:", error.message);
    return "failed";
  } catch (err) {
    console.error("[Account erase] Resend contact removal failed:", err);
    return "failed";
  }
}

// The private API lives on the app host (us.posthog.com), not the ingestion
// host (us.i.posthog.com). The key needs the person:write scope.
async function deletePostHogPerson(userId: string): Promise<EraseOutcome> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!apiKey) return "skipped";
  const host =
    process.env.POSTHOG_QUERY_HOST ||
    (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com").replace(".i.posthog.com", ".posthog.com");
  const projectId = process.env.POSTHOG_PROJECT_ID || "@current";
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/persons/bulk_delete/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ distinct_ids: [userId], delete_events: true, delete_recordings: true }),
    });
    if (!res.ok) {
      console.error(`[Account erase] PostHog person deletion failed: ${res.status}`);
      return "failed";
    }
    const body = (await res.json().catch(() => ({}))) as { persons_found?: number };
    return body.persons_found ? "removed" : "absent";
  } catch (err) {
    console.error("[Account erase] PostHog person deletion failed:", err);
    return "failed";
  }
}
