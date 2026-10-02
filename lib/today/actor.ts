import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicNameOrNull } from "@/lib/profile/public-name";
import { PARTICIPANT_COOKIE } from "@/lib/participants/shared";

/**
 * Who taps a chip or logs a payment on a live trip's Today. Signed in, a
 * person acts as their account on every device; a guest acts as their
 * browser's cookie, which also still marks what a person wrote on that
 * browser before signing in.
 */
export interface TodayActor {
  userId: string | null;
  cookieId: string | null;
}

export interface TodayPerson extends TodayActor {
  isOwner: boolean;
  /** The owner or a collaborator. */
  isMember: boolean;
  /** Shown on their taps and payments; null reads as "The owner" or "someone". */
  name: string | null;
}

/** Whether a tap or payment belongs to this person: by account, or written on this browser. */
export function isTodayActor(actor: TodayActor, row: TodayActor): boolean {
  return (!!actor.userId && row.userId === actor.userId) || (!!actor.cookieId && row.cookieId === actor.cookieId);
}

/** The cookie a new tap or payment is stored under: none when signed in, so the account identifies it everywhere. */
export function storedCookie(actor: TodayActor): string | null {
  return actor.userId ? null : actor.cookieId;
}

/** This browser's guest cookie, if it holds a usable one. The members' routes read it but never set one. */
export async function browserGuestCookie(): Promise<string | null> {
  const value = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
  return value && value.length >= 10 && value.length <= 60 ? value : null;
}

const NAME_MAX = 60;

/**
 * The person behind a Today request. The owner and collaborators show their
 * public profile name; anyone else the name they gave when they tapped
 * "I'm going".
 */
export async function resolveTodayPerson(
  admin: SupabaseClient,
  trip: { id: string; user_id: string | null },
  user: { id: string; email?: string | null } | null,
  cookieId: string | null,
): Promise<TodayPerson> {
  const isOwner = !!user && user.id === trip.user_id;
  const isMember =
    isOwner ||
    (!!user &&
      !!(await admin.from("trip_collaborators").select("user_id").eq("trip_id", trip.id).eq("user_id", user.id).maybeSingle()).data);
  const person = { userId: user?.id ?? null, cookieId, isOwner, isMember };

  if (user && isMember) {
    const { data: profile } = await admin.from("users").select("display_name").eq("id", user.id).maybeSingle();
    const name = publicNameOrNull(profile?.display_name as string | null | undefined, user.email);
    if (name) return { ...person, name: name.slice(0, NAME_MAX) };
  }
  if (user) {
    const { data: joined } = await admin
      .from("trip_participants")
      .select("display_name")
      .eq("trip_id", trip.id)
      .eq("user_id", user.id)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (joined?.display_name) return { ...person, name: joined.display_name as string };
  }
  if (!cookieId) return { ...person, name: null };
  const { data: participant } = await admin
    .from("trip_participants")
    .select("display_name")
    .eq("trip_id", trip.id)
    .eq("participant_cookie_id", cookieId)
    .maybeSingle();
  return { ...person, name: (participant?.display_name as string | null) ?? null };
}
