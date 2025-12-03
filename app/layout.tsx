import type { Metadata, Viewport } from "next";
import { Playfair_Display, Source_Sans_3, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ToastProvider } from "@/components/ui/Toast";
import {
  generateOrganizationSchema,
  generateWebSiteSchema,
  generateSoftwareApplicationSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
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
  // Core metadata
  title: {
    default: "MonkeyTravel - AI-Powered Trip Planning Made Easy",
    template: "%s | MonkeyTravel",
  },
  description: "Plan your perfect trip with AI-generated day-by-day itineraries. Get Budget, Balanced, and Premium options tailored to your travel style. Create personalized travel plans in minutes!",
  keywords: ["travel app", "trip planner", "AI travel", "itinerary generator", "vacation planning", "MonkeyTravel", "travel AI", "trip planning app", "smart travel planner", "personalized itinerary"],
  authors: [{ name: "MonkeyTravel" }],
  creator: "MonkeyTravel",
  publisher: "MonkeyTravel",

  // Canonical URL
  metadataBase: new URL("https://monkeytravel.app"),
  alternates: {
    canonical: "/",
  },

  // Open Graph for social sharing (Facebook, LinkedIn, Teams, etc.)
  openGraph: {
    title: "MonkeyTravel - AI-Powered Trip Planning",
    description: "Plan trips in minutes with AI-generated day-by-day itineraries. Budget, Balanced, and Premium options tailored to your travel style.",
    url: "https://monkeytravel.app",
    siteName: "MonkeyTravel",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "MonkeyTravel - AI-Powered Trip Planning",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  // Twitter/X Card
  twitter: {
    card: "summary_large_image",
    title: "MonkeyTravel - AI-Powered Trip Planning",
    description: "Plan trips in minutes with AI-generated day-by-day itineraries",
    images: ["/og-image.png"],
    creator: "@monkeytravel",
  },

  // Icons configuration
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    other: [
      { rel: "icon", url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },

  // App manifest
  manifest: "/manifest.json",

  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  // Verification - Add your Search Console verification code here
  // To get this: Go to Google Search Console > Settings > Ownership verification > HTML tag
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "",
    // yandex: "your-yandex-verification-code",
  },

  // App links for mobile
  appleWebApp: {
    capable: true,
    title: "MonkeyTravel",
    statusBarStyle: "default",
  },

  // Format detection
  formatDetection: {
    telephone: false,
  },

  // Category
  category: "travel",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

// Generate global structured data schemas
const organizationSchema = generateOrganizationSchema();
const webSiteSchema = generateWebSiteSchema();
const softwareApplicationSchema = generateSoftwareApplicationSchema();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Global Structured Data (JSON-LD) for SEO */}
        <script {...jsonLdScriptProps(organizationSchema)} />
        <script {...jsonLdScriptProps(webSiteSchema)} />
        <script {...jsonLdScriptProps(softwareApplicationSchema)} />
      </head>
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
