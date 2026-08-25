import { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { validateInvite, type InviteData } from "@/lib/api/invite-validation";
import InviteAcceptClient from "./InviteAcceptClient";

interface PageProps {
  params: Promise<{ token: string; locale: string }>;
}

async function getInviteData(token: string) {
  // Use admin client for public invite preview (bypasses RLS)
  // This is safe because we only expose limited preview data
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // SECURITY (task #170): anonymous lookups go through the
  // get_invite_by_token SECURITY DEFINER RPC, NOT a direct table select.
  // The trip_invites table no longer has a public-read RLS policy — the
  // old `USING (true)` policy let anon clients dump every token in the
  // table. The RPC returns at most one row, and only when the invite is
  // still usable (active, not expired, not exhausted), so a usable invite
  // is the only case that returns data. Any non-usable state collapses
  // to "INVALID_TOKEN" here, matching the safer anon-callable contract.
  //
  // `message` was added 2026-05-23 along with recipient_email + recipient_locale
  // for the invite-by-email flow — it's the inviter's personal note shown
  // above the trip summary on this page. The RPC returns it.
  const { data: invites, error: inviteError } = await supabase
    .rpc("get_invite_by_token", { p_token: token });

  // The RPC RETURNS TABLE, so the client returns an array. The function
  // body's `LIMIT 1` guarantees at most one row.
  let invite = Array.isArray(invites) ? invites[0] : null;

  // Day-2 audit Bug 1: when get_invite_by_token returns no rows we can't
  // distinguish "token doesn't exist" from "exists but is expired /
  // revoked / exhausted" — both collapse to INVALID_TOKEN, hiding the
  // EXPIRED / REVOKED / MAX_USES UX entirely. Fall back to the
  // status-only RPC (no usability filter) and re-run the shared
  // validator so we can surface the precise error_code.
  if (inviteError || !invite) {
    const { data: statusRows } = await supabase
      .rpc("get_invite_status_by_token", { p_token: token });
    const statusInvite = Array.isArray(statusRows) ? statusRows[0] : null;
    if (!statusInvite) {
      return { error: "INVALID_TOKEN" as const };
    }
    const validation = validateInvite(statusInvite as InviteData);
    if (!validation.valid && validation.errorCode && validation.errorCode !== "NOT_FOUND") {
      // Stripped tripTitle so the error screen can stay generic but
      // we expose just enough for "Trip name was X" in future copy.
      return { error: validation.errorCode };
    }
    // Edge case: status RPC returned a row but it actually IS still
    // usable (race condition / clock skew between RPCs). Fall through
    // using the status row as the invite source.
    invite = statusInvite;
  }

  // Fetch trip
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, title, description, start_date, end_date, cover_image_url, user_id, itinerary")
    .eq("id", invite.trip_id)
    .single();

  if (tripError || !trip) {
    return { error: "TRIP_NOT_FOUND" as const };
  }

  // Day-2 audit Bug 3 (P3, info-leak): when the invite was sent to a
  // specific recipient_email, don't render the full trip preview to
  // anyone holding the token. Anonymous viewers and signed-in users
  // whose email doesn't match the recipient see a stripped screen with
  // just the trip title. The accept POST (route.ts) already enforces
  // this gate — without mirroring it here, an attacker with the token
  // can still see title, destination, dates, cover image, owner +
  // inviter names + avatars, and the personal message.
  if (invite.recipient_email) {
    let viewerEmail: string | null = null;
    try {
      const serverClient = await createServerSupabase();
      const { data: { user } } = await serverClient.auth.getUser();
      viewerEmail = (user?.email ?? "").toLowerCase().trim() || null;
    } catch {
      // Treat any auth-resolution failure as anonymous — fail closed.
      viewerEmail = null;
    }
    const expected = String(invite.recipient_email).toLowerCase().trim();
    if (!viewerEmail || viewerEmail !== expected) {
      return {
        error: "RECIPIENT_MISMATCH" as const,
        tripTitle: trip.title as string,
      };
    }
  }

  // Fetch owner profile from users table
  const { data: owner } = await supabase
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", trip.user_id)
    .single();

  // Fetch inviter profile (if different from owner)
  let inviter = null;
  if (invite.created_by && invite.created_by !== trip.user_id) {
    const { data: inviterProfile } = await supabase
      .from("users")
      .select("display_name, avatar_url")
      .eq("id", invite.created_by)
      .single();
    inviter = inviterProfile;
  }

  // Count collaborators
  const { count: collaboratorCount } = await supabase
    .from("trip_collaborators")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", invite.trip_id);

  // Extract destination from itinerary
  let destination = null;
  if (trip.itinerary && Array.isArray(trip.itinerary) && trip.itinerary.length > 0) {
    const firstDay = trip.itinerary[0] as { activities?: { location?: string }[] };
    if (firstDay?.activities?.[0]?.location) {
      destination = firstDay.activities[0].location;
    }
  }

  // Calculate duration
  const startDate = new Date(trip.start_date);
  const endDate = new Date(trip.end_date);
  const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  return {
    invite: {
      token: invite.token,
      role: invite.role,
      expiresAt: invite.expires_at,
      // Personal note from the inviter (may be null for shareable-link
      // invites or when the inviter didn't add one). InviteAcceptClient
      // renders it above the trip details — restores parity with the
      // email template that already shows the same message.
      message: (invite.message ?? null) as string | null,
    },
    trip: {
      id: trip.id,
      title: trip.title,
      description: trip.description,
      coverImageUrl: trip.cover_image_url,
      startDate: trip.start_date,
      endDate: trip.end_date,
      durationDays,
      destination,
      collaboratorCount: (collaboratorCount || 0) + 1, // +1 for owner
    },
    owner: {
      displayName: owner?.display_name || "Trip Owner",
      avatarUrl: owner?.avatar_url,
    },
    inviter: inviter ? {
      displayName: inviter.display_name,
      avatarUrl: inviter.avatar_url,
    } : null,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const data = await getInviteData(token);

  // Root layout's title.template appends " | MonkeyTravel" — page-level
  // titles must NOT include the suffix themselves, or we render the
  // duplicated "X | MonkeyTravel | MonkeyTravel" caught in COLLAB_AUDIT B2.
  if ("error" in data) {
    return {
      title: "Invalid Invite",
    };
  }

  return {
    title: `Join ${data.trip.title}`,
    description: `You've been invited to join a trip to ${data.trip.destination || data.trip.title}. Accept the invite to start planning together!`,
    openGraph: {
      title: `Join ${data.trip.title}`,
      description: `${data.inviter?.displayName || data.owner.displayName} invited you to join their trip.`,
      images: data.trip.coverImageUrl ? [data.trip.coverImageUrl] : [],
    },
  };
}

export default async function JoinPage({ params }: PageProps) {
  const { token, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common.invitePage");
  const data = await getInviteData(token);

  if ("error" in data) {
    const errorMap: Record<string, string> = {
      INVALID_TOKEN: "invalidToken",
      REVOKED: "revoked",
      EXPIRED: "expired",
      MAX_USES: "maxUses",
      TRIP_NOT_FOUND: "tripNotFound",
      RECIPIENT_MISMATCH: "recipientMismatch",
    };
    const errorKey = errorMap[data.error as string] ?? "invalidToken";

    return (
      <div className="min-h-screen min-h-dvh bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {t(`errors.${errorKey}`)}
          </h1>
          <p className="text-slate-600 mb-8">
            {t(`errors.${errorKey}Desc`)}
          </p>
          <a
            href={locale === "en" ? "/" : `/${locale}`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            {t("createYourOwnTrip")}
          </a>
        </div>
      </div>
    );
  }

  return <InviteAcceptClient {...data} />;
}
