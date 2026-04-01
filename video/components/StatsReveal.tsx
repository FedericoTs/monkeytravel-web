import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  Img,
  staticFile,
} from 'remotion';
import { COLORS, FONTS } from '../theme';

/**
 * STATS REVEAL — Quick animated stats that prove the plan is real.
 *
 * Design: Bright background, 3 big stat cards with bold numbers/labels,
 * animated counters, brand colors. Logo at bottom for branding.
 *
 * Purpose: "This is legit" → builds trust, makes it feel complete.
 */
export const StatsReveal: React.FC<{
  days: number;
  activitiesCount: number;
  budgetLevel: number;
  cityName: string;
}> = ({ days, activitiesCount, budgetLevel, cityName }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const budgetLabels = ['', 'Budget', 'Balanced', 'Premium'];

  const stats = [
    { value: days, label: 'days', color: COLORS.primary, suffix: '', display: 'number' as const },
    { value: activitiesCount, label: 'activities', color: COLORS.secondary, suffix: '+', display: 'number' as const },
    { value: budgetLevel, label: budgetLabels[budgetLevel], color: COLORS.accent, suffix: '', display: 'text' as const },
  ];

  // Header fade
  const headerOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const headerY = interpolate(frame, [0, 12], [30, 0], { extrapolateRight: 'clamp' });

  // Logo at bottom
  const logoOpacity = interpolate(frame, [40, 55], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: COLORS.background, overflow: 'hidden' }}>
      {/* Large decorative number background */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontFamily: FONTS.heading,
          fontSize: 600,
          fontWeight: 700,
          color: `${COLORS.primaryLight}15`,
          lineHeight: 1,
        }}
      >
        {days}
      </div>

      {/* Decorative blobs */}
      <div
        style={{
          position: 'absolute',
          top: -100,
          right: -60,
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.primaryLight}30 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 200,
          left: -80,
          width: 250,
          height: 250,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.secondaryLight}25 0%, transparent 70%)`,
        }}
      />

      {/* Header — positioned at upper third */}
      <div
        style={{
          position: 'absolute',
          top: 280,
          left: 48,
          right: 48,
          opacity: headerOpacity,
          transform: `translateY(${headerY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.heading,
            fontSize: 56,
            fontWeight: 700,
            color: COLORS.navy,
            lineHeight: 1.2,
            marginBottom: 12,
          }}
        >
          Your {cityName} trip
        </div>
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 28,
            color: COLORS.slate,
          }}
        >
          planned by AI in seconds
        </div>
      </div>

      {/* Stat cards — centered in middle section */}
      <div
        style={{
          position: 'absolute',
          left: 36,
          right: 36,
          top: 560,
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        {stats.map((stat, i) => {
          const delay = 6 + i * 8;
          const cardSpring = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 12, stiffness: 160 },
          });
          const cardX = interpolate(
            frame,
            [delay, delay + 10],
            [i % 2 === 0 ? -200 : 200, 0],
            { extrapolateRight: 'clamp' }
          );

          // Animated counter
          const countFrame = Math.max(0, frame - delay);
          const displayValue = stat.display === 'text'
            ? stat.label
            : Math.round(interpolate(countFrame, [0, 18], [0, stat.value], { extrapolateRight: 'clamp' }));

          return (
            <div
              key={i}
              style={{
                transform: `translateX(${cardX * (1 - cardSpring)}px) scale(${cardSpring})`,
                background: COLORS.white,
                borderRadius: 24,
                padding: '36px 40px',
                display: 'flex',
                alignItems: 'center',
                gap: 24,
                boxShadow: `0 8px 24px rgba(0,0,0,0.06), 0 2px 8px ${stat.color}20`,
                borderLeft: `6px solid ${stat.color}`,
              }}
            >
              {/* Number or Label */}
              <div
                style={{
                  fontFamily: FONTS.heading,
                  fontSize: stat.display === 'text' ? 44 : 72,
                  fontWeight: 700,
                  color: stat.color,
                  minWidth: 160,
                  lineHeight: 1,
                }}
              >
                {displayValue}{stat.suffix}
              </div>

              {/* Label */}
              <div
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 30,
                  fontWeight: 600,
                  color: COLORS.navy,
                  textTransform: 'uppercase',
                  letterSpacing: '2px',
                }}
              >
                {stat.display === 'text' ? 'budget' : stat.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom branding */}
      <div
        style={{
          position: 'absolute',
          bottom: 120,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 12,
          opacity: logoOpacity,
        }}
      >
        <Img
          src={staticFile('images/logo.png')}
          style={{ width: 36, height: 36, objectFit: 'contain' }}
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
