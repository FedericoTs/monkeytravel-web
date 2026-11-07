import type { CSSProperties } from "react";
import styles from "./match.module.css";

const RADIUS = 34;
const CIRCLE = 2 * Math.PI * RADIUS;

/** The match as a ring, which fills on the first view of a new result. Drawn on the server, so it's right before any script runs. */
export default function MatchPercent({ percent, label, animate }: { percent: number; label: string; animate: boolean }) {
  return (
    <div className="relative h-[84px] w-[84px] shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={RADIUS} fill="rgba(20,24,26,0.35)" stroke="rgba(255,255,255,0.28)" strokeWidth="5" />
        <circle
          cx="40"
          cy="40"
          r={RADIUS}
          fill="none"
          stroke="#fff"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRCLE}
          strokeDashoffset={CIRCLE * (1 - percent / 100)}
          className={animate ? styles.ring : undefined}
          style={{ "--ring-empty": CIRCLE } as CSSProperties}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[1.35rem] font-semibold tabular-nums text-white">{percent}%</span>
    </div>
  );
}
