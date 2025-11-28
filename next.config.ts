import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image optimization for Vercel
  images: {
    formats: ['image/avif', 'image/webp'],
  },

  // Turbopack root directory (fixes workspace warning)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
