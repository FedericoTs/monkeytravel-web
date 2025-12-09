# AI Agent Enhancer Skill

A specialized skill for creating high-quality conversational AI interfaces with production-grade animations, UX patterns, cost efficiency, and interaction design for MonkeyTravel.

## Overview

This skill provides guidance for implementing premium AI chat experiences based on 2025 best practices from Google AI Mode Canvas, ChatGPT, Claude, and leading enterprise AI assistants.

**Core Philosophy:**
- User control is sacred (confirm, undo, cancel, override)
- Context is gold (remember, reuse, verify)
- Transparency builds trust (show what, why, and how)
- Suggest & confirm pattern (AI proposes, user approves)
- Cost efficiency first (minimize API calls, maximize cache)

---

## Cross-Skill Integration

This skill integrates with other MonkeyTravel skills:

| Skill | When to Call | Purpose |
|-------|--------------|---------|
| `gemini-travel-agent` | Activity generation, trip planning | AI model selection, prompt engineering |
| `frontend-design` | UI components, styling | Design system, animations, components |
| `amadeus-integration` | Flight/hotel bookings | Travel API integration |

### Calling Other Skills

```typescript
// When generating new activities, use gemini-travel-agent patterns
// Reference: .claude/skills/gemini-travel-agent.md
// - Model selection based on complexity
// - Prompt sanitization
// - Rate limiting patterns

// When building UI components, use frontend-design patterns
// Reference: .claude/skills/frontend-design.md
// - Color system (--primary, --accent)
// - Component library (Button, Card, Badge)
// - Animation utilities

// When integrating bookings, use amadeus-integration patterns
// Reference: .claude/skills/amadeus-integration.md
// - API authentication
// - Error handling
// - Caching strategies
```

---

## Cost Efficiency Strategy

### 1. Model Tiering System

**Use the cheapest model that can handle the task:**

```typescript
// Task classification for cost optimization
const TASK_TIERS = {
  // Tier 1: Ultra-cheap (gemini-2.0-flash-lite)
  // Cost: ~$0.001 per call
  simple: {
    model: "gemini-2.0-flash-lite",
    tasks: [
      "simple_question",      // "What time does X open?"
      "weather_check",        // Weather-related queries
      "clarification",        // "Did you mean...?"
      "tip_generation",       // Quick travel tips
    ],
    maxTokens: 500,
    costPer1kTokens: 0.0375,
  },

  // Tier 2: Standard (gemini-2.0-flash)
  // Cost: ~$0.003 per call
  medium: {
    model: "gemini-2.0-flash",
    tasks: [
      "activity_suggestion",  // Suggest alternatives
      "comparison",           // Compare options
      "day_modification",     // Modify single day
      "single_replacement",   // Replace one activity
    ],
    maxTokens: 2000,
    costPer1kTokens: 0.075,
  },

  // Tier 3: Premium (gemini-2.5-pro)
  // Cost: ~$0.05 per call - USE SPARINGLY
  complex: {
    model: "gemini-2.5-pro",
    tasks: [
      "full_itinerary_rework", // Major trip changes
      "multi_day_planning",    // Planning 3+ days
      "complex_constraints",   // Many requirements
    ],
    maxTokens: 8000,
    costPer1kTokens: 1.25,
  },
};

// Classification function
function classifyTask(message: string, context: TripContext): TaskTier {
  // Keyword-based fast classification
  const lowerMessage = message.toLowerCase();

  // Simple tasks (Tier 1)
  if (lowerMessage.match(/what time|when does|how much|is it open/)) {
    return "simple";
  }

  // Complex indicators (Tier 3)
  if (
    lowerMessage.match(/redo the entire|change everything|completely different/) ||
    context.requestedDays > 3
  ) {
    return "complex";
  }

  // Default to medium (Tier 2)
  return "medium";
}
```

### 2. Aggressive Caching Strategy

**Cache everything that can be cached:**

```typescript
// Cache Layers
const CACHE_CONFIG = {
  // Layer 1: In-memory cache (fastest)
  memory: {
    ttl: 5 * 60 * 1000,  // 5 minutes
    maxSize: 100,
    targets: ["recent_conversations", "user_preferences"],
  },

  // Layer 2: Supabase cache (persistent)
  database: {
    ttl: 14 * 24 * 60 * 60 * 1000,  // 14 days
    targets: ["generated_activities", "destination_info", "common_responses"],
  },

  // Layer 3: Edge cache (Vercel KV if available)
  edge: {
    ttl: 60 * 60 * 1000,  // 1 hour
    targets: ["popular_destinations", "seasonal_tips"],
  },
};

// Cache key generation
function generateCacheKey(params: {
  destination: string;
  activityType?: string;
  budget?: string;
  vibes?: string[];
}): string {
  const normalized = {
    dest: params.destination.toLowerCase().trim(),
    type: params.activityType || "any",
    budget: params.budget || "balanced",
    vibes: (params.vibes || []).sort().join(","),
  };
  return `activity:${normalized.dest}:${normalized.type}:${normalized.budget}:${normalized.vibes}`;
}

// Cache check before AI call
async function getOrGenerateActivity(params: ActivityParams): Promise<Activity> {
  const cacheKey = generateCacheKey(params);

  // Check cache first
  const cached = await checkCache(cacheKey);
  if (cached && !isExpired(cached)) {
    console.log(`[CACHE HIT] Saved ~$0.003 - ${cacheKey}`);
    return cached.data;
  }

  // Generate new activity
  const activity = await generateNewActivity(params);

  // Cache for future use
  await setCache(cacheKey, activity, CACHE_CONFIG.database.ttl);

  return activity;
}
```

### 3. Request Batching

**Combine multiple requests into one:**

```typescript
// BAD: Multiple API calls
const activity1 = await generateActivity({ type: "morning", day: 1 });
const activity2 = await generateActivity({ type: "afternoon", day: 1 });
const activity3 = await generateActivity({ type: "evening", day: 1 });
// Cost: ~$0.009 (3 calls)

// GOOD: Single batched call
const activities = await generateDayActivities({
  day: 1,
  slots: ["morning", "afternoon", "evening"],
});
// Cost: ~$0.004 (1 call with more tokens)

// Batching implementation
async function batchActivityGeneration(
  requests: ActivityRequest[]
): Promise<Activity[]> {
  // Group by destination and day for efficiency
  const grouped = groupBy(requests, (r) => `${r.destination}-${r.day}`);

  const results: Activity[] = [];

  for (const [key, group] of Object.entries(grouped)) {
    // Single prompt for all activities in group
    const prompt = buildBatchPrompt(group);
    const response = await generateWithModel(prompt, "medium");
    results.push(...parseMultipleActivities(response));
  }

  return results;
}
```

### 4. Smart Deduplication

**Don't regenerate what already exists:**

```typescript
// Before generating replacement
function shouldRegenerate(
  existingActivity: Activity,
  userRequest: string
): boolean {
  // Check if existing activity already satisfies request
  const requestKeywords = extractKeywords(userRequest);
  const activityKeywords = extractKeywords(existingActivity.description);

  const overlap = intersection(requestKeywords, activityKeywords);

  // If >50% overlap, suggest keeping existing
  if (overlap.length / requestKeywords.length > 0.5) {
    return false; // Don't regenerate, explain why current works
  }

  return true;
}

// Usage
if (!shouldRegenerate(existingActivity, userRequest)) {
  return {
    type: "explanation",
    message: `Your current activity "${existingActivity.name}" already fits this request because...`,
    cost: 0, // No API call needed
  };
}
```

### 5. Conversation Context Pruning

**Don't send entire conversation history:**

```typescript
// BAD: Send all messages
const fullHistory = conversation.messages; // Could be 50+ messages
// Tokens: 10,000+ = expensive

// GOOD: Smart pruning
function pruneConversation(messages: Message[], maxTokens: number = 2000): Message[] {
  // Always keep: first message (sets context) + last 4 messages
  const essential = [
    messages[0],
    ...messages.slice(-4),
  ];

  // If under limit, add more recent messages
  let tokenCount = estimateTokens(essential);
  const additional: Message[] = [];

  for (let i = messages.length - 5; i > 0; i--) {
    const msgTokens = estimateTokens([messages[i]]);
    if (tokenCount + msgTokens > maxTokens) break;
    additional.unshift(messages[i]);
    tokenCount += msgTokens;
  }

  return [messages[0], ...additional, ...messages.slice(-4)];
}

// Token estimation (rough)
function estimateTokens(messages: Message[]): number {
  const text = messages.map((m) => m.content).join(" ");
  return Math.ceil(text.length / 4); // ~4 chars per token average
}
```

### 6. Cost Monitoring & Alerts

**Track and alert on cost anomalies:**

```typescript
// Cost tracking per user per day
interface CostTracking {
  userId: string;
  date: string;
  totalCostCents: number;
  callCount: number;
  byModel: Record<string, { calls: number; cost: number }>;
}

// Daily budget enforcement
const DAILY_LIMITS = {
  free: { maxCostCents: 5, maxCalls: 10 },
  pro: { maxCostCents: 50, maxCalls: 100 },
  admin: { maxCostCents: Infinity, maxCalls: Infinity },
};

async function checkBudget(userId: string, tier: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const usage = await getDailyUsage(userId, today);
  const limit = DAILY_LIMITS[tier];

  if (usage.totalCostCents >= limit.maxCostCents) {
    return false; // Budget exceeded
  }

  return true;
}

// Real-time cost logging
async function logAICost(params: {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  action: string;
}) {
  const cost = calculateCost(params.model, params.inputTokens, params.outputTokens);

  await supabase.from("ai_cost_logs").insert({
    user_id: params.userId,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_cents: cost,
    action: params.action,
    created_at: new Date().toISOString(),
  });

  // Alert if unusual
  if (cost > 10) { // >$0.10 per call is unusual
    console.warn(`[COST ALERT] High cost call: $${(cost / 100).toFixed(4)} for ${params.action}`);
  }
}
```

### 7. Cost Reduction Summary

| Strategy | Savings | Implementation |
|----------|---------|----------------|
| Model tiering | 60-80% | Use flash-lite for simple tasks |
| Caching | 40-60% | Cache popular destinations/activities |
| Batching | 30-50% | Combine related requests |
| Deduplication | 20-30% | Skip unnecessary regeneration |
| Context pruning | 15-25% | Limit conversation history |
| **Combined** | **70-90%** | All strategies together |

### 8. Cost Estimation Formula

```typescript
// Estimated cost per user action
function estimateActionCost(action: string, context: TripContext): number {
  const costs = {
    simple_question: 0.001,      // flash-lite, cached
    activity_replacement: 0.003, // flash, may cache
    day_regeneration: 0.01,      // flash, full generation
    full_trip_replan: 0.05,      // pro, complex
  };

  // Apply cache discount if likely to hit
  const cacheHitProbability = estimateCacheHit(action, context);
  const baseCost = costs[action] || 0.005;

  return baseCost * (1 - cacheHitProbability);
}
```

---

## When to Use This Skill

- Designing or improving AI chat components
- Implementing message streaming and animations
- Creating typing indicators and loading states
- Building confirmation dialogs for AI actions
- Adding undo/redo functionality
- Implementing accessibility for dynamic content
- Optimizing conversation flow and message grouping
- **Reducing AI API costs**
- **Implementing caching strategies**

---

## Core UX Patterns

### 1. Staged Loading Indicator

**Never show just a spinner.** Use progressive stages:

```typescript
const LOADING_STAGES = [
  { id: "parsing", label: "Understanding request...", duration: 500 },
  { id: "finding", label: "Finding activities...", duration: 1500 },
  { id: "generating", label: "Creating alternatives...", duration: 2000 },
  { id: "applying", label: "Updating your trip...", duration: 500 },
];

// Component structure
function StagedLoadingIndicator({ currentStage }: { currentStage: string }) {
  return (
    <div className="flex items-center gap-2">
      {LOADING_STAGES.map((stage, i) => (
        <div key={stage.id} className="flex items-center">
          <StageIcon
            status={
              stage.id === currentStage ? "active" :
              i < activeIndex ? "completed" : "pending"
            }
          />
          {i < LOADING_STAGES.length - 1 && <Connector />}
        </div>
      ))}
    </div>
  );
}
```

### 2. Match Confirmation Dialog

**When fuzzy match confidence < 80%, ask for confirmation:**

```typescript
interface MatchConfirmation {
  query: string;           // What user asked for
  matches: {
    activity: Activity;
    dayNumber: number;
    confidence: number;
    reason: string;
  }[];
  onSelect: (activity: Activity) => void;
  onCancel: () => void;
}

// Visual: Card grid with selection highlight
// Animation: Staggered entry (100ms delay each)
// Interaction: Click to select, Escape to cancel
```

### 3. Preview Before Apply

**For significant changes, show before/after:**

```typescript
function PreviewChangeCard({
  oldActivity,
  newActivity,
  reason,
  onApply,
  onTryDifferent,
  onCancel,
}: PreviewProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="opacity-50 scale-95 transition-all">
        <ActivityCard activity={oldActivity} />
      </div>
      <div className="ring-2 ring-primary/30 transition-all">
        <ActivityCard activity={newActivity} isNew />
      </div>
      <div className="col-span-2 flex gap-2">
        <Button onClick={onApply}>Apply Change</Button>
        <Button variant="outline" onClick={onTryDifferent}>Try Different</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
```

### 4. Undo System

**30-second undo window with visual countdown:**

```typescript
interface UndoState {
  id: string;
  previousItinerary: ItineraryDay[];
  action: {
    type: "replace" | "add" | "remove";
    description: string;
    timestamp: number;
  };
  expiresAt: number;
}

// Component
function UndoToast({ undoState, onUndo }: UndoToastProps) {
  const [secondsLeft, setSecondsLeft] = useState(30);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 animate-slide-up">
      <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-4">
        <CheckCircle className="text-green-400" />
        <span>Activity replaced</span>
        <div className="flex items-center gap-2">
          <div className="h-1 w-24 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-1000"
              style={{ width: `${(secondsLeft / 30) * 100}%` }}
            />
          </div>
          <Button size="sm" variant="ghost" onClick={onUndo}>
            Undo
          </Button>
        </div>
      </div>
    </div>
  );
}
```

---

## Animation Patterns

### Message Bubble Entry

```typescript
// Framer Motion variant
export const messageVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 500,
      damping: 30,
    },
  },
};

// Usage
<motion.div variants={messageVariants} initial="hidden" animate="visible">
  <MessageBubble />
</motion.div>
```

### Typing Indicator (Wave Animation)

```css
@keyframes typing-dot {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

.typing-dot {
  animation: typing-dot 1.4s ease-in-out infinite;
}
.typing-dot:nth-child(1) { animation-delay: 0ms; }
.typing-dot:nth-child(2) { animation-delay: 150ms; }
.typing-dot:nth-child(3) { animation-delay: 300ms; }
```

```tsx
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-2">
      <div className="typing-dot w-2 h-2 bg-slate-400 rounded-full" />
      <div className="typing-dot w-2 h-2 bg-slate-400 rounded-full" />
      <div className="typing-dot w-2 h-2 bg-slate-400 rounded-full" />
    </div>
  );
}
```

### Card Replacement Transition

```typescript
export const cardReplacementVariants = {
  oldCard: {
    initial: { opacity: 1, x: 0, scale: 1 },
    exit: {
      opacity: 0,
      x: -30,
      scale: 0.95,
      transition: { duration: 0.3 }
    },
  },
  newCard: {
    initial: { opacity: 0, x: 30, scale: 0.95 },
    animate: {
      opacity: 1,
      x: 0,
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 25,
        delay: 0.2
      }
    },
  },
  arrow: {
    initial: { scale: 0, rotate: -45 },
    animate: {
      scale: 1,
      rotate: 0,
      transition: {
        type: "spring",
        stiffness: 500,
        delay: 0.15
      }
    },
  },
};
```

### Scroll-to-Change with Glow

```typescript
function scrollToChangedActivity(
  activityId: string,
  highlightDuration = 2000
) {
  const element = document.getElementById(`activity-${activityId}`);
  if (!element) return;

  // Smooth scroll
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });

  // Apply glow animation
  element.classList.add("activity-highlight");

  // Remove after duration
  setTimeout(() => {
    element.classList.remove("activity-highlight");
  }, highlightDuration);
}
```

```css
@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(var(--primary-rgb), 0.3);
  }
}

.activity-highlight {
  animation: glow-pulse 0.6s ease-in-out 3;
}
```

### Success Confetti (Subtle)

```typescript
import confetti from "canvas-confetti";

function celebrateSuccess() {
  confetti({
    particleCount: 20,
    spread: 50,
    origin: { y: 0.7 },
    colors: ["#F2C641", "#0A4B73", "#10B981"],
    ticks: 100,
    gravity: 1.2,
    scalar: 0.8,
  });
}
```

---

## Accessibility Requirements

### ARIA Labels for Dynamic Content

```tsx
<div
  role="status"
  aria-live="polite"
  aria-label={`AI is ${loadingStage.label}`}
>
  <StagedLoadingIndicator stage={loadingStage} />
</div>

<div
  role="log"
  aria-live="polite"
  aria-label="Chat messages"
>
  {messages.map((m) => <Message key={m.id} {...m} />)}
</div>
```

### Keyboard Navigation

```typescript
// Dialog keyboard handling
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && !e.shiftKey) onApply();
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [onCancel, onApply]);
```

### Reduced Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  .typing-dot,
  .activity-highlight {
    animation: none;
  }

  .animate-slide-up {
    animation-duration: 0.01ms;
  }
}
```

---

## Error Handling Patterns

### Specific Error Messages

```typescript
const ERROR_MESSAGES: Record<string, ErrorMessage> = {
  ACTIVITY_NOT_FOUND: {
    title: "Couldn't find that activity",
    description: "Try being more specific, like 'the Colosseum visit on Day 1'",
    action: "Try Again",
  },
  GENERATION_FAILED: {
    title: "Couldn't generate alternative",
    description: "Our AI had trouble. Want to try a different request?",
    action: "Try Different",
  },
  NETWORK_ERROR: {
    title: "Connection issue",
    description: "Check your internet and try again",
    action: "Retry",
  },
  BUDGET_EXCEEDED: {
    title: "Daily limit reached",
    description: "You've used your AI assistant quota for today. Resets at midnight.",
    action: "Upgrade Plan",
  },
};
```

---

## File Structure

```
components/ai/
├── AIAssistant.tsx              # Main chat component
├── AssistantCards.tsx           # Card rendering
├── StagedLoadingIndicator.tsx   # Multi-step loading
├── MatchConfirmationDialog.tsx  # Disambiguation UI
├── PreviewChangeCard.tsx        # Before/after preview
├── UndoToast.tsx               # Undo notification
├── TypingIndicator.tsx         # Premium typing dots
├── ErrorCard.tsx               # Error display
└── animations/
    ├── messageAnimations.ts    # Framer Motion variants
    ├── cardTransitions.ts      # Card swap animations
    └── index.ts                # Exports

hooks/
├── useUndo.ts                  # Undo stack management
├── usePrefersReducedMotion.ts  # Accessibility
├── useAIAgentSettings.ts       # User preferences
└── useAICostTracking.ts        # Cost monitoring

contexts/
├── AIAgentContext.tsx          # Global AI agent state
└── CostTrackingContext.tsx     # Cost monitoring state

lib/
├── ai-cache.ts                 # Caching utilities
├── ai-cost.ts                  # Cost calculation
└── ai-batch.ts                 # Request batching
```

---

## Performance & Cost Guidelines

### Lazy Load Animations

```typescript
// Only load Framer Motion when needed
const MotionDiv = dynamic(
  () => import("framer-motion").then((mod) => mod.motion.div),
  { ssr: false }
);
```

### Memoization

```typescript
// Memoize message components
const MemoizedMessage = memo(Message, (prev, next) => {
  return prev.id === next.id && prev.content === next.content;
});
```

---

## Dependencies

```bash
npm install framer-motion canvas-confetti
```

---

## References

- [WillowTree: AI Assistant Design Rules](https://www.willowtreeapps.com/insights/willowtrees-7-ux-ui-rules-for-designing-a-conversational-ai-assistant)
- [AufaitUX: Agentic AI Patterns](https://www.aufaitux.com/blog/agentic-ai-design-patterns-enterprise-guide/)
- [AI UX Patterns](https://www.aiuxpatterns.com/)
- [Shape of AI](https://www.shapeof.ai)
- [Framer Motion Docs](https://www.framer.com/motion/)
- [Canvas Confetti](https://github.com/catdad/canvas-confetti)

### Related Skills

- **gemini-travel-agent.md** - AI model selection, prompt engineering
- **frontend-design.md** - Design system, components, animations
- **amadeus-integration.md** - Travel API patterns

---

*Skill Version: 1.0*
*Last Updated: 2025-12-10*
*Compatible with: React 19, Next.js 16, Tailwind CSS 4*
