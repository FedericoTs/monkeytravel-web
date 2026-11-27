"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import { dayColor } from "@/lib/map/day-colors";
import type { Sketch } from "@/lib/og/route-sketch";
import { onPostHogReady } from "@/lib/posthog/client";
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

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";
const BUTTON = `inline-flex min-h-[48px] items-center justify-center rounded-full px-6 text-base font-semibold ${FOCUS}`;
const MAIN_BUTTON = `${BUTTON} bg-[var(--accent)] text-[var(--foreground)]`;
const QUIET_BUTTON = `${BUTTON} border border-white/30 text-white`;

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

/** The place on a departures board: hidden behind three flaps, then turned over a letter at a time. */
function Board({ place, hidden, hiddenLabel, locale }: { place: string; hidden: boolean; hiddenLabel: string; locale: string }) {
  const words = hidden ? ["???"] : place.toLocaleUpperCase(locale).split(/\s+/);
  const longest = Math.max(...words.map((word) => [...word].length));
  const size = longest <= 7 ? "text-4xl" : longest <= 11 ? "text-2xl" : "text-lg";
  let turn = 0;
  return (
    <p role="img" aria-label={hidden ? hiddenLabel : place} className="flex flex-col items-center gap-2 rounded-lg bg-black/25 p-3">
      {words.map((word, w) => (
        <span key={w} aria-hidden="true" className="flex w-full justify-center gap-1">
          {[...word].map((letter, i) => {
            turn += 1;
            return (
              <span
                key={`${hidden ? "hidden" : "shown"}-${i}`}
                style={{ animationDelay: `${turn * 60}ms` }}
                className={`story-flap relative flex aspect-[3/4] min-w-0 max-w-12 flex-1 items-center justify-center rounded-sm bg-black/50 font-semibold text-[var(--accent)] after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-black/70 ${size}`}
              >
                {letter}
              </span>
            );
          })}
        </span>
      ))}
    </p>
  );
}

/** Stops joined in the order of the plan, drawn once: the line first, the dots along it. */
function Route({ route, label, tint, small, className }: { route: Sketch; label?: string; tint?: string; small?: boolean; className: string }) {
  const line = small ? 9 : tint ? 3 : 2;
  const dot = small ? 11 : 5;
  const first = small ? 16 : 8;
  return (
    <svg
      viewBox={`0 0 ${route.width} ${route.height}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={className}
    >
      <path
        d={route.path}
        pathLength={1}
        className="story-route"
        fill="none"
        stroke={tint ?? "white"}
        strokeOpacity={tint ? 0.9 : 0.5}
        strokeWidth={line}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {route.points.map((point, i) => (
        <circle
          key={i}
          cx={point.x}
          cy={point.y}
          r={i === 0 ? first : dot}
          fill={i === 0 && tint ? "white" : (tint ?? dayColor(point.day))}
          stroke={i === 0 && tint ? tint : "var(--navy)"}
          strokeWidth={i === 0 && tint ? first / 2 : small ? 0 : 2}
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
            fill="white"
            fontSize={14}
            stroke="var(--navy)"
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

/** The trip at a glance: each day's shape in its own colour, under its number. */
function DayShapes({ days, label }: { days: StoryDay[]; label: string }) {
  const drawn = days.filter((day) => day.route);
  if (drawn.length === 0) return null;
  // Up to five in a row; more are set in two rows of about the same length.
  const perRow = drawn.length <= 5 ? drawn.length : Math.ceil(drawn.length / 2);
  return (
    <ul aria-label={label} className="mx-auto grid max-w-[340px] gap-x-3 gap-y-4" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
      {drawn.map((day) => (
        <li key={day.day} className="flex flex-col items-center">
          <Route route={day.route as Sketch} tint={dayColor(day.day)} small className="h-[48px] w-full max-w-[76px]" />
          <span className="mt-1 text-sm font-semibold text-white/75">{day.day}</span>
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
  const [cluesShown, setCluesShown] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const slide = slides[index];
  const guess = story.guess;
  const guessing = slide.kind === "guess" && picked === null;
  const atEnd = index === slides.length - 1;

  const go = (to: number) => {
    if (to < 0 || to >= slides.length || to === index) return;
    moved.current = true;
    if (to === slides.length - 1 && !mine) capture("story_finished", { guessed: picked !== null });
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

  const pick = (option: number) => {
    if (!guess || picked !== null) return;
    setPicked(option);
    if (!mine) capture("story_guessed", { right: option === guess.answer, clues: cluesShown });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(storyUrl);
      setCopied(true);
    } catch {
      // Without the clipboard the address bar still has the link.
    }
  };

  const dates = storyDates(story.startDate, story.endDate, locale);
  const severalCities = story.cities.length > 1;
  const dayDate = slide.kind === "day" ? storyDate(slide.day.date) : null;

  return (
    <main className="flex min-h-dvh justify-center bg-[var(--navy)] text-white">
      <div className="flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-6 pt-3">
        <ol aria-hidden="true" className="flex gap-1.5">
          {slides.map((_, i) => (
            <li key={i} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-[var(--accent)]" : "bg-white/20"}`} />
          ))}
        </ol>
        <p className="sr-only" role="status">
          {t("progress", { current: index + 1, total: slides.length })}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-white/80">MonkeyTravel</span>
          <Link href={fullPlanHref} className={`inline-flex min-h-[44px] items-center text-sm text-white/80 underline underline-offset-4 ${FOCUS}`}>
            {t("fullPlan")}
          </Link>
        </div>

        <section aria-labelledby="story-heading" className="flex flex-1 flex-col justify-center py-5">
          {slide.kind === "guess" && guess && (
            <>
              <h1 id="story-heading" ref={heading} tabIndex={-1} className="text-balance text-center text-3xl font-semibold leading-tight outline-none">
                {t("guess.title")}
              </h1>
              <p className="mt-2 text-center text-white/75">{t("guess.lead")}</p>
              <div className="mt-5">
                <Board place={story.place} hidden={picked === null} hiddenLabel={t("guess.hidden")} locale={locale} />
              </div>
              <ol className="mt-5 space-y-2">
                {guess.clues.slice(0, picked === null ? cluesShown : guess.clues.length).map((clue, i) => (
                  <li key={clue.kind} className="rounded-lg bg-white/10 px-4 py-3">
                    <span className="block text-sm text-white/75">{t("guess.clue", { number: i + 1 })}</span>
                    <span className="text-lg leading-snug">{storyClueText(clue, say, locale)}</span>
                  </li>
                ))}
              </ol>
              {picked === null && cluesShown < guess.clues.length && (
                <button
                  type="button"
                  onClick={() => setCluesShown((shown) => shown + 1)}
                  className={`mt-1 inline-flex min-h-[44px] items-center self-start text-base text-white underline underline-offset-4 ${FOCUS}`}
                >
                  {t("guess.another")}
                </button>
              )}
              <fieldset className="mt-3">
                <legend className="text-lg font-semibold">{t("guess.pick")}</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {guess.options.map((option, i) => {
                    const state =
                      picked === null
                        ? "border-white/30 text-white"
                        : i === guess.answer
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--foreground)]"
                          : i === picked
                            ? "border-white/20 text-white/60 line-through"
                            : "border-white/20 text-white/60";
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={picked !== null}
                        aria-pressed={picked === i}
                        onClick={() => pick(i)}
                        className={`min-h-[52px] rounded-lg border px-3 text-base font-semibold ${FOCUS} ${state}`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <p role="status" className="mt-4 min-h-[28px] text-center text-lg font-semibold">
                {picked !== null &&
                  (picked === guess.answer ? t("guess.right", { clues: cluesShown }) : t("guess.wrong", { place: story.place }))}
              </p>
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
              {dates && <p className="mt-4 text-center text-lg text-white/75">{dates}</p>}
              <div className="mt-8">
                {severalCities && story.route ? (
                  <Route route={story.route} label={t("reveal.route")} className="mx-auto max-h-[36dvh] w-full" />
                ) : (
                  <DayShapes days={story.days} label={t("reveal.route")} />
                )}
              </div>
              <p className="mt-8 text-balance text-center text-xl leading-snug">
                {storyFacts(story, say)}
              </p>
            </>
          )}

          {slide.kind === "day" && (
            <>
              <div className="flex items-end justify-between gap-4">
                <p aria-hidden="true" className="font-[family-name:var(--font-display)] text-[8.5rem] font-semibold leading-[0.8] tabular-nums" style={{ color: dayColor(slide.day.day) }}>
                  {slide.day.day}
                </p>
                {slide.day.route && <Route route={slide.day.route} tint={dayColor(slide.day.day)} className="h-[120px] w-[190px] shrink-0" />}
              </div>
              <p className="mt-6 flex flex-wrap gap-x-2 text-white/75">
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
                    <span aria-hidden="true" className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: dayColor(slide.day.day) }} />
                    {stop}
                  </li>
                ))}
              </ul>
              {slide.day.more > 0 && <p className="mt-3 pl-6 text-white/75">{t("day.more", { count: slide.day.more })}</p>}
            </>
          )}

          {slide.kind === "end" && (
            <>
              <h1 id="story-heading" ref={heading} tabIndex={-1} className={`text-balance font-semibold leading-tight outline-none ${mine ? "text-3xl" : "text-4xl"}`}>
                {mine ? t("end.mineTitle") : t("end.title")}
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-white/85">
                {mine ? (guess ? t("end.mineBody") : t("end.mineBodyPlain")) : t("end.body")}
              </p>
              {story.moreDays > 0 && <p className="mt-3 text-white/75">{t("day.moreDays", { count: story.moreDays })}</p>}
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
              <p role="status" className="mt-3 min-h-[24px] text-white/85">
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
