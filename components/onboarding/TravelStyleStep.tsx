"use client";

interface TravelStyleStepProps {
  selected: string[];
  onChange: (styles: string[]) => void;
}

const TRAVEL_STYLES = [
  {
    id: "adventure",
    label: "Adventure Seeker",
    description: "Hiking, water sports, outdoor activities",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    id: "cultural",
    label: "Culture Explorer",
    description: "Museums, historical sites, local traditions",
    icon: "M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z",
  },
  {
    id: "foodie",
    label: "Food Enthusiast",
    description: "Local cuisine, cooking classes, food tours",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  },
  {
    id: "relaxation",
    label: "Relaxation & Wellness",
    description: "Spas, beaches, peaceful retreats",
    icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
  },
  {
    id: "nightlife",
    label: "Nightlife & Social",
    description: "Bars, clubs, live entertainment",
    icon: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3",
  },
  {
    id: "photography",
    label: "Photography Lover",
    description: "Scenic spots, iconic landmarks, golden hours",
    icon: "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

export default function TravelStyleStep({ selected, onChange }: TravelStyleStepProps) {
  const toggleStyle = (styleId: string) => {
    if (selected.includes(styleId)) {
      onChange(selected.filter(s => s !== styleId));
    } else {
      onChange([...selected, styleId]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          What's your travel style?
        </h1>
        <p className="text-slate-600">
          Select all that apply - we'll personalize your trips
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {TRAVEL_STYLES.map((style) => {
          const isSelected = selected.includes(style.id);
          return (
            <button
              key={style.id}
              onClick={() => toggleStyle(style.id)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                isSelected ? "bg-[var(--primary)] text-white" : "bg-slate-100 text-slate-600"
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.icon} />
                </svg>
              </div>
              <div className="font-medium text-slate-900 text-sm">{style.label}</div>
              <div className="text-xs text-slate-500 mt-1">{style.description}</div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-sm text-slate-500">
        Selected: {selected.length} style{selected.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
