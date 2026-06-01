"use client";

/**
 * Global Error Handler for Next.js App Router
 *
 * This component catches unhandled errors at the root layout level.
 * It reports errors to Sentry and shows a user-friendly error page.
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/error-handling
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Detect stale-chunk failures from a rolling Vercel deploy.
 *
 * Symptom: a user loaded the page on deploy A, deploy B replaces the
 * hashed chunk filenames, and a later client-side navigation tries to
 * fetch the now-404 chunk → "ChunkLoadError: Failed to load chunk
 * /_next/static/chunks/0bcf7l1lc1d6v.js". Live-caught 2026-05-31 on
 * /it/trips/new mid-deploy. Hard refresh resolves immediately.
 *
 * We can't call reset() — it just re-renders the same broken tree.
 * Hard-reload instead, gated by sessionStorage so a genuinely broken
 * page doesn't enter an infinite reload loop.
 */
function isChunkLoadError(error: Error): boolean {
  const name = (error && error.name) || "";
  const msg = (error && error.message) || "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk \w+ failed/i.test(msg) ||
    /Failed to load chunk/i.test(msg) ||
    /ChunkLoadError/.test(msg)
  );
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Stale-chunk auto-recovery: hard-reload once per session. The
    // RELOAD_KEY prevents infinite loops if the reload itself fails
    // for a non-stale reason. Cleared after a successful render
    // would be ideal, but we never get to know — global-error is
    // unmounted on success. The 5-minute TTL is enough for one cycle.
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const RELOAD_KEY = "mt:chunk-reload-at";
      const last = sessionStorage.getItem(RELOAD_KEY);
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      if (!last || parseInt(last, 10) < fiveMinAgo) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        Sentry.captureMessage("ChunkLoadError auto-recovered via reload", {
          level: "warning",
          tags: { digest: error.digest, errorType: "chunk-load-recovery" },
        });
        // Defer so Sentry's beacon has a tick to fire.
        setTimeout(() => window.location.reload(), 100);
        return;
      }
    }

    // Report the error to Sentry
    Sentry.captureException(error, {
      tags: {
        errorType: "global-error",
        digest: error.digest,
      },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            backgroundColor: "#f8fafc",
            color: "#1e293b",
          }}
        >
          <div
            style={{
              maxWidth: "500px",
              textAlign: "center",
            }}
          >
            {/* Error Icon */}
            <div
              style={{
                width: "80px",
                height: "80px",
                margin: "0 auto 1.5rem",
                borderRadius: "50%",
                backgroundColor: "#fef2f2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: "600",
                marginBottom: "0.75rem",
              }}
            >
              Something went wrong
            </h1>

            <p
              style={{
                color: "#64748b",
                marginBottom: "1.5rem",
                lineHeight: "1.6",
              }}
            >
              We&apos;re sorry, but something unexpected happened. Our team has
              been notified and is working on a fix.
            </p>

            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={reset}
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#0A4B73",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "500",
                  fontSize: "0.875rem",
                }}
              >
                Try again
              </button>

              <a
                href="/"
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "white",
                  color: "#0A4B73",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  textDecoration: "none",
                  fontWeight: "500",
                  fontSize: "0.875rem",
                }}
              >
                Go home
              </a>
            </div>

            {/* Error ID for support */}
            {error.digest && (
              <p
                style={{
                  marginTop: "2rem",
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                }}
              >
                Error ID: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
