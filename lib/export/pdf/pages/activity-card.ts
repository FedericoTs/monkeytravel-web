import type jsPDF from "jspdf";
import type { PageContext } from "../types";
import type { Activity } from "@/types";
import { getActivityTypeConfig, LAYOUT } from "../config";
import { getImageFormat, hasImage } from "../utils/images";

/**
 * Render a single activity card with optional image
 */
export function renderActivityCard(
  ctx: PageContext,
  activity: Activity,
  x: number,
  y: number,
  width: number,
  currency: string
): number {
  const { doc, config, imageCache } = ctx;
  const { colors } = config;

  const hasActivityImage = hasImage(imageCache, activity.image_url);
  const cardHeight = hasActivityImage ? LAYOUT.activityCardHeight : LAYOUT.activityCardHeight - 10;
  const imageHeight = LAYOUT.activityImageHeight;
  const padding = 4;

  // === CARD BACKGROUND ===
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...colors.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, width, cardHeight, 2, 2, "FD");

  // === ACTIVITY IMAGE ===
  let contentStartY = y + 2;

  if (hasActivityImage && activity.image_url) {
    const imageData = imageCache[activity.image_url];
    const format = getImageFormat(imageData);

    try {
      doc.addImage(
        imageData,
        format,
        x + 1,
        y + 1,
        width - 2,
        imageHeight,
        undefined,
        "MEDIUM"
      );
    } catch {
      // Fallback: colored placeholder
      renderImagePlaceholder(doc, x + 1, y + 1, width - 2, imageHeight, activity.type, colors);
    }

    contentStartY = y + imageHeight + 2;
  } else {
    // Small colored strip at top instead of image
    const typeConfig = getActivityTypeConfig(activity.type);
    doc.setFillColor(...typeConfig.color);
    doc.rect(x + 1, y + 1, width - 2, 4, "F");
    contentStartY = y + 6;
  }

  // === TIME BADGE (overlaid on image if present) ===
  const badgeY = hasActivityImage ? y + imageHeight - 8 : y + 2;
  doc.setFillColor(...colors.accent);
  doc.roundedRect(x + padding, badgeY, 18, 7, 1, 1, "F");
  doc.setTextColor(...colors.text);
  doc.setFontSize(6);
  doc.setFont(config.fonts.body, "bold");
  doc.text(activity.start_time, x + padding + 2, badgeY + 5);

  // === TYPE BADGE ===
  const typeConfig = getActivityTypeConfig(activity.type);
  doc.setFillColor(...typeConfig.color);
  doc.roundedRect(x + padding + 20, badgeY, 14, 7, 1, 1, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(5);
  doc.setFont(config.fonts.body, "bold");
  doc.text(typeConfig.label, x + padding + 22, badgeY + 5);

  // === ACTIVITY NAME ===
  doc.setTextColor(...colors.text);
  doc.setFontSize(9);
  doc.setFont(config.fonts.display, "bold");
  const nameMaxWidth = width - padding * 2 - 20;
  const nameText = truncateText(activity.name, nameMaxWidth, doc, 9);
  doc.text(nameText, x + padding, contentStartY + 5);

  // === DURATION ===
  doc.setTextColor(...colors.muted);
  doc.setFontSize(6);
  doc.setFont(config.fonts.body, "normal");
  doc.text(
    `${activity.duration_minutes}m`,
    x + width - padding - 8,
    contentStartY + 5
  );

  // === DESCRIPTION ===
  doc.setFontSize(7);
  const descMaxWidth = width - padding * 2;
  const descText = activity.description.length > 80
    ? activity.description.substring(0, 80) + "..."
    : activity.description;
  const descLines = doc.splitTextToSize(descText, descMaxWidth);
  doc.text(descLines.slice(0, 2), x + padding, contentStartY + 12);

  // === FOOTER (Location + Cost) ===
  const footerY = y + cardHeight - 6;

  // Location dot
  doc.setFillColor(...colors.primary);
  doc.circle(x + padding + 1.5, footerY - 1, 1.5, "F");

  // Location text
  doc.setTextColor(...colors.muted);
  doc.setFontSize(6);
  const location = activity.address || activity.location;
  const locationText = truncateText(location, width * 0.55, doc, 6);
  doc.text(locationText, x + padding + 5, footerY);

  // Cost
  const costText = activity.estimated_cost.amount === 0
    ? "Free"
    : `${currency} ${activity.estimated_cost.amount}`;
  doc.setTextColor(...colors.text);
  doc.setFont(config.fonts.body, "bold");
  doc.text(costText, x + width - padding, footerY, { align: "right" });

  return cardHeight;
}

/**
 * Render a colored placeholder for missing images
 */
function renderImagePlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  activityType: string,
  colors: { muted: [number, number, number] }
): void {
  const typeConfig = getActivityTypeConfig(activityType);

  // Gradient-like effect
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(typeConfig.color[0] * (0.7 + ratio * 0.3));
    const g = Math.round(typeConfig.color[1] * (0.7 + ratio * 0.3));
    const b = Math.round(typeConfig.color[2] * (0.7 + ratio * 0.3));

    doc.setFillColor(r, g, b);
    doc.rect(x, y + (height / steps) * i, width, height / steps + 1, "F");
  }

  // Type label centered
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(
    typeConfig.label.toUpperCase(),
    x + width / 2,
    y + height / 2 + 3,
    { align: "center" }
  );
}

/**
 * Truncate text to fit within a width
 */
function truncateText(
  text: string,
  maxWidth: number,
  doc: jsPDF,
  fontSize: number
): string {
  doc.setFontSize(fontSize);
  let truncated = text;

  while (doc.getTextWidth(truncated) > maxWidth && truncated.length > 3) {
    truncated = truncated.substring(0, truncated.length - 4) + "...";
  }

  return truncated;
}

/**
 * Render a compact activity card (for tight spaces)
 */
export function renderCompactActivityCard(
  ctx: PageContext,
  activity: Activity,
  x: number,
  y: number,
  width: number,
  currency: string
): number {
  const { doc, config } = ctx;
  const { colors } = config;
  const cardHeight = 24;
  const padding = 3;

  // Card background
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...colors.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, width, cardHeight, 2, 2, "FD");

  // Type color bar
  const typeConfig = getActivityTypeConfig(activity.type);
  doc.setFillColor(...typeConfig.color);
  doc.rect(x, y, 3, cardHeight, "F");

  // Time
  doc.setTextColor(...colors.text);
  doc.setFontSize(7);
  doc.setFont(config.fonts.body, "bold");
  doc.text(activity.start_time, x + 6, y + 7);

  // Name
  doc.setFontSize(8);
  const nameText = activity.name.length > 25
    ? activity.name.substring(0, 25) + "..."
    : activity.name;
  doc.text(nameText, x + 22, y + 7);

  // Duration & Cost
  doc.setTextColor(...colors.muted);
  doc.setFontSize(6);
  doc.setFont(config.fonts.body, "normal");
  doc.text(`${activity.duration_minutes}m`, x + 6, y + 14);

  const costText = activity.estimated_cost.amount === 0
    ? "Free"
    : `${currency} ${activity.estimated_cost.amount}`;
  doc.text(costText, x + width - padding, y + 14, { align: "right" });

  // Location
  const location = (activity.address || activity.location).substring(0, 35);
  doc.text(location, x + 22, y + 14);

  return cardHeight;
}
