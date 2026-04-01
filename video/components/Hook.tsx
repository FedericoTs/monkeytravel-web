import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  Img,
  staticFile,
  spring,
  useVideoConfig,
} from 'remotion';
import { COLORS, FONTS } from '../theme';

/**
 * HOOK — First 2 seconds. Must stop the scroll.
 *
 * Design: Bright coral/cream background, destination photo as a tilted
 * card element, massive bold text that fills the screen.
 *
 * Purpose: "Wait, what?" → User stops scrolling.
 */
export const Hook: React.FC<{
  cityName: string;
  days: number;
  imageSlug: string;
}> = ({ cityName, days, imageSlug }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Photo card flies in from right with rotation
  const cardSpring = spring({ frame, fps, config: { damping: 12, stiffness: 80 } });
  const cardRotate = interpolate(frame, [0, 20], [8, -3], { extrapolateRight: 'clamp' });
  const cardX = interpolate(frame, [0, 15], [400, 0], { extrapolateRight: 'clamp' });

  // Main text punches in
  const textScale = spring({ frame: Math.max(0, frame - 5), fps, config: { damping: 10, stiffness: 200 } });

  // "AI planned this" badge slides up
  const badgeY = interpolate(frame, [15, 30], [40, 0], { extrapolateRight: 'clamp' });
  const badgeOpacity = interpolate(frame, [15, 25], [0, 1], { extrapolateRight: 'clamp' });

  // Decorative dots pulse
  const dotScale = interpolate(frame, [0, 30, 60], [0.8, 1.1, 0.9], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.background,
        overflow: 'hidden',
      }}
    >
      {/* Decorative coral blob top-right */}
      <div
        style={{
          position: 'absolute',
          top: -120,
          right: -80,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.primaryLight} 0%, transparent 70%)`,
          transform: `scale(${dotScale})`,
          opacity: 0.6,
        }}
      />

      {/* Decorative teal blob bottom-left */}
      <div
        style={{
          position: 'absolute',
          bottom: -100,
          left: -60,
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.secondaryLight} 0%, transparent 70%)`,
          transform: `scale(${dotScale})`,
          opacity: 0.5,
        }}
      />

      {/* Photo card — tilted, shadowed */}
      <div
        style={{
          position: 'absolute',
          top: 180,
          right: 40,
          width: 420,
          height: 560,
          borderRadius: 24,
          overflow: 'hidden',
          transform: `translateX(${cardX}px) rotate(${cardRotate}deg) scale(${cardSpring})`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.15), 0 8px 24px ${COLORS.primary}20`,
          border: `3px solid ${COLORS.white}`,
        }}
      >
        <Img
          src={staticFile(`images/destinations/${imageSlug}.jpg`)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      {/* Main text — BIG, left-aligned, fills width */}
      <div
        style={{
          position: 'absolute',
          left: 48,
          top: 800,
          transform: `scale(${textScale})`,
          transformOrigin: 'left center',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.heading,
            fontSize: 72,
            fontWeight: 700,
            color: COLORS.navy,
            lineHeight: 1.1,
            marginBottom: 8,
          }}
        >
          {days} days in
        </div>
        <div
          style={{
            fontFamily: FONTS.heading,
            fontSize: 110,
            fontWeight: 700,
            color: COLORS.primary,
            lineHeight: 1.0,
          }}
        >
          {cityName}
        </div>
      </div>

      {/* "AI planned" badge */}
      <div
        style={{
          position: 'absolute',
          left: 48,
          top: 1080,
          opacity: badgeOpacity,
          transform: `translateY(${badgeY}px)`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            background: COLORS.secondary,
            borderRadius: 50,
            padding: '10px 24px',
            fontFamily: FONTS.body,
            fontSize: 22,
            fontWeight: 600,
            color: COLORS.white,
            letterSpacing: '0.5px',
          }}
        >
          AI-planned itinerary
        </div>
      </div>

      {/* MonkeyTravel small logo bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: 120,
          left: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          opacity: badgeOpacity,
        }}
      >
        <Img
          src={staticFile('images/logo.png')}
          style={{ width: 40, height: 40, objectFit: 'contain' }}
        />
        <span
          style={{
            fontFamily: FONTS.body,
            fontSize: 20,
            fontWeight: 600,
            color: COLORS.slate,
          }}
        >
          monkeytravel.app
        </span>
      </div>
    </AbsoluteFill>
  );
};
