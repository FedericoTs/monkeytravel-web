"use client";

import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/lib/i18n/routing-config";
import { captureStoryWayInOpened, type StoryWayInOpenedEvent } from "@/lib/posthog/events";

/**
 * The way to a trip's story for the one sharing it: friends who aren't coming get a guess to play instead of a plan
 * to read. It opens /shared/<token>/story, where the link's maker sees what friends see and how to send it. A new
 * tab keeps the page it was offered on (the planner's plan, which isn't saved yet). A plain link in the page's
 * language: it sits in windows and panels that don't load the site's navigation.
 */
export function StoryWayIn({
  token,
  from,
  newTab = false,
  className = "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between",
}: {
  token: string;
  from: StoryWayInOpenedEvent["from"];
  newTab?: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return (
    <div data-testid="story-way-in" data-story-way-in={from} className={className}>
      <p className="text-sm text-slate-700">{t("story.wayIn.note")}</p>
      <a
        href={`${prefix}/shared/${token}/story`}
        {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        onClick={() => void captureStoryWayInOpened({ from })}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
      >
        {t("story.wayIn.cta")}
      </a>
    </div>
  );
}
