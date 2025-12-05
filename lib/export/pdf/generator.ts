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

  onProgress?.("Fetching images...", 10);

  // Collect all activities for image fetching
  const allActivities = trip.itinerary.flatMap((day) => day.activities);

  // Pre-fetch all images
  const imageCache: ImageCache = await prefetchTripImages(
    trip.coverImageUrl,
    allActivities,
    trip.galleryPhotos
  );

  onProgress?.("Generating cover page...", 30);

  // Create page context
  const ctx: PageContext = {
    doc,
    config: PDF_CONFIG,
    yPosition: PDF_CONFIG.margin,
    pageNumber: 1,
    imageCache,
  };

  // === RENDER PAGES ===

  // 1. Cover Page
  renderCoverPage(ctx, trip);

  onProgress?.("Generating overview...", 40);

  // 2. Overview Page
  renderOverviewPage(ctx, trip);

  onProgress?.("Generating itinerary...", 50);

  // 3. Day Pages
  const totalDays = trip.itinerary.length;
  trip.itinerary.forEach((day, idx) => {
    const progress = 50 + (idx / totalDays) * 35;
    onProgress?.(`Generating Day ${day.day_number}...`, progress);
    renderDayPage(ctx, day, trip);
  });

  onProgress?.("Generating final page...", 90);

  // 4. Final Page
  renderFinalPage(ctx, trip);

  onProgress?.("Adding page numbers...", 95);

  // Add page numbers to all pages except cover
  addPageNumbers(doc);

  onProgress?.("Finalizing PDF...", 100);

  // Return as blob
  return doc.output("blob");
}

/**
 * Add page numbers to all pages except the first (cover)
 */
function addPageNumbers(doc: jsPDF): void {
  const totalPages = doc.getNumberOfPages();

  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setTextColor(...PDF_CONFIG.colors.muted);
    doc.setFontSize(8);
    doc.setFont(PDF_CONFIG.fonts.body, "normal");

    // Page number on bottom right
    doc.text(
      `${i - 1} / ${totalPages - 1}`,
      PDF_CONFIG.pageWidth - PDF_CONFIG.margin,
      PDF_CONFIG.pageHeight - 8,
      { align: "right" }
    );
  }
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
  const totalActivities = trip.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );

  // Estimate pages: cover + overview + ~1.5 pages per day + final
  const estimatedPages = 2 + Math.ceil(trip.itinerary.length * 1.5) + 1;

  // Check if images are available
  const hasImages = !!(
    trip.coverImageUrl ||
    trip.galleryPhotos?.length ||
    trip.itinerary.some((day) =>
      day.activities.some((a) => a.image_url)
    )
  );

  // Rough estimate: ~100KB per page without images, ~300KB with images
  const sizePerPage = hasImages ? 0.3 : 0.1;
  const estimatedSizeMB = estimatedPages * sizePerPage;

  return {
    pages: estimatedPages,
    hasImages,
    estimatedSizeMB: Math.round(estimatedSizeMB * 10) / 10,
  };
}
