import type jsPDF from "jspdf";
import type { PageContext, PremiumTripForExport } from "../types";
import type { ItineraryDay } from "@/types";
import { TYPOGRAPHY, LAYOUT } from "../config";
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
 * Render a day page with hero image and activities
 */
export function renderDayPage(
  ctx: PageContext,
  day: ItineraryDay,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { margin, contentWidth, pageWidth, pageHeight, colors } = config;

  doc.addPage();
  let y = margin;

  // === DAY HEADER ===
  doc.setFillColor(...colors.primary);
  doc.roundedRect(margin, y, contentWidth, LAYOUT.dayHeaderHeight, 3, 3, "F");

  // Day number
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(TYPOGRAPHY.dayHeader.size);
  doc.setFont(config.fonts.display, "bold");
  doc.text(`DAY ${day.day_number}`, margin + 8, y + 8);

  // Theme (if available)
  if (day.theme) {
    doc.setFontSize(9);
    doc.setFont(config.fonts.body, "normal");
    doc.text(day.theme, margin + 8, y + 15);
  }

  // Date on right side
  doc.setFontSize(9);
  doc.setFont(config.fonts.body, "normal");
  doc.text(formatDate(day.date), pageWidth - margin - 5, y + 12, { align: "right" });

  y += LAYOUT.dayHeaderHeight + 8;

  // === HERO IMAGE (from first activity with image) ===
  const heroActivity = day.activities.find(
    (a) => a.image_url && hasImage(imageCache, a.image_url)
  );

  if (heroActivity && heroActivity.image_url) {
    const imageData = imageCache[heroActivity.image_url];
    const format = getImageFormat(imageData);

    try {
      doc.addImage(
        imageData,
        format,
        margin,
        y,
        contentWidth,
        LAYOUT.heroImageHeight,
        undefined,
        "MEDIUM"
      );

      // Overlay gradient at bottom of hero image
      doc.setFillColor(0, 0, 0);
      for (let i = 0; i < 10; i++) {
        const opacity = i / 20;
        if (opacity > 0.05) {
          doc.rect(margin, y + LAYOUT.heroImageHeight - 15 + i, contentWidth, 1.5, "F");
        }
      }

      // Hero activity name overlay
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.setFont(config.fonts.display, "bold");
      doc.text(heroActivity.name, margin + 5, y + LAYOUT.heroImageHeight - 5);

      y += LAYOUT.heroImageHeight + 8;
    } catch {
      // Skip hero image on error
    }
  }

  // === ACTIVITIES GRID ===
  // Determine layout: 2 columns for many activities, 1 column for few
  const activitiesCount = day.activities.length;
  const useCompactCards = activitiesCount > 6;
  const useTwoColumns = activitiesCount > 3 && !useCompactCards;

  if (useTwoColumns) {
    // Two column layout
    const colWidth = (contentWidth - 8) / 2;
    let col = 0;
    let rowY = y;

    day.activities.forEach((activity) => {
      const cardHeight = LAYOUT.activityCardHeight;

      // Check for page break
      if (rowY + cardHeight > pageHeight - 35) {
        doc.addPage();
        renderDayPageHeader(doc, day, config, margin, pageWidth);
        rowY = margin + 30;
        col = 0;
      }

      const x = margin + col * (colWidth + 8);
      renderActivityCard(ctx, activity, x, rowY, colWidth, trip.budget?.currency || "USD");

      col++;
      if (col >= 2) {
        col = 0;
        rowY += cardHeight + LAYOUT.cardGap;
      }
    });

    y = rowY + (col > 0 ? LAYOUT.activityCardHeight + LAYOUT.cardGap : 0);
  } else if (useCompactCards) {
    // Compact card layout for many activities
    day.activities.forEach((activity) => {
      const cardHeight = 26;

      // Check for page break
      if (y + cardHeight > pageHeight - 35) {
        doc.addPage();
        renderDayPageHeader(doc, day, config, margin, pageWidth);
        y = margin + 30;
      }

      renderCompactActivityCard(
        ctx,
        activity,
        margin,
        y,
        contentWidth,
        trip.budget?.currency || "USD"
      );

      y += cardHeight + 4;
    });
  } else {
    // Single column with full cards
    day.activities.forEach((activity) => {
      const cardHeight = LAYOUT.activityCardHeight;

      // Check for page break
      if (y + cardHeight > pageHeight - 35) {
        doc.addPage();
        renderDayPageHeader(doc, day, config, margin, pageWidth);
        y = margin + 30;
      }

      renderActivityCard(
        ctx,
        activity,
        margin,
        y,
        contentWidth,
        trip.budget?.currency || "USD"
      );

      y += cardHeight + LAYOUT.cardGap;
    });
  }

  // === DAILY BUDGET SUMMARY ===
  if (day.daily_budget) {
    // Ensure we have space
    if (y + 15 > pageHeight - 20) {
      doc.addPage();
      y = margin;
    }

    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(margin, pageHeight - 22, contentWidth, 12, 2, 2, "F");

    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "normal");
    doc.text(
      `Day ${day.day_number} Estimated Total: ${trip.budget?.currency || "USD"} ${day.daily_budget.total}`,
      margin + 5,
      pageHeight - 14
    );

    // Budget breakdown
    if (day.daily_budget.breakdown) {
      const breakdown = day.daily_budget.breakdown;
      const breakdownText = `Activities: ${breakdown.activities} | Food: ${breakdown.food} | Transport: ${breakdown.transport}`;
      doc.text(breakdownText, pageWidth - margin - 5, pageHeight - 14, { align: "right" });
    }
  }

  // === DAY NOTES ===
  if (day.notes && y + 20 < pageHeight - 30) {
    y = Math.max(y, pageHeight - 55);

    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(margin, y, contentWidth, 25, 2, 2, "F");

    // Tip icon
    doc.setFillColor(...colors.accent);
    doc.circle(margin + 8, y + 8, 4, "F");
    doc.setTextColor(...colors.text);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "bold");
    doc.text("!", margin + 7, y + 10);

    // Tip text
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "normal");
    const noteLines = doc.splitTextToSize(day.notes, contentWidth - 25);
    doc.text(noteLines.slice(0, 2), margin + 18, y + 10);
  }
}

/**
 * Render day page continuation header
 */
function renderDayPageHeader(
  doc: jsPDF,
  day: ItineraryDay,
  config: { fonts: { display: string }; colors: { primary: [number, number, number] } },
  margin: number,
  pageWidth: number
): void {
  // Small header for continuation pages
  doc.setFillColor(...config.colors.primary);
  doc.rect(0, 0, pageWidth, 6, "F");

  doc.setTextColor(...config.colors.primary);
  doc.setFontSize(10);
  doc.setFont(config.fonts.display, "bold");
  doc.text(`Day ${day.day_number} (continued)`, margin, margin + 10);
}

/**
 * Render multiple days optimized for space
 */
export function renderDayPages(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  trip.itinerary.forEach((day) => {
    renderDayPage(ctx, day, trip);
  });
}
