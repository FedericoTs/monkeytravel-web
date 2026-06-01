# Character Bible — "The Explorer" (MonkeyTravel mascot, Concept A)

Ironic Jumanji-style jungle adventurer who does everything the hard way — then
discovers MonkeyTravel planned the whole trip in 30 seconds. Smug-but-likable.

## Locked visual identity (use this as the prompt anchor)
> A rugged male explorer, ~45, weathered sun-tanned skin, salt-and-pepper stubble
> beard, hazel-blue eyes, tousled brown hair, brown leather-banded safari hat,
> khaki multi-pocket explorer vest over an olive field shirt, leather satchel
> strap across chest, machete on belt, cargo trousers. Photorealistic, cinematic.

Origin/anchor frame: `marketing/tests/test-A.png` (explorer holding the phone with
the real itinerary). Every reference below was generated anchored to that face via
`nano_banana_2` (Nano Banana Pro, 2k) for identity consistency.

## Reference set (8 — Soul-ready: varied angle/expression/framing, clean bg)
| File | Shot |
|---|---|
| `01-front-headshot.png` | Front headshot, hat on, neutral grey studio |
| `02-front-nohat.png` | Front headshot, hat off (face/hair) |
| `03-threequarter-left.png` | 3/4 left, head & shoulders |
| `04-threequarter-right.png` | 3/4 right, head & shoulders |
| `05-profile.png` | Full side profile |
| `06-fullbody.png` | Full body, satchel + machete, clean bg |
| `07-grin.png` | Big smug grin (expression range) |
| `08-action.png` | Jungle action / in-context |

## Highest-fidelity reuse — best practice
**Option 1 (recommended): train a Soul 2.0 ID** so the exact character is reusable in any scene:
```bash
# upload refs → ids, then train
for f in marketing/refs/0*.png; do higgsfield upload create "$f"; done   # collect the ids
higgsfield soul-id create --name "MonkeyExplorer" --soul-2 \
  --image <id1> --image <id2> --image <id3> --image <id4> --image <id5> --image <id6> --image <id7> --image <id8>
higgsfield soul-id wait <soul_id>
# then generate the character in any scene via Soul image models (text2image_soul_v2 / soul_cinematic)
```
**Option 2 (no training): multi-reference compositing** — pass 2–3 of these refs as
`--image` inputs to `nano_banana_2` together with an app screenshot to keep identity
consistent shot-to-shot (cheaper, slightly less locked than Soul).

## Tone / usage notes
- Hero line energy: *"Day 3 of planning the hard way… or I could've just done this."*
- Always pair the character with a **real app screen** on the phone (use the
  `public/screenshots/trip-barcelona-itinerary.png` itinerary as the money shot).
- Keep him likable-smug, never arrogant; the joke is effort-vs-effortless.
