# Trip Timeline Feature - Implementation Guide

## Overview

The Trip Timeline transforms MonkeyTravel from a trip planning utility into a comprehensive travel companion that engages users **before**, **during**, and **after** their trips.

### 10X Impact

| Current State | With Timeline |
|---------------|---------------|
| 2-4 weeks engagement (planning only) | 3+ weeks engagement (full lifecycle) |
| ~5 touchpoints per trip | 30+ touchpoints per trip |
| No data collection during/after | Ratings, photos, notes = AI improvement |
| One-time use | Habit-forming return visits |

---

## Documentation Created

| File | Description |
|------|-------------|
| `docs/TRIP_TIMELINE_DESIGN_SPEC.md` | Complete feature specification with information architecture, database schema, API endpoints, and implementation roadmap |
| `docs/TRIP_TIMELINE_COMPONENTS.md` | Detailed component specifications with exact Tailwind classes, React code, and design tokens |
| `types/timeline.ts` | TypeScript type definitions for all timeline-related data structures |

---

## Feature Summary

### Pre-Trip Phase
- **Countdown Hero**: Animated countdown to trip start with weather preview
- **Checklist**: Auto-generated + custom preparation tasks
- **Weather Forecast**: 7-day forecast for trip dates

### Active Trip Phase
- **Live Journey Mode**: Current day/activity tracking
- **Activity Completion**: Slide-to-complete gesture
- **Quick Rating**: 5-star ratings with tags
- **Photo Capture**: One-tap photo upload with captions

### Post-Trip Phase
- **Trip Complete Hero**: Celebration + stats summary
- **Photo Album**: Chronological gallery by day
- **Trip Statistics**: Calculated metrics and highlights

---

## Implementation Phases

### Phase 1: Foundation
**Goal**: Database and type system

```bash
# 1. Apply database migrations
npx supabase migration new add_timeline_tables

# 2. Install dependencies
npm install framer-motion @radix-ui/react-progress

# 3. Types already created at types/timeline.ts
```

**Tables to create**:
- `activity_ratings` - Track activity completion and ratings
- `activity_photos` - Store photo metadata
- `trip_checklists` - Pre-trip preparation items
- `trip-photos` storage bucket

### Phase 2: Pre-Trip Experience
**Components**:
- `CountdownHero.tsx`
- `PreTripChecklist.tsx`
- `WeatherForecast.tsx`

**API endpoints**:
- `GET /api/trips/[id]/checklist`
- `POST /api/trips/[id]/checklist`
- `PATCH /api/trips/[id]/checklist/[itemId]`

### Phase 3: Live Journey Mode
**Components**:
- `LiveJourneyHeader.tsx`
- `LiveActivityCard.tsx`
- `QuickPhotoCapture.tsx`
- `ActivityRatingModal.tsx`

**API endpoints**:
- `POST /api/trips/[id]/timeline/start`
- `POST /api/trips/[id]/activities/[activityId]/complete`
- `POST /api/trips/[id]/activities/[activityId]/skip`
- `POST /api/trips/[id]/photos`

### Phase 4: Post-Trip Memories
**Components**:
- `TripCompleteHero.tsx`
- `PhotoAlbum.tsx`
- `TripStats.tsx`

**API endpoints**:
- `GET /api/trips/[id]/stats`
- `GET /api/trips/[id]/photos`

### Phase 5: Integration & Polish
- Tab navigation in trip detail page
- Mobile bottom sheet implementations
- Framer Motion animations
- Haptic feedback

---

## Key Design Decisions

### Mobile-First
- Bottom sheets for all modals
- Swipe gestures for completion
- Large touch targets (min 44px)
- Safe area inset handling

### No Friction
- One-tap photo capture
- Skip option always visible
- Rating is optional
- Checklist auto-generated

### Premium Feel
- Glass morphism on countdown boxes
- Star rating with bounce animation
- Slide-to-complete with haptics
- Celebration confetti on completion

---

## File Structure (To Create)

```
components/
├── timeline/
│   ├── CountdownHero.tsx
│   ├── PreTripChecklist.tsx
│   ├── WeatherForecast.tsx
│   ├── LiveJourneyHeader.tsx
│   ├── LiveActivityCard.tsx
│   ├── ActivityRatingModal.tsx
│   ├── QuickPhotoCapture.tsx
│   ├── TripCompleteHero.tsx
│   ├── PhotoAlbum.tsx
│   ├── TripStats.tsx
│   └── index.ts
├── ui/
│   ├── BottomSheet.tsx
│   ├── SlideToAction.tsx
│   └── StarRating.tsx

lib/
├── hooks/
│   ├── useTimeline.ts
│   ├── useActivityRating.ts
│   └── usePhotoUpload.ts

app/
├── api/
│   └── trips/
│       └── [id]/
│           ├── timeline/route.ts
│           ├── checklist/route.ts
│           ├── photos/route.ts
│           └── activities/[activityId]/
│               ├── complete/route.ts
│               └── skip/route.ts
```

---

## First Implementation Step

Start with the foundation:

1. **Create the database migration** (see `TRIP_TIMELINE_DESIGN_SPEC.md` Section 4)
2. **Create the storage bucket** for photos
3. **Implement the basic timeline API** endpoint

Then proceed with the Pre-Trip phase, which has the lowest complexity and provides immediate value.

---

## Dependencies

```json
{
  "framer-motion": "^10.16.4",
  "@radix-ui/react-progress": "^1.0.3"
}
```

---

## Notes

- **Email notifications**: Placeholder structure included but not implemented (awaiting service decision)
- **Weather API**: Uses Open-Meteo (free, no API key required)
- **Photo storage**: Uses Supabase Storage with user-specific folders
- **Existing patterns preserved**: All new components follow existing design system

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Pre-trip checklist usage | >50% of trips |
| Live tracking adoption | >30% of trips |
| Photo upload rate | 5+ per trip |
| Rating completion | >60% of activities |
| Return to completed trips | >40% revisit rate |

---

## Ready to Implement

When ready to start implementation, begin with Phase 1:

1. Run the database migration from `TRIP_TIMELINE_DESIGN_SPEC.md`
2. Create the components following `TRIP_TIMELINE_COMPONENTS.md`
3. Use types from `types/timeline.ts`

Each phase is designed to be independently valuable and deployable.
