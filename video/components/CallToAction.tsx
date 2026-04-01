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
import { COLORS, FONTS, GRADIENTS } from '../theme';

/**
 * End screen CTA — "Plan your [destination] trip" with brand elements.
 */
export const CallToAction: React.FC<{
  cityName: string;
  ctaText: string;
  url?: string;
}> = ({ cityName, ctaText, url = 'monkeytravel.app' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgPulse = interpolate(frame, [0, 60, 90], [1, 1.02, 1], {
    extrapolateRight: 'clamp',
  });

  // Logo
  const logoSpring = spring({ frame, fps, config: { damping: 12, stiffness: 100 } });

  // CTA button
  const btnSpring = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 10, stiffness: 120 },
  });

  // URL
  const urlOpacity = interpolate(frame, [35, 50], [0, 1], { extrapolateRight: 'clamp' });

  // Glow pulse
  const glowOpacity = interpolate(
    frame,
    [30, 50, 70, 90],
    [0, 0.5, 0.3, 0.5],
    { extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill
      style={{
        background: GRADIENTS.dark,
        justifyContent: 'center',
        alignItems: 'center',
        transform: `scale(${bgPulse})`,
      }}
    >
      {/* Accent glow */}
      <div
        style={{
          position: 'absolute',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.primary}30 0%, transparent 70%)`,
          opacity: glowOpacity,
          filter: 'blur(60px)',
        }}
      />

      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoSpring})`,
          marginBottom: 48,
        }}
      >
        <Img
          src={staticFile('images/logo.png')}
          style={{ width: 120, height: 120, objectFit: 'contain' }}
        />
      </div>

      {/* Heading */}
      <div
        style={{
          opacity: interpolate(frame, [10, 25], [0, 1], { extrapolateRight: 'clamp' }),
          fontFamily: FONTS.heading,
          fontSize: 52,
          fontWeight: 700,
          color: COLORS.white,
          textAlign: 'center',
          marginBottom: 40,
          lineHeight: 1.3,
          padding: '0 60px',
        }}
      >
        Plan your{'\n'}
        <span style={{ color: COLORS.primary }}>{cityName}</span> trip
      </div>

      {/* CTA button */}
      <div
        style={{
          transform: `scale(${btnSpring})`,
          background: COLORS.primary,
          borderRadius: 60,
          padding: '20px 56px',
          fontFamily: FONTS.body,
          fontSize: 28,
          fontWeight: 600,
          color: COLORS.white,
          boxShadow: `0 8px 32px ${COLORS.primary}60`,
          marginBottom: 32,
        }}
      >
        {ctaText}
      </div>

      {/* URL */}
      <div
        style={{
          opacity: urlOpacity,
          fontFamily: FONTS.body,
          fontSize: 24,
          color: COLORS.slateLight,
          letterSpacing: '1px',
        }}
      >
        {url}
      </div>
    </AbsoluteFill>
  );
};
