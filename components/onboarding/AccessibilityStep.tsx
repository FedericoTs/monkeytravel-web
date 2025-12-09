"use client";

interface AccessibilityStepProps {
  selected: string[];
  onChange: (needs: string[]) => void;
}

const ACCESSIBILITY_OPTIONS = [
  {
    id: "none",
    label: "No accessibility needs",
    description: "I don't have specific accessibility requirements",
    icon: "M5 13l4 4L19 7",
  },
  {
    id: "wheelchair",
    label: "Wheelchair accessible",
    description: "Ramps, elevators, accessible paths",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    id: "limited-mobility",
    label: "Limited mobility",
    description: "Prefer minimal walking, rest stops",
    icon: "M16.5 3A5.5 5.5 0 0011 8.5v3.764a3 3 0 100 5.472V21M11 8.5a5.5 5.5 0 00-5.5 5.5",
  },
  {
    id: "visual",
    label: "Visual assistance",
    description: "Audio guides, tactile exhibits",
    icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
  },
  {
    id: "hearing",
    label: "Hearing assistance",
    description: "Visual alerts, sign language tours",
    icon: "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z",
  },
  {
    id: "rest-stops",
    label: "Frequent rest stops",
    description: "Plan activities with breaks in between",
    icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
  },
];

export default function AccessibilityStep({ selected, onChange }: AccessibilityStepProps) {
  const toggleNeed = (needId: string) => {
    // "None" is exclusive
    if (needId === "none") {
      onChange(selected.includes("none") ? [] : ["none"]);
      return;
    }

    // Remove "none" if selecting another option
    const withoutNone = selected.filter(s => s !== "none");

    if (selected.includes(needId)) {
      onChange(withoutNone.filter(s => s !== needId));
    } else {
      onChange([...withoutNone, needId]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Any accessibility needs?
        </h1>
        <p className="text-slate-600">
          We'll ensure activities are suitable for you
        </p>
      </div>

      <div className="space-y-3">
        {ACCESSIBILITY_OPTIONS.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <button
              key={option.id}
              onClick={() => toggleNeed(option.id)}
              className={`w-full p-4 rounded-xl border-2 text-left transition-all flex items-center gap-4 ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                isSelected ? "bg-[var(--primary)] text-white" : "bg-slate-100 text-slate-600"
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={option.icon} />
                </svg>
              </div>
              <div>
                <div className="font-medium text-slate-900">{option.label}</div>
                <div className="text-sm text-slate-500">{option.description}</div>
              </div>
              {isSelected && (
                <svg className="w-5 h-5 text-[var(--primary)] ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
