# "The Lonely Explorer" — Super Bowl–style spot series

Big-budget *feel*, dumb-simple *idea*. A series of :15–:30 spots built on one
running gag, each demoing ONE feature, each ending on the cartoon monkey + logo.

## The running gag (the whole campaign in one line)
> Our rugged Jumanji explorer treats every trip like a solo expedition into the
> unknown — while ironically using (and loving) an app **built for groups**.
> He is *gloriously, obliviously alone*. Deadpan confident. The joke writes itself.

**Why it works:** absurd visual hook (explorer where he doesn't belong) + a
deadpan feature demo + the "alone vs. group" irony = funny, shareable, and it
*actually communicates the product*. Same character every time = brand recall.

## Tone & format rules
- Deadpan, confident, never winking too hard. He believes he's a hero.
- One spot = one absurd setting + one feature + one end card. 0–3s hook is sacred.
- He **ironically presents the app** (holds the phone up, real screen composited on it).
- **End card every time:** cartoon monkey (`marketing/monkey/`) + MonkeyTravel logo
  + tagline + "Free · monkeytravel.app".

## Tagline options (end card)
- "MonkeyTravel — built for groups. *He's still working on the friends part.*"
- "Plans your whole trip in 30 seconds. *Friends sold separately.*"
- "The trip plans itself. *The squad is on you.*"

## The spots

### 1. "Solo Group Trip" (anthem / hero spot) — feature: group voting
Explorer at a long banquet table set for eight, alone in a candlelit jungle
clearing. Raises a glass: *"I let the whole group vote on the itinerary."* Beat.
Pan across eight empty chairs. *"It was unanimous."* Phone shows the **voting**
screen. → end card.

### 2. "The Louvre" — feature: real venues, hours, tickets
Full safari kit + machete, he stalks through the Louvre like a lost temple,
"discovers" the Mona Lisa, checks the app: *"Opening hours, ticket price, 4-min
walk to the next room. The jungle provides."* A guard stares. → end card.

### 3. "Concrete Jungle" — feature: smart walking routes + real prices
He rappels off a café awning / machetes through a manicured city hedge to reach
a museum 80 meters away. *"Brutal terrain. Good thing it mapped the walking
route."* Shows **walking times between stops**. → end card.

### 4. "Blue Light Special" — feature: 30-second plan (MEME BAIT)
He recreates the viral blue-neon **dancing-guy meme** in a packed club — full
explorer outfit, machete on belt, completely deadpan, phone aloft showing a
generating itinerary. Text: *"POV: you planned tomorrow in 30 seconds, so tonight
is free."* Pure trend bait. → end card.

### 5. "Balanced Budget" — feature: budget tiers
Tuxedo-fancy rooftop, he smugly eats instant noodles from the pouch. *"I chose
the 'balanced' budget."* Shows **budget tier** screen. → end card.

### 6. "Wild ChatGPT" — feature: vs ChatGPT
He confronts a chaotic stone tablet spewing a wall of text (the "wild ChatGPT"),
then calmly taps the app's tidy day-by-day. *"One of us has real prices."* → end card.

## Per-spot :15 skeleton
| 0–3s | absurd setting + explorer | visual hook, no logo |
| 3–8s | deadpan line + phone up (real app screen) | the feature |
| 8–12s | the "alone vs group" irony beat | the laugh |
| 12–15s | cartoon monkey + logo + tagline + CTA | the brand |

## Production pipeline (all on-model, cheap-first)
Two locked characters: **Explorer** = Soul 2.0 `e10be608-4d2a-47b4-ad4a-e134a44795cb`;
**Monkey** = cartoon mascot via nano_banana multi-ref (`public/images/404.png` + `logo.png`).

```bash
S=e10be608-4d2a-47b4-ad4a-e134a44795cb
# 1) Explorer in the scene (on-model, 0.12cr) — e.g. the Louvre
higgsfield generate create text2image_soul_v2 --custom_reference_id $S \
  --aspect_ratio 9:16 --quality 2k --prompt "<absurd scene>, holding up his phone, deadpan" --wait
# 2) Composite the REAL app screen onto his phone (1–2cr)
higgsfield generate create nano_banana_2 --aspect_ratio 9:16 \
  --prompt "put this app screen on the phone he holds, keep UI crisp" \
  --image <scene.png> --image <app-screen.png> --wait
# 3) Animate the key frame (9cr, +audio) — or veo3_1 (premium) for the hero spot
higgsfield generate create veo3_1_lite --image <composited.png> \
  --aspect_ratio 9:16 --duration 6 --generate_audio true --prompt "<subtle motion + sfx>" --wait
# 4) Monkey end card: animate m1/m2 subtly or keep static + logo overlay in edit
# 5) Finish: reframe (→9:16 if needed) + topaz upscale; assemble + captions + trending sound
```

## App screens / trips to create per spot
Use existing where possible (`public/screenshots/trip-barcelona-itinerary.png`,
`public/video/screens/*`, `marketing/screenshots/*`). Create these:
- **Voting screen** (Spot 1) — group voting UI (use `07-group-trip-planner` or a real authed capture).
- **Paris/Louvre itinerary** (Spot 2) — a Paris day with the Louvre, hours+ticket+walk (real trip or composite).
- **Walking-route detail** (Spot 3) — the itinerary's walking-time chips (crop of `trip-barcelona-itinerary`).
- **Nightlife/weekend plan** (Spot 4) — generating state / a weekend itinerary.
- **Budget tier** (Spot 5) — `08-budget-trip-planner` or the budget toggle.
- **vs ChatGPT** (Spot 6) — `10-from-chatgpt` + a clean itinerary.

> If a screen doesn't exist, we generate a faithful UI still (nano_banana from a
> real screenshot) or capture a real authed trip in Chrome.

## Recommended build order (cheap-first)
1. **Spot 4 "Blue Light Special"** — highest virality (meme), cheapest to fake, great test.
2. **Spot 1 "Solo Group Trip"** — the anthem; nails the core message.
3. Then 2/3/5/6 as the matrix. Make 1 hero spot with **veo3_1 (premium + audio)**; rest on `veo3_1_lite`.
Est. ≈ 15–30 credits per finished :15 spot (scene + composite + 1–2 animated clips).
