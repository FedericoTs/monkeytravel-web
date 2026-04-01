import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { z } from 'zod';
import { Hook } from '../components/Hook';
import { DayCard } from '../components/DayCard';
import { StatsReveal } from '../components/StatsReveal';
import { BrandCTA } from '../components/BrandCTA';
import { getDestinationData } from '../data';

/**
 * DestinationReel — 15s vertical reel for Instagram/TikTok/Shorts.
 *
 * NARRATIVE STRUCTURE (every frame has a purpose):
 *
 *   HOOK     (0-1.5s)  → "5 days in Tokyo" + photo card + "AI-planned"
 *                         PURPOSE: Stop the scroll. Curiosity trigger.
 *
 *   DAY 1    (1.5-4s)  → Activity list for day 1 on bright branded card
 *                         PURPOSE: "This is a real plan" — builds credibility.
 *
 *   DAY 2    (4-6.5s)  → Different accent color, different activities
 *                         PURPOSE: "It's detailed" — deepens interest.
 *
 *   DAY 3    (6.5-9s)  → Third card, third color
 *                         PURPOSE: Pattern completion — feels comprehensive.
 *
 *   STATS    (9-12s)   → "5 days · 15+ activities · Balanced budget"
 *                         PURPOSE: Social proof + legitimacy.
 *
 *   CTA      (12-15s)  → "Plan your perfect Tokyo trip" + button
 *                         PURPOSE: "I want this" → conversion.
 *
 * Design principles:
 *   - BRIGHT: Cream/white backgrounds, brand colors as accents
 *   - BRANDED: Coral, teal, gold used consistently
 *   - FAST: Quick transitions, no slow fades
 *   - MOBILE: Text is HUGE, designed for phone screens
 *   - FRESH: Feels like a modern app, not a travel agency
 */

export const destinationReelSchema = z.object({
  destination: z.string(),
  locale: z.enum(['en', 'es', 'it']),
});

type DestinationReelProps = z.infer<typeof destinationReelSchema>;

export const DestinationReel: React.FC<DestinationReelProps> = ({
  destination,
  locale,
}) => {
  const data = getDestinationData(destination, locale);

  if (!data) {
    return (
      <AbsoluteFill
        style={{
          background: '#FFFAF5',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div style={{ color: '#2D3436', fontSize: 32 }}>
          Destination "{destination}" not found
        </div>
      </AbsoluteFill>
    );
  }

  const days = data.stats.avgStayDays;
  const activities = data.activities;

  // Each day card shows 3-4 activities for visual density.
  // We cycle through the activity pool so every card looks full,
  // even when the source list has only 6 items.
  const buildDayActivities = (dayIndex: number, count: number) => {
    const result: typeof activities = [];
    for (let i = 0; i < count; i++) {
      result.push(activities[(dayIndex * 2 + i) % activities.length]);
    }
    return result;
  };

  const daySlices = [
    buildDayActivities(0, 4), // Day 1: activities 0,1,2,3
    buildDayActivities(1, 4), // Day 2: activities 2,3,4,5
    buildDayActivities(2, 4), // Day 3: activities 4,5,0,1
  ];

  return (
    <AbsoluteFill style={{ background: '#FFFAF5' }}>
      {/* HOOK: 0-44 (1.5s) — Stop the scroll */}
      <Sequence from={0} durationInFrames={45}>
        <Hook
          cityName={data.name}
          days={days}
          imageSlug={data.slug}
        />
      </Sequence>

      {/* DAY 1: 45-119 (2.5s) — "This is a real plan" */}
      <Sequence from={45} durationInFrames={75}>
        <DayCard
          dayNumber={1}
          activities={daySlices[0] || []}
          imageSlug={data.slug}
          totalDays={Math.min(days, 3)}
        />
      </Sequence>

      {/* DAY 2: 120-194 (2.5s) — "It's detailed" */}
      <Sequence from={120} durationInFrames={75}>
        <DayCard
          dayNumber={2}
          activities={daySlices[1] || daySlices[0] || []}
          imageSlug={data.slug}
          totalDays={Math.min(days, 3)}
        />
      </Sequence>

      {/* DAY 3: 195-269 (2.5s) — "It's comprehensive" */}
      <Sequence from={195} durationInFrames={75}>
        <DayCard
          dayNumber={3}
          activities={daySlices[2] || daySlices[0] || []}
          imageSlug={data.slug}
          totalDays={Math.min(days, 3)}
        />
      </Sequence>

      {/* STATS: 270-359 (3s) — "This is legit" */}
      <Sequence from={270} durationInFrames={90}>
        <StatsReveal
          days={days}
          activitiesCount={activities.length * days}
          budgetLevel={data.stats.budgetLevel}
          cityName={data.name}
        />
      </Sequence>

      {/* CTA: 360-449 (3s) — "I want this" */}
      <Sequence from={360} durationInFrames={90}>
        <BrandCTA cityName={data.name} />
      </Sequence>
    </AbsoluteFill>
  );
};
