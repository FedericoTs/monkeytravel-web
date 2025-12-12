# MonkeyTravel Future Enhancements Roadmap

> **Document Version**: 1.0
> **Last Updated**: December 2024
> **Status**: Planning Phase

This document outlines two major revenue and feature enhancements for MonkeyTravel: **Affiliate Booking Integration** and **Automatic Email Parsing**. Both systems are designed to integrate seamlessly with our existing codebase architecture.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Part 1: Affiliate Booking Integration](#part-1-affiliate-booking-integration)
   - [Overview & Revenue Potential](#overview--revenue-potential)
   - [Partner Program Analysis](#partner-program-analysis)
   - [Technical Implementation](#technical-implementation)
   - [Database Schema](#database-schema)
   - [API Endpoints](#api-endpoints)
   - [UI Components](#ui-components)
   - [Implementation Phases](#implementation-phases)
3. [Part 2: Email Parsing System](#part-2-email-parsing-system)
   - [Overview & Value Proposition](#overview--value-proposition)
   - [Architecture Comparison](#architecture-comparison)
   - [Recommended Approach: Email Forwarding](#recommended-approach-email-forwarding)
   - [Technical Implementation](#email-parsing-technical-implementation)
   - [AI Parsing Pipeline](#ai-parsing-pipeline)
   - [Database Schema](#email-parsing-database-schema)
   - [Implementation Phases](#email-parsing-implementation-phases)
4. [Combined Roadmap Timeline](#combined-roadmap-timeline)
5. [Success Metrics](#success-metrics)
6. [Risk Mitigation](#risk-mitigation)

---

## Executive Summary

### Why These Enhancements?

| Enhancement | Primary Value | Revenue Impact | User Value |
|-------------|---------------|----------------|------------|
| **Affiliate Booking** | Monetization | $120-$27,000/mo | One-click booking from itinerary |
| **Email Parsing** | Retention & Data | Indirect (engagement) | Auto-import existing bookings |

### Strategic Fit

Both features align with MonkeyTravel's core mission:

1. **Affiliate Booking**: Completes the travel planning loop—users plan AND book without leaving the app
2. **Email Parsing**: Reduces friction for users with existing bookings—import vs. manual entry

### Implementation Priority

```
Phase 1 (Q1): Affiliate Integration - Viator + GetYourGuide + Booking.com
Phase 2 (Q2): Email Forwarding System - Basic parsing for flights/hotels
Phase 3 (Q3): Advanced Parsing + Affiliate Optimization
Phase 4 (Q4): Full Automation + Revenue Optimization
```

---

## Part 1: Affiliate Booking Integration

### Overview & Revenue Potential

Transform MonkeyTravel from a planning tool into a **booking platform** by integrating affiliate partnerships with major travel providers. Users book directly from their itinerary, and MonkeyTravel earns commission.

#### Revenue Model

| User Scale | Monthly Active | Booking Rate | Avg Order | Commission | **Monthly Revenue** |
|------------|----------------|--------------|-----------|------------|---------------------|
| Early | 5,000 | 3% | $100 | 8% | **$1,200** |
| Growth | 20,000 | 5% | $120 | 8% | **$9,600** |
| Scale | 50,000 | 6% | $150 | 8% | **$36,000** |

*Conservative estimates based on industry averages*

---

### Partner Program Analysis

#### Tier 1: Immediate Integration (FREE APIs, High Commission)

| Provider | Category | Commission | Cookie | API Access | Integration Effort |
|----------|----------|------------|--------|------------|-------------------|
| **Viator** | Tours/Activities | 8% (up to 12% at scale) | 30 days | REST API, Free | Medium |
| **GetYourGuide** | Tours/Activities | 8% (up to 12% at scale) | 30 days | REST API, Free | Medium |
| **Booking.com** | Hotels | 4-6% effective | 30 days | Affiliate API, Free | Low |

#### Tier 2: Secondary Integration

| Provider | Category | Commission | Notes |
|----------|----------|------------|-------|
| **Klook** | Activities (Asia focus) | 5-15% | Strong in Asia-Pacific |
| **TheFork** | Restaurants (EU) | 40% new / 15% existing | EU-only, high commission |
| **Hostelworld** | Budget accommodation | 5-8% | Budget traveler segment |

#### Tier 3: Future Consideration

| Provider | Category | Commission | Barrier |
|----------|----------|------------|---------|
| **Expedia TAAP** | Full travel | Up to 13% | Requires IATA/ARC accreditation |
| **Airbnb** | Accommodation | N/A | No public affiliate program |

---

### Technical Implementation

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      MonkeyTravel App                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Activity    │    │   Booking    │    │   Affiliate  │      │
│  │    Card      │───▶│    Modal     │───▶│    Router    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                 │               │
│                                                 ▼               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Affiliate Links API                    │   │
│  │              /api/affiliate/generate-link                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                 │               │
└─────────────────────────────────────────────────│───────────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    │                             │                             │
                    ▼                             ▼                             ▼
           ┌──────────────┐              ┌──────────────┐              ┌──────────────┐
           │    Viator    │              │ GetYourGuide │              │  Booking.com │
           │     API      │              │     API      │              │     API      │
           └──────────────┘              └──────────────┘              └──────────────┘
```

#### Integration with Existing Codebase

**Current State** (`components/trip/TripBookingLinks.tsx`):
- Already displays booking links for flights/hotels
- Uses `BookingLink` type from `types/index.ts`
- Provider styling configured in `providerConfig` object

**Enhancement Strategy**:
1. Extend `BookingLink` type with affiliate metadata
2. Add new providers to `providerConfig`
3. Create affiliate link generation API
4. Track clicks and conversions

---

### Database Schema

#### New Tables

```sql
-- Migration: 001_affiliate_system.sql

-- Affiliate partner configuration
CREATE TABLE affiliate_partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('activities', 'hotels', 'flights', 'restaurants', 'transport')),
  api_base_url TEXT,
  affiliate_id TEXT,
  commission_rate NUMERIC(5,2) NOT NULL,
  cookie_days INTEGER DEFAULT 30,
  logo_url TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  regions TEXT[] DEFAULT '{}',  -- Empty = global, or ['EU', 'APAC', 'NA']
  config JSONB DEFAULT '{}',    -- API-specific configuration
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Track affiliate link clicks
CREATE TABLE affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  trip_id UUID REFERENCES trips(id),
  activity_id TEXT,             -- References activity in trip itinerary JSON
  partner_id UUID REFERENCES affiliate_partners(id),
  affiliate_url TEXT NOT NULL,
  destination TEXT,
  activity_name TEXT,
  click_timestamp TIMESTAMPTZ DEFAULT now(),
  device_type TEXT,             -- mobile, desktop, tablet
  referrer TEXT,
  session_id TEXT,
  converted BOOLEAN DEFAULT false,
  conversion_timestamp TIMESTAMPTZ,
  commission_amount NUMERIC(10,2),
  order_amount NUMERIC(10,2),
  currency TEXT DEFAULT 'USD'
);

-- Monthly affiliate earnings summary
CREATE TABLE affiliate_earnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID REFERENCES affiliate_partners(id),
  period_month TEXT NOT NULL,   -- 'YYYY-MM' format
  total_clicks INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  conversion_rate NUMERIC(5,2),
  total_order_value NUMERIC(12,2) DEFAULT 0,
  total_commission NUMERIC(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'paid')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(partner_id, period_month)
);

-- Activity to affiliate product mapping (optional, for deep linking)
CREATE TABLE affiliate_product_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_type TEXT NOT NULL,      -- 'museum', 'restaurant', 'tour', etc.
  destination TEXT NOT NULL,        -- 'Rome, Italy', 'Paris, France'
  partner_id UUID REFERENCES affiliate_partners(id),
  product_id TEXT,                  -- Partner's product ID for deep linking
  product_url TEXT,
  search_keywords TEXT[],           -- For matching activities
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_affiliate_clicks_user ON affiliate_clicks(user_id);
CREATE INDEX idx_affiliate_clicks_trip ON affiliate_clicks(trip_id);
CREATE INDEX idx_affiliate_clicks_partner ON affiliate_clicks(partner_id);
CREATE INDEX idx_affiliate_clicks_timestamp ON affiliate_clicks(click_timestamp);
CREATE INDEX idx_affiliate_product_dest ON affiliate_product_mappings(destination);
CREATE INDEX idx_affiliate_product_type ON affiliate_product_mappings(activity_type);

-- RLS Policies
ALTER TABLE affiliate_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_product_mappings ENABLE ROW LEVEL SECURITY;

-- Partners: Read-only for all authenticated users
CREATE POLICY "affiliate_partners_read" ON affiliate_partners
  FOR SELECT TO authenticated USING (is_active = true);

-- Clicks: Users can view their own clicks
CREATE POLICY "affiliate_clicks_own" ON affiliate_clicks
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Allow insert without user_id check (for anonymous tracking)
CREATE POLICY "affiliate_clicks_insert" ON affiliate_clicks
  FOR INSERT TO authenticated WITH CHECK (true);

-- Earnings: Admin only (service_role)
CREATE POLICY "affiliate_earnings_admin" ON affiliate_earnings
  FOR ALL TO service_role USING (true);

-- Product mappings: Read-only for authenticated
CREATE POLICY "affiliate_mappings_read" ON affiliate_product_mappings
  FOR SELECT TO authenticated USING (true);
```

#### Seed Data

```sql
-- Seed initial affiliate partners
INSERT INTO affiliate_partners (name, display_name, category, commission_rate, cookie_days, priority, regions) VALUES
  ('viator', 'Viator', 'activities', 8.00, 30, 1, '{}'),
  ('getyourguide', 'GetYourGuide', 'activities', 8.00, 30, 2, '{}'),
  ('booking_com', 'Booking.com', 'hotels', 5.00, 30, 1, '{}'),
  ('klook', 'Klook', 'activities', 7.00, 30, 3, '{APAC}'),
  ('thefork', 'TheFork', 'restaurants', 25.00, 20, 1, '{EU}'),
  ('hostelworld', 'Hostelworld', 'hotels', 6.00, 30, 2, '{}');
```

---

### API Endpoints

#### 1. Generate Affiliate Link

**File**: `app/api/affiliate/generate-link/route.ts`

```typescript
// POST /api/affiliate/generate-link
// Generates an affiliate link for a specific activity

import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

interface GenerateLinkRequest {
  activityName: string;
  activityType: string;
  destination: string;
  tripId?: string;
  activityId?: string;
  preferredPartner?: string;  // Optional: force specific partner
}

interface AffiliateLink {
  partner: string;
  partnerDisplayName: string;
  url: string;
  category: string;
  commission: number;
  logoUrl?: string;
}

// Partner-specific URL generators
const partnerGenerators: Record<string, (params: GenerateLinkRequest, affiliateId: string) => string> = {
  viator: (params, affiliateId) => {
    const searchQuery = encodeURIComponent(`${params.activityName} ${params.destination}`);
    return `https://www.viator.com/searchResults/all?text=${searchQuery}&pid=${affiliateId}`;
  },

  getyourguide: (params, affiliateId) => {
    const searchQuery = encodeURIComponent(`${params.activityName} ${params.destination}`);
    return `https://www.getyourguide.com/s/?q=${searchQuery}&partner_id=${affiliateId}`;
  },

  booking_com: (params, affiliateId) => {
    const destQuery = encodeURIComponent(params.destination);
    return `https://www.booking.com/searchresults.html?ss=${destQuery}&aid=${affiliateId}`;
  },

  klook: (params, affiliateId) => {
    const searchQuery = encodeURIComponent(`${params.activityName} ${params.destination}`);
    return `https://www.klook.com/search/?query=${searchQuery}&aff_id=${affiliateId}`;
  },

  thefork: (params, affiliateId) => {
    const destQuery = encodeURIComponent(params.destination.split(',')[0]); // City only
    return `https://www.thefork.com/search/?q=${destQuery}&pid=${affiliateId}`;
  }
};

// Map activity types to partner categories
const activityTypeToCategory: Record<string, string[]> = {
  'museum': ['activities'],
  'attraction': ['activities'],
  'landmark': ['activities'],
  'tour': ['activities'],
  'restaurant': ['restaurants'],
  'food': ['restaurants'],
  'cafe': ['restaurants'],
  'bar': ['restaurants'],
  'hotel': ['hotels'],
  'accommodation': ['hotels'],
  'activity': ['activities'],
  'cultural': ['activities'],
  'entertainment': ['activities'],
  'spa': ['activities'],
  'wellness': ['activities'],
};

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const body: GenerateLinkRequest = await req.json();

    // Get current user (optional - for tracking)
    const { data: { user } } = await supabase.auth.getUser();

    // Determine relevant categories for this activity type
    const categories = activityTypeToCategory[body.activityType.toLowerCase()] || ['activities'];

    // Fetch active partners for these categories
    const { data: partners, error: partnersError } = await supabase
      .from('affiliate_partners')
      .select('*')
      .in('category', categories)
      .eq('is_active', true)
      .order('priority', { ascending: true });

    if (partnersError || !partners?.length) {
      return NextResponse.json({
        links: [],
        message: 'No affiliate partners available for this activity type'
      });
    }

    // Generate links for each partner
    const links: AffiliateLink[] = [];

    for (const partner of partners) {
      const generator = partnerGenerators[partner.name];
      if (!generator) continue;

      // Check regional availability
      if (partner.regions?.length > 0) {
        // TODO: Determine user region from destination or user profile
        // For now, include all partners
      }

      const url = generator(body, partner.affiliate_id || '');

      links.push({
        partner: partner.name,
        partnerDisplayName: partner.display_name,
        url,
        category: partner.category,
        commission: partner.commission_rate,
        logoUrl: partner.logo_url
      });
    }

    return NextResponse.json({ links });

  } catch (error) {
    console.error('Affiliate link generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate affiliate links' },
      { status: 500 }
    );
  }
}
```

#### 2. Track Affiliate Click

**File**: `app/api/affiliate/track-click/route.ts`

```typescript
// POST /api/affiliate/track-click
// Records when a user clicks an affiliate link

import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

interface TrackClickRequest {
  partnerId: string;
  affiliateUrl: string;
  tripId?: string;
  activityId?: string;
  activityName?: string;
  destination?: string;
  sessionId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const body: TrackClickRequest = await req.json();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    // Determine device type from user agent
    const userAgent = req.headers.get('user-agent') || '';
    let deviceType = 'desktop';
    if (/mobile/i.test(userAgent)) deviceType = 'mobile';
    else if (/tablet|ipad/i.test(userAgent)) deviceType = 'tablet';

    // Get partner UUID from name
    const { data: partner } = await supabase
      .from('affiliate_partners')
      .select('id')
      .eq('name', body.partnerId)
      .single();

    if (!partner) {
      return NextResponse.json({ error: 'Invalid partner' }, { status: 400 });
    }

    // Record the click
    const { data: click, error } = await supabase
      .from('affiliate_clicks')
      .insert({
        user_id: user?.id,
        trip_id: body.tripId,
        activity_id: body.activityId,
        partner_id: partner.id,
        affiliate_url: body.affiliateUrl,
        activity_name: body.activityName,
        destination: body.destination,
        device_type: deviceType,
        referrer: req.headers.get('referer'),
        session_id: body.sessionId
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      clickId: click.id,
      redirectUrl: body.affiliateUrl
    });

  } catch (error) {
    console.error('Affiliate click tracking error:', error);
    return NextResponse.json(
      { error: 'Failed to track click' },
      { status: 500 }
    );
  }
}
```

#### 3. Affiliate Analytics (Admin)

**File**: `app/api/admin/affiliate-analytics/route.ts`

```typescript
// GET /api/admin/affiliate-analytics
// Returns affiliate performance metrics

import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    // Verify admin access
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get date range from query params
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = searchParams.get('end') || new Date().toISOString();

    // Get click summary by partner
    const { data: clicksByPartner } = await supabase
      .from('affiliate_clicks')
      .select(`
        partner_id,
        affiliate_partners!inner(name, display_name, category),
        converted
      `)
      .gte('click_timestamp', startDate)
      .lte('click_timestamp', endDate);

    // Aggregate metrics
    const partnerMetrics: Record<string, {
      name: string;
      displayName: string;
      category: string;
      clicks: number;
      conversions: number;
      conversionRate: number;
    }> = {};

    for (const click of clicksByPartner || []) {
      const partner = click.affiliate_partners;
      if (!partnerMetrics[partner.name]) {
        partnerMetrics[partner.name] = {
          name: partner.name,
          displayName: partner.display_name,
          category: partner.category,
          clicks: 0,
          conversions: 0,
          conversionRate: 0
        };
      }
      partnerMetrics[partner.name].clicks++;
      if (click.converted) partnerMetrics[partner.name].conversions++;
    }

    // Calculate conversion rates
    for (const metrics of Object.values(partnerMetrics)) {
      metrics.conversionRate = metrics.clicks > 0
        ? (metrics.conversions / metrics.clicks) * 100
        : 0;
    }

    // Get top destinations
    const { data: topDestinations } = await supabase
      .from('affiliate_clicks')
      .select('destination')
      .gte('click_timestamp', startDate)
      .not('destination', 'is', null);

    const destinationCounts: Record<string, number> = {};
    for (const click of topDestinations || []) {
      if (click.destination) {
        destinationCounts[click.destination] = (destinationCounts[click.destination] || 0) + 1;
      }
    }

    const topDests = Object.entries(destinationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([destination, count]) => ({ destination, clicks: count }));

    return NextResponse.json({
      dateRange: { start: startDate, end: endDate },
      partnerMetrics: Object.values(partnerMetrics),
      topDestinations: topDests,
      totals: {
        clicks: Object.values(partnerMetrics).reduce((sum, p) => sum + p.clicks, 0),
        conversions: Object.values(partnerMetrics).reduce((sum, p) => sum + p.conversions, 0)
      }
    });

  } catch (error) {
    console.error('Affiliate analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
```

---

### UI Components

#### 1. Enhanced Activity Card Booking Button

**File**: `components/trip/ActivityBookingButton.tsx`

```tsx
'use client';

import { useState } from 'react';
import { ExternalLink, Loader2, ShoppingBag } from 'lucide-react';
import type { Activity } from '@/types';

interface ActivityBookingButtonProps {
  activity: Activity;
  tripId: string;
  destination: string;
  variant?: 'icon' | 'button' | 'inline';
}

interface AffiliateLink {
  partner: string;
  partnerDisplayName: string;
  url: string;
  category: string;
  logoUrl?: string;
}

export default function ActivityBookingButton({
  activity,
  tripId,
  destination,
  variant = 'button'
}: ActivityBookingButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [links, setLinks] = useState<AffiliateLink[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const fetchAffiliateLinks = async () => {
    if (links.length > 0) {
      setShowDropdown(true);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/affiliate/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityName: activity.name,
          activityType: activity.type,
          destination,
          tripId,
          activityId: activity.id
        })
      });

      const data = await response.json();
      setLinks(data.links || []);
      setShowDropdown(true);
    } catch (error) {
      console.error('Failed to fetch affiliate links:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkClick = async (link: AffiliateLink) => {
    // Track the click
    await fetch('/api/affiliate/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partnerId: link.partner,
        affiliateUrl: link.url,
        tripId,
        activityId: activity.id,
        activityName: activity.name,
        destination
      })
    });

    // Open in new tab
    window.open(link.url, '_blank', 'noopener,noreferrer');
    setShowDropdown(false);
  };

  if (variant === 'icon') {
    return (
      <div className="relative">
        <button
          onClick={fetchAffiliateLinks}
          className="p-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors"
          title="Book this activity"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShoppingBag className="w-4 h-4" />
          )}
        </button>

        {showDropdown && links.length > 0 && (
          <BookingDropdown
            links={links}
            onSelect={handleLinkClick}
            onClose={() => setShowDropdown(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={fetchAffiliateLinks}
        disabled={isLoading}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm hover:shadow-md disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ShoppingBag className="w-4 h-4" />
        )}
        <span className="font-medium">Book Now</span>
      </button>

      {showDropdown && links.length > 0 && (
        <BookingDropdown
          links={links}
          onSelect={handleLinkClick}
          onClose={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}

// Dropdown component for selecting booking partner
function BookingDropdown({
  links,
  onSelect,
  onClose
}: {
  links: AffiliateLink[];
  onSelect: (link: AffiliateLink) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Dropdown */}
      <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="p-3 bg-slate-50 border-b">
          <p className="text-sm font-medium text-slate-700">Book with</p>
          <p className="text-xs text-slate-500">Compare prices across platforms</p>
        </div>

        <div className="p-2">
          {links.map((link) => (
            <button
              key={link.partner}
              onClick={() => onSelect(link)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                {link.logoUrl ? (
                  <img src={link.logoUrl} alt={link.partnerDisplayName} className="w-5 h-5" />
                ) : (
                  <ExternalLink className="w-4 h-4 text-slate-500" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium text-slate-700">{link.partnerDisplayName}</p>
                <p className="text-xs text-slate-500 capitalize">{link.category}</p>
              </div>
              <ExternalLink className="w-4 h-4 text-slate-400" />
            </button>
          ))}
        </div>

        <div className="p-2 bg-slate-50 border-t">
          <p className="text-[10px] text-slate-400 text-center">
            Prices may vary. We may earn a commission.
          </p>
        </div>
      </div>
    </>
  );
}
```

#### 2. Enhanced TripBookingLinks Component

**File**: Update `components/trip/TripBookingLinks.tsx`

Add to the existing `providerConfig`:

```typescript
const providerConfig: Record<string, { color: string; bgColor: string; logo?: string }> = {
  // ... existing providers ...
  "Viator": { color: "text-green-600", bgColor: "bg-green-50 hover:bg-green-100" },
  "GetYourGuide": { color: "text-orange-600", bgColor: "bg-orange-50 hover:bg-orange-100" },
  "Klook": { color: "text-orange-500", bgColor: "bg-orange-50 hover:bg-orange-100" },
  "TheFork": { color: "text-teal-600", bgColor: "bg-teal-50 hover:bg-teal-100" },
};
```

---

### Implementation Phases

#### Phase 1: Foundation (2-3 weeks)

**Tasks**:
1. [ ] Apply database migrations for affiliate tables
2. [ ] Create `/api/affiliate/generate-link` endpoint
3. [ ] Create `/api/affiliate/track-click` endpoint
4. [ ] Sign up for Viator Affiliate Program
5. [ ] Sign up for GetYourGuide Partner Program
6. [ ] Sign up for Booking.com Affiliate Program

**Environment Variables**:
```bash
# .env.local additions
VIATOR_AFFILIATE_ID=your_viator_id
GETYOURGUIDE_PARTNER_ID=your_gyg_id
BOOKING_COM_AID=your_booking_aid
```

#### Phase 2: UI Integration (1-2 weeks)

**Tasks**:
1. [ ] Create `ActivityBookingButton` component
2. [ ] Integrate booking button into `EditableActivityCard`
3. [ ] Update `TripBookingLinks` with new partners
4. [ ] Add booking option to activity modal/detail view
5. [ ] Mobile-optimize dropdown menu

#### Phase 3: Analytics & Optimization (2 weeks)

**Tasks**:
1. [ ] Create admin affiliate analytics dashboard
2. [ ] Implement conversion tracking webhook endpoints
3. [ ] A/B test booking button placement
4. [ ] Add partner priority based on conversion rates
5. [ ] Implement smart partner recommendations based on activity type

#### Phase 4: Advanced Features (ongoing)

**Tasks**:
1. [ ] Deep linking to specific products (not just search)
2. [ ] Price comparison widget
3. [ ] Availability checking via APIs
4. [ ] Commission optimization based on performance
5. [ ] User booking history tracking

---

## Part 2: Email Parsing System

### Overview & Value Proposition

Enable users to **automatically import existing bookings** by forwarding confirmation emails to MonkeyTravel. The system parses email content using AI and adds bookings to their trips.

#### User Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Journey                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User books flight on United.com                                     │
│                    ↓                                                    │
│  2. United sends confirmation email to user@gmail.com                   │
│                    ↓                                                    │
│  3. User forwards email to plans@monkeytravel.app                       │
│                    ↓                                                    │
│  4. MonkeyTravel receives & parses email with AI                        │
│                    ↓                                                    │
│  5. Flight automatically added to user's trip                           │
│                    ↓                                                    │
│  6. User sees booking in their itinerary with all details               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Why Email Forwarding vs. Gmail OAuth?

| Approach | Complexity | Cost | Timeline | Privacy |
|----------|------------|------|----------|---------|
| **Email Forwarding** | Medium | ~$50/mo | 2-4 weeks | High (user-initiated) |
| **Gmail OAuth** | Very High | $25K-100K/yr | 4-8 weeks + verification | Requires extensive review |

**Gmail OAuth Challenges**:
- `gmail.readonly` is a **restricted scope**
- Requires third-party security assessment ($15K-75K)
- Several weeks verification + annual re-verification
- Privacy policy must include Google's Limited Use Requirements
- Complex OAuth flow maintenance

**Email Forwarding Advantages**:
- No OAuth verification required
- User explicitly chooses what to share
- Works with ANY email provider
- TripIt's proven model (millions of users)
- Much faster time-to-market

---

### Architecture Comparison

#### Option A: Email Forwarding (RECOMMENDED)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Email Forwarding Architecture                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   User Email Provider              MonkeyTravel                         │
│   (Gmail, Outlook, etc.)           Infrastructure                       │
│                                                                         │
│   ┌──────────────────┐            ┌──────────────────┐                  │
│   │  User's Inbox    │            │  Email Receiving │                  │
│   │                  │   Forward  │     Server       │                  │
│   │  Booking Email   │──────────▶│                  │                  │
│   │  from Airline    │            │ plans@monkeytravel │                │
│   └──────────────────┘            │      .app        │                  │
│                                   └────────┬─────────┘                  │
│                                            │                            │
│                                            ▼                            │
│                                   ┌──────────────────┐                  │
│                                   │  Webhook Handler │                  │
│                                   │  /api/email/     │                  │
│                                   │    inbound       │                  │
│                                   └────────┬─────────┘                  │
│                                            │                            │
│                          ┌─────────────────┼─────────────────┐          │
│                          ▼                 ▼                 ▼          │
│                   ┌────────────┐   ┌────────────┐   ┌────────────┐     │
│                   │   Email    │   │   AI       │   │  Booking   │     │
│                   │  Storage   │   │  Parser    │   │  Matcher   │     │
│                   │            │   │ (GPT-4o)   │   │            │     │
│                   └────────────┘   └────────────┘   └────────────┘     │
│                                            │                            │
│                                            ▼                            │
│                                   ┌──────────────────┐                  │
│                                   │   Trip Update    │                  │
│                                   │   + Notification │                  │
│                                   └──────────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Option B: Gmail OAuth (NOT RECOMMENDED for MVP)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Gmail OAuth Architecture                            │
│                    (Requires Google Verification)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────────┐            ┌──────────────────┐                  │
│   │  User's Gmail    │   OAuth    │  MonkeyTravel    │                  │
│   │     Account      │◀──────────▶│     Server       │                  │
│   │                  │            │                  │                  │
│   └──────────────────┘            └────────┬─────────┘                  │
│                                            │                            │
│                                            │ Sync inbox                 │
│                                            │ (gmail.readonly)           │
│                                            │                            │
│                          ┌─────────────────┼─────────────────┐          │
│                          ▼                 ▼                 ▼          │
│                   ┌────────────┐   ┌────────────┐   ┌────────────┐     │
│                   │   Filter   │   │   Parse    │   │   Match    │     │
│                   │  Emails    │   │  Content   │   │  to Trip   │     │
│                   └────────────┘   └────────────┘   └────────────┘     │
│                                                                         │
│   ⚠️ BLOCKERS:                                                          │
│   • Restricted scope requires security assessment                       │
│   • $15K-75K assessment cost                                           │
│   • Weeks of verification process                                       │
│   • Annual re-verification                                              │
│   • Complex privacy policy requirements                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Recommended Approach: Email Forwarding

<a name="email-parsing-technical-implementation"></a>
### Technical Implementation

#### Email Receiving Options

| Service | Pricing | Webhooks | Parsing | Notes |
|---------|---------|----------|---------|-------|
| **SendGrid Inbound Parse** | $19.95/mo (40K emails) | Yes | HTML/Text | Best for scale |
| **Mailgun Inbound Routes** | $35/mo (50K emails) | Yes | Full MIME | Good parsing |
| **Postmark Inbound** | $15/mo + usage | Yes | JSON | Clean API |
| **Custom (Cloudflare Email Workers)** | ~$5/mo | Custom | Custom | Most control |

**Recommended**: SendGrid Inbound Parse (mature, reliable, good documentation)

#### Email Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Email Processing Pipeline                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐      │
│  │  Receive  │───▶│  Verify   │───▶│   Parse   │───▶│   Match   │      │
│  │   Email   │    │   User    │    │  Content  │    │  to Trip  │      │
│  └───────────┘    └───────────┘    └───────────┘    └───────────┘      │
│        │                │                │                │             │
│        ▼                ▼                ▼                ▼             │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐      │
│  │ SendGrid  │    │  Check    │    │  GPT-4o   │    │  Fuzzy    │      │
│  │ Webhook   │    │ from:addr │    │  Extract  │    │  Match    │      │
│  │           │    │  in users │    │  Booking  │    │  Dates &  │      │
│  │           │    │  table    │    │  Details  │    │  Dest     │      │
│  └───────────┘    └───────────┘    └───────────┘    └───────────┘      │
│                                                                         │
│                                          │                              │
│                                          ▼                              │
│                               ┌─────────────────────┐                   │
│                               │   Create/Update     │                   │
│                               │   Trip Activity     │                   │
│                               │   or Booking        │                   │
│                               └─────────────────────┘                   │
│                                          │                              │
│                                          ▼                              │
│                               ┌─────────────────────┐                   │
│                               │  Send Notification  │                   │
│                               │  to User            │                   │
│                               └─────────────────────┘                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### AI Parsing Pipeline

#### Supported Booking Types

| Category | Providers | Data Extracted |
|----------|-----------|----------------|
| **Flights** | Airlines (United, Delta, etc.), Booking sites | Confirmation #, Route, Dates, Times, Seat, Airline |
| **Hotels** | Hotels.com, Booking.com, Airbnb, Direct | Confirmation #, Name, Address, Check-in/out, Room type |
| **Car Rentals** | Hertz, Enterprise, Turo | Confirmation #, Pickup/dropoff, Dates, Vehicle type |
| **Activities** | Viator, GetYourGuide, Museums | Confirmation #, Name, Date, Time, Location |
| **Restaurants** | OpenTable, Resy, TheFork | Confirmation #, Name, Date, Time, Party size |
| **Trains** | Amtrak, Eurostar, Trenitalia | Confirmation #, Route, Dates, Times, Class |

#### GPT-4o Parsing Prompt

```typescript
const BOOKING_PARSER_PROMPT = `You are a travel booking email parser. Extract structured booking information from the email content provided.

Return a JSON object with the following structure:
{
  "bookingType": "flight" | "hotel" | "car_rental" | "activity" | "restaurant" | "train" | "other",
  "confidence": 0.0-1.0,
  "booking": {
    "confirmationNumber": "string",
    "provider": "string (airline/hotel/company name)",
    "status": "confirmed" | "pending" | "cancelled",

    // For flights/trains
    "departure": {
      "location": "string (city or airport code)",
      "dateTime": "ISO 8601 string",
      "terminal": "string (optional)"
    },
    "arrival": {
      "location": "string",
      "dateTime": "ISO 8601 string",
      "terminal": "string (optional)"
    },
    "passengers": ["string"],
    "class": "string (economy/business/first)",
    "seatNumbers": ["string"],

    // For hotels
    "propertyName": "string",
    "address": "string",
    "checkIn": "ISO 8601 date",
    "checkOut": "ISO 8601 date",
    "roomType": "string",
    "guests": number,

    // For activities/restaurants
    "activityName": "string",
    "location": "string",
    "dateTime": "ISO 8601 string",
    "duration": "string (optional)",
    "partySize": number,

    // Common
    "totalPrice": {
      "amount": number,
      "currency": "string (ISO code)"
    },
    "notes": "string (any important details)"
  },
  "rawProviderInfo": {
    "fromEmail": "string",
    "subject": "string"
  }
}

If you cannot parse the email or it's not a booking confirmation, return:
{
  "bookingType": "unknown",
  "confidence": 0.0,
  "error": "reason why parsing failed"
}

Important:
- Extract dates in ISO 8601 format (YYYY-MM-DDTHH:MM:SS)
- Include timezone if available
- Extract all passenger/guest names
- Include confirmation/reference numbers
- Note any special requests or notes`;
```

---

<a name="email-parsing-database-schema"></a>
### Database Schema

```sql
-- Migration: 002_email_parsing_system.sql

-- Store raw emails for debugging and re-processing
CREATE TABLE email_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),

  -- Email metadata
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,        -- plans+{user_token}@monkeytravel.app
  subject TEXT,
  received_at TIMESTAMPTZ DEFAULT now(),

  -- Content (encrypted at rest recommended)
  raw_content TEXT,                -- Original email content
  parsed_content JSONB,            -- AI-extracted booking data

  -- Processing status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'parsed', 'matched', 'failed', 'ignored')),
  error_message TEXT,

  -- Matching
  matched_trip_id UUID REFERENCES trips(id),
  created_booking_id UUID,         -- References booking in trip

  -- AI parsing metadata
  ai_model TEXT,
  ai_tokens_used INTEGER,
  parsing_confidence NUMERIC(3,2),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- User email tokens for routing
CREATE TABLE user_email_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) UNIQUE,
  token TEXT NOT NULL UNIQUE,      -- Random token for email routing
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Parsed bookings (before matching to trip)
CREATE TABLE parsed_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_import_id UUID REFERENCES email_imports(id),
  user_id UUID REFERENCES users(id),

  -- Booking type and confidence
  booking_type TEXT NOT NULL CHECK (booking_type IN ('flight', 'hotel', 'car_rental', 'activity', 'restaurant', 'train', 'other')),
  confidence NUMERIC(3,2) NOT NULL,

  -- Core booking data (normalized)
  confirmation_number TEXT,
  provider TEXT,
  status TEXT DEFAULT 'confirmed',

  -- Dates for trip matching
  start_date DATE,
  end_date DATE,
  start_datetime TIMESTAMPTZ,
  end_datetime TIMESTAMPTZ,

  -- Location for trip matching
  location_name TEXT,
  location_city TEXT,
  location_country TEXT,
  coordinates GEOGRAPHY(POINT, 4326),

  -- Full parsed data
  booking_data JSONB NOT NULL,

  -- Trip association
  matched_trip_id UUID REFERENCES trips(id),
  match_confidence NUMERIC(3,2),
  match_reason TEXT,

  -- User actions
  user_confirmed BOOLEAN DEFAULT false,
  user_rejected BOOLEAN DEFAULT false,
  added_to_trip_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Known email senders (for faster parsing)
CREATE TABLE known_booking_senders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_domain TEXT NOT NULL,      -- e.g., 'united.com', 'booking.com'
  email_pattern TEXT,              -- Regex pattern for sender address
  provider_name TEXT NOT NULL,     -- e.g., 'United Airlines', 'Booking.com'
  booking_type TEXT NOT NULL,
  parsing_template TEXT,           -- Optional: specific parsing rules
  logo_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_email_imports_user ON email_imports(user_id);
CREATE INDEX idx_email_imports_status ON email_imports(status);
CREATE INDEX idx_email_imports_received ON email_imports(received_at);
CREATE INDEX idx_parsed_bookings_user ON parsed_bookings(user_id);
CREATE INDEX idx_parsed_bookings_dates ON parsed_bookings(start_date, end_date);
CREATE INDEX idx_parsed_bookings_unmatched ON parsed_bookings(user_id) WHERE matched_trip_id IS NULL;
CREATE INDEX idx_user_email_tokens_token ON user_email_tokens(token);
CREATE INDEX idx_known_senders_domain ON known_booking_senders(email_domain);

-- RLS Policies
ALTER TABLE email_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_email_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE parsed_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_booking_senders ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "email_imports_own" ON email_imports
  FOR ALL TO authenticated USING (user_id = auth.uid());

CREATE POLICY "user_tokens_own" ON user_email_tokens
  FOR ALL TO authenticated USING (user_id = auth.uid());

CREATE POLICY "parsed_bookings_own" ON parsed_bookings
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Known senders are public read
CREATE POLICY "known_senders_read" ON known_booking_senders
  FOR SELECT TO authenticated USING (is_active = true);
```

#### Seed Known Senders

```sql
INSERT INTO known_booking_senders (email_domain, provider_name, booking_type, logo_url) VALUES
  -- Airlines
  ('united.com', 'United Airlines', 'flight', NULL),
  ('delta.com', 'Delta Air Lines', 'flight', NULL),
  ('aa.com', 'American Airlines', 'flight', NULL),
  ('southwest.com', 'Southwest Airlines', 'flight', NULL),
  ('jetblue.com', 'JetBlue', 'flight', NULL),
  ('britishairways.com', 'British Airways', 'flight', NULL),
  ('lufthansa.com', 'Lufthansa', 'flight', NULL),
  ('airfrance.fr', 'Air France', 'flight', NULL),
  ('emirates.com', 'Emirates', 'flight', NULL),
  ('ryanair.com', 'Ryanair', 'flight', NULL),
  ('easyjet.com', 'easyJet', 'flight', NULL),

  -- Hotels/Accommodation
  ('booking.com', 'Booking.com', 'hotel', NULL),
  ('hotels.com', 'Hotels.com', 'hotel', NULL),
  ('expedia.com', 'Expedia', 'hotel', NULL),
  ('airbnb.com', 'Airbnb', 'hotel', NULL),
  ('marriott.com', 'Marriott', 'hotel', NULL),
  ('hilton.com', 'Hilton', 'hotel', NULL),
  ('ihg.com', 'IHG', 'hotel', NULL),
  ('hyatt.com', 'Hyatt', 'hotel', NULL),

  -- Car Rentals
  ('hertz.com', 'Hertz', 'car_rental', NULL),
  ('enterprise.com', 'Enterprise', 'car_rental', NULL),
  ('avis.com', 'Avis', 'car_rental', NULL),
  ('budget.com', 'Budget', 'car_rental', NULL),
  ('turo.com', 'Turo', 'car_rental', NULL),

  -- Activities
  ('viator.com', 'Viator', 'activity', NULL),
  ('getyourguide.com', 'GetYourGuide', 'activity', NULL),
  ('klook.com', 'Klook', 'activity', NULL),

  -- Restaurants
  ('opentable.com', 'OpenTable', 'restaurant', NULL),
  ('resy.com', 'Resy', 'restaurant', NULL),
  ('thefork.com', 'TheFork', 'restaurant', NULL),

  -- Trains
  ('amtrak.com', 'Amtrak', 'train', NULL),
  ('eurostar.com', 'Eurostar', 'train', NULL),
  ('trenitalia.com', 'Trenitalia', 'train', NULL),
  ('sncf-connect.com', 'SNCF', 'train', NULL);
```

---

### API Endpoints

#### 1. Inbound Email Webhook

**File**: `app/api/email/inbound/route.ts`

```typescript
// POST /api/email/inbound
// Webhook endpoint for SendGrid Inbound Parse

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// Use service role for webhook (no user context)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

interface SendGridInbound {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  envelope: string;
  attachments: string;
  'attachment-info': string;
}

export async function POST(req: NextRequest) {
  try {
    // SendGrid sends form data
    const formData = await req.formData();

    const toAddress = formData.get('to') as string;
    const fromAddress = formData.get('from') as string;
    const subject = formData.get('subject') as string;
    const textContent = formData.get('text') as string;
    const htmlContent = formData.get('html') as string;

    // Extract user token from to address
    // Format: plans+{token}@monkeytravel.app
    const tokenMatch = toAddress.match(/plans\+([a-zA-Z0-9]+)@/);
    if (!tokenMatch) {
      console.log('No user token in email address:', toAddress);
      return NextResponse.json({ error: 'Invalid recipient' }, { status: 400 });
    }

    const userToken = tokenMatch[1];

    // Look up user by token
    const { data: tokenData, error: tokenError } = await supabase
      .from('user_email_tokens')
      .select('user_id')
      .eq('token', userToken)
      .eq('is_active', true)
      .single();

    if (tokenError || !tokenData) {
      console.log('Invalid or inactive token:', userToken);
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const userId = tokenData.user_id;

    // Store raw email
    const { data: emailImport, error: importError } = await supabase
      .from('email_imports')
      .insert({
        user_id: userId,
        from_address: fromAddress,
        to_address: toAddress,
        subject,
        raw_content: textContent || htmlContent,
        status: 'pending'
      })
      .select()
      .single();

    if (importError) throw importError;

    // Update token last_used_at
    await supabase
      .from('user_email_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token', userToken);

    // Queue for async processing (or process inline for MVP)
    await processEmailImport(emailImport.id, userId, textContent || htmlContent, subject, fromAddress);

    return NextResponse.json({ success: true, importId: emailImport.id });

  } catch (error) {
    console.error('Email inbound webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to process email' },
      { status: 500 }
    );
  }
}

async function processEmailImport(
  importId: string,
  userId: string,
  content: string,
  subject: string,
  fromAddress: string
) {
  try {
    // Update status to processing
    await supabase
      .from('email_imports')
      .update({ status: 'processing' })
      .eq('id', importId);

    // Check if from known sender
    const fromDomain = fromAddress.split('@')[1]?.toLowerCase();
    const { data: knownSender } = await supabase
      .from('known_booking_senders')
      .select('*')
      .eq('email_domain', fromDomain)
      .eq('is_active', true)
      .single();

    // Parse with AI
    const parseResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: BOOKING_PARSER_PROMPT
        },
        {
          role: 'user',
          content: `Email Subject: ${subject}\n\nEmail Content:\n${content.slice(0, 10000)}` // Limit content
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000
    });

    const parsedContent = JSON.parse(parseResponse.choices[0].message.content || '{}');
    const tokensUsed = parseResponse.usage?.total_tokens || 0;

    // Update email import with parsed content
    await supabase
      .from('email_imports')
      .update({
        status: parsedContent.bookingType === 'unknown' ? 'failed' : 'parsed',
        parsed_content: parsedContent,
        ai_model: 'gpt-4o',
        ai_tokens_used: tokensUsed,
        parsing_confidence: parsedContent.confidence,
        error_message: parsedContent.error
      })
      .eq('id', importId);

    // If successfully parsed, create parsed_booking record
    if (parsedContent.bookingType !== 'unknown' && parsedContent.confidence >= 0.5) {
      const booking = parsedContent.booking;

      // Determine dates
      let startDate = null;
      let endDate = null;
      let startDatetime = null;
      let endDatetime = null;

      if (booking.departure?.dateTime) {
        startDatetime = booking.departure.dateTime;
        startDate = booking.departure.dateTime.split('T')[0];
      } else if (booking.checkIn) {
        startDate = booking.checkIn;
      } else if (booking.dateTime) {
        startDatetime = booking.dateTime;
        startDate = booking.dateTime.split('T')[0];
      }

      if (booking.arrival?.dateTime) {
        endDatetime = booking.arrival.dateTime;
        endDate = booking.arrival.dateTime.split('T')[0];
      } else if (booking.checkOut) {
        endDate = booking.checkOut;
      }

      // Determine location
      let locationName = null;
      let locationCity = null;

      if (booking.arrival?.location) {
        locationName = booking.arrival.location;
      } else if (booking.propertyName) {
        locationName = booking.propertyName;
      } else if (booking.activityName) {
        locationName = booking.activityName;
      }

      if (booking.location) {
        locationCity = booking.location;
      }

      const { data: parsedBooking, error: bookingError } = await supabase
        .from('parsed_bookings')
        .insert({
          email_import_id: importId,
          user_id: userId,
          booking_type: parsedContent.bookingType,
          confidence: parsedContent.confidence,
          confirmation_number: booking.confirmationNumber,
          provider: booking.provider || knownSender?.provider_name,
          status: booking.status || 'confirmed',
          start_date: startDate,
          end_date: endDate,
          start_datetime: startDatetime,
          end_datetime: endDatetime,
          location_name: locationName,
          location_city: locationCity,
          booking_data: parsedContent
        })
        .select()
        .single();

      if (bookingError) {
        console.error('Error creating parsed booking:', bookingError);
      } else {
        // Try to auto-match to a trip
        await matchBookingToTrip(parsedBooking.id, userId);
      }
    }

  } catch (error) {
    console.error('Email processing error:', error);
    await supabase
      .from('email_imports')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', importId);
  }
}

async function matchBookingToTrip(bookingId: string, userId: string) {
  const { data: booking } = await supabase
    .from('parsed_bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (!booking || !booking.start_date) return;

  // Find trips that overlap with booking dates
  const { data: trips } = await supabase
    .from('trips')
    .select('id, title, start_date, end_date, itinerary')
    .eq('user_id', userId)
    .lte('start_date', booking.end_date || booking.start_date)
    .gte('end_date', booking.start_date);

  if (!trips || trips.length === 0) return;

  // Simple matching: first trip that overlaps
  // TODO: Add smarter matching based on destination
  const matchedTrip = trips[0];

  await supabase
    .from('parsed_bookings')
    .update({
      matched_trip_id: matchedTrip.id,
      match_confidence: 0.7,
      match_reason: 'Date overlap'
    })
    .eq('id', bookingId);

  // Update email import status
  await supabase
    .from('email_imports')
    .update({
      status: 'matched',
      matched_trip_id: matchedTrip.id
    })
    .eq('id', booking.email_import_id);

  // TODO: Create notification for user
}

const BOOKING_PARSER_PROMPT = `You are a travel booking email parser...`; // Full prompt from above
```

#### 2. Get User's Email Token

**File**: `app/api/email/token/route.ts`

```typescript
// GET /api/email/token - Get or create user's email forwarding token
// POST /api/email/token/regenerate - Regenerate token

import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get existing token
    let { data: tokenData } = await supabase
      .from('user_email_tokens')
      .select('token, created_at, last_used_at')
      .eq('user_id', user.id)
      .single();

    // Create if doesn't exist
    if (!tokenData) {
      const newToken = randomBytes(8).toString('hex');
      const { data: newTokenData, error } = await supabase
        .from('user_email_tokens')
        .insert({
          user_id: user.id,
          token: newToken
        })
        .select()
        .single();

      if (error) throw error;
      tokenData = newTokenData;
    }

    const emailAddress = `plans+${tokenData.token}@monkeytravel.app`;

    return NextResponse.json({
      token: tokenData.token,
      emailAddress,
      createdAt: tokenData.created_at,
      lastUsedAt: tokenData.last_used_at,
      instructions: [
        'Forward any booking confirmation emails to your personal MonkeyTravel address above.',
        'We support flights, hotels, car rentals, activities, and restaurant reservations.',
        'Your booking will be automatically parsed and matched to your trips.'
      ]
    });

  } catch (error) {
    console.error('Email token error:', error);
    return NextResponse.json(
      { error: 'Failed to get email token' },
      { status: 500 }
    );
  }
}
```

#### 3. Get Parsed Bookings

**File**: `app/api/bookings/parsed/route.ts`

```typescript
// GET /api/bookings/parsed - Get user's parsed bookings
// Can filter by matched/unmatched

import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status'); // 'matched', 'unmatched', 'all'
    const tripId = searchParams.get('tripId');

    let query = supabase
      .from('parsed_bookings')
      .select(`
        *,
        trips:matched_trip_id(id, title, start_date, end_date)
      `)
      .eq('user_id', user.id)
      .eq('user_rejected', false)
      .order('created_at', { ascending: false });

    if (status === 'matched') {
      query = query.not('matched_trip_id', 'is', null);
    } else if (status === 'unmatched') {
      query = query.is('matched_trip_id', null);
    }

    if (tripId) {
      query = query.eq('matched_trip_id', tripId);
    }

    const { data: bookings, error } = await query;

    if (error) throw error;

    return NextResponse.json({ bookings });

  } catch (error) {
    console.error('Get parsed bookings error:', error);
    return NextResponse.json(
      { error: 'Failed to get bookings' },
      { status: 500 }
    );
  }
}
```

---

### UI Components

#### 1. Email Forwarding Setup Component

**File**: `components/settings/EmailForwardingSetup.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Mail, Copy, Check, RefreshCw, Info } from 'lucide-react';

interface EmailToken {
  token: string;
  emailAddress: string;
  createdAt: string;
  lastUsedAt: string | null;
  instructions: string[];
}

export default function EmailForwardingSetup() {
  const [tokenData, setTokenData] = useState<EmailToken | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchToken();
  }, []);

  const fetchToken = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/email/token');
      const data = await response.json();
      setTokenData(data);
    } catch (error) {
      console.error('Failed to fetch email token:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!tokenData) return;
    await navigator.clipboard.writeText(tokenData.emailAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="animate-pulse bg-slate-100 rounded-2xl h-48" />
    );
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-blue-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Auto-Import Bookings</h3>
            <p className="text-sm text-slate-500">Forward confirmation emails to add bookings automatically</p>
          </div>
        </div>
      </div>

      {/* Email Address */}
      <div className="p-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Your personal forwarding address
        </label>
        <div className="flex gap-2">
          <div className="flex-1 bg-white rounded-xl border border-blue-200 px-4 py-3 font-mono text-sm text-slate-700 truncate">
            {tokenData?.emailAddress}
          </div>
          <button
            onClick={copyToClipboard}
            className="px-4 py-3 bg-white rounded-xl border border-blue-200 hover:bg-blue-50 transition-colors"
          >
            {copied ? (
              <Check className="w-5 h-5 text-green-500" />
            ) : (
              <Copy className="w-5 h-5 text-slate-500" />
            )}
          </button>
        </div>

        {tokenData?.lastUsedAt && (
          <p className="mt-2 text-xs text-slate-500">
            Last used: {new Date(tokenData.lastUsedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Instructions */}
      <div className="px-6 pb-6">
        <div className="bg-white/50 rounded-xl p-4">
          <div className="flex items-start gap-2 mb-3">
            <Info className="w-4 h-4 text-blue-500 mt-0.5" />
            <span className="text-sm font-medium text-slate-700">How it works</span>
          </div>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center shrink-0">1</span>
              <span>Forward any booking confirmation email to the address above</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center shrink-0">2</span>
              <span>We extract flight, hotel, and activity details automatically</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center shrink-0">3</span>
              <span>Bookings are matched to your trips and added to your itinerary</span>
            </li>
          </ol>
        </div>
      </div>

      {/* Supported Providers */}
      <div className="px-6 pb-6">
        <p className="text-xs text-slate-500 mb-2">Supported providers</p>
        <div className="flex flex-wrap gap-2">
          {['Airlines', 'Hotels', 'Airbnb', 'Car Rentals', 'Activities', 'Restaurants'].map((provider) => (
            <span
              key={provider}
              className="px-2 py-1 bg-white rounded-lg text-xs text-slate-600 border border-slate-200"
            >
              {provider}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

#### 2. Pending Bookings Component

**File**: `components/bookings/PendingBookings.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Plane, Hotel, Car, Ticket, UtensilsCrossed, Train, Check, X, ChevronRight } from 'lucide-react';

interface ParsedBooking {
  id: string;
  booking_type: string;
  confidence: number;
  confirmation_number: string;
  provider: string;
  start_date: string;
  end_date: string;
  location_name: string;
  booking_data: {
    booking: Record<string, unknown>;
  };
  matched_trip_id: string | null;
  trips?: {
    id: string;
    title: string;
    start_date: string;
    end_date: string;
  };
}

const bookingTypeIcons: Record<string, React.ElementType> = {
  flight: Plane,
  hotel: Hotel,
  car_rental: Car,
  activity: Ticket,
  restaurant: UtensilsCrossed,
  train: Train
};

const bookingTypeColors: Record<string, string> = {
  flight: 'bg-blue-100 text-blue-600',
  hotel: 'bg-purple-100 text-purple-600',
  car_rental: 'bg-orange-100 text-orange-600',
  activity: 'bg-green-100 text-green-600',
  restaurant: 'bg-rose-100 text-rose-600',
  train: 'bg-amber-100 text-amber-600'
};

export default function PendingBookings() {
  const [bookings, setBookings] = useState<ParsedBooking[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    try {
      const response = await fetch('/api/bookings/parsed?status=unmatched');
      const data = await response.json();
      setBookings(data.bookings || []);
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async (bookingId: string, tripId: string) => {
    // TODO: Implement confirm and add to trip
    console.log('Confirm booking', bookingId, 'to trip', tripId);
  };

  const handleReject = async (bookingId: string) => {
    // TODO: Implement reject
    console.log('Reject booking', bookingId);
  };

  if (isLoading) {
    return <div className="animate-pulse bg-slate-100 rounded-xl h-32" />;
  }

  if (bookings.length === 0) {
    return null; // Don't show if no pending bookings
  }

  return (
    <div className="bg-amber-50 rounded-2xl border border-amber-200 overflow-hidden">
      <div className="p-4 border-b border-amber-200 bg-amber-100/50">
        <h3 className="font-semibold text-amber-900">
          Pending Bookings ({bookings.length})
        </h3>
        <p className="text-sm text-amber-700">
          Review and add imported bookings to your trips
        </p>
      </div>

      <div className="divide-y divide-amber-100">
        {bookings.map((booking) => {
          const Icon = bookingTypeIcons[booking.booking_type] || Ticket;
          const colorClass = bookingTypeColors[booking.booking_type] || 'bg-slate-100 text-slate-600';

          return (
            <div key={booking.id} className="p-4 hover:bg-amber-50/50 transition-colors">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl ${colorClass} flex items-center justify-center shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 truncate">
                      {booking.provider}
                    </span>
                    {booking.confirmation_number && (
                      <span className="text-xs text-slate-500">
                        #{booking.confirmation_number}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-slate-600 truncate">
                    {booking.location_name}
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    {booking.start_date && new Date(booking.start_date).toLocaleDateString()}
                    {booking.end_date && booking.end_date !== booking.start_date && (
                      <> - {new Date(booking.end_date).toLocaleDateString()}</>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleReject(booking.id)}
                    className="p-2 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                    title="Ignore"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleConfirm(booking.id, '')}
                    className="p-2 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 transition-colors"
                    title="Add to trip"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

<a name="email-parsing-implementation-phases"></a>
### Implementation Phases

#### Phase 1: Foundation (2-3 weeks)

**Tasks**:
1. [ ] Set up SendGrid Inbound Parse with DNS
2. [ ] Apply database migrations for email parsing tables
3. [ ] Create `/api/email/inbound` webhook endpoint
4. [ ] Create `/api/email/token` endpoint
5. [ ] Implement basic GPT-4o parsing
6. [ ] Create `EmailForwardingSetup` component

**DNS Configuration**:
```
MX record: monkeytravel.app → mx.sendgrid.net
```

**Environment Variables**:
```bash
# .env.local additions
SENDGRID_API_KEY=your_sendgrid_key
SENDGRID_INBOUND_KEY=your_webhook_secret
OPENAI_API_KEY=your_openai_key  # Already have this
```

#### Phase 2: Parsing Accuracy (2 weeks)

**Tasks**:
1. [ ] Test with real booking emails from major providers
2. [ ] Refine GPT-4o parsing prompt
3. [ ] Add provider-specific parsing templates
4. [ ] Implement confidence scoring
5. [ ] Create test suite with sample emails

#### Phase 3: Trip Integration (2 weeks)

**Tasks**:
1. [ ] Implement trip matching algorithm
2. [ ] Create `PendingBookings` component
3. [ ] Add booking review/confirm flow
4. [ ] Convert parsed booking to itinerary activity
5. [ ] Add notification when booking is parsed

#### Phase 4: Polish & Scale (ongoing)

**Tasks**:
1. [ ] Add Gmail auto-forwarding instructions
2. [ ] Implement attachment parsing (PDF tickets)
3. [ ] Add multi-language support
4. [ ] Rate limiting and abuse prevention
5. [ ] Analytics dashboard for parsing success rates

---

## Combined Roadmap Timeline

```
2024 Q1                    2024 Q2                    2024 Q3
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│                         │                         │                         │
│  AFFILIATE PHASE 1-2    │  EMAIL PARSING 1-2      │  OPTIMIZATION           │
│  ├─ DB Migrations       │  ├─ SendGrid Setup      │  ├─ A/B Testing         │
│  ├─ Partner Signups     │  ├─ Webhook Endpoint    │  ├─ Conversion Track    │
│  ├─ Link Generation     │  ├─ AI Parsing          │  ├─ Deep Linking        │
│  ├─ Click Tracking      │  ├─ Trip Matching       │  ├─ Price Compare       │
│  └─ UI Integration      │  └─ UI Components       │  └─ Analytics           │
│                         │                         │                         │
│  ═══════════════════════════════════════════════════════════════════════  │
│  Target Revenue:        │  Target Users:          │  Target Revenue:        │
│  $500/mo (soft launch)  │  1,000 email imports    │  $5,000+/mo             │
│                         │                         │                         │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

---

## Success Metrics

### Affiliate Booking

| Metric | Phase 1 Target | Phase 2 Target | Scale Target |
|--------|----------------|----------------|--------------|
| Click-through Rate | 5% | 8% | 12% |
| Conversion Rate | 1% | 2% | 3% |
| Avg Commission | $8 | $10 | $12 |
| Monthly Revenue | $500 | $2,000 | $10,000+ |

### Email Parsing

| Metric | Phase 1 Target | Phase 2 Target | Scale Target |
|--------|----------------|----------------|--------------|
| Parse Success Rate | 70% | 85% | 95% |
| Auto-Match Rate | 50% | 70% | 80% |
| User Confirmation Rate | 60% | 75% | 85% |
| Monthly Imports | 100 | 500 | 5,000 |

---

## Risk Mitigation

### Affiliate Risks

| Risk | Mitigation |
|------|------------|
| Low conversion rates | A/B test button placement, partner selection |
| Partner API changes | Abstract partner logic, monitor for changes |
| Commission tracking issues | Implement server-side tracking, regular reconciliation |
| User trust concerns | Clear disclosure ("We may earn a commission") |

### Email Parsing Risks

| Risk | Mitigation |
|------|------------|
| AI parsing errors | Confidence scoring, user review step |
| Email provider blocking | Multiple sending addresses, SPF/DKIM setup |
| Privacy concerns | Clear data usage policy, optional feature |
| Abuse/spam | Rate limiting, email verification |
| High AI costs | Caching, batch processing, cheaper models for simple cases |

---

## Appendix: Partner Application Links

### Affiliate Programs

- **Viator**: https://www.viator.com/affiliates
- **GetYourGuide**: https://partner.getyourguide.com/
- **Booking.com**: https://www.booking.com/affiliate-program.html
- **Klook**: https://affiliate.klook.com/
- **TheFork**: https://www.thefork.com/affiliate

### Email Services

- **SendGrid Inbound Parse**: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
- **Mailgun Routes**: https://documentation.mailgun.com/en/latest/api-routes.html
- **Postmark Inbound**: https://postmarkapp.com/developer/webhooks/inbound-webhook

---

*Document maintained by MonkeyTravel Engineering Team*
