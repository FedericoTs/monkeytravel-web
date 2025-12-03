import type { Metadata, Viewport } from "next";
import { Playfair_Display, Source_Sans_3, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

// Display font for headings - elegant serif
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Body font - clean sans-serif
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Keep mono for code blocks
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MonkeyTravel - AI-Powered Trip Planning Made Easy",
  description: "Plan your perfect trip with AI-generated day-by-day itineraries. Get Budget, Balanced, and Premium options tailored to your travel style. Join the waitlist!",
  keywords: ["travel app", "trip planner", "AI travel", "itinerary generator", "vacation planning", "MonkeyTravel"],
  openGraph: {
    title: "MonkeyTravel - AI-Powered Trip Planning",
    description: "Plan trips in minutes with AI-generated day-by-day itineraries",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${playfair.variable} ${sourceSans.variable} ${geistMono.variable} antialiased`}
      >
        <ToastProvider>
          {children}
        </ToastProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
