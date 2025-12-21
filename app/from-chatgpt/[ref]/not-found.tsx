/**
 * Not Found Page for ChatGPT Import
 * Shown when the itinerary doesn't exist or has already been claimed
 */

import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8fafc] to-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="font-semibold text-[var(--primary)]">
              MonkeyTravel
            </span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Itinerary Not Found
          </h1>

          <p className="text-gray-600 mb-6">
            This itinerary may have expired, already been saved, or the link might be incorrect.
            ChatGPT-generated itineraries are available for 7 days.
          </p>

          <div className="space-y-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white font-semibold px-6 py-3 rounded-xl transition-all w-full"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Create a New Trip
            </Link>

            <p className="text-sm text-gray-500">
              Or go back to{" "}
              <Link href="/" className="text-[var(--primary)] hover:underline">
                ChatGPT
              </Link>{" "}
              and generate a new itinerary.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-6 text-center text-sm text-gray-500">
        <p>
          Powered by{" "}
          <Link href="/" className="text-[var(--primary)] hover:underline">
            MonkeyTravel
          </Link>{" "}
          AI
        </p>
      </footer>
    </div>
  );
}
