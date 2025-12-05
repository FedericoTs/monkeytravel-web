import type jsPDF from "jspdf";
import type { PageContext, PremiumTripForExport } from "../types";
import { COLORS, TYPOGRAPHY, LAYOUT } from "../config";
import { getImageFormat, hasImage } from "../utils/images";

/**
 * Render the final page with gallery, closing message, and branding
 */
export function renderFinalPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { margin, contentWidth, pageWidth, pageHeight } = config;

  doc.addPage();
  let y = 0;

  // === TOP ACCENT BAR ===
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 8, "F");

  y = margin + 15;

  // === GALLERY STRIP ===
  // Collect all activity images for gallery
  const allImages: string[] = [];
  trip.itinerary.forEach((day) => {
    day.activities.forEach((activity) => {
      if (activity.image_url && hasImage(imageCache, activity.image_url)) {
        allImages.push(activity.image_url);
      }
    });
  });

  // Also add gallery photos if available
  if (trip.galleryPhotos) {
    trip.galleryPhotos.forEach((photo) => {
      const url = photo.url || photo.thumbnailUrl;
      if (url && hasImage(imageCache, url)) {
        allImages.push(url);
      }
    });
  }

  const photos = [...new Set(allImages)].slice(0, 4);
  const galleryHeight = 50;

  if (photos.length > 0) {
    // Section title
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(12);
    doc.setFont(config.fonts.display, "bold");
    doc.text("TRIP MEMORIES", margin, y);

    doc.setDrawColor(...COLORS.accent);
    doc.setLineWidth(2);
    doc.line(margin, y + 3, margin + 35, y + 3);

    y += 12;

    const photoWidth = (contentWidth - (photos.length - 1) * 6) / photos.length;

    photos.forEach((photoUrl, idx) => {
      const x = margin + idx * (photoWidth + 6);
      const photoImage = imageCache[photoUrl];

      if (photoImage) {
        try {
          const format = getImageFormat(photoImage);
          doc.addImage(
            photoImage,
            format,
            x,
            y,
            photoWidth,
            galleryHeight,
            undefined,
            "MEDIUM"
          );
        } catch {
          renderGalleryPlaceholder(doc, x, y, photoWidth, galleryHeight, idx);
        }
      } else {
        renderGalleryPlaceholder(doc, x, y, photoWidth, galleryHeight, idx);
      }
    });

    y += galleryHeight + 20;
  } else {
    // Decorative element instead of gallery
    doc.setDrawColor(...COLORS.accent);
    doc.setLineWidth(3);
    doc.line(margin + 50, y, pageWidth - margin - 50, y);
    y += 25;
  }

  // === CLOSING MESSAGE ===
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(26);
  doc.setFont(config.fonts.display, "bold");
  doc.text("Have an Amazing Trip!", pageWidth / 2, y, { align: "center" });

  y += 8;

  // Decorative underline
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(2);
  doc.line(pageWidth / 2 - 30, y, pageWidth / 2 + 30, y);

  y += 18;

  // Trip summary text
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(11);
  doc.setFont(config.fonts.body, "normal");

  const totalActivities = trip.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );

  const summaryText = `Your ${trip.itinerary.length}-day adventure to ${trip.destination} is all set! ` +
    `With ${totalActivities} carefully curated experiences, this itinerary was crafted ` +
    `with AI precision to match your travel style.`;

  const summaryLines = doc.splitTextToSize(summaryText, contentWidth - 30);
  doc.text(summaryLines, pageWidth / 2, y, { align: "center" });

  y += summaryLines.length * 6 + 25;

  // === SHARE SECTION ===
  doc.setFillColor(...COLORS.cardBg);
  doc.roundedRect(margin + 20, y, contentWidth - 40, 40, 6, 6, "F");

  // Share prompt
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(10);
  doc.setFont(config.fonts.body, "normal");
  doc.text("Share your journey on social media:", pageWidth / 2, y + 14, { align: "center" });

  // Hashtags
  doc.setTextColor(...COLORS.primary);
  doc.setFontSize(14);
  doc.setFont(config.fonts.body, "bold");

  // Create destination hashtag (remove spaces and special chars)
  const destinationTag = trip.destination
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, 20);
  const year = new Date(trip.startDate).getFullYear();
  const hashtags = `#MonkeyTravel #${destinationTag}${year}`;

  doc.text(hashtags, pageWidth / 2, y + 30, { align: "center" });

  y += 55;

  // === QUICK REFERENCE BOX ===
  if (y < pageHeight - 120) {
    doc.setFillColor(...COLORS.cardBg);
    doc.roundedRect(margin, y, contentWidth, 50, 4, 4, "F");

    // Left accent
    doc.setFillColor(...COLORS.secondary);
    doc.rect(margin, y, 5, 50, "F");

    // Title
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(11);
    doc.setFont(config.fonts.display, "bold");
    doc.text("Quick Reference", margin + 12, y + 12);

    // Stats
    doc.setTextColor(...COLORS.muted);
    doc.setFontSize(9);
    doc.setFont(config.fonts.body, "normal");

    const stats = [
      `Destination: ${trip.destination}`,
      `Duration: ${trip.itinerary.length} days`,
      `Total Activities: ${totalActivities}`,
      trip.budget ? `Budget: ${trip.budget.currency} ${trip.budget.total}` : null,
    ].filter(Boolean);

    stats.forEach((stat, idx) => {
      if (stat) {
        doc.text(stat, margin + 12 + (idx % 2) * 85, y + 25 + Math.floor(idx / 2) * 12);
      }
    });

    y += 60;
  }

  // === BRAND FOOTER ===
  const footerY = pageHeight - 55;

  // Brand box
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(margin + 30, footerY, contentWidth - 60, 42, 6, 6, "F");

  // Brand name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont(config.fonts.display, "bold");
  doc.text("MonkeyTravel", pageWidth / 2, footerY + 14, { align: "center" });

  // Tagline
  doc.setFontSize(10);
  doc.setFont(config.fonts.body, "normal");
  doc.text("AI-Powered Travel Planning", pageWidth / 2, footerY + 26, { align: "center" });

  // URL
  doc.setFontSize(11);
  doc.setFont(config.fonts.body, "bold");
  doc.text("monkeytravel.app", pageWidth / 2, footerY + 38, { align: "center" });

  // === GENERATION DATE ===
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "normal");
  const genDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  doc.text(
    `Generated on ${genDate}`,
    pageWidth / 2,
    pageHeight - 8,
    { align: "center" }
  );

  // Page number
  const totalPages = trip.itinerary.length + 2;
  doc.text(`${totalPages} / ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
}

/**
 * Render a gallery placeholder
 */
function renderGalleryPlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  index: number
): void {
  // Gradient colors based on index
  const gradients: [number, number, number][] = [
    [102, 126, 234],  // Purple-blue
    [240, 147, 251],  // Pink
    [79, 172, 254],   // Light blue
    [67, 233, 123],   // Green
  ];

  const color = gradients[index % gradients.length];

  // Draw gradient
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.min(255, color[0] + 40 * ratio);
    const g = Math.min(255, color[1] + 40 * ratio);
    const b = Math.min(255, color[2] + 40 * ratio);

    doc.setFillColor(r, g, b);
    doc.rect(x, y + (height / steps) * i, width, height / steps + 1, "F");
  }

  // Add subtle pattern
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.2);
  for (let i = 0; i < 3; i++) {
    doc.line(x + 8, y + height / 2 - 6 + i * 6, x + width - 8, y + height / 2 - 6 + i * 6);
  }
}
