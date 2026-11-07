"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/lib/i18n/routing";
import { trackFindMine, trackMatchFinished, trackMatchPlan, trackMatchShare } from "@/lib/match/analytics";
import { canShareNatively, openWhatsApp } from "@/lib/share/channels";

export interface ActionsCopy {
  plan: string;
  planPlain: string;
  share: string;
  shareHint: string;
  friendHeadline: string;
  findMine: string;
  whatsapp: string;
  copy: string;
  copied: string;
  saveImage: string;
}

const OWN_KEY = "mt_match_own";

function readOwn(code: string): boolean {
  try {
    return sessionStorage.getItem(OWN_KEY) === code;
  } catch {
    return false;
  }
}

function rememberOwn(code: string): void {
  try {
    sessionStorage.setItem(OWN_KEY, code);
  } catch {
    // A private window can refuse this; the page still works.
  }
}

const buttonBase = "inline-flex min-h-[56px]! w-full items-center justify-center gap-2 rounded-2xl px-6 text-center text-lg font-semibold transition-transform active:scale-[0.98]";
const primary = `${buttonBase} bg-[var(--secondary-ink)] text-white`;
const secondary = `${buttonBase} bg-[var(--foreground)]/[0.06] text-[var(--foreground)]`;

/**
 * What to do with a result. The person who just got it plans it or shares it; a
 * friend who opened their link is asked for theirs. The page's words are the same
 * for both, so a link copied from the address bar can't say the wrong thing.
 */
export default function MatchActions({
  code,
  isNew,
  copy,
  planHref,
  findMineHref,
  shareUrl,
  shareText,
  imageUrl,
  place,
  type,
  together,
}: {
  code: string;
  isNew: boolean;
  copy: ActionsCopy;
  planHref: string;
  findMineHref: string;
  shareUrl: string;
  shareText: string;
  imageUrl: string;
  place: string;
  type: string;
  together: boolean;
}) {
  const [own, setOwn] = useState(isNew);
  const [panel, setPanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const image = useRef<File | null>(null);

  useEffect(() => {
    if (isNew) {
      rememberOwn(code);
      trackMatchFinished(place, type, together);
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState(window.history.state, "", url.toString());
    } else if (readOwn(code)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists in the browser
      setOwn(true);
    }
  }, [code, isNew, place, type, together]);

  // Ready before the tap: a phone only opens its share sheet straight from a tap,
  // and waiting for the picture first would lose it.
  useEffect(() => {
    if (!own || !canShareNatively()) return;
    let alive = true;
    fetch(imageUrl)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (alive && blob) image.current = new File([blob], "my-place.jpg", { type: blob.type || "image/jpeg" });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [own, imageUrl]);

  const message = `${shareText} ${shareUrl}`;

  const share = async () => {
    if (!canShareNatively()) {
      setPanel(true);
      return;
    }
    const file = image.current;
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: message });
        trackMatchShare("native_image", place);
      } else {
        await navigator.share({ text: shareText, url: shareUrl });
        trackMatchShare("native_link", place);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPanel(true);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      trackMatchShare("copy", place);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused: the WhatsApp and image buttons are still there.
    }
  };

  if (!own) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-lg font-semibold text-[var(--foreground)]">{copy.friendHeadline}</p>
        <Link href={findMineHref} onClick={() => trackFindMine(place)} className={primary}>
          {copy.findMine}
        </Link>
        <Link href={planHref} onClick={() => trackMatchPlan(place, "friend")} className={secondary}>
          {copy.planPlain}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Link href={planHref} onClick={() => trackMatchPlan(place, "own")} className={primary}>
        {copy.plan}
      </Link>
      <button type="button" onClick={share} className={secondary}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
        {copy.share}
      </button>
      {panel ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              if (openWhatsApp(message)) trackMatchShare("whatsapp", place);
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--foreground)]/15 px-3 text-sm font-semibold text-[var(--foreground)]"
          >
            {copy.whatsapp}
          </button>
          <button type="button" onClick={copyLink} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--foreground)]/15 px-3 text-sm font-semibold text-[var(--foreground)]">
            {copied ? copy.copied : copy.copy}
          </button>
          <a
            href={imageUrl}
            download="my-place.jpg"
            onClick={() => trackMatchShare("download", place)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--foreground)]/15 px-3 text-sm font-semibold text-[var(--foreground)]"
          >
            {copy.saveImage}
          </a>
        </div>
      ) : null}
      <p className="text-center text-sm text-[var(--foreground-muted)]">{copy.shareHint}</p>
    </div>
  );
}
