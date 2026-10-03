import { Fraunces, Source_Sans_3, Geist_Mono } from "next/font/google";

// Display font for headings — warm editorial serif (variable font).
// Fraunces ships as a single woff2 covering 400/500/600/700 via the variable
// axis, so we get more weights than Playfair did at lower wire cost.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Body font - clean sans-serif
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Keep mono for code blocks. Not preloaded: it only appears below the fold
// or in dialogs, so it should not compete with the hero for bandwidth.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

/** The <body> class every root layout applies: the three font variables plus antialiasing. */
export const bodyFontClassName = `${fraunces.variable} ${sourceSans.variable} ${geistMono.variable} antialiased`;
