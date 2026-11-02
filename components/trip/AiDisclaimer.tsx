import type { ReactNode } from "react";

/** The amber note under an AI-made itinerary: check the details before you go. */
export default function AiDisclaimer({
  title,
  children,
  className = "mt-12",
}: {
  title: ReactNode;
  children: ReactNode;
  /** Spacing above the note. */
  className?: string;
}) {
  return (
    <div className={`${className} p-5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl`}>
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
        <div>
          <h4 className="font-semibold text-amber-900 mb-1">{title}</h4>
          <p className="text-sm text-amber-800">{children}</p>
        </div>
      </div>
    </div>
  );
}
