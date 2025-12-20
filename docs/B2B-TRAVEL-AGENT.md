# B2B Corporate Travel Agent - Technical Specification

> AI-powered travel planning for enterprise teams via Slack and Microsoft Teams

## Executive Summary

Build a parallel B2B product leveraging MonkeyTravel's AI trip generation capabilities for corporate travel management. The system enables employees to plan, book, and manage business trips through conversational interfaces in Slack/Teams, with built-in approval workflows and policy compliance.

**Key Differentiator:** AI-native, conversational-first experience vs. legacy enterprise tools (Concur, SAP Concur, Navan/TripActions)

---

## Table of Contents

1. [Market Analysis](#market-analysis) - Consumer vs Enterprise, Competitive Landscape
2. [Business Strategy](#business-strategy) - **NEW: Comprehensive Business Analysis**
   - Market Opportunity (TAM/SAM/SOM)
   - Competitive Deep Dive (SWOT, Feature Matrix)
   - Buyer Personas (CFO, Travel Manager, Road Warrior)
   - Go-to-Market Strategy (Hybrid PLG + PLS)
   - Marketing Strategy (SEO, Paid, Slack Directory)
   - Sales Strategy (Segmentation, Process)
   - Growth Framework (AARRR, Viral Loops)
   - Unit Economics (CAC, LTV, Payback)
   - Pricing Strategy
3. [Architecture Overview](#architecture-overview) - System Diagram
4. [Gemini Function Calling](#gemini-function-calling-implementation) - Tool Declarations, Modes
5. [Amadeus API Integration](#amadeus-api-integration) - 9-Step Booking Flow
6. [n8n Workflow Orchestration](#n8n-workflow-orchestration) - Approval, Reminders, Expense Sync
7. [Database Schema](#database-schema) - Organizations, Users, Trips, Bookings
8. [Slack App Implementation](#slack-app-implementation) - Manifest, Event Handlers
9. [Cost Analysis](#cost-analysis) - Infrastructure, Revenue Model
10. [Implementation Phases](#implementation-phases) - Phase 0-3 Roadmap
11. [Risks & Mitigations](#risks--mitigations)
12. [Open Questions](#open-questions)
13. [Appendix: API Reference Links](#appendix-api-reference-links)

---

## Market Analysis

### Consumer vs Enterprise Travel

| Aspect | Consumer (Current) | Enterprise (B2B) |
|--------|-------------------|------------------|
| Decision Maker | Individual | Manager/Finance/Traveler |
| Goal | Inspiration + Planning | Efficiency + Compliance |
| Booking | "I'll figure it out" | Must actually book |
| Budget | Flexible | Policy-constrained |
| Approval | None | Multi-level workflows |
| Interface | Web/Mobile app | Slack/Teams native |
| Payment | Personal card | Corporate card/invoicing |
| Reporting | None | Expense reconciliation |

### Competitive Landscape

| Competitor | Positioning | Weakness |
|------------|------------|----------|
| **Navan (TripActions)** | Full-service, VC-backed | Complex, expensive |
| **TravelPerk** | European focus, modern UX | Limited US coverage |
| **SAP Concur** | Enterprise incumbent | Legacy UX, slow |
| **Ramp Travel** | Spend management first | Travel as add-on |
| **Spotnana** | API-first, B2B2B | No direct consumer brand |

**Our Positioning:** AI-native + conversational-first for modern distributed teams (50-500 employees)

---

## Business Strategy

### Market Opportunity

#### Total Addressable Market (TAM)

| Segment | 2024 Value | CAGR | 2030 Projection |
|---------|------------|------|-----------------|
| **Global Business Travel** | $1.1-1.5 Trillion | 6-8% | $1.8+ Trillion |
| **US Business Travel** | $259 Billion | 9.8% | $659 Billion (2034) |
| **Travel Management Software** | $1.09 Billion | 7.6% | $1.55 Billion (2029) |
| **Travel Management Services** | $8.5 Billion | 4.7% | $12.9 Billion (2033) |

*Sources: [Custom Market Insights](https://www.custommarketinsights.com/report/corporate-travel-market/), [Expert Market Research](https://www.expertmarketresearch.com/reports/united-states-business-travel-market), [Business Research Insights](https://www.businessresearchinsights.com/market-reports/business-travel-management-service-market-105102)*

#### Serviceable Addressable Market (SAM)

**Target: US SMBs (50-500 employees) using Slack/Teams**

| Metric | Estimate |
|--------|----------|
| US companies 50-500 employees | ~120,000 |
| % using Slack or Teams | ~70% |
| Avg annual travel spend | $50,000-500,000 |
| **SAM (Management fees @ 5%)** | **$200M-2B** |

#### Serviceable Obtainable Market (SOM) - Year 1

| Scenario | Companies | Avg ACV | ARR |
|----------|-----------|---------|-----|
| Conservative | 50 | $5,000 | $250K |
| Moderate | 150 | $8,000 | $1.2M |
| Aggressive | 300 | $12,000 | $3.6M |

---

### Competitive Deep Dive

#### SWOT Analysis

**STRENGTHS**
- AI-native architecture (not bolted on)
- Conversational-first UX (Slack/Teams native)
- Modern tech stack (Next.js, Supabase, Gemini)
- No legacy code or technical debt
- Lean cost structure (~$90/mo infrastructure)
- Existing consumer AI trip generation IP

**WEAKNESSES**
- No booking infrastructure (need consolidator)
- No airline/hotel contracts (worse rates initially)
- No brand recognition in enterprise
- Small team (if applicable)
- No SOC 2/compliance certifications yet

**OPPORTUNITIES**
- Post-COVID travel surge (pent-up demand)
- Legacy tools (Concur) losing market share
- AI differentiation window (12-18 months)
- Slack/Teams marketplace distribution
- Remote-first companies need modern tools
- 55% of travel managers cite compliance as #1 priority

**THREATS**
- Navan/TravelPerk have $1B+ war chests
- Microsoft Copilot entering travel space
- Amadeus/Sabre building direct B2B tools
- Enterprise sales cycles long (6-18 months)
- Recession could freeze travel budgets

#### Competitor Feature Matrix

| Feature | MonkeyTravel | Navan | TravelPerk | SAP Concur |
|---------|-------------|-------|------------|------------|
| **AI Chat Booking** | ✅ Native | ⚠️ Basic | ❌ None | ❌ None |
| **Slack/Teams App** | ✅ Primary | ⚠️ Add-on | ⚠️ Basic | ❌ None |
| **Policy Engine** | ✅ JSONB | ✅ Full | ✅ Full | ✅ Full |
| **LCC Support** | ⚠️ Limited | ✅ Yes | ✅ Yes | ⚠️ Limited |
| **Expense Integration** | ⚠️ Phase 2 | ✅ Native | ⚠️ Partners | ✅ Native |
| **SSO/SCIM** | ⚠️ Phase 3 | ✅ Yes | ✅ Yes | ✅ Yes |
| **Setup Time** | <1 day | 2-4 weeks | 1-2 weeks | 4-8 weeks |
| **Pricing Transparency** | ✅ Public | ⚠️ Quote | ✅ Public | ❌ Quote |
| **SMB Focus** | ✅ Primary | ⚠️ Secondary | ✅ Primary | ❌ Enterprise |

#### Competitor Pricing Intelligence

| Competitor | SMB Pricing | Enterprise | Model |
|------------|-------------|------------|-------|
| **Navan** | Free (15 users), then $15/user/mo | Custom quote | Freemium + booking fees |
| **TravelPerk** | $99/mo base + $5/booking | Custom | Base + transaction |
| **SAP Concur** | Not disclosed (expensive) | $20-50/user/mo + fees | Enterprise only |
| **Ramp Travel** | Included with Ramp card | Included | Card revenue model |

*Sources: [G2 Navan Pricing](https://www.g2.com/products/navan-formerly-tripactions/pricing), [TravelPerk vs Navan](https://www.travelperk.com/blog/navan-vs-concur/)*

---

### Buyer Personas

#### Persona 1: The CFO (Economic Buyer)

| Attribute | Profile |
|-----------|---------|
| **Title** | CFO, VP Finance, Controller |
| **Company Size** | 50-500 employees |
| **Industry** | Tech, Professional Services, Consulting |
| **Travel Spend** | $100K-1M/year |

**Pain Points (Ranked by Severity):**

1. **Lack of Visibility** (Critical)
   - Cannot see real-time travel spend
   - Surprised by end-of-quarter expense reports
   - No forecasting capability

2. **Policy Non-Compliance** (High)
   - 55% cite compliance as #1 cost control factor
   - Forced into "bad cop" role micromanaging expenses
   - Employees booking outside approved channels

3. **Expense Reconciliation** (High)
   - Manual processes, multiple payment methods
   - Errors and delays in month-end close
   - Integration gaps with accounting systems

4. **Rising Travel Costs** (Medium)
   - Airfare and hotel inflation
   - Last-minute bookings premium
   - No negotiated rates

*Sources: [iTilite CFO Pain Points](https://www.itilite.com/blog/pain-points-for-cfo/), [Adelman Travel CFO Checklist](https://www.adelmantravel.com/blogs/blog/corporate-travel-program-checklists-what-every-cfo-should-ask/)*

**Decision Criteria:**
- ROI within 6-12 months
- Demonstrable cost savings (10-20%)
- Integration with existing finance stack
- Security and compliance certifications

**Messaging:**
> "See every travel dollar in real-time. AI-enforced policy compliance. Zero micromanagement."

---

#### Persona 2: The Travel Manager (Champion/Influencer)

| Attribute | Profile |
|-----------|---------|
| **Title** | Travel Manager, Office Manager, EA to CEO |
| **Reports To** | CFO or COO |
| **Hat Wearing** | Often part-time travel + other duties |

**Pain Points:**

1. **Decentralized Booking**
   - Employees book on personal cards
   - Multiple booking tools (Expedia, Google Flights, direct)
   - No single source of truth

2. **Approval Bottlenecks**
   - Email chains for approvals
   - Managers slow to respond
   - Trips delayed or missed

3. **Traveler Complaints**
   - Rigid policies frustrate employees
   - Poor UX of legacy tools
   - No mobile-first experience

4. **Duty of Care**
   - Cannot locate travelers in emergencies
   - No real-time flight status
   - Compliance with safety policies

**Decision Criteria:**
- Easy implementation (< 1 week)
- High adoption rate from travelers
- Reduces their workload (automation)
- Good vendor support

**Messaging:**
> "Your travel program on autopilot. AI handles policy, approvals, and reminders. You focus on exceptions."

---

#### Persona 3: The Road Warrior (End User)

| Attribute | Profile |
|-----------|---------|
| **Title** | Account Executive, Consultant, Engineer |
| **Travel Frequency** | 2-10 trips/month |
| **Booking Behavior** | Wants fastest path to confirmed trip |

**Pain Points:**

1. **Friction in Booking**
   - Multiple systems to navigate
   - Unclear what's "in policy"
   - Slow approval process

2. **Poor Mobile Experience**
   - Can't book from phone easily
   - No real-time updates
   - Receipts scattered

3. **Personal Preferences Ignored**
   - Seat preference not saved
   - Frequent flyer numbers lost
   - Dietary restrictions forgotten

**Messaging:**
> "Tell the AI where you need to go. It handles the rest. Book in 60 seconds from Slack."

---

### Go-to-Market Strategy

#### Hybrid PLG + PLS Model

Based on research, **65% of SaaS buyers prefer both product-led AND sales-led experiences**. Pure PLG rarely works for B2B travel where deals involve multiple stakeholders.

*Source: [McKinsey PLG Research](https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/from-product-led-growth-to-product-led-sales-beyond-the-plg-hype)*

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     HYBRID GTM FUNNEL                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                │
│  │  AWARENESS  │────▶│   PRODUCT   │────▶│    SALES    │                │
│  │             │     │   TRIAL     │     │  ASSISTED   │                │
│  └─────────────┘     └─────────────┘     └─────────────┘                │
│       │                    │                   │                         │
│       ▼                    ▼                   ▼                         │
│  • SEO/Content        • Free Slack app    • Demo for teams >20         │
│  • Slack directory    • Self-serve        • Custom policy setup        │
│  • LinkedIn ads         onboarding        • Consolidator intro         │
│  • Referrals          • 14-day trial      • Annual contract            │
│  • Marketplace          of premium        • Implementation support     │
│                                                                          │
│  ──────────────────────────────────────────────────────────────────────│
│                                                                          │
│  SMB (1-50 travelers)          │     Mid-Market (50-200 travelers)     │
│  ─────────────────────────────│─────────────────────────────────────── │
│  • Pure PLG                    │     • PLG + Sales Touch               │
│  • Self-serve                  │     • Demo + onboarding call          │
│  • $15/user/mo                 │     • $25/user/mo                     │
│  • Monthly billing             │     • Annual contract preferred       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Channel Strategy

| Channel | Priority | CAC Estimate | Notes |
|---------|----------|--------------|-------|
| **Slack App Directory** | 🔴 High | Low ($50-100) | Viral distribution, high intent |
| **LinkedIn Ads** | 🔴 High | Medium ($200-400) | Target travel managers, CFOs |
| **SEO/Content** | 🟡 Medium | Low ($100-200) | Long-term, compounding |
| **Referral Program** | 🟡 Medium | Very Low ($20-50) | 30%+ of signups for Slack |
| **Partnerships** | 🟡 Medium | Medium | Accountants, HR tools, Ramp |
| **Cold Outbound** | 🟢 Later | High ($500-1000) | For enterprise only |

*Source: [Slack Growth Study](https://growthhackers.com/growth-studies/slack/)*

---

### Marketing Strategy

#### SEO Strategy

**Primary Keywords (High Intent):**

| Keyword | Monthly Volume | Difficulty | Priority |
|---------|---------------|------------|----------|
| "corporate travel management software" | 2,400 | High | 🔴 |
| "business travel booking tool" | 1,200 | Medium | 🔴 |
| "slack travel booking" | 320 | Low | 🔴 |
| "AI travel assistant business" | 480 | Low | 🔴 |
| "navan alternative" | 720 | Medium | 🟡 |
| "concur alternative" | 1,900 | High | 🟡 |

**Content Pillars:**

1. **Comparison Content** (Bottom Funnel)
   - "Navan vs TravelPerk vs MonkeyTravel"
   - "Best Concur Alternatives 2025"
   - "Corporate Travel Software Comparison"

2. **Problem-Aware Content** (Middle Funnel)
   - "How to Improve Travel Policy Compliance"
   - "Corporate Travel Expense Management Guide"
   - "Building a Travel Policy Template"

3. **Thought Leadership** (Top Funnel)
   - "Future of AI in Business Travel"
   - "Remote Work and Travel Management"
   - "CFO Guide to Travel Cost Optimization"

#### Paid Acquisition

**LinkedIn Ads (Primary Paid Channel):**

| Audience | Targeting | Ad Type |
|----------|-----------|---------|
| CFOs at 50-500 employee companies | Job title + company size | Sponsored Content |
| Travel Managers | Job title OR "travel" in bio | Carousel (feature demo) |
| HR/People Ops | Job function + Slack users | Lead Gen Form |

**Retargeting Funnel:**
1. Website visitors → Demo video ad
2. Pricing page visitors → Case study ad
3. Free trial signups → Feature tutorial ad

#### Slack App Directory Optimization

**Listing Optimization:**
- Title: "MonkeyTravel - AI Travel Booking & Expense"
- Keywords: travel, booking, expense, AI, trips, flights
- Screenshots: Chat booking flow, approval workflow, expense sync
- Reviews strategy: Request reviews at booking completion

**Marketplace Growth Tactics:**
- Launch on Product Hunt for Slack users
- Partner with Slack solution providers
- Featured placement negotiation

---

### Sales Strategy

#### Deal Size Segmentation

| Segment | ACV Range | Sales Cycle | Motion |
|---------|-----------|-------------|--------|
| **Self-Serve** | <$2K | 14 days | PLG only |
| **SMB** | $2K-10K | 30 days | PLG + light touch |
| **Mid-Market** | $10K-50K | 60-90 days | AE-led |
| **Enterprise** | $50K+ | 6-18 months | Enterprise sales |

*Sources: [SaaStr Sales Cycle Benchmarks](https://www.saastr.com/dear-saastr-whats-a-good-benchmark-for-b2b-sales-cycles/), [SaaSCan Benchmarks](https://saascan.ca/b2b-saas-metric-benchmarks-2024/)*

#### Sales Cycle by ACV (Industry Benchmarks)

| ACV | Expected Close Time |
|-----|---------------------|
| <$2K | <14 days |
| $2K-5K | 30 days |
| $5K-25K | 60-90 days |
| $25K-100K | 90-180 days |
| >$100K | 6-18 months |

#### Sales Process (Mid-Market)

```
Day 0: Inbound (Slack install or demo request)
     │
Day 1-3: Discovery Call (30 min)
     │   - Current travel spend & tools
     │   - Pain points (compliance, visibility)
     │   - Decision makers identified
     │
Day 7: Demo (45 min)
     │   - Slack booking flow
     │   - Policy engine walkthrough
     │   - Approval workflow demo
     │
Day 14: Trial Start
     │   - Free 14-day trial
     │   - Onboarding call with team
     │   - 3 test bookings goal
     │
Day 21: Business Case Meeting
     │   - ROI analysis (savings vs current)
     │   - CFO/finance stakeholder intro
     │   - Security questionnaire
     │
Day 28-45: Procurement
     │   - Contract negotiation
     │   - Legal review
     │   - Annual vs monthly
     │
Day 45-60: Close & Implementation
       - Consolidator setup
       - Policy migration
       - Team training
```

---

### Growth Framework (AARRR)

#### Metrics & Benchmarks

| Stage | Metric | Target | How to Improve |
|-------|--------|--------|----------------|
| **Acquisition** | Slack installs/month | 100+ | App directory SEO, LinkedIn ads |
| **Activation** | First booking within 7 days | 60%+ | Onboarding flow, Slack tutorial |
| **Retention** | Monthly active teams | 90%+ | Booking reminders, new features |
| **Referral** | Teams that invite others | 20%+ | Referral rewards, viral features |
| **Revenue** | Trial → Paid conversion | 15%+ | Demo follow-up, value proof |

#### North Star Metric

> **Trips Booked per Active Team per Month**

This metric captures:
- Value delivered (actual bookings, not just logins)
- Stickiness (teams that book regularly)
- Revenue proxy (more trips = more fees)

**Input Metrics:**
```
Trips Booked = f(
  Active Teams ×
  Avg Travelers per Team ×
  Trips per Traveler ×
  Booking Completion Rate
)
```

#### Viral Loops

**Loop 1: Approval-Based Virality**
```
Traveler books → Manager approves in Slack → Manager sees value →
Manager tells other teams → New team installs
```

**Loop 2: Cross-Company Virality**
```
Employee changes companies → Requests MonkeyTravel at new job →
New company evaluates → New customer
```

**Loop 3: Referral Program**
| Referrer Reward | Referee Reward | Trigger |
|-----------------|----------------|---------|
| $100 credit | 1 month free | New team reaches 5 bookings |

---

### Unit Economics

#### Customer Acquisition Cost (CAC)

| Channel | Spend | Customers | CAC |
|---------|-------|-----------|-----|
| Slack Directory | $0 | 30 | $0 |
| LinkedIn Ads | $5,000 | 15 | $333 |
| Content/SEO | $2,000 | 10 | $200 |
| Referrals | $500 | 10 | $50 |
| **Blended** | **$7,500** | **65** | **$115** |

#### Lifetime Value (LTV)

| Plan | ARPU/Mo | Gross Margin | Churn | LTV |
|------|---------|--------------|-------|-----|
| Starter | $300 | 90% | 5%/mo | $5,400 |
| Business | $1,250 | 90% | 3%/mo | $37,500 |
| Enterprise | $5,000 | 85% | 1%/mo | $425,000 |

**LTV:CAC Ratios:**
- Starter: 5,400 / 115 = **47:1** ✅
- Business: 37,500 / 333 = **113:1** ✅
- Target benchmark: **3:1 minimum**, **5:1 ideal**

#### Payback Period

| Plan | Monthly Revenue | CAC | Payback |
|------|-----------------|-----|---------|
| Starter | $300 × 90% = $270 | $115 | **0.4 months** |
| Business | $1,250 × 90% = $1,125 | $333 | **0.3 months** |

**Target:** <12 months payback (we're well under)

---

### Pricing Strategy

#### Recommended Pricing Model

**Hybrid: Per-User + Transaction Fee**

| Component | Price | Rationale |
|-----------|-------|-----------|
| **Platform Fee** | $0 (freemium base) | Remove friction, match Navan |
| **Per Active Traveler** | $15/mo (after first 10 free) | Scales with value |
| **Booking Fee** | $5-15/booking | Aligns incentives with usage |
| **Premium Add-ons** | $200-500/mo | Policy engine, SSO, support |

**Pricing Tiers:**

| Tier | Users | Platform | Per-User | Booking Fee | Total (50 trips/mo) |
|------|-------|----------|----------|-------------|---------------------|
| **Free** | 1-10 | $0 | $0 | $10 | $500/mo |
| **Business** | 11-50 | $0 | $15 | $8 | $600 + $400 = $1,000/mo |
| **Enterprise** | 50+ | Custom | Custom | $5 | Custom |

#### Competitive Positioning

```
                    SIMPLE                                         COMPLEX
                       │                                              │
    ┌──────────────────┼──────────────────────────────────────────────┤
    │                  │                                              │
    │   MonkeyTravel   │      TravelPerk          Navan              │
    │   ●              │          ●                  ●               │
    │                  │                                     Concur   │
    │                  │                                       ●     │
 LOW│                  │                                              │HIGH
COST│                  │                                              │COST
    │                  │                                              │
    └──────────────────┴──────────────────────────────────────────────┘

    POSITIONING: Simpler than Navan, more powerful than spreadsheets
```

---

### Key Success Metrics (First 12 Months)

| Metric | Month 3 | Month 6 | Month 12 |
|--------|---------|---------|----------|
| **Slack Installs** | 100 | 400 | 1,500 |
| **Active Teams** | 20 | 80 | 300 |
| **Trips Booked** | 200 | 1,500 | 8,000 |
| **ARR** | $15K | $80K | $400K |
| **NRR (Net Revenue Retention)** | N/A | 105% | 115% |
| **Logo Churn** | <10% | <8% | <5% |

---

## Architecture Overview

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACES                                    │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│   Slack App     │   Teams App     │   Web Dashboard │   Mobile (Future)     │
│   - Chat with   │   - Chat with   │   - Admin panel │                       │
│     AI agent    │     AI agent    │   - Reporting   │                       │
│   - Approvals   │   - Approvals   │   - Policies    │                       │
│   - Bookings    │   - Bookings    │   - User mgmt   │                       │
└────────┬────────┴────────┬────────┴────────┬────────┴───────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GEMINI AI AGENT LAYER                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Gemini 2.0 Flash (Conversational Core)                              │   │
│  │  - Function calling (search_flights, create_booking, etc.)          │   │
│  │  - Multi-turn conversation state                                     │   │
│  │  - Policy awareness (injected context)                               │   │
│  │  - Parallel tool calls for multi-source data                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        n8n WORKFLOW ORCHESTRATION                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │ Approval    │  │ Check-in    │  │ Expense     │  │ Policy          │    │
│  │ Workflows   │  │ Reminders   │  │ Sync        │  │ Enforcement     │    │
│  │             │  │ (Scheduled) │  │ (Webhooks)  │  │ (Pre-booking)   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘    │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│   Amadeus API   │   Supabase      │   Stripe        │   Integrations        │
│   - Flights     │   - Users/Orgs  │   - Payments    │   - Expensify         │
│   - Hotels      │   - Bookings    │   - Invoicing   │   - Ramp              │
│   - Cars        │   - Policies    │   - Subscriptions│  - QuickBooks        │
│   - Check-in    │   - Approvals   │                 │   - Okta/WorkOS       │
│     links       │   - Analytics   │                 │                       │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘
```

---

## Gemini Function Calling Implementation

### Tool Declarations

```typescript
// tools/travel-functions.ts

export const travelTools = [
  {
    name: "search_flights",
    description: "Search available flights between two airports on specific dates",
    parameters: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Origin airport IATA code (e.g., SFO, JFK, LHR)"
        },
        destination: {
          type: "string",
          description: "Destination airport IATA code"
        },
        departure_date: {
          type: "string",
          description: "Departure date in YYYY-MM-DD format"
        },
        return_date: {
          type: "string",
          description: "Return date in YYYY-MM-DD format (optional for one-way)"
        },
        cabin_class: {
          type: "string",
          enum: ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"],
          description: "Cabin class preference"
        },
        max_price: {
          type: "number",
          description: "Maximum price in USD (from company policy)"
        },
        direct_only: {
          type: "boolean",
          description: "Only show direct flights"
        }
      },
      required: ["origin", "destination", "departure_date"]
    }
  },
  {
    name: "check_policy_compliance",
    description: "Verify if a travel option complies with company policy",
    parameters: {
      type: "object",
      properties: {
        organization_id: { type: "string" },
        trip_type: {
          type: "string",
          enum: ["domestic", "international"]
        },
        total_cost: { type: "number" },
        cabin_class: { type: "string" },
        advance_days: { type: "integer" }
      },
      required: ["organization_id", "trip_type", "total_cost"]
    }
  },
  {
    name: "create_trip_request",
    description: "Create a new trip request for approval",
    parameters: {
      type: "object",
      properties: {
        traveler_id: { type: "string" },
        organization_id: { type: "string" },
        destination: { type: "string" },
        purpose: { type: "string" },
        departure_date: { type: "string" },
        return_date: { type: "string" },
        estimated_cost: { type: "number" },
        flight_offer_id: { type: "string" },
        hotel_offer_id: { type: "string" }
      },
      required: ["traveler_id", "organization_id", "destination", "purpose"]
    }
  },
  {
    name: "book_flight",
    description: "Book a flight after approval is received",
    parameters: {
      type: "object",
      properties: {
        trip_request_id: { type: "string" },
        flight_offer_id: { type: "string" },
        traveler_details: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            date_of_birth: { type: "string" },
            passport_number: { type: "string" },
            passport_expiry: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" }
          }
        }
      },
      required: ["trip_request_id", "flight_offer_id", "traveler_details"]
    }
  },
  {
    name: "get_trip_status",
    description: "Get the current status of a trip request or booking",
    parameters: {
      type: "object",
      properties: {
        trip_request_id: { type: "string" }
      },
      required: ["trip_request_id"]
    }
  },
  {
    name: "cancel_booking",
    description: "Request cancellation of an existing booking",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        reason: { type: "string" }
      },
      required: ["booking_id"]
    }
  }
];
```

### Function Calling Modes

| Mode | Use Case | Example |
|------|----------|---------|
| `AUTO` | Default - model decides when to call | General conversation |
| `ANY` | Force function call | "Book this flight now" |
| `NONE` | Disable functions | Policy explanation only |
| `VALIDATED` | Must be valid call or text | Strict booking flow |

### Multi-Turn Conversation Flow

```typescript
// Example: Complete booking conversation

// Turn 1: User initiates
User: "I need to fly to NYC next Tuesday for a client meeting"

// Turn 2: Agent searches (parallel calls)
Agent: [Function calls: search_flights, check_policy_compliance]
       "I found 5 options for you. Based on your company's policy,
        here are the compliant flights under your $800 limit..."

// Turn 3: User selects
User: "The 8am Delta flight looks good"

// Turn 4: Agent creates request
Agent: [Function call: create_trip_request]
       "I've created a trip request for your NYC trip.
        It's been sent to Sarah (your manager) for approval.
        I'll notify you once it's approved!"

// Turn 5: (After approval webhook)
Agent: [Function call: book_flight]
       "Great news! Sarah approved your trip. I've booked your flight:
        - Delta DL123, Mar 5, 8:00 AM SFO → JFK
        - Confirmation: ABC123
        - Check-in opens 24h before departure"
```

---

## Amadeus API Integration

### Complete Booking Flow (9 Steps)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AMADEUS BOOKING PIPELINE                              │
└─────────────────────────────────────────────────────────────────────────────┘

Step 1: SEARCH ──────────────────────────────────────────────────────────────►
│ POST /v2/shopping/flight-offers
│ - origin, destination, departureDate
│ - adults, travelClass, maxPrice
│ Returns: Up to 250 flight offers from 500+ airlines
│
Step 2: PRICE ───────────────────────────────────────────────────────────────►
│ POST /v1/shopping/flight-offers/pricing
│ ⚠️ CRITICAL: Prices can change between search and booking!
│ Returns: grandTotal, taxes, instant ticketing requirements
│
Step 3: UPSELL (Optional) ───────────────────────────────────────────────────►
│ POST /v1/shopping/flight-offers/upselling
│ Returns: Branded fare options (bags, seats, refundability)
│
Step 4: SEATMAP (Optional) ──────────────────────────────────────────────────►
│ GET /v1/shopping/seatmaps
│ Returns: Cabin layout visualization (view only)
│
Step 5: BOOK ────────────────────────────────────────────────────────────────►
│ POST /v1/booking/flight-orders
│ Required: traveler data, contact info, documents (passport)
│ Max 9 passengers per PNR
│ ticketingAgreement: DELAY_TO_QUEUE or CONFIRM
│ Returns: PNR (Passenger Name Record), booking reference
│
Step 6: MANAGE ──────────────────────────────────────────────────────────────►
│ GET /v1/booking/flight-orders/{orderId}
│ Returns: Full booking details, associated records, ticket numbers
│
Step 7: TICKET ──────────────────────────────────────────────────────────────►
│ ⚠️ REQUIRES CONSOLIDATOR PARTNERSHIP (Self-Service API)
│ ⚠️ OR IATA/ARC LICENSE (Enterprise SOAP API)
│ Consolidator receives booking, issues tickets from back office
│
Step 8: STATUS ──────────────────────────────────────────────────────────────►
│ GET /v1/schedule/flights
│ Returns: Real-time departure/arrival info, delays, gates
│
Step 9: CANCEL ──────────────────────────────────────────────────────────────►
│ Via Flight Order Management API
│ Policies vary by airline/fare rules
│
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Implementation

```typescript
// lib/amadeus/client.ts

import Amadeus from 'amadeus';

const amadeus = new Amadeus({
  clientId: process.env.AMADEUS_CLIENT_ID,
  clientSecret: process.env.AMADEUS_CLIENT_SECRET,
  hostname: 'production' // or 'test' for sandbox
});

export async function searchFlights(params: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  maxPrice?: number;
  nonStop?: boolean;
}) {
  const response = await amadeus.shopping.flightOffersSearch.get({
    originLocationCode: params.origin,
    destinationLocationCode: params.destination,
    departureDate: params.departureDate,
    returnDate: params.returnDate,
    adults: params.adults || 1,
    travelClass: params.travelClass,
    maxPrice: params.maxPrice,
    nonStop: params.nonStop,
    max: 50 // Limit results
  });

  return response.data;
}

export async function priceFlightOffer(flightOffer: any) {
  // ⚠️ CRITICAL: Always re-price before booking
  const response = await amadeus.shopping.flightOffers.pricing.post(
    JSON.stringify({
      data: {
        type: 'flight-offers-pricing',
        flightOffers: [flightOffer]
      }
    })
  );

  return response.data;
}

export async function createBooking(params: {
  flightOffer: any;
  travelers: TravelerInfo[];
  contact: ContactInfo;
}) {
  const response = await amadeus.booking.flightOrders.post(
    JSON.stringify({
      data: {
        type: 'flight-order',
        flightOffers: [params.flightOffer],
        travelers: params.travelers.map((t, i) => ({
          id: String(i + 1),
          dateOfBirth: t.dateOfBirth,
          gender: t.gender,
          name: {
            firstName: t.firstName,
            lastName: t.lastName
          },
          documents: [{
            documentType: 'PASSPORT',
            number: t.passportNumber,
            expiryDate: t.passportExpiry,
            issuanceCountry: t.passportCountry,
            nationality: t.nationality,
            holder: true
          }],
          contact: {
            emailAddress: params.contact.email,
            phones: [{
              deviceType: 'MOBILE',
              countryCallingCode: '1',
              number: params.contact.phone
            }]
          }
        })),
        ticketingAgreement: {
          option: 'DELAY_TO_QUEUE' // Ticket later via consolidator
        }
      }
    })
  );

  return response.data;
}

export async function getCheckInLink(pnr: string, airline: string) {
  // ⚠️ CHECK-IN IS LINKS ONLY - Redirects to airline website
  const checkInUrls: Record<string, string> = {
    'AA': `https://www.aa.com/reservation/view?recordLocator=${pnr}`,
    'DL': `https://www.delta.com/mytrips/`,
    'UA': `https://www.united.com/ual/en/us/flight-status/detail/`,
    'BA': `https://www.britishairways.com/travel/managebooking/public/en_us`,
    // ... add more airlines
  };

  return checkInUrls[airline] || `https://checkmytrip.com/`;
}
```

### API Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Check-in** | Links only, no actual check-in | Provide deep links to airline sites |
| **LCCs** | No Southwest, limited Ryanair | Direct airline integrations |
| **Ticketing** | Requires consolidator | Partner with travel consolidator |
| **Seat selection** | View only for some airlines | Direct airline API for selection |
| **Price volatility** | Can change between search/book | Always re-price before booking |

---

## n8n Workflow Orchestration

### Workflow 1: Approval Flow

```yaml
# approval-workflow.yaml
name: Trip Approval Workflow
trigger: Webhook (from Gemini agent)

nodes:
  - type: webhook
    id: receive_request
    path: /trip-request

  - type: supabase
    id: get_requester
    operation: Select
    table: organization_users
    filter: user_id = {{ $json.requester_id }}

  - type: supabase
    id: get_approver
    operation: Select
    table: organization_users
    filter:
      org_id = {{ $node.get_requester.org_id }}
      can_approve_up_to >= {{ $json.estimated_cost }}
    order: can_approve_up_to ASC
    limit: 1

  - type: switch
    id: check_auto_approve
    conditions:
      - {{ $json.estimated_cost }} < {{ $node.get_org.auto_approve_limit }}

  - type: slack
    id: send_approval_request
    channel: dm:{{ $node.get_approver.slack_user_id }}
    message: |
      🛫 *Trip Approval Request*

      *Traveler:* {{ $node.get_requester.name }}
      *Destination:* {{ $json.destination }}
      *Dates:* {{ $json.departure_date }} → {{ $json.return_date }}
      *Purpose:* {{ $json.purpose }}
      *Estimated Cost:* ${{ $json.estimated_cost }}

      {{ if $json.policy_violations }}
      ⚠️ *Policy Exceptions:*
      {{ $json.policy_violations }}
      {{ endif }}
    blocks:
      - type: actions
        elements:
          - type: button
            text: ✅ Approve
            action_id: approve_trip
            value: {{ $json.request_id }}
            style: primary
          - type: button
            text: ❌ Reject
            action_id: reject_trip
            value: {{ $json.request_id }}
            style: danger
          - type: button
            text: 💬 Ask Questions
            action_id: ask_questions
            value: {{ $json.request_id }}
```

### Workflow 2: Check-in Reminders

```yaml
# checkin-reminder.yaml
name: Flight Check-in Reminders
trigger: Schedule (every hour)

nodes:
  - type: schedule
    id: hourly_check
    cron: "0 * * * *"

  - type: supabase
    id: get_upcoming_flights
    operation: Select
    table: bookings
    filter:
      departure_time > NOW()
      departure_time < NOW() + INTERVAL '25 hours'
      checkin_reminder_sent = false

  - type: loop
    id: process_each_booking
    items: {{ $node.get_upcoming_flights.data }}

  - type: http
    id: get_checkin_link
    method: GET
    url: /api/amadeus/checkin-link
    query:
      pnr: {{ $item.confirmation_number }}
      airline: {{ $item.airline_code }}

  - type: slack
    id: send_reminder
    channel: dm:{{ $item.traveler_slack_id }}
    message: |
      ✈️ *Check-in Now Available!*

      Your flight to {{ $item.destination }} departs in ~24 hours.

      *Flight:* {{ $item.airline_code }}{{ $item.flight_number }}
      *Departure:* {{ $item.departure_time | date:"h:mm A, MMM D" }}
      *From:* {{ $item.origin_airport }}

    blocks:
      - type: actions
        elements:
          - type: button
            text: 🎫 Check In Now
            url: {{ $node.get_checkin_link.url }}
            style: primary

  - type: supabase
    id: mark_reminder_sent
    operation: Update
    table: bookings
    filter: id = {{ $item.id }}
    data:
      checkin_reminder_sent: true
```

### Workflow 3: Expense Sync

```yaml
# expense-sync.yaml
name: Expense System Sync
trigger: Webhook (booking completed)

nodes:
  - type: webhook
    id: booking_completed
    path: /booking-complete

  - type: supabase
    id: get_booking_details
    operation: Select
    table: bookings
    filter: id = {{ $json.booking_id }}
    join:
      - trip_requests
      - organization_users
      - organizations

  - type: switch
    id: check_expense_system
    routes:
      - condition: {{ $node.get_booking_details.org.expense_system }} == 'expensify'
        next: sync_expensify
      - condition: {{ $node.get_booking_details.org.expense_system }} == 'ramp'
        next: sync_ramp
      - condition: {{ $node.get_booking_details.org.expense_system }} == 'quickbooks'
        next: sync_quickbooks

  - type: http
    id: sync_expensify
    method: POST
    url: https://integrations.expensify.com/Integration-Server/ExpensifyIntegrations
    body:
      type: create
      employeeEmail: {{ $node.get_booking_details.traveler.email }}
      reportName: "Business Trip - {{ $node.get_booking_details.destination }}"
      expenses:
        - merchant: {{ $node.get_booking_details.airline }}
          amount: {{ $node.get_booking_details.total_cost }}
          category: Travel - Airfare
          date: {{ $node.get_booking_details.booking_date }}
          receipt: {{ $node.get_booking_details.receipt_url }}
```

### n8n Best Practices

| Pattern | Use For | Avoid For |
|---------|---------|-----------|
| **Scheduled Jobs** | Check-in reminders, report generation | User-facing responses |
| **Webhooks** | Event-driven (booking complete, approval) | Continuous polling |
| **HTTP Requests** | API integrations, external services | Complex logic |
| **Switch Nodes** | Conditional routing | Multi-step reasoning |
| **Loops** | Batch processing | Real-time interactions |

**Key Insight:** n8n excels at deterministic, scheduled, event-driven workflows. Use Gemini for conversational, reasoning-heavy interactions.

---

## Database Schema

### Core Tables

```sql
-- Organizations (multi-tenant)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE, -- For email domain matching
  slack_team_id TEXT UNIQUE,
  teams_tenant_id TEXT UNIQUE,

  -- Travel Policy (JSONB for flexibility)
  travel_policy JSONB DEFAULT '{
    "domestic_flight_max": 800,
    "international_flight_max": 3000,
    "hotel_per_night_max": 250,
    "advance_booking_days": 7,
    "auto_approve_under": 500,
    "allowed_cabin_classes": ["ECONOMY", "PREMIUM_ECONOMY"],
    "require_approval_over": 1000,
    "preferred_airlines": ["DL", "AA", "UA"],
    "blocked_airlines": []
  }',

  -- Integrations
  expense_system TEXT, -- 'expensify', 'ramp', 'quickbooks', null
  expense_api_key TEXT, -- Encrypted

  -- Subscription
  plan TEXT DEFAULT 'starter', -- 'starter', 'business', 'enterprise'
  stripe_customer_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organization Users
CREATE TABLE organization_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Role & Permissions
  role TEXT DEFAULT 'traveler', -- 'admin', 'manager', 'traveler'
  department TEXT,
  can_approve_up_to DECIMAL(10,2) DEFAULT 0, -- Approval limit

  -- Messaging IDs
  slack_user_id TEXT,
  teams_user_id TEXT,

  -- Traveler Profile
  traveler_profile JSONB DEFAULT '{
    "passport_number": null,
    "passport_expiry": null,
    "passport_country": null,
    "date_of_birth": null,
    "gender": null,
    "known_traveler_number": null,
    "seat_preference": "aisle",
    "meal_preference": "none",
    "frequent_flyer": {}
  }',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- Trip Requests
CREATE TABLE trip_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  requester_id UUID REFERENCES organization_users(id),
  approver_id UUID REFERENCES organization_users(id),

  -- Trip Details
  destination TEXT NOT NULL,
  purpose TEXT NOT NULL,
  departure_date DATE NOT NULL,
  return_date DATE,

  -- Status
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'booked', 'cancelled'
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Cost & Policy
  estimated_cost DECIMAL(10,2),
  policy_violations JSONB, -- Array of violations

  -- Selected Options (cached from search)
  flight_offer JSONB,
  hotel_offer JSONB,
  car_offer JSONB,

  -- Conversation
  slack_thread_ts TEXT, -- For threading messages
  teams_conversation_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_request_id UUID REFERENCES trip_requests(id),

  -- Booking Details
  type TEXT NOT NULL, -- 'flight', 'hotel', 'car'
  confirmation_number TEXT NOT NULL,
  vendor TEXT NOT NULL, -- Airline code, hotel chain, car company

  -- Financial
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  payment_method TEXT, -- 'corporate_card', 'invoice', 'personal_reimbursement'

  -- Status
  status TEXT DEFAULT 'confirmed', -- 'confirmed', 'cancelled', 'completed'

  -- Flight-specific
  flight_number TEXT,
  origin_airport TEXT,
  destination_airport TEXT,
  departure_time TIMESTAMPTZ,
  arrival_time TIMESTAMPTZ,
  cabin_class TEXT,
  seat_number TEXT,

  -- Reminders
  checkin_reminder_sent BOOLEAN DEFAULT FALSE,
  departure_reminder_sent BOOLEAN DEFAULT FALSE,

  -- Raw API Response
  amadeus_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trip_requests_org ON trip_requests(organization_id);
CREATE INDEX idx_trip_requests_status ON trip_requests(status);
CREATE INDEX idx_trip_requests_approver ON trip_requests(approver_id, status);
CREATE INDEX idx_bookings_departure ON bookings(departure_time) WHERE type = 'flight';
CREATE INDEX idx_org_users_slack ON organization_users(slack_user_id);

-- RLS Policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Users can only see their own organization's data
CREATE POLICY "Users see own org" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM organization_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users see org members" ON organization_users
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users see org trips" ON trip_requests
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_users WHERE user_id = auth.uid())
  );
```

---

## Slack App Implementation

### Manifest

```yaml
# slack-manifest.yaml
display_information:
  name: MonkeyTravel Business
  description: AI-powered business travel planning and booking
  background_color: "#FF6B6B"
  long_description: |
    Plan and book business trips through natural conversation.
    Get AI-powered recommendations, automatic policy compliance,
    and streamlined approval workflows.

features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: MonkeyTravel
    always_online: true
  shortcuts:
    - name: New Trip Request
      type: global
      callback_id: new_trip_request
      description: Start planning a new business trip
  slash_commands:
    - command: /travel
      description: Plan a business trip
      usage_hint: "[destination] [dates] or just describe your trip"
      should_escape: false

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - chat:write
      - commands
      - files:read
      - groups:history
      - im:history
      - im:read
      - im:write
      - users:read
      - users:read.email

settings:
  event_subscriptions:
    bot_events:
      - app_home_opened
      - app_mention
      - message.im
  interactivity:
    is_enabled: true
    request_url: https://api.monkeytravel.app/slack/interactions
  org_deploy_enabled: true
  socket_mode_enabled: false
```

### Event Handlers

```typescript
// app/api/slack/events/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  const body = await req.json();

  // URL Verification (Slack challenge)
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Handle events
  if (body.type === 'event_callback') {
    const event = body.event;

    switch (event.type) {
      case 'message':
        if (event.channel_type === 'im' && !event.bot_id) {
          await handleDirectMessage(event);
        }
        break;

      case 'app_mention':
        await handleMention(event);
        break;

      case 'app_home_opened':
        await updateHomeTab(event.user);
        break;
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleDirectMessage(event: any) {
  const { user, text, channel, thread_ts } = event;

  // Get user's organization context
  const { data: orgUser } = await supabase
    .from('organization_users')
    .select('*, organizations(*)')
    .eq('slack_user_id', user)
    .single();

  if (!orgUser) {
    await slack.chat.postMessage({
      channel,
      text: "I don't recognize your Slack workspace. Please ask your admin to connect MonkeyTravel to your organization."
    });
    return;
  }

  // Build context for Gemini
  const systemPrompt = `You are a helpful business travel assistant for ${orgUser.organizations.name}.

Travel Policy:
${JSON.stringify(orgUser.organizations.travel_policy, null, 2)}

User: ${orgUser.traveler_profile?.first_name || 'Unknown'}
Role: ${orgUser.role}
Approval Limit: $${orgUser.can_approve_up_to}

Available functions: search_flights, check_policy_compliance, create_trip_request, get_trip_status

Always check policy compliance before suggesting bookings. If a request exceeds policy limits, explain the violation and offer alternatives.`;

  // Call Gemini with function calling
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    tools: [{ functionDeclarations: travelTools }]
  });

  const chat = model.startChat({
    history: await getChatHistory(channel, thread_ts),
    systemInstruction: systemPrompt
  });

  const result = await chat.sendMessage(text);
  const response = result.response;

  // Handle function calls
  if (response.functionCalls()) {
    for (const call of response.functionCalls()) {
      const functionResult = await executeTravelFunction(call.name, call.args, orgUser);

      // Send function result back to model
      const followUp = await chat.sendMessage([{
        functionResponse: {
          name: call.name,
          response: functionResult
        }
      }]);

      await slack.chat.postMessage({
        channel,
        thread_ts: thread_ts || event.ts,
        text: followUp.response.text(),
        blocks: formatSlackBlocks(followUp.response.text(), functionResult)
      });
    }
  } else {
    await slack.chat.postMessage({
      channel,
      thread_ts: thread_ts || event.ts,
      text: response.text()
    });
  }
}

async function executeTravelFunction(name: string, args: any, orgUser: any) {
  switch (name) {
    case 'search_flights':
      const flights = await searchFlights(args);
      // Filter by policy
      return flights.filter(f =>
        f.price.total <= orgUser.organizations.travel_policy.domestic_flight_max
      );

    case 'check_policy_compliance':
      return checkPolicyCompliance(args, orgUser.organizations.travel_policy);

    case 'create_trip_request':
      return await createTripRequest({
        ...args,
        organization_id: orgUser.organization_id,
        requester_id: orgUser.id
      });

    default:
      throw new Error(`Unknown function: ${name}`);
  }
}
```

---

## Cost Analysis

### Infrastructure Costs (100 trips/month)

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| **Gemini API** | ~200 conversations × 10 turns × 1K tokens | $15 |
| **Amadeus API** | 100 bookings × $0.10 | $10 |
| **Supabase** | Pro plan | $25 |
| **n8n Cloud** | Starter (5K executions) | $20 |
| **Vercel** | Pro | $20 |
| **Slack/Teams** | Free tier sufficient | $0 |
| **Total** | | **~$90/mo** |

### Revenue Model

| Plan | Price/User/Mo | Features |
|------|---------------|----------|
| **Starter** | $15 | 5 travelers, basic policy, Slack only |
| **Business** | $25 | 50 travelers, full policy, Slack + Teams |
| **Enterprise** | Custom | Unlimited, SSO, custom integrations |

**Unit Economics (100 trips @ $50 avg booking fee):**
- Revenue: $5,000
- Infrastructure: $90
- Margin: **98%**

---

## Implementation Phases

### Phase 0: Validation (No Code) - 2 weeks
- [ ] Customer discovery interviews (5-10 companies)
- [ ] Competitive analysis deep-dive
- [ ] Figma prototype for user testing
- [ ] Pricing sensitivity research
- [ ] Identify design partner customers
- [ ] Gather LOIs (Letters of Intent)

### Phase 1: Concierge MVP - 4 weeks
- [ ] Slack app with basic chat (Gemini)
- [ ] Manual booking fulfillment (human in the loop)
- [ ] Simple trip request form
- [ ] Email-based approvals
- [ ] 5-10 pilot customers

### Phase 2: Self-Serve Booking - 8 weeks
- [ ] Amadeus flight search + booking integration
- [ ] Automated policy compliance checks
- [ ] Slack approval buttons (Interactive Components)
- [ ] n8n workflows: reminders, expense sync
- [ ] Microsoft Teams app
- [ ] Hotel search (Amadeus or Booking.com)

### Phase 3: Enterprise Scale - 12 weeks
- [ ] SSO/SCIM (WorkOS integration)
- [ ] Custom approval hierarchies
- [ ] Budget tracking & forecasting
- [ ] Expensify/Ramp/Concur integrations
- [ ] Admin dashboard (policy management)
- [ ] SOC 2 compliance preparation
- [ ] Enterprise sales motion

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Amadeus ticketing complexity** | High | Start with consolidator partnership |
| **Policy engine edge cases** | Medium | Extensive testing, gradual rollout |
| **Slack rate limits** | Medium | Queue + backoff strategy |
| **LCC coverage gaps** | Medium | Direct airline APIs for Southwest, etc. |
| **Check-in limitations** | Low | Clear UX that it's a redirect |
| **Competition (Navan, etc.)** | High | Focus on AI differentiation, startup segment |

---

## Open Questions

1. **Ticketing Partner:** Which consolidator to partner with for ticket issuance?
2. **Hotel Strategy:** Amadeus hotels vs. Booking.com API vs. Expedia API?
3. **Car Rental:** Include in MVP or Phase 2?
4. **Expense Integration:** Build generic API or specific integrations first?
5. **Pricing Model:** Per-booking fee vs. per-user subscription vs. hybrid?
6. **Enterprise Sales:** Inside sales vs. PLG (product-led growth)?

---

## Appendix: API Reference Links

- [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Amadeus Self-Service APIs](https://developers.amadeus.com/self-service)
- [Amadeus Flight Booking Guide](https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/resources/flights/)
- [n8n Workflow Templates](https://n8n.io/workflows/)
- [Slack API - Interactive Components](https://api.slack.com/interactivity)
- [Microsoft Teams Bot Framework](https://docs.microsoft.com/en-us/microsoftteams/platform/bots/what-are-bots)
- [Duffel API (Alternative to Amadeus)](https://duffel.com/docs)
- [Composio (Tool Integrations)](https://composio.dev/)

---

## Research Sources

### Market & Industry Reports
- [Custom Market Insights - Corporate Travel Market](https://www.custommarketinsights.com/report/corporate-travel-market/)
- [Expert Market Research - US Business Travel](https://www.expertmarketresearch.com/reports/united-states-business-travel-market)
- [Business Research Insights - Travel Management Services](https://www.businessresearchinsights.com/market-reports/business-travel-management-service-market-105102)
- [Phocuswright - US Corporate Travel Sizing](https://www.phocuswright.com/Special-Projects/2024/US-Corporate-Travel-Market-Sizing-and-Trends-2024-Insights-and-Outlook)

### Competitive Intelligence
- [G2 - Navan Pricing](https://www.g2.com/products/navan-formerly-tripactions/pricing)
- [TravelPerk - Navan vs Concur Comparison](https://www.travelperk.com/blog/navan-vs-concur/)
- [TravelPerk - Best Concur Alternatives](https://www.travelperk.com/blog/best-sap-concur-alternatives-competitors/)
- [Navan - Corporate Travel Guide](https://navan.com/blog/insights-trends/top-corporate-travel-companies-for-2024)

### Growth & GTM Strategy
- [McKinsey - From PLG to Product-Led Sales](https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/from-product-led-growth-to-product-led-sales-beyond-the-plg-hype)
- [GrowthHackers - Slack Growth Study](https://growthhackers.com/growth-studies/slack/)
- [SaaStr - B2B Sales Cycle Benchmarks](https://www.saastr.com/dear-saastr-whats-a-good-benchmark-for-b2b-sales-cycles/)
- [ProductLed - PLG vs SLG](https://productled.com/blog/product-led-growth-vs-sales-led-growth)

### Buyer Pain Points
- [iTilite - CFO Pain Points in Business Travel](https://www.itilite.com/blog/pain-points-for-cfo/)
- [Adelman Travel - CFO Program Checklist](https://www.adelmantravel.com/blogs/blog/corporate-travel-program-checklists-what-every-cfo-should-ask/)
- [CWT - Travel Policy Compliance](https://www.mycwt.com/insights/improving-travel-policy-compliance/)
- [Navan - Corporate Travel Compliance](https://navan.com/blog/corporate-travel-compliance)

### Technical Documentation
- [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Amadeus Flight Booking Guide](https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/resources/flights/)
- [n8n Workflow Templates](https://n8n.io/workflows/)
- [Slack API - Interactive Components](https://api.slack.com/interactivity)

---

*Last Updated: December 19, 2024*
*Document Version: 2.0*
*Status: Research & Exploration (No Implementation)*

**Changelog:**
- v2.0 (Dec 19, 2024): Added comprehensive Business Strategy section with market sizing, competitive analysis, buyer personas, GTM strategy, marketing, sales, growth framework, unit economics, and pricing strategy
- v1.0 (Dec 2024): Initial technical specification with architecture, API integrations, database schema, and implementation phases
