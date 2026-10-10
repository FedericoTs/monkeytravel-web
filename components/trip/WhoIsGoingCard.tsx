"use client";

/**
 * The owner's "Who's going" (Live Trip Phase 2.4): the trip's group as the
 * expense split sees it (lib/trips/roster) — the owner, collaborators and
 * everyone who said they're going — with each one's role, join time, and
 * whether they have an account. The count is the people who share expenses.
 * Remove takes back an "I'm going" where that is what puts someone in the
 * group. The share button uses the participant framing ("send it to the
 * people coming"), not the vote one.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { initialsOf, type OwnerParticipant } from "@/lib/participants/shared";

const ROLE_LABELS: Record<string, string> = {
  owner: "collaborators.owner",
  editor: "roles.editor.label",
  voter: "roles.voter.label",
  viewer: "roles.viewer.label",
};

interface Group {
  count: number;
  participants: OwnerParticipant[];
}

async function loadGroup(tripId: string): Promise<Group> {
  try {
    const res = await fetch(`/api/trips/${tripId}/participants`, { cache: "no-store" });
    if (!res.ok) return { count: 0, participants: [] };
    const json = (await res.json()) as Partial<Group>;
    return { count: json.count ?? 0, participants: json.participants ?? [] };
  } catch {
    return { count: 0, participants: [] };
  }
}

interface WhoIsGoingCardProps {
  tripId: string;
  onShare?: () => void;
  className?: string;
}

export default function WhoIsGoingCard({ tripId, onShare, className = "" }: WhoIsGoingCardProps) {
  // Messages are namespaced by file; share.participants.* lives in common.json.
  const t = useTranslations("common");
  const locale = useLocale();
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadGroup(tripId).then((g) => {
      if (alive) setGroup(g);
    });
    return () => {
      alive = false;
    };
  }, [tripId]);

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

  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const rows = group?.participants ?? null;
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
            className={`ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--primary-ink)] ${rows === null ? "invisible" : ""}`}
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

      {rows && rows.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2" data-testid="who-is-going-row">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary-ink)]">
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
