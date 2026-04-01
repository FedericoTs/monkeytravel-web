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

const ACTIVITY_ICONS: Record<string, string> = {
  breakfast: '🥐',
  lunch: '🍽️',
  dinner: '🌙',
  sightseeing: '📸',
  museum: '🎨',
  walk: '🚶',
  shopping: '🛍️',
  nightlife: '🍸',
  transport: '🚇',
  activity: '⭐',
};

/**
 * Activity card that slides in with icon, time, title, and description.
 * Used as a sequence within the Destination Reel.
 */
export const ActivityCard: React.FC<{
  time: string;
  type: string;
  title: string;
  description: string;
  index: number;
  imageSlug: string;
}> = ({ time, type, title, description, index, imageSlug }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgScale = interpolate(frame, [0, 120], [1.05, 1.15], { extrapolateRight: 'clamp' });

  // Card entrance
  const cardSpring = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const cardOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  // Time badge
  const badgeScale = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 10, stiffness: 150 },
  });

  // Text stagger
  const titleOpacity = interpolate(frame, [10, 22], [0, 1], { extrapolateRight: 'clamp' });
  const titleX = interpolate(frame, [10, 22], [20, 0], { extrapolateRight: 'clamp' });

  const descOpacity = interpolate(frame, [18, 30], [0, 1], { extrapolateRight: 'clamp' });
  const descY = interpolate(frame, [18, 30], [10, 0], { extrapolateRight: 'clamp' });

  const icon = ACTIVITY_ICONS[type] || '⭐';

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

      {/* Card */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '0 48px 280px',
        }}
      >
        <div
          style={{
            opacity: cardOpacity,
            transform: `translateY(${(1 - cardSpring) * 40}px)`,
            background: 'rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
            borderRadius: 24,
            padding: '48px 40px',
            width: '100%',
            maxWidth: 960,
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {/* Time badge + icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div
              style={{
                transform: `scale(${badgeScale})`,
                background: COLORS.primary,
                borderRadius: 50,
                padding: '10px 24px',
                fontFamily: FONTS.body,
                fontSize: 22,
                fontWeight: 600,
                color: COLORS.white,
              }}
            >
              {time}
            </div>
            <div style={{ fontSize: 36 }}>{icon}</div>
          </div>

          {/* Title */}
          <div
            style={{
              opacity: titleOpacity,
              transform: `translateX(${titleX}px)`,
              fontFamily: FONTS.heading,
              fontSize: 44,
              fontWeight: 700,
              color: COLORS.white,
              marginBottom: 16,
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
              lineHeight: 1.6,
              maxWidth: 800,
            }}
          >
            {description}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
