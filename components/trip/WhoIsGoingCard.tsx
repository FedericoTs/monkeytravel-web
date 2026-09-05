"use client";

/**
 * The owner's "Who's going" (Live Trip Phase 2.4): count, names, join times,
 * and a Remove per row. Empty state sends the owner to the share flow with
 * the participant framing ("send it to the people coming"), not the vote one.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { initialsOf, type OwnerParticipant } from "@/lib/participants/shared";

interface WhoIsGoingCardProps {
  tripId: string;
  onShare?: () => void;
  className?: string;
}

export default function WhoIsGoingCard({ tripId, onShare, className = "" }: WhoIsGoingCardProps) {
  // Messages are namespaced by file; share.participants.* lives in common.json.
  const t = useTranslations("common");
  const locale = useLocale();
  const [rows, setRows] = useState<OwnerParticipant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/participants`, { cache: "no-store" });
        if (!res.ok) {
          if (alive) setRows([]);
          return;
        }
        const json = (await res.json()) as { participants?: OwnerParticipant[] };
        if (alive) setRows(json.participants ?? []);
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tripId]);

  const remove = useCallback(
    async (id: string) => {
      if (removing) return;
      setRemoving(id);
      setError(null);
      const before = rows ?? [];
      setRows(before.filter((r) => r.id !== id));
      try {
        const res = await fetch(`/api/trips/${tripId}/participants/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
      } catch {
        setRows(before);
        setError(t("share.participants.error"));
      } finally {
        setRemoving(null);
      }
    },
    [removing, rows, tripId, t],
  );

  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const count = rows?.length ?? 0;

  return (
    <section
      data-testid="who-is-going"
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}
      aria-label={t("share.participants.whoIsGoing")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900">
          {t("share.participants.whoIsGoing")}
          {rows !== null && (
            <span className="ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--primary-ink)]">
              {t("share.participants.going", { count })}
            </span>
          )}
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

      {rows === null ? (
        <p className="mt-3 text-sm text-slate-500">…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{t("share.participants.noneYet")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2" data-testid="who-is-going-row">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary-ink)]">
                {initialsOf(p.display_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {p.display_name ?? t("share.participants.anonymous")}
                </p>
                <p className="text-xs text-slate-500">
                  {t("share.participants.joinedAt", { when: fmt(p.joined_at) })}
                  {p.has_email ? ` · ${t("share.participants.getsUpdates")}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(p.id)}
                disabled={removing === p.id}
                className="text-xs text-slate-500 hover:text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
              >
                {t("share.participants.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
