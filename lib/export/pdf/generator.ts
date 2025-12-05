import jsPDF from "jspdf";
import type { PremiumTripForExport, PageContext, ImageCache } from "./types";
import { PDF_CONFIG } from "./config";
import { prefetchTripImages } from "./utils/images";
import { renderCoverPage } from "./pages/cover";
import { renderOverviewPage } from "./pages/overview";
import { renderDayPage } from "./pages/day-spread";
import { renderFinalPage } from "./pages/final";

/**
 * Generate a premium magazine-style PDF for a trip
 */
export async function generatePremiumTripPDF(
  trip: PremiumTripForExport,
  onProgress?: (step: string, progress: number) => void
): Promise<Blob> {
  onProgress?.("Initializing PDF...", 0);

  // Initialize jsPDF
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  onProgress?.("Fetching images...", 5);

  // Pre-fetch all images using the server-side proxy
  const imageCache: ImageCache = await prefetchTripImages(trip, (step, progress) => {
    // Map image progress to 5-40% of total progress
    const mappedProgress = 5 + (progress / 100) * 35;
    onProgress?.(step, mappedProgress);
  });

  onProgress?.("Generating cover page...", 45);

  // Create page context
  const ctx: PageContext = {
    doc,
    config: PDF_CONFIG,
    yPosition: PDF_CONFIG.margin,
    pageNumber: 1,
    imageCache,
  };

  // === RENDER PAGES ===

  // 1. Cover Page (no addPage needed - jsPDF starts with one page)
  renderCoverPage(ctx, trip);

  onProgress?.("Generating overview...", 50);

  // 2. Overview Page
  renderOverviewPage(ctx, trip);

  onProgress?.("Generating itinerary...", 55);

  // 3. Day Pages
  const totalDays = trip.itinerary.length;
  trip.itinerary.forEach((day, idx) => {
    const progress = 55 + (idx / totalDays) * 30;
    onProgress?.(`Generating Day ${day.day_number}...`, progress);
    renderDayPage(ctx, day, idx, totalDays, trip);
  });

  onProgress?.("Generating final page...", 90);

  // 4. Final Page
  renderFinalPage(ctx, trip);

  onProgress?.("Finalizing PDF...", 100);

  // Return as blob
  return doc.output("blob");
}

/**
 * Download a premium PDF for a trip
 */
export async function downloadPremiumPDF(
  trip: PremiumTripForExport,
  onProgress?: (step: string, progress: number) => void
): Promise<void> {
  const blob = await generatePremiumTripPDF(trip, onProgress);

  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;

  // Generate filename
  const safeName = trip.title
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  link.download = `${safeName}-travel-guide.pdf`;

  // Trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Get estimated PDF size info
 */
export function estimatePDFSize(trip: PremiumTripForExport): {
  pages: number;
  hasImages: boolean;
  estimatedSizeMB: number;
} {
  // Estimate pages: cover + overview + ~1 page per day + final
  const estimatedPages = 2 + trip.itinerary.length + 1;

  // Check if images are available
  const hasImages = !!(
    trip.coverImageUrl ||
    trip.galleryPhotos?.length ||
    trip.itinerary.some((day) =>
      day.activities.some((a) => a.image_url)
    )
  );

  // Rough estimate: ~100KB per page without images, ~400KB with images
  const sizePerPage = hasImages ? 0.4 : 0.1;
  const estimatedSizeMB = estimatedPages * sizePerPage;

  return {
    pages: estimatedPages,
    hasImages,
    estimatedSizeMB: Math.round(estimatedSizeMB * 10) / 10,
  };
}
