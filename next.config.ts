import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

// Security headers for production
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self)'
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.posthog.com https://*.google-analytics.com https://*.googletagmanager.com https://*.sentry.io https://*.vercel-scripts.com https://*.vercel-insights.com https://www.googleadservices.com https://cdn.travelpayouts.com https://emrldco.com https://maps.googleapis.com https://maps.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.posthog.com https://*.sentry.io https://*.google-analytics.com https://*.googleapis.com https://*.vercel-insights.com https://*.open-meteo.com",
      "frame-src 'self' https://accounts.google.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

  // Image optimization for Vercel
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'places.googleapis.com',
        pathname: '/v1/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'maps.googleapis.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/photos/**',
      },
      {
        protocol: 'https',
        hostname: 'flagcdn.com',
        pathname: '/**',
      },
    ],
  },

  // Turbopack root directory (fixes workspace warning)
  turbopack: {
    root: __dirname,
  },
};

// Sentry configuration options
const sentryConfig = {
  // Organization and project for source maps
  org: "monkeytravelapp-u6",
  project: "javascript-nextjs",

  // Auth token for source maps upload (from environment)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Silence all Sentry build output
  silent: true,

  // Upload source maps for better error stack traces
  widenClientFileUpload: true,

  // Disable Sentry telemetry
  telemetry: false,

  // Automatically tree-shake Sentry logger statements
  disableLogger: true,

  // Hide source maps from clients (security)
  hideSourceMaps: true,

  // Tunneling (disabled - use default Sentry endpoints)
  tunnelRoute: undefined,

  // Disable source map upload in CI to prevent timeouts
  sourcemaps: {
    disable: !!process.env.VERCEL,
  },
};

// Create next-intl plugin
const withNextIntl = createNextIntlPlugin("./i18n.ts");

// Export with next-intl and Sentry wrappers
export default withSentryConfig(withNextIntl(nextConfig), sentryConfig);
