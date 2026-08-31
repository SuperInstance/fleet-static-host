# CONCEPT MOOD BOARD — ridiculous 1990s machines for kids

*Inventions lane, 2026-08-30. Illustrations for `docs/90s-MACHINES.md`.*

## Provenance

- **Model:** `@cf/black-forest-labs/flux-1-schnell` (12B, 4 steps) via
  **Cloudflare Workers AI REST API** (free-tier neurons, per spending
  doctrine — NOT DeepInfra). Account: Casey.digennaro@gmail.com.
- **Route:** wrangler OAuth token (this wrangler build dropped `wrangler ai
  run`; REST direct against `/accounts/…/ai/run/` instead). Generator
  script: `~/.openclaw/workspace/qs-moodboard-gen.py` (subprocess list-form,
  house law).
- **Post:** generated 1024×1024 JPEG, downscaled to 640×640 WebP q82 with
  PIL (12 files, 288 KB total — repo-friendly).
- **QA, booked honestly:** visual inspection by an image model was attempted
  and failed (`zai/glm-5v-turbo` 429 no-plan; DeepInfra fallback had no
  vision input). Style consistency comes from the shared style block below,
  not from human/AI eyeballing. If any image is off-vibe, regenerate: the
  recipe is fully reproducible.

## The style block (append to every subject)

> 1990s children's edutainment software illustration, flat chunky cartoon
> style, thick dark outlines, bright saturated primary colors (red, yellow,
> cyan, grass green), simple rounded geometric shapes, plain pale
> background, wholesome goofy energy, like a ridiculous Rube Goldberg
> machine from a 1994 kids game, no text, no words, no letters, no watermark

## The twelve (each maps to a compendium entry)

| File | Concept | Compendium entry |
|------|---------|------------------|
| `01-springboot-mouse.webp` | wind-up mouse in spring boots | TIM mouse × Sonic spring |
| `02-balloon-crane.webp` | balloon lifting a treasure chest | TIM balloon |
| `03-cannon-elevator.webp` | cannon fires a capsule upward | TIM cannon × hull-2 lift |
| `04-monkey-generator-belt.webp` | monkey pedals, belt carries bowling balls | TIM monkey-generator × belt |
| `05-teeter-totter-launch.webp` | catapult kid toward trampoline | TIM teeter-totter |
| `06-scissors-balloon-bucket.webp` | scissors about to pop the balloon | TIM scissors |
| `07-corkscrew-marble-run.webp` | spiral tube + pinball bumpers | Sonic corkscrew × bumper |
| `08-builder-staircase.webp` | builders passing bricks over a gap | Lemmings builder |
| `09-antigravity-pad.webp` | glowing pad flips crates upward | TIM anti-gravity |
| `10-flooz-pipes.webp` | glowing liquid through grid pipes | Pipe Dream flooz |
| `11-three-specialists.webp` | three vikings, one platform | Lost Vikings role-switch |
| `12-key-gate-machine.webp` | golden key meets gear gate | SMW key/keyhole = hull-2 lock |

## Failure ledger for this run

1. `wrangler ai run` — no longer exists in current wrangler (help shows only
   `ai models`/`ai finetune`). Worked around via REST with the wrangler
   OAuth token. Not a CF-auth failure; auth was fine on path 1.
2. Vision QA of generated art — both configured image-analysis models
   failed (429 / no image input). Booked above.
