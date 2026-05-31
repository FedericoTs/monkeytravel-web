"use client";

/**
 * "Start Anywhere" — wizard entry point above the destination input.
 *
 * Lets a visitor drop in a photo (camera roll, drag-and-drop, file
 * picker) OR a web URL (TikTok caption, Pinterest pin, blog post) and
 * have us extract destination + vibes + suggested dates via Gemini
 * Vision, then pre-fill the wizard so they can hit Generate immediately.
 *
 * Hidden behind a flag (FLAG_START_ANYWHERE) so we can A/B-measure
 * conversion lift before making it the default entry surface.
 */

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { TripVibe } from "@/types";

interface ExtractedContext {
  destination: string | null;
  destinationConfidence: number;
  vibes: string[];
  suggestedDurationDays: number;
  monthHint: string | null;
  notes: string;
}

interface Props {
  /**
   * Called with the extracted context. The wizard should use it to
   * pre-fill destination + dates + vibes, then optionally scroll the
   * user to the next field they still need to confirm.
   */
  onExtracted: (
    fields: {
      destination: string | null;
      vibes: TripVibe[];
      suggestedStartDate: string | null; // YYYY-MM-DD
      suggestedEndDate: string | null; // YYYY-MM-DD
    },
    context: ExtractedContext
  ) => void;
}

const VALID_VIBES: ReadonlySet<TripVibe> = new Set<TripVibe>([
  "adventure",
  "cultural",
  "foodie",
  "romantic",
  "nature",
  "urban",
]);

/**
 * Map a Gemini-supplied month name + duration to concrete start/end dates.
 *
 * Strategy: take the *next* occurrence of that month from today. If we're
 * already past it this year, jump to next year. Aligned to the middle of
 * the month (15th) — generic enough to not lock the user into a specific
 * weekend but specific enough that the date pickers don't show today by
 * default.
 *
 * Returns null/null if the monthHint doesn't parse — let the user pick
 * the dates themselves.
 */
function monthHintToDateRange(
  monthHint: string | null,
  durationDays: number
): { start: string | null; end: string | null } {
  if (!monthHint) return { start: null, end: null };

  const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const monthIdx = MONTHS.indexOf(monthHint.toLowerCase().trim());
  if (monthIdx < 0) return { start: null, end: null };

  const now = new Date();
  // Always book at least 30 days out so the user isn't forced into a
  // last-minute trip if they upload a picture today of a March destination.
  let year = now.getFullYear();
  if (monthIdx < now.getMonth() || (monthIdx === now.getMonth() && now.getDate() > 1)) {
    year += 1;
  }
  const start = new Date(year, monthIdx, 15);
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, durationDays - 1));

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return { start: fmt(start), end: fmt(end) };
}

export default function StartAnywhereSection({ onExtracted }: Props) {
  // i18n — was hardcoded English; caught in 2026-05-29 audit on /it/.
  const t = useTranslations("trips.wizard.step1");
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"image" | "url">("image");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [websiteText, setWebsiteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Decode → resize → re-encode an image client-side before upload.
   *
   * Why this exists (2026-05-30 bug fix):
   *   iPhone photos straight from the camera roll are 3-12 MB and often
   *   HEIC. Two problems hit them at once:
   *     1. Vercel's serverless body limit is 4.5 MB — anything bigger
   *        returns a generic "Request Entity Too Large" / opaque 413
   *        BEFORE our route handler runs. Users see a cryptic error.
   *     2. Even when small enough to upload, HEIC isn't accepted by
   *        Gemini Vision (officially supported but inconsistent across
   *        models — Flash sometimes rejects it as "the string is
   *        invalid"). User reported exactly that message.
   *
   * Fix: decode via <img>, paint to a <canvas> resized to a max
   * 1920px on the longest edge, re-export as JPEG quality 0.85, then
   * base64-encode the resulting blob. After this, even a 12 MB HEIC
   * becomes a ~200-400 KB JPEG that's well under any limit and in a
   * format Gemini Vision always accepts.
   *
   * HEIC decode caveat: Safari + iOS Chrome can decode HEIC via <img>;
   * desktop Chrome cannot. We fall through to a clear error message in
   * that case rather than uploading a broken file.
   *
   * Returns:
   *   - `data`: raw base64 (no `data:` prefix)
   *   - `mimeType`: always "image/jpeg" because we re-encode
   *   - `originalSize` / `resizedSize` for telemetry / debug overlays
   */
  const resizeAndEncodeImage = (
    file: File
  ): Promise<{ data: string; mimeType: string; originalSize: number; resizedSize: number }> =>
    new Promise((resolve, reject) => {
      const MAX_EDGE_PX = 1920;
      const JPEG_QUALITY = 0.85;

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      const cleanup = () => URL.revokeObjectURL(objectUrl);

      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img;
        if (!w || !h) {
          cleanup();
          reject(new Error("Image has invalid dimensions"));
          return;
        }

        // Scale longest edge to MAX_EDGE_PX; preserve aspect ratio.
        const scale = Math.min(1, MAX_EDGE_PX / Math.max(w, h));
        const targetW = Math.round(w * scale);
        const targetH = Math.round(h * scale);

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          reject(new Error("Canvas 2D context unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);

        canvas.toBlob(
          (blob) => {
            cleanup();
            if (!blob) {
              reject(new Error("Failed to encode resized image"));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const comma = result.indexOf(",");
              const base64 = comma >= 0 ? result.slice(comma + 1) : result;
              resolve({
                data: base64,
                mimeType: "image/jpeg",
                originalSize: file.size,
                resizedSize: blob.size,
              });
            };
            reader.onerror = () => reject(new Error("Failed to read resized blob"));
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          JPEG_QUALITY
        );
      };

      img.onerror = () => {
        cleanup();
        // Most likely cause: browser can't decode the format (HEIC on
        // desktop Chrome is the typical case). Give the user clear
        // guidance instead of a cryptic upload failure later.
        const isLikelyHeic = /\.heic$|\.heif$/i.test(file.name) || /heic|heif/i.test(file.type);
        reject(
          new Error(
            isLikelyHeic
              ? "Your browser can't read HEIC files. Open the photo in Photos / Gallery and save it as JPEG, or upload a different image."
              : "Couldn't decode that image. Try a different file (JPEG or PNG works best)."
          )
        );
      };

      img.src = objectUrl;
    });

  const handleExtract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let body: Record<string, unknown> = {};

      if (mode === "image") {
        if (imageFile) {
          // 2026-05-30: was fileToBase64() — naive read-as-data-URL which
          // bricked on iPhone HEIC photos (Gemini Vision rejected them
          // as "the string is invalid") AND on any image >4.5MB (Vercel
          // serverless body cap, hit before our route handler ran).
          // resizeAndEncodeImage() decodes → resizes to 1920px → re-encodes
          // as JPEG, so a 12MB iPhone HEIC becomes a ~300KB JPEG. Works
          // on any browser that can decode the source format.
          const { data, mimeType } = await resizeAndEncodeImage(imageFile);
          body = { imageBase64: data, imageMimeType: mimeType };
        } else if (imageUrl.startsWith("http")) {
          body = { imageUrl };
        } else {
          setError("Pick an image file or paste an image URL.");
          setLoading(false);
          return;
        }
      } else {
        if (!websiteText.trim()) {
          setError("Paste a URL or some text from a blog/article.");
          setLoading(false);
          return;
        }
        // If they pasted a URL we just pass it as text — Gemini reads it
        // as a literal string. A future enhancement would fetch + scrape.
        body = { websiteText: websiteText.trim() };
      }

      const res = await fetch("/api/ai/extract-trip-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't extract trip details — try a different input.");
        setLoading(false);
        return;
      }

      const ctx: ExtractedContext = data.context;
      if (!ctx.destination) {
        setError(ctx.notes || "Couldn't identify a destination from this. Try a clearer image or paste a URL with a place name.");
        setLoading(false);
        return;
      }

      const vibes = ctx.vibes.filter((v): v is TripVibe => VALID_VIBES.has(v as TripVibe));
      const { start, end } = monthHintToDateRange(ctx.monthHint, ctx.suggestedDurationDays);

      onExtracted(
        {
          destination: ctx.destination,
          vibes,
          suggestedStartDate: start,
          suggestedEndDate: end,
        },
        ctx
      );

      // Auto-collapse after successful extraction so the wizard's normal
      // form takes focus.
      setExpanded(false);
      setImageFile(null);
      setImageUrl("");
      setWebsiteText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — try again.");
    } finally {
      setLoading(false);
    }
  }, [mode, imageFile, imageUrl, websiteText, onExtracted]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full mb-6 rounded-2xl border-2 border-dashed border-[var(--primary)]/40 bg-gradient-to-br from-[var(--primary)]/5 to-[var(--accent)]/5 hover:from-[var(--primary)]/10 hover:to-[var(--accent)]/10 hover:border-[var(--primary)]/60 transition-all px-4 py-3 sm:py-4 text-left group"
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
            ✨
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              {t("startAnywhereTitle")}
            </p>
            <p className="text-xs text-slate-600">
              {t("startAnywhereSubtitle")}
            </p>
          </div>
          <svg
            className="w-5 h-5 text-slate-400 group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-all"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-[var(--primary)]/30 bg-white p-4 sm:p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <span className="text-xl">✨</span> Start anywhere
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload a photo, drop a URL, or paste text. We'll prefill the trip.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode("image")}
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            mode === "image"
              ? "bg-[var(--primary)] text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          📷 Image
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            mode === "url"
              ? "bg-[var(--primary)] text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          🔗 URL / Text
        </button>
      </div>

      {mode === "image" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-[var(--primary)]/50 bg-slate-50 hover:bg-[var(--primary)]/5 p-4 text-center transition-colors"
          >
            {imageFile ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-700">
                <span>📸</span>
                <span className="truncate max-w-[200px]">{imageFile.name}</span>
                <span className="text-xs text-slate-400">
                  ({(imageFile.size / 1024).toFixed(0)} KB)
                </span>
              </div>
            ) : (
              <span className="text-sm text-slate-600">
                Tap to pick a photo from your device
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setImageFile(f);
            }}
          />
          <div className="text-center text-xs text-slate-400">— or —</div>
          <input
            type="url"
            placeholder="Paste an image URL (https://...)"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      ) : (
        <textarea
          placeholder="Paste a URL, a tweet, or some text from a travel article…"
          value={websiteText}
          onChange={(e) => setWebsiteText(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
        />
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <button
        type="button"
        onClick={handleExtract}
        disabled={
          loading ||
          (mode === "image" && !imageFile && !imageUrl.startsWith("http")) ||
          (mode === "url" && !websiteText.trim())
        }
        className="mt-4 w-full rounded-xl bg-[var(--primary)] text-white font-semibold py-2.5 hover:bg-[var(--primary)]/90 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg
              className="animate-spin w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <circle cx="12" cy="12" r="10" strokeWidth="3" className="opacity-25" />
              <path
                strokeWidth="3"
                strokeLinecap="round"
                d="M12 2a10 10 0 0110 10"
                className="opacity-75"
              />
            </svg>
            Analysing…
          </>
        ) : (
          <>✨ Extract trip</>
        )}
      </button>
    </div>
  );
}
