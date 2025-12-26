import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
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
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="text-center max-w-md">
          {/* 404 Illustration - already contains "404 PAGE NOT FOUND" text */}
          <div className="relative w-64 h-48 sm:w-80 sm:h-60 md:w-96 md:h-72 mx-auto mb-6">
            <Image
              src="/images/404.png"
              alt="404 - Page Not Found"
              fill
              className="object-contain"
              priority
            />
          </div>

          <p className="text-slate-600 text-sm sm:text-base mb-6 max-w-sm mx-auto">
            Looks like you took a wrong turn. The page you&apos;re looking for
            doesn&apos;t exist or has been moved.
          </p>

          <div className="space-y-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white font-semibold px-6 py-3 rounded-xl transition-all w-full sm:w-auto shadow-lg shadow-[var(--primary)]/25"
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
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              Back to Home
            </Link>

            <p className="text-sm text-slate-500">
              Or{" "}
              <Link
                href="/trips/new"
                className="text-[var(--primary)] hover:underline font-medium"
              >
                plan a new trip
              </Link>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-6 text-center text-sm text-slate-500">
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
