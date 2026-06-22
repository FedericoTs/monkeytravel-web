import { getAuthenticatedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * POST /api/feedback
 *
 * Stores a power-user demand-discovery survey response into `user_feedback`
 * (RLS-locked, service-role only). In-app submissions are authenticated; the
 * user is resolved if present but not hard-required, so a future tokenized
 * email-link path can supply identity differently without a rewrite.
 */
const SOURCES = ["in_app", "email_link", "newsletter"] as const;
const WOULD = ["yes", "maybe", "no"] as const;

function clean(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUser();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest("Invalid JSON");
  }

  const source = SOURCES.includes(body.source as never)
    ? (body.source as string)
    : "in_app";
  const wouldRaw =
    typeof body.would_book_through_us === "string" ? body.would_book_through_us : "";
  const would = WOULD.includes(wouldRaw as never) ? wouldRaw : null;
  const openToChat = body.open_to_chat === true;
  const contactEmail = clean(body.contact_email, 254);

  const usesFor = clean(body.uses_for);
  const almostStopped = clean(body.almost_stopped);
  const lastBooked = clean(body.last_booked_where);

  // Don't persist empty rows — require at least one substantive answer.
  if (
    !usesFor &&
    !almostStopped &&
    !lastBooked &&
    !would &&
    !(openToChat && contactEmail)
  ) {
    return apiSuccess({ saved: false });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("user_feedback").insert({
    user_id: user?.id ?? null,
    source,
    uses_for: usesFor,
    almost_stopped: almostStopped,
    last_booked_where: lastBooked,
    would_book_through_us: would,
    open_to_chat: openToChat,
    contact_email: openToChat ? contactEmail : null,
  });

  if (error) {
    console.error("[Feedback] insert failed:", error.message);
    return errors.internal("Failed to save feedback", "Feedback");
  }

  return apiSuccess({ saved: true });
}
