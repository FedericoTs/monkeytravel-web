import type { PageContext, PremiumTripForExport } from "../types";
import { COLORS, TYPOGRAPHY, LAYOUT } from "../config";

/**
 * Format date for display
 */
function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };

  return `${start.toLocaleDateString("en-US", options)} - ${end.toLocaleDateString("en-US", options)}`;
}

/**
 * Render the overview page with trip stats, highlights, and tips
 */
export function renderOverviewPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config } = ctx;
  const { margin, contentWidth, pageWidth, pageHeight } = config;

  doc.addPage();
  let y = margin;

  // === TOP ACCENT BAR ===
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 8, "F");

  y += 18;

  // === SECTION TITLE ===
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(TYPOGRAPHY.sectionTitle.size);
  doc.setFont(config.fonts.display, "bold");
  doc.text("YOUR JOURNEY AT A GLANCE", margin, y);

  // Title underline
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(2.5);
  doc.line(margin, y + 4, margin + 70, y + 4);

  y += 22;

  // === STATS GRID (2x2) ===
  const cardWidth = (contentWidth - 8) / 2;
  const cardHeight = 42;
  const totalActivities = trip.itinerary.reduce((sum, day) => sum + day.activities.length, 0);

  // Card 1: Days
  renderStatCard(ctx, margin, y, cardWidth, cardHeight, {
    label: "DAYS",
    value: String(trip.itinerary.length),
    sublabel: formatDateRange(trip.startDate, trip.endDate),
    accentColor: COLORS.primary,
  });

  // Card 2: Activities
  renderStatCard(ctx, margin + cardWidth + 8, y, cardWidth, cardHeight, {
    label: "ACTIVITIES",
    value: String(totalActivities),
    sublabel: "Curated experiences",
    accentColor: COLORS.secondary,
  });

  y += cardHeight + 8;

  // Card 3: Budget
  renderStatCard(ctx, margin, y, cardWidth, cardHeight, {
    label: "BUDGET",
    value: trip.budget ? `${trip.budget.currency} ${trip.budget.total}` : "—",
    sublabel: "Estimated total",
    accentColor: COLORS.accent,
  });

  // Card 4: Weather
  const weatherNote = trip.meta?.weather_note || "Check local forecast";
  renderStatCard(ctx, margin + cardWidth + 8, y, cardWidth, cardHeight, {
    label: "WEATHER",
    value: weatherNote.length > 20 ? weatherNote.substring(0, 18) + "..." : weatherNote,
    sublabel: "Plan accordingly",
    accentColor: COLORS.go,
  });

  y += cardHeight + 20;

  // === TRIP DESCRIPTION (if available) ===
  if (trip.description) {
    doc.setFillColor(...COLORS.cardBg);
    doc.roundedRect(margin, y, contentWidth, 35, 4, 4, "F");

    doc.setTextColor(...COLORS.text);
    doc.setFontSize(10);
    doc.setFont(config.fonts.body, "italic");
    const descLines = doc.splitTextToSize(`"${trip.description}"`, contentWidth - 16);
    doc.text(descLines.slice(0, 3), margin + 8, y + 12);

    y += 45;
  }

  // === HIGHLIGHTS SECTION ===
  if (trip.meta?.highlights && trip.meta.highlights.length > 0) {
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(14);
    doc.setFont(config.fonts.display, "bold");
    doc.text("Trip Highlights", margin, y);

    doc.setDrawColor(...COLORS.secondary);
    doc.setLineWidth(1.5);
    doc.line(margin, y + 3, margin + 35, y + 3);

    y += 12;

    // Highlight cards
    const highlights = trip.meta.highlights.slice(0, 6);
    highlights.forEach((highlight, idx) => {
      const highlightY = y + idx * 14;

      // Bullet
      doc.setFillColor(...COLORS.secondary);
      doc.circle(margin + 4, highlightY + 2, 2.5, "F");

      // Number inside bullet
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.setFont(config.fonts.body, "bold");
      doc.text(String(idx + 1), margin + 2.5, highlightY + 4);

      // Highlight text
      doc.setTextColor(...COLORS.text);
      doc.setFontSize(10);
      doc.setFont(config.fonts.body, "normal");
      const truncated = highlight.length > 65 ? highlight.substring(0, 62) + "..." : highlight;
      doc.text(truncated, margin + 12, highlightY + 4);
    });

    y += highlights.length * 14 + 15;
  }

  // === PACKING ESSENTIALS ===
  if (trip.meta?.packing_suggestions && trip.meta.packing_suggestions.length > 0) {
    // Section header
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(14);
    doc.setFont(config.fonts.display, "bold");
    doc.text("Packing Essentials", margin, y);

    doc.setDrawColor(...COLORS.accent);
    doc.setLineWidth(1.5);
    doc.line(margin, y + 3, margin + 40, y + 3);

    y += 12;

    // Packing items in a grid
    const packingItems = trip.meta.packing_suggestions.slice(0, 12);
    const colWidth = (contentWidth - 8) / 3;
    const itemsPerCol = Math.ceil(packingItems.length / 3);

    packingItems.forEach((item, idx) => {
      const col = Math.floor(idx / itemsPerCol);
      const row = idx % itemsPerCol;
      const itemX = margin + col * (colWidth + 4);
      const itemY = y + row * 10;

      // Checkbox style
      doc.setDrawColor(...COLORS.light);
      doc.setLineWidth(0.5);
      doc.rect(itemX, itemY - 3, 4, 4);

      // Item text
      doc.setTextColor(...COLORS.muted);
      doc.setFontSize(8);
      doc.setFont(config.fonts.body, "normal");
      const truncatedItem = item.length > 20 ? item.substring(0, 18) + "..." : item;
      doc.text(truncatedItem, itemX + 6, itemY);
    });

    y += itemsPerCol * 10 + 15;
  }

  // === DAY-BY-DAY PREVIEW ===
  if (y < pageHeight - 100) {
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(14);
    doc.setFont(config.fonts.display, "bold");
    doc.text("Day-by-Day Overview", margin, y);

    doc.setDrawColor(...COLORS.primary);
    doc.setLineWidth(1.5);
    doc.line(margin, y + 3, margin + 45, y + 3);

    y += 12;

    // Day pills
    const pillHeight = 22;
    const pillsPerRow = 4;
    const pillWidth = (contentWidth - (pillsPerRow - 1) * 6) / pillsPerRow;

    trip.itinerary.slice(0, 8).forEach((day, idx) => {
      const row = Math.floor(idx / pillsPerRow);
      const col = idx % pillsPerRow;
      const pillX = margin + col * (pillWidth + 6);
      const pillY = y + row * (pillHeight + 6);

      if (pillY + pillHeight > pageHeight - 30) return;

      // Pill background
      doc.setFillColor(...COLORS.cardBg);
      doc.roundedRect(pillX, pillY, pillWidth, pillHeight, 3, 3, "F");

      // Left accent
      doc.setFillColor(...COLORS.primary);
      doc.rect(pillX, pillY, 3, pillHeight, "F");

      // Day number
      doc.setTextColor(...COLORS.primary);
      doc.setFontSize(10);
      doc.setFont(config.fonts.display, "bold");
      doc.text(`Day ${day.day_number}`, pillX + 6, pillY + 8);

      // Theme
      if (day.theme) {
        doc.setTextColor(...COLORS.muted);
        doc.setFontSize(7);
        doc.setFont(config.fonts.body, "normal");
        const themeText = day.theme.length > 18 ? day.theme.substring(0, 16) + "..." : day.theme;
        doc.text(themeText, pillX + 6, pillY + 16);
      }
    });
  }

  // === PAGE NUMBER ===
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(TYPOGRAPHY.pageNumber.size);
  doc.setFont(config.fonts.body, "normal");
  doc.text("1 / " + String(trip.itinerary.length + 2), pageWidth - margin, pageHeight - 10, { align: "right" });
}

/**
 * Render a stat card
 */
function renderStatCard(
  ctx: PageContext,
  x: number,
  y: number,
  width: number,
  height: number,
  data: {
    label: string;
    value: string;
    sublabel: string;
    accentColor: [number, number, number];
  }
): void {
  const { doc, config } = ctx;

  // Card background
  doc.setFillColor(...COLORS.cardBg);
  doc.roundedRect(x, y, width, height, 4, 4, "F");

  // Left accent bar
  doc.setFillColor(...data.accentColor);
  doc.rect(x, y, 4, height, "F");

  // Label
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(9);
  doc.setFont(config.fonts.body, "bold");
  doc.text(data.label, x + 10, y + 10);

  // Value
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(20);
  doc.setFont(config.fonts.display, "bold");
  doc.text(data.value, x + 10, y + 26);

  // Sublabel
  doc.setTextColor(...COLORS.subtle);
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "normal");
  doc.text(data.sublabel, x + 10, y + 36);
}
