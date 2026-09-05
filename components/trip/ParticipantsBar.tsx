"use client";

/**
 * The recipient header's action row (Live Trip Phase 2.2): "N going"
 * avatars · [I'm going] · [Share] · [More ▾]. Replaces the like/save/fork
 * trio and its zeros, and the vote banner (whose copy becomes the secondary
 * line under the button).
 *
 * Tapping "I'm going" is optimistic: the count and the state flip at once,
 * then POST /join confirms. On success the row asks, inline and in order,
 * for a name (optional) and then an email for this trip's notifications
 * (optional, purpose stated). "Not going" is one tap away the whole time.
 *
 * Identity is the mt_anon_voter cookie the join route mints (httpOnly), so
 * this component holds no id — it only ever asks the server "me?".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { initialsOf, type ParticipantSource, type ParticipantsResponse } from "@/lib/participants/shared";

interface ParticipantsBarProps {
  shareToken: string;
  source: ParticipantSource;
  /** `?vote=1` crew-ask link: the vote copy is the secondary line. */
  crewAsk: boolean;
  /** Absolute URL to share (falls back to location.href). */
  shareUrl?: string;
  tripTitle: string;
  onSaveForLater: () => void;
  /** Present only when the viewer may fork (signed in, not the owner). */
  onFork?: () => void;
  className?: string;
}

type Step = "idle" | "name" | "email" | "done";

const EMPTY: ParticipantsResponse = {
  count: 0,
  participants: [],
  me: { joined: false, display_name: null, has_email: false },
};

export default function ParticipantsBar({
  shareToken,
  source,
  crewAsk,
  shareUrl,
  tripTitle,
  onSaveForLater,
  onFork,
  className = "",
}: ParticipantsBarProps) {
  // Messages are namespaced by file; share.* and shared.* live in common.json.
  const t = useTranslations("common");
  const [data, setData] = useState<ParticipantsResponse>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [shared, setShared] = useState<"idle" | "copied">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const base = `/api/shared/${shareToken}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${base}/participants`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as ParticipantsResponse;
        if (alive && json && typeof json.count === "number") {
          setData(json);
          setName(json.me.display_name ?? "");
        }
      } catch {
        // The row still renders with zero; the tap still works.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [base]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<ParticipantsResponse | null> => {
      const res = await fetch(`${base}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || j?.message || t("share.participants.error"));
      }
      return (await res.json()) as ParticipantsResponse;
    },
    [base, source, t],
  );

  const join = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const before = data;
    // Optimistic: the count and the "You're in" pill flip at once. The name
    // prompt waits for the POST to confirm — an update needs the row to exist.
    setData({ ...data, count: data.count + 1, me: { ...data.me, joined: true } });
    try {
      const next = await post({ action: "join" });
      if (next) setData(next);
      setStep("name");
    } catch (e) {
      setData(before);
      setStep("idle");
      setError(e instanceof Error ? e.message : t("share.participants.error"));
    } finally {
      setBusy(false);
    }
  }, [busy, data, post, t]);

  const leave = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const before = data;
    setData({ ...data, count: Math.max(0, data.count - 1), me: { ...data.me, joined: false } });
    setStep("idle");
    try {
      const next = await post({ action: "leave" });
      if (next) setData(next);
    } catch (e) {
      setData(before);
      setError(e instanceof Error ? e.message : t("share.participants.error"));
    } finally {
      setBusy(false);
    }
  }, [busy, data, post, t]);

  const saveName = useCallback(async () => {
    // Reached only after join confirmed (step became "name"), so the row
    // exists. The disabled button + Playwright actionability prevent a
    // double-submit; no busy short-circuit here, or a fast Enter is swallowed.
    const value = name.trim();
    if (!value) {
      setStep(data.me.has_email ? "done" : "email");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await post({ action: "update", display_name: value });
      if (next) setData(next);
      setStep(data.me.has_email ? "done" : "email");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("share.participants.error"));
    } finally {
      setBusy(false);
    }
  }, [name, data.me.has_email, post, t]);

  const saveEmail = useCallback(async () => {
    const value = email.trim();
    if (!value) {
      setStep("done");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await post({ action: "update", email: value });
      if (next) setData(next);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("share.participants.error"));
    } finally {
      setBusy(false);
    }
  }, [email, post, t]);

  const share = useCallback(async () => {
    const url = shareUrl ?? (typeof window !== "undefined" ? window.location.href : "");
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: tripTitle, url });
        return;
      }
    } catch {
      // user cancelled the sheet — fall through to copy
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared("copied");
      setTimeout(() => setShared("idle"), 2000);
    } catch {
      setError(t("share.participants.error"));
    }
  }, [shareUrl, tripTitle, t]);

  const joined = data.me.joined;
  const shown = data.participants.slice(0, 5);
  const overflow = Math.max(0, data.count - shown.length);

  return (
    <section
      data-testid="participants-bar"
      className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm ${className}`}
      aria-label={t("share.participants.aria")}
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* N going — avatars from what participants typed */}
        <div className="flex items-center gap-2 min-w-0" data-testid="participants-count" data-count={data.count}>
          {data.count > 0 && (
            <div className="flex -space-x-2" aria-hidden="true">
              {shown.map((p) => (
                <span
                  key={p.id}
                  title={p.display_name ?? undefined}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary-ink)]"
                >
                  {initialsOf(p.display_name)}
                </span>
              ))}
              {overflow > 0 && (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[11px] font-bold text-slate-600">
                  +{overflow}
                </span>
              )}
            </div>
          )}
          <span className="text-sm font-semibold text-slate-800 whitespace-nowrap">
            {loaded || data.count > 0 ? t("share.participants.going", { count: data.count }) : " "}
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {joined ? (
            <span className="inline-flex items-center gap-2">
              <span
                data-testid="participants-joined"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 border border-emerald-200"
              >
                <span aria-hidden>✓</span>
                {t("share.participants.youreIn")}
              </span>
              <button
                type="button"
                onClick={leave}
                disabled={busy}
                className="text-xs text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline disabled:opacity-50"
              >
                {t("share.participants.notGoing")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={join}
              disabled={busy}
              data-testid="participants-join"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-semibold text-white shadow-lg shadow-[var(--primary)]/25 hover:bg-[var(--primary-dark)] transition-colors disabled:opacity-60"
            >
              <span aria-hidden>🙋</span>
              {t("share.participants.imGoing")}
            </button>
          )}

          <button
            type="button"
            onClick={share}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            {shared === "copied" ? t("share.participants.copied") : t("share.participants.share")}
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("share.participants.more")}
              <span aria-hidden className="text-xs">▾</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onSaveForLater();
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {t("share.participants.saveForLater")}
                </button>
                {onFork && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onFork();
                    }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {t("share.participants.fork")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Secondary line: the vote invitation, now under the action, not above the trip. */}
      {!joined && step === "idle" && (
        <p className="mt-2 text-xs text-slate-500">
          {crewAsk ? t("share.crewPrompt.body") : t("shared.voteInviteBody")}
        </p>
      )}

      {/* After the tap: name, then email — each optional, each skippable. */}
      {joined && step === "name" && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <label htmlFor="participant-name" className="text-sm text-slate-700">
            {t("share.participants.namePrompt")}
          </label>
          <input
            id="participant-name"
            data-testid="participants-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="given-name"
            placeholder={t("share.participants.namePlaceholder")}
            className="min-h-[40px] flex-1 min-w-[10rem] rounded-lg border border-slate-300 px-3 text-sm focus:border-[var(--primary)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-[40px] rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {name.trim() ? t("share.participants.save") : t("share.participants.skip")}
          </button>
        </form>
      )}
      {joined && step === "email" && (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveEmail();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="participant-email" className="text-sm text-slate-700">
              {t("share.participants.emailPrompt")}
            </label>
            <input
              id="participant-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              autoComplete="email"
              placeholder={t("share.participants.emailPlaceholder")}
              className="min-h-[40px] flex-1 min-w-[12rem] rounded-lg border border-slate-300 px-3 text-sm focus:border-[var(--primary)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="min-h-[40px] rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {email.trim() ? t("share.participants.save") : t("share.participants.skip")}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t("share.participants.emailPurpose")}</p>
        </form>
      )}
      {joined && step === "done" && (
        <p className="mt-2 text-xs text-slate-500" data-testid="participants-done">
          {t("share.participants.done")}
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
