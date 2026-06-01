# "The Lonely Explorer" — Shot-by-Shot Script (VALIDATE THIS FIRST)

Process: **write → validate → then generate reference images → then animate.**
No images are made from this until you approve the script.

Tagline (end card, every spot): **"Plans your whole trip in 30 seconds. Friends sold separately."**

## Global production rules (fixes from review)
1. **Solo framing — never clone him.** The Soul model copies the explorer onto
   any human in frame. So: every Soul-generated shot is **SOLO** ("he is the only
   person in the shot, no other people"). When a scene needs a crowd or extras
   (e.g. the club), we generate that plate **without** the Soul and keep extras as
   blurred, back-turned, or clearly different people — or composite him in. Every
   frame is checked for accidental duplicates before it's used.
2. **Phone is a hero prop.** In any handheld shot the phone is held clearly toward
   camera at readable size. AND every spot has ≥1 dedicated **SCREEN INSERT** — a
   full-frame cut to the *real app screenshot* (no AI on the UI) so the feature is
   crisp and unmistakable. Screen inserts are the product payoff.
3. **Explorer = Soul 2.0** `e10be608…` (solo). **Monkey end card** = cartoon mascot
   (`marketing/monkey/`). **App UI** = real screenshots, never AI-warped.
4. Length 15s; deadpan tone; 0–2s visual hook is sacred; end card 2.5–3s.

Shot types: **WIDE** (explorer in scene), **PHONE** (he holds phone to camera),
**INSERT** (full-frame real app screen), **END** (monkey + logo + tagline).

---

## SPOT 1 — "Solo Group Trip" (anthem) · feature: group voting · 15s
The gag: he's alone at a banquet for eight; "the group voted."

| t | shot | visual | VO / on-screen | audio |
|---|---|---|---|---|
| 0–3 | WIDE | He sits alone at the head of a long candlelit banquet table set for 8, jungle clearing. Raises a glass to no one. | (vo) "I let the whole group vote on the trip." | strings swell |
| 3–6 | WIDE (slow push) | Slow pan across **8 empty chairs**. He keeps smiling. | on-screen: *the group has spoken* | crickets |
| 6–10 | INSERT | Full-frame **voting screen** (activities with vote counts). A tally fills in. | (vo) "It was unanimous." | UI ding |
| 10–12.5 | PHONE | He lowers the phone, content, still alone. | — | beat |
| 12.5–15 | END | Cartoon monkey + logo. | text: **"Friends sold separately."** + Free · monkeytravel.app | button click |

Screens needed: clean **group-voting UI** (create — see Asset list).

---

## SPOT 2 — "The Louvre" · feature: real venues, hours, tickets · 15s

| t | shot | visual | VO / on-screen | audio |
|---|---|---|---|---|
| 0–3 | WIDE | Full safari kit + machete, he stalks an ornate empty museum gallery like a temple. | (vo) "Day four in the ruins…" | adventure perc. |
| 3–6 | WIDE | He "discovers" a famous painting, squints like it's treasure. | (vo) "…the locals call it 'the Louvre'." | reveal sting |
| 6–10 | INSERT | Full-frame **Paris itinerary**: Louvre card — open hours, ticket price, "4-min walk to next room". | on-screen: *hours · tickets · walking time* | UI ticks |
| 10–12.5 | PHONE | He nods at the phone. A guard (back-turned, different) ignores him. | (vo) "The jungle provides." | — |
| 12.5–15 | END | Monkey + logo + tagline. | "Friends sold separately." | — |

Screens needed: **Paris/Louvre day** itinerary (create or adapt barcelona itinerary).

---

## SPOT 3 — "Concrete Jungle" · feature: walking routes + real prices · 15s

| t | shot | visual | VO / on-screen | audio |
|---|---|---|---|---|
| 0–3 | WIDE | He machetes through a manicured city-park hedge, skyscrapers behind. | (vo) "Treacherous terrain." | tense perc. |
| 3–7 | INSERT | Full-frame **itinerary walking detail**: "Café → Museum · 6 min · 450 m · €4 coffee". | on-screen: *real routes · real prices* | map blip |
| 7–11 | PHONE | He points the phone at the (80 m away) museum, deadpan triumphant. | (vo) "Eighty meters. We made it." | — |
| 11–12.5 | WIDE | He steps over a tiny garden fence like a ravine. | — | comedic thud |
| 12.5–15 | END | Monkey + logo + tagline. | "Friends sold separately." | — |

Screens needed: crop of `trip-barcelona-itinerary.png` walking-time chips (have it).

---

## SPOT 4 — "Blue Light Special" (MEME) · feature: 30-second plan · 15s
Crowd spot → generate the club plate WITHOUT the Soul; composite him in; extras blurred.

| t | shot | visual | VO / on-screen | audio |
|---|---|---|---|---|
| 0–3 | WIDE | Neon-blue club. He dances deadpan in full safari kit, phone raised. (extras = blurred, behind, different) | text: *POV: tomorrow's already planned* | trending club beat |
| 3–6 | PHONE | Tight on the glowing phone in his raised hand. | — | beat builds |
| 6–9 | INSERT | Full-frame app: a day-by-day plan finishing generating (progress → done). | (vo) "Planned the whole trip in 30 seconds." | beat **drop** |
| 9–12.5 | WIDE | He keeps the exact same deadpan dance. | (vo) "So tonight's free." | — |
| 12.5–15 | END | Monkey (subtle bob to the beat) + logo + tagline. | "Friends sold separately." | — |

Screens needed: **generating → done** plan state (create) or use free-planner + itinerary.

---

## SPOT 5 — "Balanced Budget" · feature: budget tiers · 15s

| t | shot | visual | VO / on-screen | audio |
|---|---|---|---|---|
| 0–3 | WIDE | Tux jacket over explorer shirt, candlelit rooftop dinner at dusk, alone. Eats instant noodles from the pouch. | (vo) "Fine dining." | posh strings |
| 3–7 | INSERT | Full-frame **budget tiers**: Budget / Balanced / Premium — "Balanced" selected. | on-screen: *you pick the budget* | UI tick |
| 7–11 | PHONE | He toasts the phone with the noodle fork. | (vo) "I chose 'balanced'." | — |
| 11–12.5 | WIDE | Slurp. Deadpan to camera. | — | — |
| 12.5–15 | END | Monkey + logo + tagline. | "Friends sold separately." | — |

Screens needed: **budget tier** UI (adapt `08-budget-trip-planner`).

---

## SPOT 6 — "Wild ChatGPT" · feature: vs ChatGPT · 15s

| t | shot | visual | VO / on-screen | audio |
|---|---|---|---|---|
| 0–3 | WIDE | Cave. He faces a glowing stone tablet erupting with chaotic text. | (vo) "I asked the oracle for a plan." | ominous hum |
| 3–6 | WIDE | Tablet spews more nonsense; he's unimpressed. | on-screen: *"…no prices. no hours. no map."* | static |
| 6–10 | INSERT | Cut to full-frame clean **day-by-day itinerary** (real venues + prices). | (vo) "One of us has real prices." | clean chime |
| 10–12.5 | PHONE | He holds the tidy phone beside the messy tablet. | — | — |
| 12.5–15 | END | Monkey + logo + tagline. | "Friends sold separately." | — |

Screens needed: `10-from-chatgpt` + clean itinerary (have both).

---

## App screens / trips to create (after script approval)
| Screen | For | Source |
|---|---|---|
| Group-voting UI (vote counts) | Spot 1, 4 | create faithful UI (or authed capture) |
| Paris/Louvre day (hours+ticket+walk) | Spot 2 | adapt itinerary / authed Paris trip |
| Walking-time chip close-up | Spot 3 | crop `trip-barcelona-itinerary.png` ✓ |
| Plan "generating → done" | Spot 4 | create |
| Budget tiers selected | Spot 5 | adapt `08-budget-trip-planner` |
| Clean itinerary | Spot 2/3/6 | `trip-barcelona-itinerary.png` ✓ |

## Pipeline once script is approved
1. Generate **solo** explorer scene frames (Soul, 0.12cr) — checked for no duplicates.
2. Build/collect the **real app screens** above; use them full-frame for INSERT shots.
3. Composite phone-in-hand shots (nano_banana, 1–2cr) at correct phone size.
4. Animate WIDE + PHONE beats (veo3_1_lite 9cr; hero spot veo3_1 +audio); INSERTs are
   simple push-ins on the real screenshot (cheap/none).
5. Monkey end card + captions + trending sound; reframe/upscale.

---
### ✅ Please validate
- Spot order/selection, the VO lines, and the screen-insert moments.
- Anything to cut/add. Once you sign off, I'll create the reference images + screens.
