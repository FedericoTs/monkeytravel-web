"use client";

interface ActiveHoursStepProps {
  startHour: number;
  endHour: number;
  onStartChange: (hour: number) => void;
  onEndChange: (hour: number) => void;
}

const formatHour = (hour: number): string => {
  if (hour === 0 || hour === 24) return "12:00 AM";
  if (hour === 12) return "12:00 PM";
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
};

const PRESETS = [
  { label: "Early Bird", start: 6, end: 20, description: "6 AM - 8 PM" },
  { label: "Standard", start: 8, end: 22, description: "8 AM - 10 PM" },
  { label: "Night Owl", start: 10, end: 24, description: "10 AM - 12 AM" },
];

export default function ActiveHoursStep({
  startHour,
  endHour,
  onStartChange,
  onEndChange,
}: ActiveHoursStepProps) {
  const applyPreset = (start: number, end: number) => {
    onStartChange(start);
    onEndChange(end);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          When do you like to explore?
        </h1>
        <p className="text-slate-600">
          We'll schedule activities during your active hours
        </p>
      </div>

      {/* Presets */}
      <div className="grid grid-cols-3 gap-3">
        {PRESETS.map((preset) => {
          const isSelected = startHour === preset.start && endHour === preset.end;
          return (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset.start, preset.end)}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="font-medium text-slate-900 text-sm">{preset.label}</div>
              <div className="text-xs text-slate-500 mt-1">{preset.description}</div>
            </button>
          );
        })}
      </div>

      {/* Custom Selection */}
      <div className="bg-slate-50 rounded-xl p-6 space-y-6">
        <div className="text-center text-sm font-medium text-slate-700">
          Or customize your hours
        </div>

        {/* Start Time */}
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">
            Start activities from
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={12}
              value={startHour}
              onChange={(e) => onStartChange(Number(e.target.value))}
              className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
            />
            <div className="w-24 text-right font-medium text-slate-900">
              {formatHour(startHour)}
            </div>
          </div>
        </div>

        {/* End Time */}
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">
            Wind down by
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={18}
              max={24}
              value={endHour}
              onChange={(e) => onEndChange(Number(e.target.value))}
              className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
            />
            <div className="w-24 text-right font-medium text-slate-900">
              {formatHour(endHour)}
            </div>
          </div>
        </div>
      </div>

      {/* Visual Summary */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <div className="font-medium text-amber-900">
              {endHour - startHour} active hours
            </div>
            <div className="text-sm text-amber-700">
              {formatHour(startHour)} to {formatHour(endHour)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
