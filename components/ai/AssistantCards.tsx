"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import type {
  AssistantCard,
  AssistantActivityCard,
  AssistantReplacementCard,
  AssistantTipCard,
  AssistantComparisonCard,
  AssistantConfirmationCard,
  Activity,
} from "@/types";

// Activity type colors and icons (labels come from translations)
const ACTIVITY_STYLES: Record<
  Activity["type"],
  { bg: string; border: string; icon: string }
> = {
  attraction: {
    bg: "from-amber-50 to-orange-50",
    border: "border-amber-200",
    icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
  },
  restaurant: {
    bg: "from-rose-50 to-pink-50",
    border: "border-rose-200",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  },
  activity: {
    bg: "from-emerald-50 to-teal-50",
    border: "border-emerald-200",
    icon: "M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  transport: {
    bg: "from-sky-50 to-blue-50",
    border: "border-sky-200",
    icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  },
};

// Tip icon mapping
const TIP_ICONS: Record<string, { path: string; bg: string; color: string }> = {
  lightbulb: {
    path: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    bg: "bg-amber-100",
    color: "text-amber-600",
  },
  warning: {
    path: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
    bg: "bg-orange-100",
    color: "text-orange-600",
  },
  info: {
    path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    bg: "bg-blue-100",
    color: "text-blue-600",
  },
  clock: {
    path: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    bg: "bg-purple-100",
    color: "text-purple-600",
  },
  money: {
    path: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    bg: "bg-green-100",
    color: "text-green-600",
  },
  weather: {
    path: "M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z",
    bg: "bg-sky-100",
    color: "text-sky-600",
  },
};

// Confirmation icons
const CONFIRMATION_ICONS: Record<string, { path: string; bg: string }> = {
  check: {
    path: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    bg: "bg-gradient-to-br from-emerald-400 to-green-500",
  },
  swap: {
    path: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
    bg: "bg-gradient-to-br from-violet-400 to-purple-500",
  },
  plus: {
    path: "M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z",
    bg: "bg-gradient-to-br from-blue-400 to-indigo-500",
  },
  trash: {
    path: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
    bg: "bg-gradient-to-br from-rose-400 to-red-500",
  },
};

// Mini Activity Card for suggestions
function MiniActivityCard({
  activity,
  dayNumber,
  reason,
  isNew = false,
  className = "",
}: {
  activity: Activity;
  dayNumber?: number;
  reason?: string;
  isNew?: boolean;
  className?: string;
}) {
  const t = useTranslations("common.ai.cards");
  const style = ACTIVITY_STYLES[activity.type] || ACTIVITY_STYLES.activity;

  return (
    <div
      className={`
        relative overflow-hidden rounded-xl border ${style.border}
        bg-gradient-to-br ${style.bg} p-3
        transition-all duration-300 hover:shadow-md
        ${className}
      `}
    >
      {/* New badge */}
      {isNew && (
        <div className="absolute -top-1 -right-1">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm">
            {t("new")}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-lg bg-white/80 flex items-center justify-center flex-shrink-0 shadow-sm">
          <svg
            className="w-4 h-4 text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={style.icon}
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-slate-900 text-sm leading-tight truncate">
            {activity.name}
          </h4>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-slate-500 capitalize">
              {t(`activityTypes.${activity.type}`)}
            </span>
            {dayNumber && (
              <>
                <span className="text-slate-300">•</span>
                <span className="text-[11px] text-slate-500">{t("day", { number: dayNumber })}</span>
              </>
            )}
            {activity.start_time && (
              <>
                <span className="text-slate-300">•</span>
                <span className="text-[11px] text-slate-500">{activity.start_time}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-600 line-clamp-2 mb-2">
        {activity.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {activity.duration_minutes && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/60 text-slate-600">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {activity.duration_minutes}min
            </span>
          )}
          {activity.estimated_cost && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/60 text-slate-600">
              {activity.estimated_cost.currency} {activity.estimated_cost.amount}
            </span>
          )}
        </div>
        {activity.location && (
          <span className="text-[10px] text-slate-500 truncate max-w-[100px]">
            {activity.location}
          </span>
        )}
      </div>

      {/* Reason */}
      {reason && (
        <div className="mt-2 pt-2 border-t border-white/50">
          <p className="text-[11px] text-slate-600 italic flex items-start gap-1">
            <svg className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
            </svg>
            {reason}
          </p>
        </div>
      )}
    </div>
  );
}

// Activity Suggestion Card
function ActivitySuggestionCard({ card }: { card: AssistantActivityCard }) {
  return (
    <div className="animate-in slide-in-from-bottom-2 duration-300">
      <MiniActivityCard
        activity={card.activity}
        dayNumber={card.dayNumber}
        reason={card.reason}
        isNew={card.type === "activity_added"}
      />
    </div>
  );
}

// Activity Replacement Card with animation
function ActivityReplacementCard({
  card,
  onUndo,
}: {
  card: AssistantReplacementCard;
  onUndo?: () => void;
}) {
  const t = useTranslations("common.ai.cards");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    // Animate the swap after a short delay
    const timer = setTimeout(() => setShowNew(true), 400);
    return () => clearTimeout(timer);
  }, []);

  const oldStyle = ACTIVITY_STYLES[card.oldActivity.type] || ACTIVITY_STYLES.activity;
  const newStyle = ACTIVITY_STYLES[card.newActivity.type] || ACTIVITY_STYLES.activity;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white">
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div className="flex-1">
            <span className="text-xs font-semibold text-slate-700">{t("activityReplaced")}</span>
            <span className="text-[10px] text-slate-500 ml-2">{t("day", { number: card.dayNumber })}</span>
          </div>
          {card.autoApplied && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              {t("autoApplied")}
            </span>
          )}
        </div>
      </div>

      {/* Cards Container */}
      <div className="p-3 space-y-2">
        {/* Old Activity (fading out) */}
        <div
          className={`
            relative transition-all duration-500 ease-out
            ${showNew ? "opacity-40 scale-[0.97]" : "opacity-100 scale-100"}
          `}
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div
              className={`
                w-full h-0.5 bg-gradient-to-r from-transparent via-red-400 to-transparent
                transition-all duration-500
                ${showNew ? "opacity-100" : "opacity-0"}
              `}
            />
          </div>
          <div className={`rounded-lg border ${oldStyle.border} bg-gradient-to-br ${oldStyle.bg} p-2.5 relative`}>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={oldStyle.icon} />
              </svg>
              <span className="text-sm font-medium text-slate-700 line-through decoration-red-400/60">
                {card.oldActivity.name}
              </span>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center">
          <div
            className={`
              w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-green-500
              flex items-center justify-center shadow-md
              transition-all duration-500
              ${showNew ? "scale-100 opacity-100" : "scale-75 opacity-0"}
            `}
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        </div>

        {/* New Activity (sliding in) */}
        <div
          className={`
            transition-all duration-500 ease-out
            ${showNew ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
          `}
        >
          <MiniActivityCard
            activity={card.newActivity}
            isNew
          />
        </div>
      </div>

      {/* Reason */}
      {card.reason && (
        <div className="px-3 pb-3">
          <p className="text-[11px] text-slate-500 italic">
            {card.reason}
          </p>
        </div>
      )}

      {/* Undo button */}
      {card.autoApplied && onUndo && (
        <div className="px-3 pb-3">
          <button
            onClick={onUndo}
            className="text-[11px] text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            {t("undoChange")}
          </button>
        </div>
      )}
    </div>
  );
}

// Tip Card
function TipCard({ card }: { card: AssistantTipCard }) {
  const iconStyle = TIP_ICONS[card.icon] || TIP_ICONS.info;

  return (
    <div className="animate-in slide-in-from-bottom-2 duration-300 rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className={`w-8 h-8 rounded-lg ${iconStyle.bg} flex items-center justify-center flex-shrink-0`}>
          <svg className={`w-4 h-4 ${iconStyle.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconStyle.path} />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-slate-900 mb-0.5">{card.title}</h4>
          <p className="text-xs text-slate-600 leading-relaxed">{card.content}</p>
        </div>
      </div>
    </div>
  );
}

// Comparison Card
function ComparisonCard({ card }: { card: AssistantComparisonCard }) {
  const t = useTranslations("common.ai.cards");
  return (
    <div className="animate-in slide-in-from-bottom-2 duration-300 rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 py-2 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <h4 className="text-sm font-semibold text-slate-900">{card.title}</h4>
      </div>
      <div className="p-3 space-y-2">
        {card.options.map((option, idx) => (
          <div
            key={idx}
            className={`
              relative rounded-lg border p-2.5 transition-all
              ${option.recommended
                ? "border-emerald-300 bg-gradient-to-br from-emerald-50 to-green-50"
                : "border-slate-200 bg-slate-50"
              }
            `}
          >
            {option.recommended && (
              <span className="absolute -top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-medium">
                {t("recommended")}
              </span>
            )}
            <h5 className="font-medium text-sm text-slate-900 mb-1.5">{option.name}</h5>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-emerald-600 font-medium">{t("pros")}</span>
                <ul className="mt-0.5 space-y-0.5">
                  {option.pros.map((pro, i) => (
                    <li key={i} className="flex items-start gap-1 text-slate-600">
                      <span className="text-emerald-500 mt-0.5">+</span>
                      {pro}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="text-rose-600 font-medium">{t("cons")}</span>
                <ul className="mt-0.5 space-y-0.5">
                  {option.cons.map((con, i) => (
                    <li key={i} className="flex items-start gap-1 text-slate-600">
                      <span className="text-rose-500 mt-0.5">-</span>
                      {con}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Confirmation Card with celebration animation
function ConfirmationCard({ card }: { card: AssistantConfirmationCard }) {
  const iconStyle = CONFIRMATION_ICONS[card.icon] || CONFIRMATION_ICONS.check;
  const [showSparkles, setShowSparkles] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSparkles(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="animate-in zoom-in-95 duration-300 relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50">
      {/* Sparkle effects */}
      {showSparkles && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-amber-400 rounded-full animate-ping"
              style={{
                left: `${20 + Math.random() * 60}%`,
                top: `${20 + Math.random() * 60}%`,
                animationDelay: `${i * 0.15}s`,
                animationDuration: "1s",
              }}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 p-3 relative z-10">
        <div className={`w-10 h-10 rounded-full ${iconStyle.bg} flex items-center justify-center shadow-lg`}>
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={iconStyle.path} />
          </svg>
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-slate-900">{card.title}</h4>
          <p className="text-xs text-slate-600">{card.description}</p>
        </div>
      </div>
    </div>
  );
}

// Main AssistantCards component that renders the appropriate card type
export default function AssistantCards({
  cards,
  onUndo,
}: {
  cards: AssistantCard[];
  onUndo?: (cardIndex: number) => void;
}) {
  if (!cards || cards.length === 0) return null;

  return (
    <div className="space-y-2">
      {cards.map((card, index) => {
        switch (card.type) {
          case "activity_suggestion":
          case "activity_added":
            return <ActivitySuggestionCard key={index} card={card} />;
          case "activity_replacement":
            return (
              <ActivityReplacementCard
                key={index}
                card={card}
                onUndo={onUndo ? () => onUndo(index) : undefined}
              />
            );
          case "tip":
            return <TipCard key={index} card={card} />;
          case "comparison":
            return <ComparisonCard key={index} card={card} />;
          case "confirmation":
            return <ConfirmationCard key={index} card={card} />;
          case "error":
            return (
              <div
                key={index}
                className="animate-in slide-in-from-bottom-2 duration-300 rounded-xl border border-red-200 bg-red-50 p-3"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-red-700">{card.message}</p>
                </div>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

// Export individual components for direct use
export {
  MiniActivityCard,
  ActivitySuggestionCard,
  ActivityReplacementCard,
  TipCard,
  ComparisonCard,
  ConfirmationCard,
};
