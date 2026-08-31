# THE 1990s MACHINE COMPENDIUM — what the classics teach quilt-scratch

*Inventions lane, 2026-08-30. Concept/art only — no code touched (repo at 583b24b).
Mined from memory by Lucineer (GLM-5.3); one honest gap booked at the bottom.
Mood board for this doc: `assets/concepts/` (12 images, Workers AI flux-1-schnell — see header there).*

## Why the 90s are the spec

Every great 90s machine game ran on one comedy principle: **a rule stated
plainly, obeyed literally, forever.** The wind-up mouse walks until it hits a
wall because that's what wind-up means. The balloon pops because balloons pop.
The rock falls because rocks fall. Nothing negotiated, nothing fudged — the
funny came from *physics doing exactly what it said it would do*, with total
dignity, in a universe that never apologized.

That is also quilt-scratch's law: **numbers over magic.** The 90s machines were
inspectable cells before we had the word for it — every mouse had a wind-down
counter, every bomber had his 5-4-3-2-1 painted on his face. The difference is
our kids can OPEN the mouse and watch the number. The comedy survives the
transplant; the opacity doesn't.

## The verdict ruler (how each mechanic is mapped)

- 🔌 **WIRING** — pure wiring of the existing 17 palette types + 6 hull-2
  tiles (actor, keyboard, bullet, creatureGrid, crash, boom×3, scorePing,
  npc, pilot, personality, sheet, skin, lift, pickup, lock, crumble, sign,
  explorer). No engine work. Ship it as a fabric file.
- 🧩 **TILE** — one new tile (or one new port on an existing tile), named,
  with its state/ports sketched. Must pass M1–M4 / N1–N4 like everyone else.
- 🚧 **EDGE** — structurally impossible under the fabric laws. The edge is
  *named*, because "say the edges out loud" is marketing AND law (IDEATION,
  hole 6).

The five fabric edges that decide verdicts, restated in one line each:

1. **Fixed-cell-set** — no spawn, no destroy. Multiplicity = pre-declared
   masks (`creatureGrid.alive[]`). "Exactly one bullet, on purpose."
2. **Crash is the only collision** — an X/Y range check that routes an event.
3. **N1/N3 slices** — a tile moves no one but itself; mechanics own one slice.
4. **One-tick-old wires** — values arrive one tick late; feedback loops are
   delay lines, and that's the lesson.
5. **Transform-don't-end** — nothing halts the room; games change regime
   (Threshold tile proposed, not yet built).

---

## The Incredible Machine (Sierra, 1992–93) — the ur-fabric

The whole game was wiring parts into a fabric and pressing RUN. It is our
grandparent. Nine mechanics:

- **Wind-up mouse** 🔌 — walked in a line until a wall, then turned; wound
  down visibly. Funny: it never doubted the plan.
  Map: villager npc with a palette seed (bWander maxed, bTend/bWave/bRest
  zeroed — same shape as `p-curious`, a seed not code). The cat that should
  chase it is a half-edge: `friendX/friendY` only bias waving, never movement
  (IDEATION, goto edge). So: the mouse ships, the cat waves helplessly at it,
  and that's somehow funnier.
- **Balloon** 🔌 — floated up until something popped it. Funny: buoyancy with
  no exit strategy.
  Map: the balloon IS the bullet wearing a costume — `bullet.y` climbs every
  tick; scissors = a crash tile with a narrow X/Y range; pop = `crash.boom →
  boomPop`. The engine's one-bullet law reads as "exactly one balloon, on
  purpose."
- **Cannon** 🔌 — fired when sparked. Funny: total commitment.
  Map: `keyboard.fire → bullet.fire`; the cannon is a skin on the fire event.
  This is the invaders wiring with a hat.
- **Scissors** 🔌 — existed to pop balloons, nothing else. Funny: a specialist.
  Map: crash-as-scissors (above). One job, done with pride.
- **Monkey-bicycle-generator** 🔌 — pedaled when scared, powered the cannon.
  Funny: fear as renewable energy.
  Map: a bit chain of wiring: scare → `pickup.pop`, `pickup.bit →
  crash.bulletAlive` — the monkey's courage is a bit the cannon reads. Every
  link inspectable. This is the TIM *chain reaction* reduced to wires, and it
  already runs today.
- **Conveyor belt** 🧩 — carried everything sideways at belt speed. Funny:
  objects leaving with dignity.
  Map: **Belt** — the lift's horizontal sibling. State: `{x, y, speed,
  deckLen}`; ports: `riderX/riderY` in, `deckX` out; tick: while ridden, x +=
  speed. One mechanic slice (its own deck), one new tile.
- **Anti-gravity pad** 🧩 — flipped which way "down" meant. Funny: agreeing
  loudly with gravity, in the other direction.
  Map: smallest honest shape is one new input port on explorer: `fallDir`
  (1/-1). A pad is a pickup whose `bit` writes it. Tiny, lawful (M2 keeps
  wires by name), and the inspector shows "down = -1" as a number.
- **Teeter-totter** 🚧→🧩 — weight on one end lifted the other. Funny: Justice,
  as a machine.
  Map: possible only as one tile owning BOTH ends and both riders' weights —
  the widest N3 slice proposed in this doc. Verdict: legal but expensive;
  park it behind the Belt and the Spring.
- **Bucket-pulley chain** 🔌 — water filled, bucket dropped, rope pulled,
  scissors closed. Funny: bureaucracy.
  Map: it's the monkey-generator pattern, longer: fill counter → Threshold →
  bit → pop. Pure wiring once the Threshold tile exists (already proposed).

## Lemmings (DMA Design, 1991) — the fixed population

The population never changed; only their *states* did. Our closest cousin
philosophically (fixed-cell-set as a game genre).

- **Builder** 🧩 — laid 12 bricks of staircase, then shrugged. Funny: the
  shrug at brick 12.
  Map: **Builder** — crumble's mirror image. State: `{bricks: 12, floors[]}`;
  ports: `playerX/playerY` in, `floors` out; tick: while walking, append a
  floor cell, decrement bricks. The countdown on its face is already a
  hull-2 law (crumble paints its own). Same code shape, sign flipped.
- **Blocker** 🧩 — became a wall so the others turned back. Funny: a person
  achieving furniture.
  Map: **Blocker** — an npc seed plus one output: its x becomes a floor cell
  on the `floors` channel the explorer already reads. Small tile, big laugh.
- **Digger/basher** 🔌 — removed floor, downward or sideways. Funny: terrain
  as a suggestion.
  Map: the crumble bridge IS the digger (touch → countdown → gone → knits
  back). Sideways = the same tile with an orientation field — a palette
  seed, `crumble-x` / "Solid bridge" precedent.
- **Floater (umbrella)** 🧩 — fell slowly and safely. Funny: dignity at 4
  frames per second.
  Map: explorer owns fall speed but has no `mood` port (npc/pilot do). One
  port addition: `explorer.mood`; an "Umbrella" personality card then biases
  fallSpeed. A card in the palette, one port in the engine.
- **Bomber** 🔌 — 5-4-3-2-1 painted on him, then a crater. Funny: the painted
  countdown, every time.
  Map: the countdown face exists (crumble), the pop routing exists
  (`pickup.pop → boomSparks`). Pop-with-confetti = wiring today;
  remove-terrain-on-event needs a `trip` input on crumble — one port.

## Sonic the Hedgehog (Sonic Team, 1991) — speed as texture

- **Spring** 🧩 — one tile, instant vertical enthusiasm. Funny: the *boing*
  was the whole character arc.
  Map: **Spring** — state `{x, y, power}`; ports: `playerX/playerY` in,
  `hop` event out → one new `explorer.hop` input. In the inspector the kid
  literally watches y jump by 220 in one tick and learns "a jump is
  arithmetic." Cheapest big delight on this page.
- **Bumper** 🚧 — bounced you back with a clang and a score. Funny: pinball
  dignity.
  Map: blocked twice over — bullet has no direction, explorer has no vx. The
  bumper waits for a ball that can be sorry. Named edge: **no momentum
  model.** (Score half works today: `crash.boom → scorePing`.)
- **Corkscrew / loop** 🚧 — speed glued you to the track. Funny: physics
  asleep at the wheel.
  Map: needs track normals + velocity — the deepest physics on this page,
  furthest from the fabric. Edge, named: **no momentum, no normals.**

## Super Mario World (Nintendo, 1990) — regime flips and living tools

- **Key + keyhole** 🔌 — carried the key to the door, secret unfolded.
  Funny: the door was *waiting*.
  Map: SHIPPED — hull-2's pickup+lock is this exact machine (SMW was the
  spec all along; the lineage is now official).
- **P-switch** 🧩 — pressed it and bricks became coins (and back) on a
  timer. Funny: the world confessing it was coins the whole time.
  Map: **Regime** — the P-switch is quilt-scratch's *identity tile*: state
  `{on, timer}`; outputs `bit`. Wire `bit` into consumers that flip behavior
  (crumble fragile on/off, grid read as coins). Needs consumers to accept a
  regime input (one input port each). "Systems don't halt, they change
  regime" becomes a button kids can press. Also covers Chip's Challenge
  toggle walls wholesale.
- **Note block** 🧩 — bounce + a musical note. Funny: the note played YOU.
  Map: Spring with a face that paints the pitch number. Audio is
  deliberately cut (hull-2 "not built, by name"), so ship it silent with the
  number visible — the sound is a number until sound ships.
- **Yoshi as a machine** 🔌 — a mount that ate things and shot them back.
  Funny: digestion as ordnance.
  Map: pure NET-CAST geometry, wired: `explorer.x → crash.bulletX`,
  `explorer.y → crash.bulletY`, `constant(1) → crash.bulletAlive` (you are
  the catcher), `crash.killIndex → grid.killIndex` (swallow),
  `keyboard.fire → bullet.fire` (spit). Your pet is a crash tile in a
  dinosaur costume.

## The Lost Vikings (Silicon & Synapse, 1993) — three specialists, one wire

- **Role-switching** 🧩 — one viking active, abilities split three ways.
  Funny: three heroes, one pair of hands.
  Map: two-stage. (a) 🔌 TODAY: wire `keyboard.move` to three explorers at
  once — fan-out is legal wiring! — and get **Synchronized Vikings**, a
  three-body puzzle where everyone walks together (hilarious, genuinely
  playable, zero engine work). (b) 🧩 HONEST: true switching needs a
  **Selector** — state `{active: 0|1|2}`; ports: `move` in, `moveA/B/C` out,
  `fire` cycles active. One tile, and it doubles as the fan-in fix's sibling
  (fan-out's mux).

## Pipe Dream (LucasFilm, 1991) — the flooz

- **Pipes before the flooz** 🔌 — lay a path on a fixed grid, then the liquid
  came and told you the truth. Funny: the truth was a liquid.
  Map: quilt-scratch IS this game — cells on a grid, ports, a moving `1`.
  The flooz = an event walking a chain of wires, each pipe tile passing it
  when full (bits propagating). Ship it as a demo fabric: pre-laid pipes,
  the kid rewires before the flooz arrives. The arrival timer is the
  proposed Threshold tile. Zero new engine.

## Contraption Zack (Mindscape, 1992) — the broken machine

- **Repair puzzles** 🔌 — a machine that SHOULD work, one wrong part; find
  it, fix it. Funny: someone else's confident mistake.
  Map: a *level format*, not a tile: ship fabrics with a missing wire or a
  swapped tile, Sign carries the complaint ("the lift never comes — Theo is
  sure the wire fell behind the shelf"). The kid repairs; M2/N4 guarantee
  the repair is safe and the mistake is archived. Zero engine cost, entire
  curriculum in one idea: reading someone else's wiring is the deepest
  programming lesson we can offer.

## Chip's Challenge (Epyx, 1989) — regime and floors

- **Toggle walls** 🧩 — wall↔floor on a global beat. Map: Regime tile (see
  P-switch).
- **Force floors** 🧩 — conveyor tiles that pushed. Map: Belt (see TIM).
- **Ice** 🚧 — enter it, slide until you leave it. Funny: commitment.
  Map: needs a velocity model — the same edge as the bumper. Named: **no
  momentum.**

## Boulder Dash (First Star, 1984 — but every kid met it in the 90s) — the cellular automaton

- **Rocks with opinions** 🧩 — fell if unsupported, rolled off rounded
  things, crushed without appeal. Funny: gravity as personnel.
  Map: **BoulderField** — one tile owning a small grid, `creatureGrid`
  precedent: state `{cells[], alive[]}`; tick: classic falling rule per
  cell; ports: `playerX/playerY` in, `crush` event out, `grid` out (so crash
  can see it). Medium cost, and it's the *deepest* lineage match: Boulder
  Dash was per-cell ticks before tiles existed.

## Lode Runner (Broderbund, 1983 — same 90s-kid caveat) — dig and heal

- **Dig-hole, guard falls, hole heals** 🔌 — SHIPPED: the crumble bridge is
  this exact mechanic (touches → countdown → gone → knits back). The guard
  falling in is blocked by the no-NPC-gravity edge (npc owns no fall), so
  today the *hole* works and the *guard* waves at it — see the cat, above.
  The 90s classics keep converging on hull-2.

## Donkey Kong (Nintendo, 1981→ every 90s port) — hostile springs

- **Springs on girders** 🧩 — bounced downhill toward you on a fixed path.
  Funny: menace on a schedule.
  Map: Spring + an authored platform path (npc-with-hop). Low priority: the
  friendly Spring delivers 90% of the delight at 10% of the menace.

## Pengo (Sega, 1982) — the push

- **Push-block that slides and crushes** 🧩 — you pushed, it committed.
  Funny: momentum you borrowed.
  Map: **IceBlock** — state `{x, y, dx}`; ports: `playerX/playerY` in,
  `grid` out; tick: keeps sliding until it hits, then crash rules. Solves N1
  by owning its own slide. Medium.

## Arkanoid/Breakout (Taito, 1986 — the 90s lived in it) — the paddle

- **Paddle as machine** 🔌/🚧 — your x WAS the machine; the ball was physics.
  Map: paddle = `actor.x ← keyboard.move` (wiring, today). Ball = EDGE: the
  bullet only climbs — there is no falling ball, because gravity is a story
  we haven't wired. Named: **bullet has no direction** (also blocks return
  fire, IDEATION).

## Ghost Trap — booked honestly

The brief names it; I can't confirm a canonical 1990s *Ghost Trap* from
memory and won't invent one. The name does the work anyway: trap-as-capture
= pickup + lock + a Spring under the floor. If Casey means a specific game,
tell me and it gets a real entry.

---

## Top 10 — kid-delight ÷ implementation cost

| # | Mechanic | Verdict | Delight | Cost | Why it wins |
|---|----------|---------|---------|------|-------------|
| 1 | **Spring** (Sonic/TIM trampoline) | 🧩 tile, tiny | 10 | 1 | one tile + one `explorer.hop` port; y jumps 220 in one tick, visibly |
| 2 | **Contraption Zack repairs** (broken fabrics) | 🔌 wiring | 9 | 0 | a level format; Sign carries the complaint; repair = the lesson |
| 3 | **P-switch / Regime** (SMW, Chip's toggle walls) | 🧩 tile, small | 10 | 2 | the transform-don't-end identity as a button |
| 4 | **Synchronized Vikings** (Lost Vikings) | 🔌 wiring | 8 | 0 | fan-out is legal; three heroes, one pair of hands, free |
| 5 | **Yoshi-as-machine** (SMW) | 🔌 wiring | 8 | 0 | NET-CAST geometry already built; pet = crash tile in costume |
| 6 | **Builder staircase** (Lemmings) | 🧩 tile, small | 9 | 2 | crumble mirrored; brick budget painted on its face |
| 7 | **Monkey-generator chains** (TIM) | 🔌 wiring | 7 | 0 | scare→bit→armed: courage as a number, runs today |
| 8 | **Belt / force floor** (TIM, Chip's) | 🧩 tile, small | 7 | 2 | lift's horizontal sibling; objects leave with dignity |
| 9 | **Cannon-capsule** (TIM) | 🔌 wiring | 6 | 0 | bullet + a skin; total commitment, existing ports |
| 10 | **BoulderField** (Boulder Dash) | 🧩 tile, medium | 10 | 4 | deepest lineage match — per-cell ticks, rocks as personnel |

*(Selector — true Lost-Vikings switching — is #11 by a hair: small tile,
but Synchronized Vikings delivers the joke for free first.)*

## What the 90s teach the fabric edges

Every classic above that hit an edge hit the SAME three: **no momentum**
(bumper, ice, corkscrew), **no NPC gravity** (the cat, the falling guard),
**no spawn/destroy** (Lemmings' population was fixed too — they chose the
mask, we inherit it). The 90s answer to all three was the same as ours:
don't patch the physics, change the regime. Mario doesn't get momentum on
ice; the LEVEL becomes momentum. That's a Regime tile, a Belt tile, and a
Threshold tile — three small tiles and the 90s are wired.

*One more thing the 90s knew: every machine had a FACE. The wind-down, the
5-4-3-2-1, the brick counter. Our faces are inspectable numbers — the joke
and the lesson land in the same place.*

— Lucineer, inventions lane, 2026-08-30
