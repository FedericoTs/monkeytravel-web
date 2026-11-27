"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import { dayColor } from "@/lib/map/day-colors";
import { copyToClipboard } from "@/lib/native/share";
import type { Sketch } from "@/lib/og/route-sketch";
import { onPostHogReady } from "@/lib/posthog/client";
import { boardOf, CLUE_AFTER_MISSES, cluesInSight, GUESS_MISSES, guessState, KEYS, keysOf } from "@/lib/story/letters";
import type { StoryDay, TripStory } from "@/lib/story/trip-story";
import { storyClueText, storyDate, storyDates, storyFacts, type StoryTranslator } from "@/lib/story/words";
import { reportPlanOwnClicked } from "@/lib/trips/plan-own";
import StoryPost from "./StoryPost";

interface Props {
  story: TripStory;
  locale: string;
  tripId: string;
  /** The planner, opened for this place. */
  planHref: string;
  /** The whole plan this story tells. */
  fullPlanHref: string;
  /** This page's address, for the one who made the link to pass on. */
  storyUrl: string;
  /** The share link's token: its pictures to post are drawn for it. */
  shareToken: string;
  /** The trip's owner, or the browser that made its link: shown how friends see it, and how to send it. */
  mine: boolean;
}

type Slide = { kind: "guess" } | { kind: "reveal" } | { kind: "day"; day: StoryDay } | { kind: "end" };

// The site's own colours: its cream ground and charcoal ink, coral for the one main action of a screen.
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--foreground)]";
const BUTTON = `inline-flex min-h-[48px] items-center justify-center rounded-xl px-6 text-base font-semibold ${FOCUS}`;
const MAIN_BUTTON = `${BUTTON} bg-[var(--primary)] text-white`;
const QUIET_BUTTON = `${BUTTON} border-2 border-gray-200 bg-white text-[var(--foreground)]`;
const CARD = "rounded-lg border border-slate-200 bg-white";

/** A file name from a place's name: "São Miguel" saves as "sao-miguel". */
function plainFileName(place: string): string {
  const name = place
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return name || "trip";
}

/** Only reaches visitors who accepted analytics. */
function capture(event: string, properties: Record<string, string | number | boolean>): void {
  onPostHogReady((posthog) => posthog.capture(event, properties));
}

/**
 * The place on a departures board, the one dark thing on the screen: a flap for each letter, turned over when a
 * friend picks its key, and all of them once the guess is over.
 */
function Board({ place, open, locale, label }: { place: string; open: (key: string) => boolean; locale: string; label: string }) {
  const words = boardOf(place, locale);
  const longest = Math.max(...words.map((word) => word.length));
  const size = longest <= 7 ? "text-4xl" : longest <= 11 ? "text-2xl" : "text-lg";
  return (
    <p role="img" aria-label={label} className="flex flex-col items-center gap-2 rounded-lg bg-[var(--navy)] p-3">
      {words.map((word, w) => (
        <span key={w} aria-hidden="true" className="flex w-full justify-center gap-1">
          {word.map((tile, i) => {
            const shown = tile.key === null || open(tile.key);
            return (
              <span
                key={`${i}-${shown ? "shown" : "hidden"}`}
                className={`relative flex aspect-[3/4] min-w-0 max-w-12 flex-1 items-center justify-center rounded-sm bg-black/40 font-semibold text-[var(--accent)] after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-black/50 ${size} ${shown && tile.key ? "story-flap" : ""}`}
              >
                {shown ? tile.ch : ""}
              </span>
            );
          })}
        </span>
      ))}
    </p>
  );
}

/** Stops joined in the order of the plan, drawn once: the line in the site's ink, each stop in its day's colour. */
function Route({ route, label, small, className }: { route: Sketch; label?: string; small?: boolean; className: string }) {
  const line = small ? 8 : 2.5;
  const dot = small ? 12 : 6;
  return (
    <svg viewBox={`0 0 ${route.width} ${route.height}`} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} className={className}>
      <path
        d={route.path}
        pathLength={1}
        className="story-route"
        fill="none"
        stroke="var(--foreground)"
        strokeOpacity={0.55}
        strokeWidth={line}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {route.points.map((point, i) => (
        <circle
          key={i}
          cx={point.x}
          cy={point.y}
          r={i === 0 ? dot * 1.35 : dot}
          fill={dayColor(point.day)}
          stroke="var(--foreground)"
          strokeWidth={small ? 4 : 1.5}
          className="story-dot"
          style={{ animationDelay: `${Math.round((i / route.points.length) * 1400)}ms` }}
        />
      ))}
      {route.labels.map((place) => {
        const leftward = place.x > route.width * 0.6;
        return (
          <text
            key={place.text}
            x={place.x + (leftward ? -12 : 12)}
            y={place.y + 5}
            textAnchor={leftward ? "end" : "start"}
            fill="var(--foreground)"
            fontSize={14}
            fontWeight={600}
            stroke="var(--background)"
            strokeWidth={5}
            paintOrder="stroke"
          >
            {place.text}
          </text>
        );
      })}
    </svg>
  );
}

/** The trip at a glance: each day's shape, under its number. */
function DayShapes({ days, label }: { days: StoryDay[]; label: string }) {
  const drawn = days.filter((day) => day.route);
  if (drawn.length === 0) return null;
  // Up to five in a row; more are set in two rows of about the same length.
  const perRow = drawn.length <= 5 ? drawn.length : Math.ceil(drawn.length / 2);
  return (
    <ul aria-label={label} className="mx-auto grid max-w-[340px] gap-x-3 gap-y-4" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
      {drawn.map((day) => (
        <li key={day.day} className="flex flex-col items-center">
          <Route route={day.route as Sketch} small className="h-[48px] w-full max-w-[76px]" />
          <span className="mt-1 text-sm font-semibold text-[var(--foreground-muted)]">{day.day}</span>
        </li>
      ))}
    </ul>
  );
}

export default function TripStoryView({ story, locale, tripId, planHref, fullPlanHref, storyUrl, shareToken, mine }: Props) {
  const t = useTranslations("common.story");
  const say = t as unknown as StoryTranslator;
  const slides = useMemo<Slide[]>(
    () => [
      ...(story.guess ? [{ kind: "guess" } as const] : []),
      { kind: "reveal" } as const,
      ...story.days.map((day) => ({ kind: "day", day }) as const),
      { kind: "end" } as const,
    ],
    [story]
  );
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [told, setTold] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const slide = slides[index];
  const guess = story.guess;
  const { misses, solved, lost } = guessState(story.place, picked, GUESS_MISSES);
  const over = solved || lost;
  const guessing = slide.kind === "guess" && !over;
  const atEnd = index === slides.length - 1;
  const answer = useMemo(() => keysOf(story.place), [story.place]);

  const go = (to: number) => {
    if (to < 0 || to >= slides.length || to === index) return;
    moved.current = true;
    if (to === slides.length - 1 && !mine) capture("story_finished", { guessed: over });
    setIndex(to);
  };

  // A new part is announced by its heading: a reader of the screen hears what just changed.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (event.key === "ArrowRight" && !guessing) setIndex((i) => Math.min(slides.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guessing, slides.length]);

  const pick = (key: string) => {
    if (!guess || over || picked.includes(key)) return;
    const next = [...picked, key];
    setPicked(next);
    const after = guessState(story.place, next, GUESS_MISSES);
    if ((after.solved || after.lost) && !mine) capture("story_guessed", { right: after.solved, misses: after.misses });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(storyUrl);
      setCopied(true);
    } catch {
      // Without the clipboard the address bar still has the link.
    }
  };

  // A friend's result, sent back to the one going: the share sheet where there is one, else copied to paste.
  const tell = async () => {
    const text = `${solved ? t("guess.tellSolved", { misses }) : t("guess.tellLost")} ${storyUrl}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
      } catch {
        // Closed without sending: nothing to say.
      }
      return;
    }
    if (await copyToClipboard(text)) setTold(true);
  };

  const dates = storyDates(story.startDate, story.endDate, locale);
  const severalCities = story.cities.length > 1;
  const dayDate = slide.kind === "day" ? storyDate(slide.day.date) : null;
  const cluesShown = guess ? (over ? guess.clues.length : cluesInSight(guess.clues.length, misses, CLUE_AFTER_MISSES)) : 0;
  const open = (key: string) => over || picked.includes(key);
  const boardLabel = over
    ? story.place
    : boardOf(story.place, locale)
        .map((word) => word.map((tile) => (tile.key === null || picked.includes(tile.key) ? tile.ch : t("guess.blank"))).join(" "))
        .join(", ");

  return (
    <main className="flex min-h-dvh justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-6 pt-3">
        <ol aria-hidden="true" className="flex gap-1.5">
          {slides.map((_, i) => (
            <li key={i} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-[var(--primary)]" : "bg-[var(--foreground)]/15"}`} />
          ))}
        </ol>
        <p className="sr-only" role="status">
          {t("progress", { current: index + 1, total: slides.length })}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-semibold">MonkeyTravel</span>
          <Link href={fullPlanHref} className={`inline-flex min-h-[44px] items-center text-sm underline underline-offset-4 ${FOCUS}`}>
            {t("fullPlan")}
          </Link>
        </div>
        {mine && !atEnd && (
          <div data-testid="story-mine-bar" className="flex items-center justify-between gap-3 rounded-lg bg-[var(--background-warm)] px-3 py-1">
            <p className="text-sm">{t("mine.note")}</p>
            <button type="button" onClick={() => go(slides.length - 1)} className={`inline-flex min-h-[44px] shrink-0 items-center text-sm font-semibold underline underline-offset-4 ${FOCUS}`}>
              {t("mine.post")}
            </button>
          </div>
        )}

        <section aria-labelledby="story-heading" className="flex flex-1 flex-col justify-center py-5">
          {slide.kind === "guess" && guess && (
            <>
              <h1 id="story-heading" ref={heading} tabIndex={-1} className="text-balance text-center text-2xl font-semibold leading-tight outline-none">
                {t("guess.title")}
              </h1>
              {!over && <p className="mt-1 text-center text-sm text-[var(--foreground-muted)]">{t("guess.lead", { max: GUESS_MISSES })}</p>}
              <div className="mt-3">
                <Board place={story.place} open={open} locale={locale} label={boardLabel} />
              </div>
              {/* One card for every clue, so the keys stay on the screen as clues open. */}
              <ol aria-label={t("guess.clues")} className={`${CARD} mt-3 list-decimal space-y-1 py-2.5 pl-9 pr-4 leading-snug`}>
                {guess.clues.slice(0, cluesShown).map((clue) => (
                  <li key={clue.kind}>{storyClueText(clue, say, locale)}</li>
                ))}
              </ol>
              {!over && (
                <>
                  <p className="mt-3 flex items-center justify-between text-sm text-[var(--foreground-muted)]">
                    <span>{t("guess.misses", { count: misses, max: GUESS_MISSES })}</span>
                    <span aria-hidden="true" className="flex gap-1">
                      {Array.from({ length: GUESS_MISSES }, (_, i) => (
                        <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < misses ? "bg-[var(--primary)]" : "bg-[var(--foreground)]/15"}`} />
                      ))}
                    </span>
                  </p>
                  <div role="group" aria-label={t("guess.keys")} className="mt-2 grid grid-cols-7 gap-1.5">
                    {KEYS.map((key) => {
                      const used = picked.includes(key);
                      const state = !used
                        ? "border-gray-200 bg-white text-[var(--foreground)]"
                        : answer.has(key)
                          ? "border-[var(--secondary-ink)] bg-[var(--secondary-ink)] text-white"
                          : "border-slate-200 bg-slate-100 text-slate-500 line-through";
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={used}
                          onClick={() => pick(key)}
                          className={`min-h-[44px] rounded-md border-2 text-base font-semibold ${FOCUS} ${state}`}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <p role="status" className={`text-center text-lg font-semibold ${over ? "mt-4" : ""}`}>
                {solved && t("guess.solved", { misses })}
                {lost && t("guess.lost", { place: story.place })}
              </p>
              {over && !mine && (
                <button type="button" onClick={tell} className={`${QUIET_BUTTON} mt-2`}>
                  {told ? t("guess.told") : t("guess.tell")}
                </button>
              )}
            </>
          )}

          {slide.kind === "reveal" && (
            <>
              <h1
                id="story-heading"
                ref={heading}
                tabIndex={-1}
                className={`text-balance text-center font-semibold leading-none outline-none ${story.place.length > 18 ? "text-4xl leading-tight" : "text-6xl"}`}
              >
                {story.place}
              </h1>
              {dates && <p className="mt-4 text-center text-lg text-[var(--foreground-muted)]">{dates}</p>}
              <div className="mt-8">
                {severalCities && story.route ? (
                  <Route route={story.route} label={t("reveal.route")} className="mx-auto max-h-[36dvh] w-full" />
                ) : (
                  <DayShapes days={story.days} label={t("reveal.route")} />
                )}
              </div>
              <p className="mt-8 text-balance text-center text-xl leading-snug">{storyFacts(story, say)}</p>
            </>
          )}

          {slide.kind === "day" && (
            <>
              <div className="flex items-end justify-between gap-4">
                <p
                  aria-hidden="true"
                  className="flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl font-[family-name:var(--font-display)] text-7xl font-semibold tabular-nums"
                  style={{ backgroundColor: dayColor(slide.day.day) }}
                >
                  {slide.day.day}
                </p>
                {slide.day.route && <Route route={slide.day.route} className="h-[112px] w-[178px] shrink-0" />}
              </div>
              <p className="mt-6 flex flex-wrap gap-x-2 text-[var(--foreground-muted)]">
                <span className="sr-only">{t("day.label", { number: slide.day.day })}</span>
                {dayDate && <span>{new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(dayDate)}</span>}
                {slide.day.city && severalCities && <span>{t("day.in", { city: slide.day.city })}</span>}
              </p>
              <h1 id="story-heading" ref={heading} tabIndex={-1} className="mt-1 text-balance text-4xl font-semibold leading-tight outline-none">
                {slide.day.title ?? t("day.label", { number: slide.day.day })}
              </h1>
              <ul className="mt-5 space-y-3">
                {slide.day.stops.map((stop) => (
                  <li key={stop} className="flex items-start gap-3 text-xl leading-snug">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-3 w-3 shrink-0 rounded-full border border-[var(--foreground)]"
                      style={{ backgroundColor: dayColor(slide.day.day) }}
                    />
                    {stop}
                  </li>
                ))}
              </ul>
              {slide.day.more > 0 && <p className="mt-3 pl-6 text-[var(--foreground-muted)]">{t("day.more", { count: slide.day.more })}</p>}
            </>
          )}

          {slide.kind === "end" && (
            <>
              <h1
                id="story-heading"
                ref={heading}
                tabIndex={-1}
                className={`text-balance font-semibold leading-tight outline-none ${mine ? "text-3xl" : "text-4xl"}`}
              >
                {mine ? t("end.mineTitle") : t("end.title")}
              </h1>
              <p className="mt-4 text-lg leading-relaxed">{mine ? (guess ? t("end.mineBody") : t("end.mineBodyPlain")) : t("end.body")}</p>
              {story.moreDays > 0 && <p className="mt-3 text-[var(--foreground-muted)]">{t("day.moreDays", { count: story.moreDays })}</p>}
              {mine && (
                <div className="mt-6">
                  <StoryPost
                    shareToken={shareToken}
                    locale={locale}
                    tripId={tripId}
                    withGuess={guess !== null}
                    storyUrl={storyUrl}
                    fileStem={plainFileName(story.place)}
                  />
                </div>
              )}
              <div className={`flex flex-col gap-3 ${mine ? "mt-2" : "mt-8"}`}>
                {mine ? (
                  <button type="button" onClick={copyLink} className={QUIET_BUTTON}>
                    {t("end.copy")}
                  </button>
                ) : (
                  <Link
                    href={planHref}
                    onClick={() => reportPlanOwnClicked({ tripId, destination: story.place, referralCode: null, surface: "story" })}
                    className={MAIN_BUTTON}
                  >
                    {t("end.plan")}
                  </Link>
                )}
                <Link href={fullPlanHref} className={QUIET_BUTTON}>
                  {t("fullPlan")}
                </Link>
              </div>
              <p role="status" className="mt-3 min-h-[24px]">
                {copied && t("end.copied")}
              </p>
            </>
          )}
        </section>

        <div className="flex gap-3">
          {index > 0 && (
            <button type="button" onClick={() => go(index - 1)} className={QUIET_BUTTON}>
              {t("back")}
            </button>
          )}
          {guessing && (
            <button type="button" onClick={() => go(index + 1)} className={`${QUIET_BUTTON} flex-1`}>
              {t("guess.skip")}
            </button>
          )}
          {!guessing && !atEnd && (
            <button type="button" onClick={() => go(index + 1)} className={`${MAIN_BUTTON} flex-1`}>
              {slide.kind === "guess" ? t("guess.see") : t("next")}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
