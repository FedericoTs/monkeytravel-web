import type jsPDF from "jspdf";
import type { PageContext, PremiumTripForExport } from "../types";
import { getImageFormat, hasImage } from "../utils/images";

/**
 * Render the final page with gallery, closing message, and branding
 */
export function renderFinalPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { margin, contentWidth, pageWidth, pageHeight, colors } = config;

  doc.addPage();
  let y = margin;

  // === TOP ACCENT BAR ===
  doc.setFillColor(...colors.primary);
  doc.rect(0, 0, pageWidth, 6, "F");

  y += 15;

  // === GALLERY STRIP ===
  const photos = trip.galleryPhotos?.slice(0, 3) || [];
  const galleryHeight = 55;

  if (photos.length > 0) {
    const photoWidth = (contentWidth - 10) / 3;

    photos.forEach((photo, idx) => {
      const x = margin + idx * (photoWidth + 5);
      const photoUrl = photo.url || photo.thumbnailUrl;
      const photoImage = hasImage(imageCache, photoUrl) ? imageCache[photoUrl] : null;

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
          renderPlaceholder(doc, x, y, photoWidth, galleryHeight, colors.cardBg);
        }
      } else {
        renderPlaceholder(doc, x, y, photoWidth, galleryHeight, colors.cardBg);
      }
    });

    y += galleryHeight + 15;
  } else {
    // Decorative line instead of gallery
    doc.setDrawColor(...colors.accent);
    doc.setLineWidth(2);
    doc.line(margin + 40, y, pageWidth - margin - 40, y);
    y += 20;
  }

  // === CLOSING MESSAGE ===
  doc.setTextColor(...colors.text);
  doc.setFontSize(22);
  doc.setFont(config.fonts.display, "bold");
  doc.text("Have an Amazing Trip!", pageWidth / 2, y, { align: "center" });

  y += 12;

  // Decorative underline
  doc.setDrawColor(...colors.accent);
  doc.setLineWidth(1.5);
  doc.line(pageWidth / 2 - 25, y, pageWidth / 2 + 25, y);

  y += 15;

  // Trip summary text
  doc.setTextColor(...colors.muted);
  doc.setFontSize(10);
  doc.setFont(config.fonts.body, "normal");

  const totalActivities = trip.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );

  const summaryText = `Your ${trip.itinerary.length}-day adventure to ${trip.destination} is all set! ` +
    `With ${totalActivities} carefully curated experiences, this itinerary was crafted ` +
    `with AI precision to match your travel style.`;

  const summaryLines = doc.splitTextToSize(summaryText, contentWidth - 40);
  doc.text(summaryLines, pageWidth / 2, y, { align: "center" });

  y += summaryLines.length * 5 + 20;

  // === SHARE SECTION ===
  doc.setFillColor(...colors.cardBg);
  doc.roundedRect(margin + 25, y, contentWidth - 50, 35, 4, 4, "F");

  // Share prompt
  doc.setTextColor(...colors.muted);
  doc.setFontSize(9);
  doc.text("Share your journey on social media:", pageWidth / 2, y + 12, { align: "center" });

  // Hashtags
  doc.setTextColor(...colors.primary);
  doc.setFontSize(12);
  doc.setFont(config.fonts.body, "bold");

  // Create destination hashtag (remove spaces and special chars)
  const destinationTag = trip.destination
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, 20);
  const year = new Date(trip.startDate).getFullYear();
  const hashtags = `#MonkeyTravel #${destinationTag}${year}`;

  doc.text(hashtags, pageWidth / 2, y + 25, { align: "center" });

  y += 50;

  // === TRAVEL TIPS (if highlights available) ===
  if (trip.meta?.packing_suggestions && trip.meta.packing_suggestions.length > 0) {
    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(margin, y, contentWidth, 30, 3, 3, "F");

    // Tip icon
    doc.setFillColor(...colors.accent);
    doc.circle(margin + 10, y + 10, 5, "F");
    doc.setTextColor(...colors.text);
    doc.setFontSize(10);
    doc.setFont(config.fonts.body, "bold");
    doc.text("!", margin + 8, y + 13);

    // Reminder text
    doc.setTextColor(...colors.text);
    doc.setFontSize(9);
    doc.setFont(config.fonts.body, "normal");
    doc.text("Don't forget to pack:", margin + 20, y + 10);

    doc.setFontSize(8);
    doc.setTextColor(...colors.muted);
    const packingList = trip.meta.packing_suggestions.slice(0, 4).join(", ");
    const packingLines = doc.splitTextToSize(packingList, contentWidth - 30);
    doc.text(packingLines.slice(0, 2), margin + 20, y + 20);

    y += 40;
  }

  // === BRAND FOOTER ===
  const footerY = pageHeight - 50;

  // Brand box
  doc.setFillColor(...colors.primary);
  doc.roundedRect(margin + 35, footerY, contentWidth - 70, 38, 4, 4, "F");

  // Brand name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont(config.fonts.display, "bold");
  doc.text("MonkeyTravel", pageWidth / 2, footerY + 12, { align: "center" });

  // Tagline
  doc.setFontSize(9);
  doc.setFont(config.fonts.body, "normal");
  doc.text("AI-Powered Travel Planning", pageWidth / 2, footerY + 22, { align: "center" });

  // URL
  doc.setFontSize(10);
  doc.setFont(config.fonts.body, "bold");
  doc.text("monkeytravel.app", pageWidth / 2, footerY + 32, { align: "center" });

  // === GENERATION DATE ===
  doc.setTextColor(...colors.muted);
  doc.setFontSize(7);
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
}

/**
 * Render a placeholder rectangle
 */
function renderPlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number]
): void {
  doc.setFillColor(...color);
  doc.roundedRect(x, y, width, height, 2, 2, "F");

  // Subtle pattern
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  for (let i = 0; i < 3; i++) {
    doc.line(x + 5, y + height / 2 - 5 + i * 5, x + width - 5, y + height / 2 - 5 + i * 5);
  }
}
