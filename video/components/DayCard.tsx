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

const VIBE_COLORS = [COLORS.primary, COLORS.secondary, COLORS.accent];

const TYPE_EMOJI: Record<string, string> = {
  sightseeing: '📍',
  lunch: '🍜',
  dinner: '🍷',
  walk: '🚶',
  shopping: '🛍️',
  culture: '🎭',
  nature: '🌿',
  nightlife: '🌃',
  breakfast: '☕',
  default: '✦',
};

/**
 * DAY CARD — Shows one day of the itinerary with activity descriptions.
 *
 * Design: Bright branded card on cream background with rich activity list.
 * Each day gets a different accent color. Activities include type emoji,
 * time, title, and description for visual density.
 */
export const DayCard: React.FC<{
  dayNumber: number;
  activities: Array<{ time: string; title: string; type: string; description?: string }>;
  imageSlug: string;
  totalDays: number;
}> = ({ dayNumber, activities, imageSlug, totalDays }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const accentColor = VIBE_COLORS[(dayNumber - 1) % VIBE_COLORS.length];

  // Card slides up from bottom
  const cardY = interpolate(frame, [0, 15], [600, 0], { extrapolateRight: 'clamp' });
  const cardSpring = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });

  // Day number scales in
  const dayScale = spring({ frame: Math.max(0, frame - 5), fps, config: { damping: 8, stiffness: 180 } });

  // Activities stagger in
  const getActivityOpacity = (index: number) =>
    interpolate(frame, [10 + index * 5, 16 + index * 5], [0, 1], { extrapolateRight: 'clamp' });
  const getActivityX = (index: number) =>
    interpolate(frame, [10 + index * 5, 16 + index * 5], [30, 0], { extrapolateRight: 'clamp' });

  const items = activities.slice(0, 4);

  return (
    <AbsoluteFill style={{ background: COLORS.background, overflow: 'hidden' }}>
      {/* Accent color strip at top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 8,
          background: accentColor,
        }}
      />

      {/* Small destination image — top right corner */}
      <div
        style={{
          position: 'absolute',
          top: 40,
          right: 40,
          width: 140,
          height: 140,
          borderRadius: 20,
          overflow: 'hidden',
          opacity: interpolate(frame, [8, 18], [0, 1], { extrapolateRight: 'clamp' }),
          boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
        }}
      >
        <Img
          src={staticFile(`images/destinations/${imageSlug}.jpg`)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      {/* Day indicator */}
      <div
        style={{
          position: 'absolute',
          top: 60,
          left: 48,
          transform: `scale(${dayScale})`,
          transformOrigin: 'left center',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 20,
            fontWeight: 600,
            color: COLORS.slate,
            textTransform: 'uppercase',
            letterSpacing: '3px',
            marginBottom: 8,
          }}
        >
          Day {dayNumber} of {totalDays}
        </div>
        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: totalDays }, (_, i) => (
            <div
              key={i}
              style={{
                width: i + 1 === dayNumber ? 32 : 12,
                height: 12,
                borderRadius: 6,
                background: i + 1 === dayNumber ? accentColor : `${COLORS.slateLight}60`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Main card — centered vertically, auto-height */}
      <div
        style={{
          position: 'absolute',
          left: 32,
          right: 32,
          top: 240,
          transform: `translateY(${cardY * (1 - cardSpring)}px)`,
          background: COLORS.white,
          borderRadius: 28,
          padding: '44px 40px',
          boxShadow: `0 12px 40px rgba(0,0,0,0.08), 0 2px 8px ${accentColor}15`,
          border: `1px solid ${COLORS.slateLight}30`,
          overflow: 'hidden',
        }}
      >
        {/* Activity list */}
        {items.map((activity, i) => (
          <div
            key={i}
            style={{
              opacity: getActivityOpacity(i),
              transform: `translateX(${getActivityX(i)}px)`,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              marginBottom: i < items.length - 1 ? 32 : 0,
              paddingBottom: i < items.length - 1 ? 32 : 0,
              borderBottom: i < items.length - 1 ? `1px solid ${COLORS.slateLight}20` : 'none',
            }}
          >
            {/* Type emoji + time column */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: 80,
                gap: 6,
              }}
            >
              <div style={{ fontSize: 32 }}>
                {TYPE_EMOJI[activity.type] || TYPE_EMOJI.default}
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 18,
                  fontWeight: 600,
                  color: accentColor,
                }}
              >
                {activity.time}
              </div>
            </div>

            {/* Title + description */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 28,
                  fontWeight: 700,
                  color: COLORS.navy,
                  lineHeight: 1.25,
                  marginBottom: activity.description ? 8 : 0,
                }}
              >
                {activity.title}
              </div>
              {activity.description && (
                <div
                  style={{
                    fontFamily: FONTS.body,
                    fontSize: 20,
                    fontWeight: 400,
                    color: COLORS.slate,
                    lineHeight: 1.4,
                  }}
                >
                  {activity.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom branding */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: interpolate(frame, [25, 35], [0, 0.6], { extrapolateRight: 'clamp' }),
        }}
      >
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 18,
            color: COLORS.slate,
            letterSpacing: '1px',
          }}
        >
          monkeytravel.app
        </div>
      </div>
    </AbsoluteFill>
  );
};
