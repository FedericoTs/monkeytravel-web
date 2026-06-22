import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";

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

// 5 submissions/hour, keyed by user id when present, IP otherwise. This is the
// only public write path into user_feedback (the table is RLS-locked and the
// insert goes through the service-role client), so this limiter is the sole
// flood gate — matching every other anonymous write path in the app.
const feedbackLimiter = createRateLimiter("feedback", 5, 60 * 60 * 1000);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthenticatedUser();

  const { allowed } = await feedbackLimiter.check(request, user?.id);
  if (!allowed) {
    return errors.rateLimit("Too many submissions — please try again later.");
  }

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
  // Server-side email validation. The in-app <input type="email"> is bypassable
  // via direct POST, so reject anything that isn't a plain address here — also
  // strips CR/LF and mailto-param chars so a stored value can't poison the
  // admin mailto: links or the "open to chat" lead list.
  const rawEmail = clean(body.contact_email, 254);
  const contactEmail =
    rawEmail && EMAIL_RE.test(rawEmail) && !/[\r\n?&%]/.test(rawEmail)
      ? rawEmail
      : null;

  // Open-ended answers stay generous (the qualitative signal is the point);
  // the booking field is short. Both are bounded to limit paste-dumps.
  const usesFor = clean(body.uses_for, 1500);
  const almostStopped = clean(body.almost_stopped, 1500);
  const lastBooked = clean(body.last_booked_where, 200);

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
