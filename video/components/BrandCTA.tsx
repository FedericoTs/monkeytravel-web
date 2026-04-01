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
 * BRAND CTA — Final screen. Bright, branded, clear action.
 *
 * Design: Brand background (warm cream), logo centered,
 * bold CTA text, coral button, URL below.
 *
 * Purpose: "I want this" → user visits the app.
 */
export const BrandCTA: React.FC<{
  cityName: string;
}> = ({ cityName }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo pops in
  const logoSpring = spring({ frame, fps, config: { damping: 10, stiffness: 140 } });

  // Text fades up
  const textOpacity = interpolate(frame, [8, 20], [0, 1], { extrapolateRight: 'clamp' });
  const textY = interpolate(frame, [8, 20], [20, 0], { extrapolateRight: 'clamp' });

  // Button slides up with bounce
  const btnSpring = spring({
    frame: Math.max(0, frame - 15),
    fps,
    config: { damping: 8, stiffness: 120 },
  });

  // URL
  const urlOpacity = interpolate(frame, [25, 35], [0, 1], { extrapolateRight: 'clamp' });

  // Subtle pulsing glow on button
  const btnGlow = interpolate(
    frame,
    [30, 50, 70, 90],
    [0.4, 0.8, 0.4, 0.8],
    { extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ background: COLORS.background, overflow: 'hidden' }}>
      {/* Decorative blobs */}
      <div
        style={{
          position: 'absolute',
          top: -200,
          right: -100,
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.primaryLight}50 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -150,
          left: -100,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.secondaryLight}40 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 400,
          left: -80,
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.accentLight}30 0%, transparent 70%)`,
        }}
      />

      {/* Content */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {/* Logo */}
        <div style={{ transform: `scale(${logoSpring})`, marginBottom: 40 }}>
          <Img
            src={staticFile('images/logo.png')}
            style={{ width: 160, height: 160, objectFit: 'contain' }}
          />
        </div>

        {/* Heading */}
        <div
          style={{
            opacity: textOpacity,
            transform: `translateY(${textY}px)`,
            textAlign: 'center',
            padding: '0 48px',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.heading,
              fontSize: 48,
              fontWeight: 700,
              color: COLORS.navy,
              lineHeight: 1.3,
            }}
          >
            Plan your perfect
          </div>
          <div
            style={{
              fontFamily: FONTS.heading,
              fontSize: 64,
              fontWeight: 700,
              color: COLORS.primary,
              lineHeight: 1.2,
            }}
          >
            {cityName} trip
          </div>
        </div>

        {/* Subtext */}
        <div
          style={{
            opacity: textOpacity,
            fontFamily: FONTS.body,
            fontSize: 24,
            color: COLORS.slate,
            marginBottom: 48,
          }}
        >
          Free AI itinerary in 30 seconds
        </div>

        {/* CTA Button */}
        <div
          style={{
            transform: `scale(${btnSpring})`,
            background: COLORS.primary,
            borderRadius: 60,
            padding: '22px 64px',
            boxShadow: `0 12px 40px ${COLORS.primary}${Math.round(btnGlow * 99).toString().padStart(2, '0')}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.body,
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.white,
              letterSpacing: '0.5px',
            }}
          >
            Try MonkeyTravel
          </div>
        </div>

        {/* URL */}
        <div
          style={{
            opacity: urlOpacity,
            marginTop: 28,
            fontFamily: FONTS.body,
            fontSize: 22,
            color: COLORS.slate,
            letterSpacing: '1px',
          }}
        >
          monkeytravel.app
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
