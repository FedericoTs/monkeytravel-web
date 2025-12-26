import type jsPDF from "jspdf";
import type { PageContext, PremiumTripForExport } from "../types";
import { COLORS, TYPOGRAPHY, LAYOUT } from "../config";
import { getImageFormat, hasImage } from "../utils/images";
import { formatDateRange } from "@/lib/datetime";

/**
 * Draw a beautiful gradient background when no cover image
 */
function drawGradientBackground(doc: jsPDF, width: number, height: number): void {
  // Create gradient effect with multiple rectangles
  const steps = 50;
  const stepHeight = height / steps;

  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(COLORS.coverGradientStart[0] + (COLORS.coverGradientEnd[0] - COLORS.coverGradientStart[0]) * ratio);
    const g = Math.round(COLORS.coverGradientStart[1] + (COLORS.coverGradientEnd[1] - COLORS.coverGradientStart[1]) * ratio);
    const b = Math.round(COLORS.coverGradientStart[2] + (COLORS.coverGradientEnd[2] - COLORS.coverGradientStart[2]) * ratio);

    doc.setFillColor(r, g, b);
    doc.rect(0, i * stepHeight, width, stepHeight + 1, "F");
  }

  // Add subtle pattern overlay
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.1);
  for (let i = 0; i < width; i += 15) {
    for (let j = 0; j < height; j += 15) {
      doc.setFillColor(255, 255, 255);
      doc.circle(i, j, 0.5, "F");
    }
  }
}

/**
 * Draw bottom gradient overlay for text readability
 */
function drawBottomOverlay(doc: jsPDF, width: number, height: number, startY: number): void {
  const overlayHeight = height - startY;
  const steps = 30;
  const stepHeight = overlayHeight / steps;

  for (let i = 0; i < steps; i++) {
    const opacity = (i / steps) * 0.85;
    const gray = Math.round(255 * (1 - opacity));
    doc.setFillColor(gray, gray, gray);

    // Create gradient from transparent to dark
    if (i > 5) {
      doc.rect(0, startY + i * stepHeight, width, stepHeight + 1, "F");
    }
  }

  // Solid dark section at bottom
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, height - 85, width, 85, "F");
}

/**
 * Render the cover page - Magazine style
 */
export function renderCoverPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { pageWidth, pageHeight, margin } = config;

  // Calculate stats
  const totalActivities = trip.itinerary.reduce((sum, day) => sum + day.activities.length, 0);
  const days = trip.itinerary.length;

  // === FULL-BLEED BACKGROUND ===
  const hasCoverImage = hasImage(imageCache, trip.coverImageUrl);

  if (hasCoverImage && trip.coverImageUrl) {
    const imageData = imageCache[trip.coverImageUrl];
    const format = getImageFormat(imageData);

    try {
      // Full-bleed image
      doc.addImage(
        imageData,
        format,
        0,
        0,
        pageWidth,
        pageHeight,
        undefined,
        "MEDIUM"
      );
    } catch {
      // Fallback to gradient
      drawGradientBackground(doc, pageWidth, pageHeight);
    }
  } else {
    // Beautiful gradient fallback
    drawGradientBackground(doc, pageWidth, pageHeight);
  }

  // === BOTTOM OVERLAY FOR TEXT ===
  drawBottomOverlay(doc, pageWidth, pageHeight, LAYOUT.coverOverlayStart);

  // === BRAND HEADER ===
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont(config.fonts.display, "bold");
  doc.text("MONKEYTRAVEL", margin, margin + 8);

  // Brand underline accent
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(2);
  doc.line(margin, margin + 12, margin + 40, margin + 12);

  // === DESTINATION TITLE - Large and impactful ===
  const titleY = pageHeight - 75;

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(TYPOGRAPHY.coverTitle.size);
  doc.setFont(config.fonts.display, "bold");

  // Main title
  const title = trip.title;
  doc.text(title, margin, titleY);

  // Destination subtitle if different from title
  if (trip.destination && trip.destination !== trip.title.replace(/ Trip$/, "")) {
    doc.setFontSize(18);
    doc.setFont(config.fonts.body, "normal");
    doc.text(trip.destination, margin, titleY + 12);
  }

  // === DATE RANGE ===
  doc.setFontSize(TYPOGRAPHY.coverSubtitle.size);
  doc.setFont(config.fonts.body, "normal");
  doc.setTextColor(200, 200, 200);
  doc.text(formatDateRange(trip.startDate, trip.endDate), margin, titleY + 28);

  // === STATS PILLS ===
  const pillY = pageHeight - 30;
  const pillHeight = 9;
  const pillRadius = 4;
  let pillX = margin;

  // Days pill
  doc.setFillColor(...COLORS.primary);
  const daysText = `${days} Days`;
  const daysWidth = doc.getTextWidth(daysText) + 14;
  doc.roundedRect(pillX, pillY, daysWidth, pillHeight, pillRadius, pillRadius, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "bold");
  doc.text(daysText, pillX + 7, pillY + 6);
  pillX += daysWidth + 6;

  // Activities pill
  doc.setFillColor(...COLORS.secondary);
  const activitiesText = `${totalActivities} Activities`;
  const activitiesWidth = doc.getTextWidth(activitiesText) + 14;
  doc.roundedRect(pillX, pillY, activitiesWidth, pillHeight, pillRadius, pillRadius, "F");
  doc.text(activitiesText, pillX + 7, pillY + 6);
  pillX += activitiesWidth + 6;

  // Budget pill (if available)
  if (trip.budget?.total) {
    doc.setFillColor(...COLORS.accent);
    doc.setTextColor(...COLORS.text);
    const budgetText = `${trip.budget.currency} ${trip.budget.total}`;
    const budgetWidth = doc.getTextWidth(budgetText) + 14;
    doc.roundedRect(pillX, pillY, budgetWidth, pillHeight, pillRadius, pillRadius, "F");
    doc.text(budgetText, pillX + 7, pillY + 6);
  }

  // === WEBSITE URL (bottom right) ===
  doc.setTextColor(...COLORS.accent);
  doc.setFontSize(9);
  doc.setFont(config.fonts.body, "normal");
  doc.text("monkeytravel.app", pageWidth - margin, pageHeight - 12, { align: "right" });
}
