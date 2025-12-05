/**
 * Premium PDF Export Module
 *
 * Generates magazine-style travel itinerary PDFs with:
 * - Full-bleed cover images
 * - Beautiful typography
 * - Activity photos
 * - Professional layouts
 *
 * Usage:
 * ```typescript
 * import { generatePremiumTripPDF, downloadPremiumPDF } from "@/lib/export/pdf";
 *
 * // Generate blob for custom handling
 * const blob = await generatePremiumTripPDF(tripData);
 *
 * // Or download directly
 * await downloadPremiumPDF(tripData, (step, progress) => {
 *   console.log(`${step}: ${progress}%`);
 * });
 * ```
 */

// Main exports
export {
  generatePremiumTripPDF,
  downloadPremiumPDF,
  estimatePDFSize,
} from "./generator";

// Types
export type {
  PremiumTripForExport,
  PDFConfig,
  ImageCache,
  PageContext,
  RGB,
} from "./types";

// Config (for customization)
export { PDF_CONFIG, TYPOGRAPHY, LAYOUT, getActivityTypeConfig } from "./config";

// Utilities (for advanced usage)
export { fetchImageAsBase64, prefetchTripImages, hasImage } from "./utils/images";

// Page renderers (for custom PDF composition)
export { renderCoverPage } from "./pages/cover";
export { renderOverviewPage } from "./pages/overview";
export { renderDayPage, renderDayPages } from "./pages/day-spread";
export { renderActivityCard, renderCompactActivityCard } from "./pages/activity-card";
export { renderFinalPage } from "./pages/final";
