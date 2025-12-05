import type { PageContext, PremiumTripForExport } from "../types";
import { TYPOGRAPHY, LAYOUT } from "../config";

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
 * Parse weather note for a simple display
 */
function parseWeatherDisplay(note?: string): string {
  if (!note) return "Check forecast";

  // Try to extract temperature
  const tempMatch = note.match(/(\d+[-]\d+[°]?[CF]?|\d+[°][CF])/);
  if (tempMatch) return tempMatch[1];

  // Try to extract condition
  const lower = note.toLowerCase();
  if (lower.includes("sun")) return "Sunny";
  if (lower.includes("rain")) return "Rainy";
  if (lower.includes("cloud")) return "Cloudy";
  if (lower.includes("warm")) return "Warm";
  if (lower.includes("cold")) return "Cold";
  if (lower.includes("mild")) return "Mild";

  return "See notes";
}

/**
 * Render the overview page with trip stats and highlights
 */
export function renderOverviewPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config } = ctx;
  const { margin, contentWidth, pageWidth, colors } = config;

  doc.addPage();
  let y = margin;

  // === TOP ACCENT BAR ===
  doc.setFillColor(...colors.primary);
  doc.rect(0, 0, pageWidth, 6, "F");

  y += 15;

  // === SECTION TITLE ===
  doc.setTextColor(...colors.text);
  doc.setFontSize(TYPOGRAPHY.sectionTitle.size);
  doc.setFont(config.fonts.display, "bold");
  doc.text("YOUR JOURNEY AT A GLANCE", margin, y);

  // Decorative underline
  doc.setDrawColor(...colors.accent);
  doc.setLineWidth(1);
  doc.line(margin, y + 3, margin + 50, y + 3);

  y += 20;

  // === STATS GRID (2x2) ===
  const statBoxWidth = (contentWidth - 10) / 2;
  const statBoxHeight = 38;

  const totalActivities = trip.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );

  const stats = [
    {
      label: "DAYS",
      value: trip.itinerary.length.toString(),
      subtext: `${formatDate(trip.startDate)} - ${formatDate(trip.endDate)}`,
    },
    {
      label: "ACTIVITIES",
      value: totalActivities.toString(),
      subtext: "Curated experiences",
    },
    {
      label: "BUDGET",
      value: trip.budget
        ? `${trip.budget.currency} ${trip.budget.total.toLocaleString()}`
        : "N/A",
      subtext: "Estimated total",
    },
    {
      label: "WEATHER",
      value: parseWeatherDisplay(trip.meta?.weather_note),
      subtext: trip.meta?.weather_note?.substring(0, 30) || "Plan accordingly",
    },
  ];

  stats.forEach((stat, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = margin + col * (statBoxWidth + 10);
    const boxY = y + row * (statBoxHeight + 8);

    // Card background
    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(x, boxY, statBoxWidth, statBoxHeight, 3, 3, "F");

    // Left accent bar
    const accentColor = idx === 0 ? colors.primary :
                        idx === 1 ? colors.secondary :
                        idx === 2 ? colors.accent :
                        [74, 144, 226] as [number, number, number]; // Blue for weather

    doc.setFillColor(...accentColor);
    doc.rect(x, boxY, 3, statBoxHeight, "F");

    // Label
    doc.setTextColor(...colors.muted);
    doc.setFontSize(7);
    doc.setFont(config.fonts.body, "bold");
    doc.text(stat.label, x + 10, boxY + 10);

    // Value
    doc.setTextColor(...colors.text);
    doc.setFontSize(16);
    doc.setFont(config.fonts.display, "bold");
    const valueText = stat.value.length > 12
      ? stat.value.substring(0, 12)
      : stat.value;
    doc.text(valueText, x + 10, boxY + 24);

    // Subtext
    doc.setTextColor(...colors.muted);
    doc.setFontSize(7);
    doc.setFont(config.fonts.body, "normal");
    const subText = stat.subtext.length > 25
      ? stat.subtext.substring(0, 25) + "..."
      : stat.subtext;
    doc.text(subText, x + 10, boxY + 33);
  });

  y += statBoxHeight * 2 + 25;

  // === HIGHLIGHTS SECTION ===
  if (trip.meta?.highlights && trip.meta.highlights.length > 0) {
    // Section header
    doc.setFillColor(...colors.primary);
    doc.roundedRect(margin, y, contentWidth, 24, 3, 3, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont(config.fonts.display, "bold");
    doc.text("TRIP HIGHLIGHTS", margin + 10, y + 9);

    // Star icon (text representation)
    doc.setFontSize(9);
    doc.text("*", margin + 4, y + 8);

    y += 10;

    // Highlight count
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "normal");
    doc.text(
      `${trip.meta.highlights.length} curated experiences`,
      margin + 10,
      y + 10
    );

    y += 22;

    // Highlights list
    trip.meta.highlights.slice(0, 5).forEach((highlight, idx) => {
      // Bullet point
      doc.setFillColor(...colors.accent);
      doc.circle(margin + 4, y + 2, 2, "F");

      // Highlight text
      doc.setTextColor(...colors.text);
      doc.setFontSize(9);
      doc.setFont(config.fonts.body, "normal");

      const lines = doc.splitTextToSize(highlight, contentWidth - 15);
      doc.text(lines.slice(0, 2), margin + 12, y + 4);

      y += lines.length * 5 + 6;
    });
  }

  y += 10;

  // === PACKING SUGGESTIONS ===
  if (trip.meta?.packing_suggestions && trip.meta.packing_suggestions.length > 0) {
    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(margin, y, contentWidth, 45, 3, 3, "F");

    // Header
    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "bold");
    doc.text("PACKING SUGGESTIONS", margin + 10, y + 12);

    // Icon
    doc.setFillColor(...colors.secondary);
    doc.circle(margin + 4, y + 10, 2, "F");

    // Items
    doc.setTextColor(...colors.text);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "normal");

    const packingItems = trip.meta.packing_suggestions.slice(0, 6);
    const packingText = packingItems.join("  |  ");
    const packingLines = doc.splitTextToSize(packingText, contentWidth - 20);

    doc.text(packingLines.slice(0, 3), margin + 10, y + 24);
  }

  // === DESTINATION TAGS ===
  if (trip.meta?.destination_best_for && trip.meta.destination_best_for.length > 0) {
    y += 55;

    doc.setTextColor(...colors.muted);
    doc.setFontSize(7);
    doc.setFont(config.fonts.body, "bold");
    doc.text("BEST FOR:", margin, y);

    let tagX = margin + 25;
    trip.meta.destination_best_for.slice(0, 5).forEach((tag) => {
      const tagWidth = tag.length * 2.5 + 8;

      if (tagX + tagWidth > margin + contentWidth) {
        tagX = margin + 25;
        y += 10;
      }

      doc.setFillColor(...colors.cardBg);
      doc.roundedRect(tagX, y - 5, tagWidth, 8, 2, 2, "F");

      doc.setTextColor(...colors.text);
      doc.setFontSize(7);
      doc.setFont(config.fonts.body, "normal");
      doc.text(tag, tagX + 4, y);

      tagX += tagWidth + 4;
    });
  }
}
