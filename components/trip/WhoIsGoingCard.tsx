"use client";

/**
 * The owner's "Who's going" (Live Trip Phase 2.4): the trip's group as the
 * expense split sees it (lib/trips/roster) — the owner, collaborators and
 * everyone who said they're going — with each one's role, join time, and
 * whether they have an account. The count is the people who share expenses.
 * Remove takes back an "I'm going" where that is what puts someone in the
 * group. The share button uses the participant framing ("send it to the
 * people coming"), not the vote one. Below the group, what people going
 * through the link don't want to miss, with one button to add what the plan
 * doesn't hold yet, and Undo.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { missingMustDos } from "@/lib/ai/must-do-match";
import { ItineraryWriteBlockedError } from "@/lib/trips/itinerary-sync";
import { initialsOf, type OwnerParticipant, type OwnerPicks } from "@/lib/participants/shared";
import type { ItineraryDay } from "@/types";

const ROLE_LABELS: Record<string, string> = {
  owner: "collaborators.owner",
  editor: "roles.editor.label",
  voter: "roles.voter.label",
  viewer: "roles.viewer.label",
};

interface Group {
  count: number;
  participants: OwnerParticipant[];
  picks: OwnerPicks[];
}

// The group always holds the owner, so while it loads their row keeps its
// place invisibly, like the pill and the empty-state line.
const LOADING_ROWS: OwnerParticipant[] = [
  { id: "loading", display_name: null, role: "owner", going: true, in_split: true, has_account: true, has_email: false, joined_at: null, participant_id: null },
];

async function loadGroup(tripId: string): Promise<Group> {
  try {
    const res = await fetch(`/api/trips/${tripId}/participants`, { cache: "no-store" });
    if (!res.ok) return { count: 0, participants: [], picks: [] };
    const json = (await res.json()) as Partial<Group>;
    return { count: json.count ?? 0, participants: json.participants ?? [], picks: json.picks ?? [] };
  } catch {
    return { count: 0, participants: [], picks: [] };
  }
}

/** What adding someone's must-dos did, while its Undo is offered. */
interface Fitted {
  participantId: string;
  added: string[];
  notFitted: string[];
  /** The plan it was written onto and the version it was written at, for Undo; absent when nothing was written. */
  previous?: ItineraryDay[];
  version?: number;
  undone?: boolean;
}

interface WhoIsGoingCardProps {
  tripId: string;
  onShare?: () => void;
  /** Told the group's size once it is read, and again when it changes. */
  onCount?: (count: number) => void;
  className?: string;
  /** The plan as the page shows it: whether it holds someone's must-dos yet. */
  itinerary?: ItineraryDay[];
  /** Runs a write of the plan made on the server in the page's save queue (hooks/useItinerarySync.ts). */
  runItineraryWrite?: <T>(task: () => Promise<T>) => Promise<T>;
  /** Takes a plan the server has stored, at the version it was stored at. */
  onItineraryChange?: (days: ItineraryDay[], version?: number | null) => void;
}

/** The payload of an apiSuccess answer, wrapped or not. */
async function payloadOf<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T } & T;
  return (body.data ?? body) as T;
}

export default function WhoIsGoingCard({
  tripId,
  onShare,
  onCount,
  className = "",
  itinerary,
  runItineraryWrite,
  onItineraryChange,
}: WhoIsGoingCardProps) {
  // Messages are namespaced by file; share.participants.* lives in common.json.
  const t = useTranslations("common");
  const locale = useLocale();
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [fitting, setFitting] = useState<string | null>(null);
  const [fitted, setFitted] = useState<Fitted | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const canFit = !!(itinerary && runItineraryWrite && onItineraryChange);

  useEffect(() => {
    let alive = true;
    void loadGroup(tripId).then((g) => {
      if (alive) setGroup(g);
    });
    return () => {
      alive = false;
    };
  }, [tripId]);

  useEffect(() => {
    if (group) onCount?.(group.count);
  }, [group, onCount]);

  // A collaborator who is removed stays in the list under their role, so the
  // list is read again rather than guessed.
  const remove = useCallback(
    async (participantId: string) => {
      if (removing) return;
      setRemoving(participantId);
      setError(null);
      try {
        const res = await fetch(`/api/trips/${tripId}/participants/${participantId}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        setGroup(await loadGroup(tripId));
      } catch {
        setError(t("share.participants.error"));
      } finally {
        setRemoving(null);
      }
    },
    [removing, tripId, t],
  );

  // The list's note that someone's picks were fitted in (as of when they sent them, not this device's
  // clock), until it is read again.
  const markFitted = useCallback(
    (participantId: string, placed: boolean) =>
      setGroup(
        (g) =>
          g && { ...g, picks: g.picks.map((p) => (p.participant_id === participantId ? { ...p, picks_placed_at: placed ? p.picks_at : null } : p)) },
      ),
    [],
  );

  // A blocked write (unsaved edits, a conflict) says why itself; else the status picks the message.
  const fitMessage = useCallback(
    (err: unknown, conflict: string) => {
      if (err instanceof ItineraryWriteBlockedError) return err.message;
      return t((err as { status?: number })?.status === 409 ? conflict : "share.participants.fit.failed");
    },
    [t],
  );

  // In the page's save queue: its edits are saved first, and it takes the stored plan at its version.
  const fit = useCallback(
    async (participantId: string) => {
      if (fitting || !runItineraryWrite || !onItineraryChange) return;
      setFitting(participantId);
      setFitError(null);
      setFitted(null);
      try {
        await runItineraryWrite(async () => {
          const res = await fetch(`/api/trips/${tripId}/participants/${participantId}/fit`, { method: "POST" });
          if (!res.ok) throw Object.assign(new Error("fit failed"), { status: res.status });
          const out = await payloadOf<{
            added?: string[];
            notFitted?: string[];
            itinerary?: ItineraryDay[] | null;
            previousItinerary?: ItineraryDay[];
            itineraryVersion?: number;
          }>(res);
          if (out.itinerary) onItineraryChange(out.itinerary, out.itineraryVersion ?? null);
          setFitted({
            participantId,
            added: out.added ?? [],
            notFitted: out.notFitted ?? [],
            ...(out.itinerary && out.previousItinerary ? { previous: out.previousItinerary, version: out.itineraryVersion } : {}),
          });
          markFitted(participantId, true);
        });
      } catch (err) {
        setFitError(fitMessage(err, "share.participants.fit.busy"));
      } finally {
        setFitting(null);
      }
    },
    [fitting, runItineraryWrite, onItineraryChange, tripId, markFitted, fitMessage],
  );

  // Puts back the plan the picks were written onto, while it is as they left it.
  const undoFit = useCallback(async () => {
    const last = fitted;
    if (!last?.previous || last.undone || !runItineraryWrite || !onItineraryChange) return;
    const previous = last.previous;
    setFitError(null);
    try {
      await runItineraryWrite(async () => {
        const res = await fetch("/api/ai/assistant/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tripId, previousItinerary: previous, expectedVersion: last.version }),
        });
        if (!res.ok) throw Object.assign(new Error("undo failed"), { status: res.status });
        const out = await payloadOf<{ itineraryVersion?: number }>(res);
        onItineraryChange(previous, out.itineraryVersion ?? null);
      });
      setFitted({ ...last, undone: true });
      markFitted(last.participantId, false);
      // Offered again on the next visit too.
      void fetch(`/api/trips/${tripId}/participants/${last.participantId}/fit`, { method: "DELETE" }).catch(() => {});
    } catch (err) {
      setFitError(fitMessage(err, "share.participants.fit.undoFailed"));
    }
  }, [fitted, runItineraryWrite, onItineraryChange, tripId, markFitted, fitMessage]);

  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const rows = group?.participants ?? null;
  const shown = rows ?? LOADING_ROWS;
  const count = group?.count ?? 0;
  const justTheOwner = !rows || rows.every((p) => p.role === "owner");

  const details = (p: OwnerParticipant) =>
    [
      p.role && ROLE_LABELS[p.role] ? t(ROLE_LABELS[p.role]) : null,
      p.going && p.joined_at ? t("share.participants.joinedAt", { when: fmt(p.joined_at) }) : null,
      p.has_account ? null : t("share.participants.guest"),
      p.has_email ? t("share.participants.getsUpdates") : null,
      // Going but not sharing: they said so on the public page, not through the share link.
      p.in_split ? null : p.going ? t("share.participants.notInExpensesYet") : t("share.participants.followingAlong"),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section
      data-testid="who-is-going"
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}
      aria-label={t("share.participants.whoIsGoing")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* While the list loads, the pill and the empty-state line hold their
            place invisibly: the pill's width decides whether the button wraps
            below the heading on a phone, which used to move the page. */}
        <h2 className="text-base font-bold text-slate-900">
          {t("share.participants.whoIsGoing")}
          <span
            className={`ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--foreground)] ${rows === null ? "invisible" : ""}`}
            aria-hidden={rows === null || undefined}
          >
            {t("share.participants.going", { count })}
          </span>
        </h2>
        {onShare && (
          <button
            type="button"
            onClick={onShare}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary-dark)] transition-colors"
          >
            {t("share.participants.sendToPeople")}
          </button>
        )}
      </div>

      {shown.length > 0 && (
        <ul className={`mt-3 divide-y divide-slate-100 ${rows === null ? "invisible" : ""}`} aria-hidden={rows === null || undefined}>
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2" data-testid="who-is-going-row">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--foreground)]">
                {initialsOf(p.display_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${p.in_split ? "text-slate-900" : "text-slate-500"}`}>
                  {p.display_name ?? t("share.participants.anonymous")}
                </p>
                <p className="text-xs text-slate-500">{details(p)}</p>
              </div>
              {/* Collaborators who share costs stay in through their role, so Remove is for the rest. */}
              {p.participant_id && (p.role === null || p.role === "viewer") && (
                <button
                  type="button"
                  onClick={() => void remove(p.participant_id as string)}
                  disabled={removing === p.participant_id}
                  className="text-xs text-slate-500 hover:text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {t("share.participants.remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(group?.picks.length ?? 0) > 0 && (
        <div className="mt-4 space-y-3" data-testid="who-is-going-picks">
          {group!.picks.map((p) => {
            const missing = itinerary ? missingMustDos(p.picks, itinerary) : [];
            const fittedAlready = p.picks_placed_at !== null && p.picks_placed_at >= p.picks_at;
            const result = fitted?.participantId === p.participant_id ? fitted : null;
            return (
              <div key={p.participant_id} className="rounded-xl bg-slate-50 p-3" data-testid="who-is-going-pick">
                <p className="text-sm font-medium text-slate-900">
                  {p.display_name ? t("share.participants.fit.title", { name: p.display_name }) : t("share.participants.fit.titleNoName")}
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                  {p.picks.map((pick) => (
                    <li key={pick}>{pick}</li>
                  ))}
                </ul>
                {canFit && missing.length > 0 && !fittedAlready && (
                  <button
                    type="button"
                    onClick={() => void fit(p.participant_id)}
                    disabled={fitting !== null}
                    className="mt-2 min-h-[44px] rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--primary-dark)] transition-colors disabled:opacity-60"
                  >
                    {fitting === p.participant_id ? t("share.participants.fit.working") : t("share.participants.fit.button")}
                  </button>
                )}
                {result && !result.undone && result.added.length > 0 && (
                  <p className="mt-2 text-sm text-slate-700" role="status">
                    {t("share.participants.fit.added", { list: result.added.join(", ") })}{" "}
                    {result.previous && (
                      <button type="button" onClick={() => void undoFit()} className="font-medium text-slate-900 underline underline-offset-2">
                        {t("share.participants.fit.undo")}
                      </button>
                    )}
                  </p>
                )}
                {result && !result.undone && result.notFitted.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">{t("share.participants.fit.noPlace", { list: result.notFitted.join(", ") })}</p>
                )}
                {result?.undone && (
                  <p className="mt-2 text-sm text-slate-700" role="status">
                    {t("share.participants.fit.undone")}
                  </p>
                )}
              </div>
            );
          })}
          {fitError && (
            <p className="text-xs text-red-600" role="alert">
              {fitError}
            </p>
          )}
        </div>
      )}
      {justTheOwner && (
        <p className={`mt-3 text-sm text-slate-600 ${rows === null ? "invisible" : ""}`} aria-hidden={rows === null || undefined}>
          {t("share.participants.noneYet")}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
