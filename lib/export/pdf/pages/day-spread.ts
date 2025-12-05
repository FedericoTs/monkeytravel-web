import type jsPDF from "jspdf";
import type { PageContext, PremiumTripForExport } from "../types";
import type { ItineraryDay } from "@/types";
import { COLORS, TYPOGRAPHY, LAYOUT } from "../config";
import { getImageFormat, hasImage } from "../utils/images";
import { renderActivityCard, renderCompactActivityCard } from "./activity-card";

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Render a day page with visual timeline and activities
 */
export function renderDayPage(
  ctx: PageContext,
  day: ItineraryDay,
  dayIndex: number,
  totalDays: number,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { margin, contentWidth, pageWidth, pageHeight } = config;

  doc.addPage();
  let y = 0;

  // === TOP ACCENT BAR ===
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 8, "F");

  y = margin + 8;

  // === DAY HEADER ===
  // Day number badge
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(margin, y, contentWidth, 28, 4, 4, "F");

  // Day number - large
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(TYPOGRAPHY.dayHeader.size);
  doc.setFont(config.fonts.display, "bold");
  doc.text(`DAY ${day.day_number}`, margin + 10, y + 14);

  // Theme
  if (day.theme) {
    doc.setFontSize(10);
    doc.setFont(config.fonts.body, "normal");
    doc.text(day.theme, margin + 10, y + 22);
  }

  // Date on right side
  doc.setFontSize(11);
  doc.setFont(config.fonts.body, "normal");
  doc.text(formatDate(day.date), pageWidth - margin - 10, y + 18, { align: "right" });

  y += 36;

  // === HERO IMAGE (from first activity with image) ===
  const heroActivity = day.activities.find(
    (a) => a.image_url && hasImage(imageCache, a.image_url)
  );

  if (heroActivity && heroActivity.image_url) {
    const imageData = imageCache[heroActivity.image_url];
    const format = getImageFormat(imageData);
    const heroHeight = LAYOUT.heroImageHeight;

    try {
      doc.addImage(
        imageData,
        format,
        margin,
        y,
        contentWidth,
        heroHeight,
        undefined,
        "MEDIUM"
      );

      // Gradient overlay at bottom
      for (let i = 0; i < 15; i++) {
        const opacity = (i / 15) * 0.7;
        doc.setFillColor(0, 0, 0);
        if (opacity > 0.1) {
          doc.rect(margin, y + heroHeight - 20 + i, contentWidth, 1.5, "F");
        }
      }

      // Hero activity name overlay
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont(config.fonts.display, "bold");
      doc.text(heroActivity.name, margin + 8, y + heroHeight - 6);

      y += heroHeight + 10;
    } catch {
      // Skip hero image on error
    }
  }

  // === ACTIVITIES WITH TIMELINE ===
  const activitiesCount = day.activities.length;
  const useCompactCards = activitiesCount > 5;
  const cardHeight = useCompactCards ? 22 : LAYOUT.activityCardHeight;
  const timelineX = margin + 8;
  const contentStartX = margin + 20;
  const cardWidth = contentWidth - 20;

  // Draw timeline line
  const timelineStartY = y;
  const timelineEndY = Math.min(
    y + activitiesCount * (cardHeight + LAYOUT.cardGap),
    pageHeight - 50
  );

  doc.setDrawColor(...COLORS.light);
  doc.setLineWidth(LAYOUT.timelineLineWidth);
  doc.line(timelineX, timelineStartY, timelineX, timelineEndY);

  // Render activities
  day.activities.forEach((activity, idx) => {
    // Check for page break
    if (y + cardHeight > pageHeight - 40) {
      doc.addPage();
      renderDayPageHeader(doc, day, config, margin, pageWidth, dayIndex, totalDays);
      y = margin + 30;

      // Continue timeline on new page
      doc.setDrawColor(...COLORS.light);
      doc.setLineWidth(LAYOUT.timelineLineWidth);
      doc.line(timelineX, y, timelineX, pageHeight - 50);
    }

    // Timeline dot
    doc.setFillColor(...COLORS.primary);
    doc.circle(timelineX, y + cardHeight / 2, LAYOUT.timelineDotSize / 2, "F");

    // Time label on timeline
    doc.setTextColor(...COLORS.primary);
    doc.setFontSize(7);
    doc.setFont(config.fonts.body, "bold");
    const timeLabel = activity.start_time;
    doc.text(timeLabel, timelineX - 2, y + 3, { align: "right" });

    // Activity card
    if (useCompactCards) {
      renderCompactActivityCard(
        ctx,
        activity,
        contentStartX,
        y,
        cardWidth,
        trip.budget?.currency || "USD"
      );
    } else {
      renderActivityCard(
        ctx,
        activity,
        contentStartX,
        y,
        cardWidth,
        trip.budget?.currency || "USD"
      );
    }

    y += cardHeight + LAYOUT.cardGap;
  });

  // === DAILY BUDGET SUMMARY ===
  if (day.daily_budget && y + 20 < pageHeight - 20) {
    const summaryY = pageHeight - 28;

    doc.setFillColor(...COLORS.cardBg);
    doc.roundedRect(margin, summaryY, contentWidth, 16, 3, 3, "F");

    // Left accent
    doc.setFillColor(...COLORS.accent);
    doc.rect(margin, summaryY, 4, 16, "F");

    // Total
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(9);
    doc.setFont(config.fonts.body, "bold");
    doc.text(
      `Day ${day.day_number} Total: ${trip.budget?.currency || "USD"} ${day.daily_budget.total}`,
      margin + 10,
      summaryY + 10
    );

    // Breakdown
    if (day.daily_budget.breakdown) {
      const { activities, food, transport } = day.daily_budget.breakdown;
      doc.setTextColor(...COLORS.muted);
      doc.setFontSize(8);
      doc.setFont(config.fonts.body, "normal");
      doc.text(
        `Activities: ${activities} | Food: ${food} | Transport: ${transport}`,
        pageWidth - margin - 10,
        summaryY + 10,
        { align: "right" }
      );
    }
  }

  // === DAY NOTES ===
  if (day.notes && y + 25 < pageHeight - 45) {
    const noteY = pageHeight - 48;

    doc.setFillColor(...COLORS.cardBg);
    doc.roundedRect(margin, noteY, contentWidth, 18, 3, 3, "F");

    // Tip icon
    doc.setFillColor(...COLORS.secondary);
    doc.circle(margin + 8, noteY + 9, 4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "bold");
    doc.text("!", margin + 6.5, noteY + 11);

    // Note text
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "normal");
    const noteText = day.notes.length > 90 ? day.notes.substring(0, 87) + "..." : day.notes;
    doc.text(noteText, margin + 18, noteY + 11);
  }

  // === PAGE NUMBER ===
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(TYPOGRAPHY.pageNumber.size);
  doc.setFont(config.fonts.body, "normal");
  doc.text(`${dayIndex + 2} / ${totalDays + 2}`, pageWidth - margin, pageHeight - 8, { align: "right" });
}

/**
 * Render day page continuation header
 */
function renderDayPageHeader(
  doc: jsPDF,
  day: ItineraryDay,
  config: { fonts: { display: string }; colors?: { primary: [number, number, number] } },
  margin: number,
  pageWidth: number,
  dayIndex: number,
  totalDays: number
): void {
  // Top accent bar
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 6, "F");

  // Small header
  doc.setTextColor(...COLORS.primary);
  doc.setFontSize(12);
  doc.setFont(config.fonts.display, "bold");
  doc.text(`Day ${day.day_number} (continued)`, margin, margin + 12);

  // Date
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(9);
  doc.setFont(config.fonts.display, "normal");
  doc.text(formatDate(day.date), pageWidth - margin, margin + 12, { align: "right" });

  // Page number
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(8);
  doc.text(`${dayIndex + 2} / ${totalDays + 2}`, pageWidth - margin, pageWidth - 8, { align: "right" });
}

/**
 * Render all day pages
 */
export function renderDayPages(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const totalDays = trip.itinerary.length;

  trip.itinerary.forEach((day, idx) => {
    renderDayPage(ctx, day, idx, totalDays, trip);
  });
}
