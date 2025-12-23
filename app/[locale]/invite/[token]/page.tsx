import { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import InviteAcceptClient from "./InviteAcceptClient";

interface PageProps {
  params: Promise<{ token: string }>;
}

async function getInviteData(token: string) {
  // Use admin client for public invite preview (bypasses RLS)
  // This is safe because we only expose limited preview data
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Fetch invite with trip details
  const { data: invite, error: inviteError } = await supabase
    .from("trip_invites")
    .select("*")
    .eq("token", token)
    .single();

  if (inviteError || !invite) {
    return { error: "INVALID_TOKEN" };
  }

  // Check if invite is still valid
  if (!invite.is_active) {
    return { error: "REVOKED" };
  }

  if (new Date(invite.expires_at) < new Date()) {
    return { error: "EXPIRED" };
  }

  if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
    return { error: "MAX_USES" };
  }

  // Fetch trip
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, title, description, start_date, end_date, cover_image_url, user_id, itinerary")
    .eq("id", invite.trip_id)
    .single();

  if (tripError || !trip) {
    return { error: "TRIP_NOT_FOUND" };
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

  if ("error" in data) {
    return {
      title: "Invalid Invite | MonkeyTravel",
    };
  }

  return {
    title: `Join ${data.trip.title} | MonkeyTravel`,
    description: `You've been invited to join a trip to ${data.trip.destination || data.trip.title}. Accept the invite to start planning together!`,
    openGraph: {
      title: `Join ${data.trip.title}`,
      description: `${data.inviter?.displayName || data.owner.displayName} invited you to join their trip.`,
      images: data.trip.coverImageUrl ? [data.trip.coverImageUrl] : [],
    },
  };
}

export default async function JoinPage({ params }: PageProps) {
  const { token } = await params;
  const data = await getInviteData(token);

  if ("error" in data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {data.error === "INVALID_TOKEN" && "Invalid Invite Link"}
            {data.error === "REVOKED" && "Invite Revoked"}
            {data.error === "EXPIRED" && "Invite Expired"}
            {data.error === "MAX_USES" && "Invite Already Used"}
            {data.error === "TRIP_NOT_FOUND" && "Trip Not Found"}
          </h1>
          <p className="text-slate-600 mb-8">
            {data.error === "INVALID_TOKEN" && "This invite link doesn't exist or may have been deleted."}
            {data.error === "REVOKED" && "The trip owner has revoked this invite."}
            {data.error === "EXPIRED" && "This invite link has expired. Please ask for a new one."}
            {data.error === "MAX_USES" && "This invite has already been used. Please ask for a new one."}
            {data.error === "TRIP_NOT_FOUND" && "The trip associated with this invite no longer exists."}
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Create Your Own Trip
          </a>
        </div>
      </div>
    );
  }

  return <InviteAcceptClient {...data} />;
}
