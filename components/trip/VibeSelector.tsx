"use client";

import { TripVibe, VibeOption } from "@/types";
import { useTranslations } from "next-intl";

// Vibe configuration (labels/descriptions come from translations)
interface VibeConfig {
  id: TripVibe;
  emoji: string;
  color: string;
  category: "practical" | "fantasy";
  detailCount: number; // Number of detail items to fetch from translations
}

const VIBE_CONFIGS: VibeConfig[] = [
  // Practical Vibes (8)
  { id: "adventure", emoji: "🏔️", color: "var(--vibe-adventure)", category: "practical", detailCount: 3 },
  { id: "cultural", emoji: "🎭", color: "var(--vibe-cultural)", category: "practical", detailCount: 3 },
  { id: "foodie", emoji: "🍜", color: "var(--vibe-foodie)", category: "practical", detailCount: 3 },
  { id: "wellness", emoji: "🧘", color: "var(--vibe-wellness)", category: "practical", detailCount: 3 },
  { id: "romantic", emoji: "💕", color: "var(--vibe-romantic)", category: "practical", detailCount: 3 },
  { id: "urban", emoji: "🌃", color: "var(--vibe-urban)", category: "practical", detailCount: 3 },
  { id: "nature", emoji: "🌲", color: "var(--vibe-nature)", category: "practical", detailCount: 3 },
  { id: "offbeat", emoji: "🗺️", color: "var(--vibe-offbeat)", category: "practical", detailCount: 3 },
  // Fantasy/Whimsical Vibes (4)
  { id: "wonderland", emoji: "🐇", color: "var(--vibe-wonderland)", category: "fantasy", detailCount: 3 },
  { id: "movie-magic", emoji: "🎬", color: "var(--vibe-movie-magic)", category: "fantasy", detailCount: 3 },
  { id: "fairytale", emoji: "🏰", color: "var(--vibe-fairytale)", category: "fantasy", detailCount: 3 },
  { id: "retro", emoji: "🕰️", color: "var(--vibe-retro)", category: "fantasy", detailCount: 3 },
];

interface VibeSelectorProps {
  selectedVibes: TripVibe[];
  onVibesChange: (vibes: TripVibe[]) => void;
  maxVibes?: number;
}

export default function VibeSelector({
  selectedVibes,
  onVibesChange,
  maxVibes = 3,
}: VibeSelectorProps) {
  const t = useTranslations("common.vibes");

  // Build vibes array with translated labels/descriptions
  const vibes: VibeOption[] = VIBE_CONFIGS.map((config) => ({
    id: config.id,
    label: t(`types.${config.id}.label`),
    emoji: config.emoji,
    color: config.color,
    description: t(`types.${config.id}.description`),
    details: Array.from({ length: config.detailCount }, (_, i) =>
      t(`types.${config.id}.details.${i}`)
    ),
    category: config.category,
  }));

  const toggleVibe = (vibeId: TripVibe) => {
    const currentIndex = selectedVibes.indexOf(vibeId);

    if (currentIndex !== -1) {
      // Remove vibe
      const newVibes = selectedVibes.filter((v) => v !== vibeId);
      onVibesChange(newVibes);
    } else if (selectedVibes.length < maxVibes) {
      // Add vibe
      onVibesChange([...selectedVibes, vibeId]);
    }
  };

  const getSelectionOrder = (vibeId: TripVibe): number | null => {
    const index = selectedVibes.indexOf(vibeId);
    return index !== -1 ? index + 1 : null;
  };

  const getPriorityLabel = (order: number): string => {
    if (order === 1) return t("priority.primary");
    if (order === 2) return t("priority.secondary");
    return t("priority.accent");
  };

  const practicalVibes = vibes.filter((v) => v.category === "practical");
  const fantasyVibes = vibes.filter((v) => v.category === "fantasy");

  return (
    <div className="space-y-6">
      {/* Selection Counter */}
      <div className="flex justify-end">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-sm font-medium text-slate-600">
          <span className={selectedVibes.length > 0 ? "text-[var(--primary)]" : ""}>
            {selectedVibes.length}
          </span>
          <span>/</span>
          <span>{maxVibes}</span>
          <span className="hidden sm:inline">{t("selected")}</span>
        </div>
      </div>

      {/* Practical Vibes Section */}
      <div>
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
          {t("categories.classic")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {practicalVibes.map((vibe) => (
            <VibeCard
              key={vibe.id}
              vibe={vibe}
              isSelected={selectedVibes.includes(vibe.id)}
              selectionOrder={getSelectionOrder(vibe.id)}
              isDisabled={
                !selectedVibes.includes(vibe.id) &&
                selectedVibes.length >= maxVibes
              }
              onClick={() => toggleVibe(vibe.id)}
              getPriorityLabel={getPriorityLabel}
            />
          ))}
        </div>
      </div>

      {/* Fantasy Vibes Section */}
      <div>
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>{t("categories.fantasy")}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-[var(--secondary)]/20 text-[var(--secondary-dark)]">
            {t("categories.unique")}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {fantasyVibes.map((vibe) => (
            <VibeCard
              key={vibe.id}
              vibe={vibe}
              isSelected={selectedVibes.includes(vibe.id)}
              selectionOrder={getSelectionOrder(vibe.id)}
              isDisabled={
                !selectedVibes.includes(vibe.id) &&
                selectedVibes.length >= maxVibes
              }
              onClick={() => toggleVibe(vibe.id)}
              getPriorityLabel={getPriorityLabel}
            />
          ))}
        </div>
      </div>

      {/* Selection Summary */}
      {selectedVibes.length > 0 && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-slate-50 to-white border border-slate-200">
          <div className="text-sm font-medium text-slate-700 mb-2">
            {t("yourBlend")}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedVibes.map((vibeId, index) => {
              const vibe = vibes.find((v) => v.id === vibeId);
              if (!vibe) return null;
              const influencePercent = index === 0 ? 50 : index === 1 ? 30 : 20;
              return (
                <div
                  key={vibeId}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium text-white"
                  style={{ backgroundColor: vibe.color }}
                >
                  <span>{vibe.emoji}</span>
                  <span>{vibe.label}</span>
                  <span className="opacity-75">({t("influence", { percent: influencePercent })})</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Individual Vibe Card Component
interface VibeCardProps {
  vibe: VibeOption;
  isSelected: boolean;
  selectionOrder: number | null;
  isDisabled: boolean;
  onClick: () => void;
  getPriorityLabel: (order: number) => string;
}

function VibeCard({
  vibe,
  isSelected,
  selectionOrder,
  isDisabled,
  onClick,
  getPriorityLabel,
}: VibeCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`
        relative p-4 rounded-xl text-left transition-all duration-300 overflow-hidden
        ${
          isSelected
            ? "ring-2 shadow-lg scale-[1.02] border-2"
            : isDisabled
            ? "cursor-not-allowed bg-white border border-slate-200/60"
            : "bg-white border border-slate-200 hover:border-slate-300 hover:shadow-md hover:scale-[1.01] active:scale-[0.99]"
        }
      `}
      style={
        isSelected
          ? {
              borderColor: vibe.color,
              ["--tw-ring-color" as string]: vibe.color,
              backgroundColor: `color-mix(in srgb, ${vibe.color} 10%, white)`,
              boxShadow: `0 10px 25px -5px color-mix(in srgb, ${vibe.color} 30%, transparent)`,
            }
          : undefined
      }
    >
      {/* Disabled overlay with subtle pattern - shows when 3 vibes selected */}
      {isDisabled && (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50/90 to-slate-100/90 backdrop-blur-[1px] z-10 flex items-center justify-center">
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000000' fill-opacity='1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3C/g%3E%3C/svg%3E")`,
          }} />
          <div className="px-2 py-1 rounded-full bg-white/80 border border-slate-200 shadow-sm">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max reached</span>
          </div>
        </div>
      )}
      {/* Selection Order Badge */}
      {selectionOrder && (
        <div
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg"
          style={{ backgroundColor: vibe.color }}
        >
          {selectionOrder}
        </div>
      )}

      {/* Emoji & Label */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{vibe.emoji}</span>
        <div>
          <div
            className={`font-semibold text-sm ${
              isSelected ? "" : "text-slate-900"
            }`}
            style={isSelected ? { color: vibe.color } : undefined}
          >
            {vibe.label}
          </div>
          {selectionOrder && (
            <div
              className="text-[10px] font-medium"
              style={{ color: vibe.color }}
            >
              {getPriorityLabel(selectionOrder)}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-500 leading-relaxed mb-2">
        {vibe.description}
      </p>

      {/* Details */}
      <div className="flex flex-wrap gap-1">
        {vibe.details.map((detail) => (
          <span
            key={detail}
            className={`text-[10px] px-2 py-0.5 rounded-full ${
              isSelected
                ? "bg-white/50 text-slate-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {detail}
          </span>
        ))}
      </div>

      {/* Selected checkmark */}
      {isSelected && (
        <div
          className="absolute bottom-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: vibe.color }}
        >
          <svg
            className="w-3 h-3 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      )}
    </button>
  );
}

// Export the VIBE_CONFIGS array for use in other components
export { VIBE_CONFIGS };
