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
 * Highlight slide — shows a destination highlight (icon + title + description)
 * with cinematic background and glass card.
 */
export const HighlightSlide: React.FC<{
  icon: string;
  title: string;
  description: string;
  imageSlug: string;
  accentColor?: string;
}> = ({
  icon,
  title,
  description,
  imageSlug,
  accentColor = COLORS.accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgScale = interpolate(frame, [0, 120], [1.0, 1.12], { extrapolateRight: 'clamp' });

  // Icon bounce in
  const iconSpring = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 150 },
  });

  // Title slide
  const titleOpacity = interpolate(frame, [8, 20], [0, 1], { extrapolateRight: 'clamp' });
  const titleX = interpolate(frame, [8, 20], [-30, 0], { extrapolateRight: 'clamp' });

  // Description
  const descOpacity = interpolate(frame, [16, 28], [0, 1], { extrapolateRight: 'clamp' });
  const descY = interpolate(frame, [16, 28], [15, 0], { extrapolateRight: 'clamp' });

  // Accent line
  const lineWidth = interpolate(frame, [12, 30], [0, 80], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      {/* Background */}
      <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
        <Img
          src={staticFile(`images/destinations/${imageSlug}.jpg`)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0.2) 100%)',
        }}
      />

      {/* Content centered */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 60px',
        }}
      >
        {/* Icon */}
        <div
          style={{
            fontSize: 80,
            transform: `scale(${iconSpring})`,
            marginBottom: 32,
          }}
        >
          {icon}
        </div>

        {/* Accent line */}
        <div
          style={{
            width: lineWidth,
            height: 4,
            background: accentColor,
            borderRadius: 2,
            marginBottom: 24,
          }}
        />

        {/* Title */}
        <div
          style={{
            opacity: titleOpacity,
            transform: `translateX(${titleX}px)`,
            fontFamily: FONTS.heading,
            fontSize: 48,
            fontWeight: 700,
            color: COLORS.white,
            textAlign: 'center',
            marginBottom: 24,
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>

        {/* Description */}
        <div
          style={{
            opacity: descOpacity,
            transform: `translateY(${descY}px)`,
            fontFamily: FONTS.body,
            fontSize: 24,
            color: 'rgba(255,255,255,0.8)',
            textAlign: 'center',
            lineHeight: 1.6,
            maxWidth: 800,
          }}
        >
          {description}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
