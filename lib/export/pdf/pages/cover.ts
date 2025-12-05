import type jsPDF from "jspdf";
import type { PageContext, PremiumTripForExport } from "../types";
import { TYPOGRAPHY, LAYOUT } from "../config";
import { getImageFormat, hasImage } from "../utils/images";

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Render the cover page with full-bleed hero image
 */
export function renderCoverPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { pageWidth, pageHeight, margin, contentWidth, colors } = config;

  // === FULL BLEED HERO IMAGE ===
  const coverImageHeight = pageHeight * LAYOUT.coverImageRatio;
  const hasCoverImage = hasImage(imageCache, trip.coverImageUrl);

  if (hasCoverImage && trip.coverImageUrl) {
    const imageData = imageCache[trip.coverImageUrl];
    const format = getImageFormat(imageData);

    try {
      doc.addImage(
        imageData,
        format,
        0,
        0,
        pageWidth,
        coverImageHeight,
        undefined,
        "MEDIUM"
      );
    } catch (e) {
      // Fallback to gradient if image fails
      renderGradientBackground(doc, pageWidth, coverImageHeight, colors.primary);
    }
  } else {
    // Gradient fallback
    renderGradientBackground(doc, pageWidth, coverImageHeight, colors.primary);
  }

  // === GRADIENT OVERLAY (bottom fade) ===
  renderBottomGradient(doc, pageWidth, pageHeight, LAYOUT.coverGradientStart);

  // === CONTENT SECTION ===
  const contentStartY = pageHeight * 0.50;

  // Brand name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont(config.fonts.display, "bold");
  doc.text("MONKEYTRAVEL", margin, contentStartY);

  // Decorative line
  doc.setDrawColor(255, 217, 61); // Gold accent
  doc.setLineWidth(0.5);
  doc.line(margin, contentStartY + 4, margin + 30, contentStartY + 4);

  // Trip title
  doc.setFontSize(TYPOGRAPHY.coverTitle.size);
  doc.setFont(config.fonts.display, "bold");
  const titleLines = doc.splitTextToSize(trip.title, contentWidth);
  doc.text(titleLines.slice(0, 2), margin, contentStartY + 18);

  // Calculate title height
  const titleHeight = Math.min(titleLines.length, 2) * 10;

  // Destination
  doc.setFontSize(14);
  doc.setFont(config.fonts.body, "normal");
  doc.setTextColor(255, 255, 255, 0.9);
  doc.text(trip.destination, margin, contentStartY + titleHeight + 22);

  // Date range and stats
  const startDate = formatDate(trip.startDate);
  const endDate = formatDate(trip.endDate);
  const totalActivities = trip.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );
  const daysCount = trip.itinerary.length;

  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255, 0.8);
  doc.text(
    `${startDate} - ${endDate}`,
    margin,
    contentStartY + titleHeight + 34
  );

  // Stats pills
  const statsY = contentStartY + titleHeight + 44;
  renderStatPill(doc, margin, statsY, `${daysCount} Days`, colors.accent);
  renderStatPill(doc, margin + 35, statsY, `${totalActivities} Activities`, colors.secondary);

  // === BOTTOM INFO BAR ===
  const bottomBarY = pageHeight - 28;
  doc.setFillColor(255, 255, 255);
  doc.rect(0, bottomBarY, pageWidth, 28, "F");

  // Budget (if available)
  if (trip.budget) {
    doc.setFillColor(...colors.accent);
    doc.roundedRect(margin, bottomBarY + 8, 55, 14, 2, 2, "F");
    doc.setTextColor(...colors.text);
    doc.setFontSize(10);
    doc.setFont(config.fonts.body, "bold");
    doc.text(
      `${trip.budget.currency} ${trip.budget.total.toLocaleString()}`,
      margin + 5,
      bottomBarY + 17
    );
  }

  // Weather note
  if (trip.meta?.weather_note) {
    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "normal");
    const weatherText = trip.meta.weather_note.length > 60
      ? trip.meta.weather_note.substring(0, 60) + "..."
      : trip.meta.weather_note;
    doc.text(weatherText, pageWidth - margin, bottomBarY + 17, { align: "right" });
  }

  // Brand URL
  doc.setTextColor(...colors.primary);
  doc.setFontSize(7);
  doc.text("monkeytravel.app", pageWidth / 2, bottomBarY + 24, { align: "center" });
}

/**
 * Render gradient background when no cover image
 */
function renderGradientBackground(
  doc: jsPDF,
  width: number,
  height: number,
  baseColor: [number, number, number]
): void {
  // Create a subtle gradient effect using multiple rectangles
  const steps = 20;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(baseColor[0] * (1 - ratio * 0.3));
    const g = Math.round(baseColor[1] * (1 - ratio * 0.3));
    const b = Math.round(baseColor[2] * (1 - ratio * 0.3));

    doc.setFillColor(r, g, b);
    doc.rect(0, (height / steps) * i, width, height / steps + 1, "F");
  }
}

/**
 * Render bottom gradient overlay for text readability
 */
function renderBottomGradient(
  doc: jsPDF,
  width: number,
  height: number,
  startRatio: number
): void {
  const startY = height * startRatio;
  const gradientHeight = height - startY;
  const steps = 40;

  for (let i = 0; i < steps; i++) {
    const opacity = (i / steps) * 0.85;
    const y = startY + (gradientHeight / steps) * i;

    // jsPDF doesn't support true opacity, so we blend with black
    const gray = Math.round(255 * (1 - opacity));
    doc.setFillColor(gray > 40 ? 40 : 0, gray > 40 ? 40 : 0, gray > 40 ? 45 : 0);

    // Only draw if visible
    if (opacity > 0.1) {
      doc.setFillColor(0, 0, 0);
      doc.rect(0, y, width, gradientHeight / steps + 1, "F");
    }
  }
}

/**
 * Render a stat pill
 */
function renderStatPill(
  doc: jsPDF,
  x: number,
  y: number,
  text: string,
  color: [number, number, number]
): void {
  const pillWidth = text.length * 2.5 + 10;
  const pillHeight = 8;

  doc.setFillColor(...color);
  doc.roundedRect(x, y, pillWidth, pillHeight, 2, 2, "F");

  doc.setTextColor(45, 52, 54); // Dark text on light pill
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text(text, x + pillWidth / 2, y + 5.5, { align: "center" });
}
