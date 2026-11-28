"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { copyToClipboard, shareFile } from "@/lib/native/share";
import { onPostHogReady } from "@/lib/posthog/client";
import { tripCardPath } from "@/lib/seo/og-image";

type Picture = "guess" | "place";

interface Props {
  shareToken: string;
  locale: string;
  tripId: string;
  /** The story opens on a guess: there is a guess to post, and the place is its answer. */
  withGuess: boolean;
  /** Copied in the same press, to add to the post as its link. */
  storyUrl: string;
  /** What the saved files are called. */
  fileStem: string;
}

/** A story that opens on a guess has the guess and its answer to post; another has the trip alone. */
const picturesFor = (withGuess: boolean): Picture[] => (withGuess ? ["guess", "place"] : ["place"]);

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--foreground)]";

/**
 * The story's pictures, for the one telling the trip to post. Each is fetched as soon as this shows, because a
 * phone opens its share sheet only for a tap that already has the file in hand: a press never waits for a
 * picture to be drawn.
 */
export default function StoryPost({ shareToken, locale, tripId, withGuess, storyUrl, fileStem }: Props) {
  const t = useTranslations("common.story");
  const [files, setFiles] = useState<Partial<Record<Picture, File | "failed">>>({});
  const [said, setSaid] = useState<"shared" | "saved" | null>(null);

  useEffect(() => {
    let showing = true;
    for (const picture of picturesFor(withGuess)) {
      fetch(tripCardPath({ token: shareToken }, { format: picture, locale }))
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`picture ${res.status}`))))
        .then((blob) => new File([blob], `${fileStem}-${picture}.png`, { type: "image/png" }))
        .catch(() => "failed" as const)
        .then((file) => {
          if (showing) setFiles((had) => ({ ...had, [picture]: file }));
        });
    }
    return () => {
      showing = false;
    };
  }, [shareToken, locale, withGuess, fileStem]);

  const post = async (picture: Picture) => {
    const file = files[picture];
    if (!(file instanceof File)) return;
    // Asked for in the tap itself, before anything is awaited: the link to paste, then the share sheet.
    void copyToClipboard(storyUrl);
    const outcome = await shareFile(file);
    if (outcome === "cancelled") return;
    const method = outcome === "shared" ? "native_share" : "download";
    setSaid(outcome === "shared" ? "shared" : "saved");
    onPostHogReady((posthog) => posthog.capture("story_posted", { picture, method }));
    // The site's own count, the same for everyone.
    void fetch("/api/funnel-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "trip_card_shared", trip_id: tripId, format: picture, method }),
      keepalive: true,
    }).catch(() => {});
  };

  const pictures = picturesFor(withGuess);
  const failed = pictures.some((picture) => files[picture] === "failed");

  return (
    <div>
      <ul className={`grid gap-3 ${pictures.length === 2 ? "grid-cols-2" : "mx-auto max-w-[220px] grid-cols-1"}`}>
        {pictures.map((picture) => {
          const ready = files[picture] instanceof File;
          const label = picture === "guess" ? t("post.guess") : withGuess ? t("post.place") : t("post.trip");
          return (
            <li key={picture}>
              <button
                type="button"
                disabled={!ready}
                onClick={() => post(picture)}
                className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-gray-200 bg-white p-2 text-base font-semibold text-[var(--foreground)] ${FOCUS} ${ready ? "" : "opacity-70"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tripCardPath({ token: shareToken }, { format: picture, locale })}
                  alt=""
                  width={270}
                  height={480}
                  className="aspect-[9/16] w-full rounded-sm bg-[var(--background-warm)] object-cover"
                />
                <span className="flex min-h-[44px] items-center text-center">{ready || files[picture] === "failed" ? label : t("post.preparing")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="mt-3 min-h-[24px]">
        {failed ? t("post.failed") : said === "shared" ? t("post.shared") : said === "saved" ? t("post.saved") : ""}
      </p>
    </div>
  );
}
