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
 * Brand intro animation — Logo scales in with glow, tagline fades up.
 * Duration: ~60 frames (2s at 30fps)
 */
export const BrandIntro: React.FC<{
  tagline?: string;
}> = ({ tagline = 'AI-Powered Travel Planning' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { mass: 1, damping: 12, stiffness: 100 } });
  const logoOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  const glowOpacity = interpolate(frame, [15, 30, 50], [0, 0.6, 0.2], {
    extrapolateRight: 'clamp',
  });

  const taglineOpacity = interpolate(frame, [25, 40], [0, 1], { extrapolateRight: 'clamp' });
  const taglineY = interpolate(frame, [25, 40], [20, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: GRADIENTS.dark,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.primary}40 0%, transparent 70%)`,
          opacity: glowOpacity,
          filter: 'blur(40px)',
        }}
      />

      {/* Logo */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <Img
          src={staticFile('images/logo.png')}
          style={{ width: 200, height: 200, objectFit: 'contain' }}
        />

        <div
          style={{
            fontFamily: FONTS.heading,
            fontSize: 64,
            fontWeight: 700,
            color: COLORS.white,
            letterSpacing: '-1px',
          }}
        >
          Monkey<span style={{ color: COLORS.primary }}>Travel</span>
        </div>
      </div>

      {/* Tagline */}
      <div
        style={{
          position: 'absolute',
          bottom: 400,
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
          fontFamily: FONTS.body,
          fontSize: 32,
          color: COLORS.slateLight,
          letterSpacing: '2px',
          textTransform: 'uppercase',
        }}
      >
        {tagline}
      </div>
    </AbsoluteFill>
  );
};
