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
 * Cinematic destination title card with background image.
 * Image zooms slowly (Ken Burns), title and subtitle animate in.
 */
export const DestinationTitle: React.FC<{
  cityName: string;
  country: string;
  tagline: string;
  imageSlug: string;
}> = ({ cityName, country, tagline, imageSlug }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Ken Burns zoom on background
  const bgScale = interpolate(frame, [0, 150], [1.0, 1.15], { extrapolateRight: 'clamp' });

  // Title entrance
  const titleSpring = spring({ frame: Math.max(0, frame - 10), fps, config: { damping: 14, stiffness: 80 } });
  const titleOpacity = interpolate(frame, [10, 25], [0, 1], { extrapolateRight: 'clamp' });

  // Country tag
  const countryOpacity = interpolate(frame, [25, 40], [0, 1], { extrapolateRight: 'clamp' });
  const countryX = interpolate(frame, [25, 40], [-30, 0], { extrapolateRight: 'clamp' });

  // Tagline
  const taglineOpacity = interpolate(frame, [40, 55], [0, 1], { extrapolateRight: 'clamp' });
  const taglineY = interpolate(frame, [40, 55], [15, 0], { extrapolateRight: 'clamp' });

  // Decorative line
  const lineWidth = interpolate(frame, [20, 45], [0, 120], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      {/* Background image with Ken Burns */}
      <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
        <Img
          src={staticFile(`images/destinations/${imageSlug}.jpg`)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      {/* Gradient overlay — full coverage for text readability */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0.1) 100%)',
        }}
      />

      {/* Content */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          padding: '0 60px 320px',
        }}
      >
        {/* Country tag */}
        <div
          style={{
            opacity: countryOpacity,
            transform: `translateX(${countryX}px)`,
            fontFamily: FONTS.body,
            fontSize: 24,
            fontWeight: 600,
            color: COLORS.accent,
            textTransform: 'uppercase',
            letterSpacing: '4px',
            marginBottom: 16,
          }}
        >
          {country}
        </div>

        {/* City name */}
        <div
          style={{
            opacity: titleOpacity,
            transform: `translateY(${(1 - titleSpring) * 30}px)`,
            fontFamily: FONTS.heading,
            fontSize: 96,
            fontWeight: 700,
            color: COLORS.white,
            lineHeight: 1.1,
            marginBottom: 20,
          }}
        >
          {cityName}
        </div>

        {/* Decorative line */}
        <div
          style={{
            width: lineWidth,
            height: 4,
            background: COLORS.primary,
            borderRadius: 2,
            marginBottom: 20,
          }}
        />

        {/* Tagline */}
        <div
          style={{
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            fontFamily: FONTS.body,
            fontSize: 28,
            color: COLORS.slateLight,
            maxWidth: 800,
            lineHeight: 1.5,
          }}
        >
          {tagline}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
