"use client";

import { useEffect, useRef, useState } from "react";
import { useConsent } from "@/lib/consent";
import { Link, useRouter } from "@/lib/i18n/routing";
import { trackMatchStarted } from "@/lib/match/analytics";
import { QUESTION_PHOTOS, START_PHOTOS, photoUrl } from "@/lib/match/photos";
import { makeCode, type Home } from "@/lib/match/questions";
import styles from "./match.module.css";

export interface QuizCopy {
  brand: string;
  title: string;
  subtitle: string;
  cta: string;
  note: string;
  withFriend: string;
  /** "Question {n} of {total}", with the numbers still to fill. */
  progress: string;
  back: string;
  matching: string;
  questions: { title: string; options: string[] }[];
}

const AFTER_TAP_MS = 240;
const MATCHING_MS = 1100;

function Photo({ id, className, eager }: { id: number; className: string; eager?: boolean }) {
  return (
    <picture>
      <source media="(min-width: 768px)" srcSet={photoUrl(id, 1600, 1000)} />
      <img src={photoUrl(id, 828, 1792)} alt="" className={className} fetchPriority={eager ? "high" : "low"} decoding="async" />
    </picture>
  );
}

/**
 * The start screen and the six questions. It knows no destinations: it collects
 * the answers and goes to the result page, which scores them on the server.
 */
export default function MatchQuiz({ copy, home, companions }: { copy: QuizCopy; home: Home; companions: string[] }) {
  const router = useRouter();
  // Until a cookie choice is made its bar sits at the bottom: the answers stay above it.
  const { bannerStatus } = useConsent();
  const [step, setStep] = useState<number>(-1);
  const [answers, setAnswers] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const total = copy.questions.length;
  const matching = step === total;
  const asking = step >= 0 && step < total;

  useEffect(() => {
    if (asking) titleRef.current?.focus({ preventScroll: true });
  }, [asking, step]);

  // The questions cover the whole screen, so the page under them doesn't scroll.
  const covering = step >= 0;
  useEffect(() => {
    if (!covering) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [covering]);

  useEffect(() => {
    if (!matching) return;
    const code = makeCode(answers, home);
    const friends = companions.length ? `&with=${companions.join(",")}` : "";
    const timer = setTimeout(() => router.push(`/where-should-i-go/${code}?new=1${friends}`), MATCHING_MS);
    return () => clearTimeout(timer);
  }, [matching, answers, home, companions, router]);

  const start = () => {
    trackMatchStarted(companions.length > 0);
    setStep(0);
  };

  const choose = (option: number) => {
    if (picked !== null) return;
    setPicked(option);
    setTimeout(() => {
      setAnswers((previous) => [...previous.slice(0, step), option]);
      setPicked(null);
      setStep(step + 1);
    }, AFTER_TAP_MS);
  };

  if (step < 0) {
    return (
      <section className="relative isolate flex h-[100dvh] min-h-[560px] w-full flex-col overflow-hidden bg-[#14181a] text-white">
        {START_PHOTOS.map((id, i) => (
          <div key={id} className={styles.startSlide} style={{ position: "absolute", inset: 0, animationDelay: `${i * 6}s` }}>
            <Photo id={id} className="h-full w-full object-cover" eager={i === 0} />
          </div>
        ))}
        <div className={styles.startScrim} />
        <header className="relative flex items-center gap-2 px-5 pt-5 sm:px-10 sm:pt-8">
          <Link href="/" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold tracking-wide text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-512.png" alt="" width={28} height={28} className="rounded-lg" />
            {copy.brand}
          </Link>
        </header>
        <div className={`relative mt-auto w-full max-w-2xl px-5 pb-[max(2.5rem,12dvh)] sm:px-10 ${styles.rise}`}>
          <h1 className="text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-7xl">{copy.title}</h1>
          <p className="mt-3 text-lg text-white/90 sm:text-2xl">{companions.length ? copy.withFriend : copy.subtitle}</p>
          <button
            type="button"
            onClick={start}
            className="mt-6 inline-flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-white px-8 text-lg font-semibold text-[#14181a] transition-transform active:scale-[0.98] sm:w-auto"
          >
            {copy.cta}
          </button>
          <p className="mt-3 text-sm text-white/80">{copy.note}</p>
        </div>
      </section>
    );
  }

  const shown = Math.min(step, total - 1);
  const question = copy.questions[shown];
  return (
    <section className="fixed inset-0 z-[60] isolate flex flex-col overflow-hidden bg-[#14181a] text-white">
      {/* All of them from the first tap, so no question waits on its photo. */}
      {QUESTION_PHOTOS.map((id, i) => (
        <Photo key={id} id={id} className={`${styles.photo} ${i === shown ? styles.photoShown : ""}`} eager={i === shown} />
      ))}
      <div className={matching ? styles.matchingScrim : styles.questionScrim} />

      <div className="relative flex items-center gap-1.5 px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10">
        {copy.questions.map((_, i) => (
          <span key={i} className={styles.segment}>
            <span className={`${styles.segmentFill} ${i < step || (i === step && picked !== null) ? styles.segmentDone : ""}`} />
          </span>
        ))}
      </div>
      <div className="relative flex min-h-[52px] items-center justify-between px-3 sm:px-8">
        {step > 0 && !matching ? (
          <button type="button" onClick={() => setStep(step - 1)} className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm font-medium text-white/90">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
            {copy.back}
          </button>
        ) : (
          <span />
        )}
        <span className="px-2 text-sm text-white/90" aria-live="polite">
          {matching ? "" : copy.progress.replace("{n}", String(step + 1)).replace("{total}", String(total))}
        </span>
      </div>

      {matching ? (
        <div className="relative m-auto px-6 text-center">
          <p className={`text-3xl font-semibold sm:text-5xl ${styles.pulse}`} style={{ fontFamily: "var(--font-display), Georgia, serif" }} role="status">
            {copy.matching}
          </p>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <div key={step} className={`mx-auto mt-auto flex w-full max-w-xl flex-col px-5 sm:px-6 ${bannerStatus === "visible" ? "pb-[200px]" : "pb-[max(2rem,6dvh)]"} ${styles.rise}`}>
            <h2 ref={titleRef} tabIndex={-1} className="text-[2rem] font-semibold leading-[1.12] tracking-tight text-white outline-none sm:text-5xl">
              {question.title}
            </h2>
            <div className="mt-6 flex flex-col gap-3" role="group" aria-label={question.title}>
              {question.options.map((label, option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => choose(option)}
                  aria-pressed={answers[step] === option}
                  className={`min-h-[56px] w-full rounded-2xl px-5 py-3 text-left text-lg font-semibold leading-snug text-white ${styles.glass} ${picked === option ? styles.glassPicked : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
