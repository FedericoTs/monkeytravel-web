/**
 * MonkeyTravel Video Brand Theme
 * Mirrors globals.css brand system for Remotion compositions
 */

export const COLORS = {
  primary: '#FF6B6B',
  primaryLight: '#FFB4B4',
  primaryDark: '#E85555',
  primaryDeeper: '#D94444',

  secondary: '#00B4A6',
  secondaryLight: '#B2F5EA',
  secondaryDark: '#008B80',

  accent: '#FFD93D',
  accentLight: '#FFF3B8',
  accentDark: '#E5C235',

  navy: '#2D3436',
  navyLight: '#3D4447',
  slate: '#636E72',
  slateLight: '#B2BEC3',

  background: '#FFFAF5',
  backgroundWarm: '#FFF5EB',
  white: '#FFFFFF',
  black: '#000000',

  success: '#00B894',
  error: '#FF7675',

  vibes: {
    adventure: '#00CEC9',
    cultural: '#A29BFE',
    foodie: '#FDCB6E',
    romantic: '#FD79A8',
    nature: '#00B894',
    urban: '#74B9FF',
  },
} as const;

export const FONTS = {
  heading: 'Playfair Display, Georgia, serif',
  body: 'Source Sans 3, system-ui, sans-serif',
  mono: 'Geist Mono, monospace',
} as const;

export const GRADIENTS = {
  hero: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.secondary} 50%, ${COLORS.accent} 100%)`,
  warm: `linear-gradient(135deg, ${COLORS.primaryLight} 0%, ${COLORS.accentLight} 100%)`,
  dark: `linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navyLight} 100%)`,
  coral: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%)`,
  teal: `linear-gradient(135deg, ${COLORS.secondary} 0%, ${COLORS.secondaryDark} 100%)`,
  overlay: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)',
  overlayStrong: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)',
} as const;

/** Standard video formats for social platforms */
export const FORMATS = {
  reel: { width: 1080, height: 1920, fps: 30 },       // Instagram Reels, TikTok, Shorts
  square: { width: 1080, height: 1080, fps: 30 },      // Instagram Post, LinkedIn, Twitter
  landscape: { width: 1920, height: 1080, fps: 30 },   // YouTube, Website
  story: { width: 1080, height: 1920, fps: 30 },       // Instagram/Facebook Stories
} as const;

/** Timing presets in frames (at 30fps) */
export const TIMING = {
  /** Entrance animations */
  fadeIn: 15,        // 0.5s
  slideIn: 20,       // 0.67s
  scaleIn: 12,       // 0.4s

  /** Hold durations */
  holdShort: 45,     // 1.5s
  holdMedium: 75,    // 2.5s
  holdLong: 120,     // 4s

  /** Transitions */
  crossfade: 15,     // 0.5s
  wipe: 20,          // 0.67s

  /** Standard scene durations */
  introScene: 60,    // 2s
  contentScene: 120, // 4s
  ctaScene: 90,      // 3s
} as const;

/** Easing functions for spring animations */
export const SPRINGS = {
  gentle: { mass: 1, damping: 15, stiffness: 100 },
  bouncy: { mass: 1, damping: 10, stiffness: 150 },
  snappy: { mass: 0.5, damping: 15, stiffness: 200 },
  cinematic: { mass: 1, damping: 20, stiffness: 80 },
} as const;
