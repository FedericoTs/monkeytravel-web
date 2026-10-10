import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actorKey } from "@/lib/expenses/shared";
import type { ParticipantSource } from "@/lib/participants/shared";

/**
 * Who is in a trip's group, one entry per person: the owner, every
 * collaborator, and everyone who tapped "I'm going" and hasn't left. A person
 * is keyed by their account when there is one, otherwise by the browser
 * cookie they joined from. Every feature that splits or lists the group reads
 * this, so they agree on who it is.
 */
export interface RosterPerson {
  /** "u:<userId>" for an account, "c:<cookie>" for a guest. */
  key: string;
  userId: string | null;
  cookieId: string | null;
  /** The name they gave when they tapped "I'm going", if they did. */
  name: string | null;
  /** "owner" or their collaborator role; null for someone who only said they're going. */
  role: string | null;
  going: boolean;
  /** Their "I'm going" row, if they tapped it, and where they tapped it. */
  participant: { id: string; joinedAt: string; hasEmail: boolean; source: ParticipantSource } | null;
}

export type CohortMember = Pick<RosterPerson, "userId" | "cookieId" | "name">;

/** The trip's group. Fails rather than return part of it, so nothing is split across a partial group. */
export async function tripRoster(
  admin: SupabaseClient,
  trip: { id: string; user_id: string | null },
): Promise<{ roster: RosterPerson[]; error: unknown }> {
  const [collaborators, participants] = await Promise.all([
    admin.from("trip_collaborators").select("user_id, role").eq("trip_id", trip.id).order("joined_at", { ascending: true }),
    admin
      .from("trip_participants")
      .select("id, participant_cookie_id, user_id, display_name, email, joined_at, source")
      .eq("trip_id", trip.id)
      .is("left_at", null)
      .order("joined_at", { ascending: true }),
  ]);
  const error = collaborators.error ?? participants.error;
  if (error) return { roster: [], error };

  const byKey = new Map<string, RosterPerson>();
  // Of one person's "I'm going" rows, the first, unless only a later one came through the share link.
  const confirmedFirst = (a: RosterPerson["participant"], b: RosterPerson["participant"]) =>
    a && b && a.source === "public" && b.source !== "public" ? b : (a ?? b);
  const put = (p: RosterPerson) => {
    const seen = byKey.get(p.key);
    if (!seen) byKey.set(p.key, p);
    else
      byKey.set(p.key, {
        ...seen,
        role: seen.role ?? p.role,
        going: seen.going || p.going,
        name: seen.name ?? p.name,
        participant: confirmedFirst(seen.participant, p.participant),
      });
  };
  if (trip.user_id) {
    put({ key: actorKey(trip.user_id, null), userId: trip.user_id, cookieId: null, name: null, role: "owner", going: false, participant: null });
  }
  for (const c of collaborators.data ?? []) {
    const userId = c.user_id as string;
    put({ key: actorKey(userId, null), userId, cookieId: null, name: null, role: (c.role as string | null) ?? null, going: false, participant: null });
  }
  for (const p of participants.data ?? []) {
    const userId = (p.user_id as string | null) ?? null;
    const cookieId = userId ? null : ((p.participant_cookie_id as string | null) ?? null);
    put({
      key: actorKey(userId, cookieId),
      userId,
      cookieId,
      name: (p.display_name as string | null) ?? null,
      role: null,
      going: true,
      participant: { id: p.id as string, joinedAt: p.joined_at as string, hasEmail: !!p.email, source: p.source as ParticipantSource },
    });
  }
  return { roster: [...byKey.values()], error: null };
}

/**
 * Whether a person shares a new expense: the owner, editors, voters, and
 * anyone who said they're going through the share link. A viewer is often
 * someone following along, so they share only once they tap "I'm going".
 * Anyone could tap it on the public trip page, so that alone doesn't count.
 */
export function sharesExpenses(p: RosterPerson): boolean {
  return (p.going && p.participant?.source !== "public") || p.role === "owner" || p.role === "editor" || p.role === "voter";
}

/** Who a new expense is split across: everyone who shares, plus the payer, once. */
export function expenseCohort(roster: RosterPerson[], payer: CohortMember | null): CohortMember[] {
  const cohort: CohortMember[] = roster.filter(sharesExpenses).map(({ userId, cookieId, name }) => ({ userId, cookieId, name }));
  if (payer && (payer.userId || payer.cookieId)) {
    const key = actorKey(payer.userId, payer.cookieId);
    if (!roster.some((p) => p.key === key && sharesExpenses(p))) cohort.push(payer);
  }
  return cohort;
}
