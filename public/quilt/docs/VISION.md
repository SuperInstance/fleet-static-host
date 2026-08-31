# VISION — quilt-scratch

*Founding brief, from Casey, 2026-08-30. Keel laid by Lucineer.*

## What this is

ScratchJr taught kids to snap instruction blocks. quilt-scratch snaps
**cells** — small running things with state, ports, and their own tick
loops. A student wires tiles into a fabric and gets a visual game engine
they can watch from the inside: open any tile, see its numbers change
every tick. No code anywhere. The wiring IS the program.

## Tile taxonomy (the founding palette)

- **Actor tiles** — things with a position in the room. A position is not
  hidden inside a sprite: it IS a cell whose state is `{x, y}` (and friends:
  velocity, facing). Open the ship tile and watch x increment every tick.
- **Runtime / NPC tiles** — preset characters with a complete idle loop.
  A shopkeeper ticks on her own: sweep, stock shelves, wave at passers-by.
  No IO required for her to live. The room renders; she exists in it.
  These are the "community" tiles: gardener, shopkeeper, neighbors who live
  upstairs in their building.
- **Personality tiles** — snap onto an actor to change how its idle loop
  chooses: curious, shy, grumpy, helpful. Same skeleton, different weights.
- **Character-sheet tiles** — name, age, backstory, inventory. The editable
  "who am I" card.
- **Skin/clothing tiles** — pure appearance, swappable without touching
  behavior. (The explosion-look principle applies to people too: how a
  character LOOKS is a routed tile, not a property buried in logic.)
- **Mechanics tiles** — the laws. Crash-physics (an X/Y range + what to route
  on overlap), gravity, boundaries, timers. A mechanic tile owns its slice
  of the world and nothing else.
- **Effect tiles** — what happens on a routed event: explosion-look,
  sound, score-ping. Swappable per-event: the crash cell routes "on hit" to
  whichever effect tile the student picked, and flipping the tile changes
  the explosion everywhere without rewiring anything.

## The canonical worked example: space invaders

- The player ship going back and forth along the bottom: an **actor tile**
  whose position cell holds `x` (y fixed). Every tick the wired input tile
  nudges `x`.
- A shot: the fire event writes the bullet cell with `x = ship.x` (the exact
  spot it left from) and `y` climbing every tick until it either leaves the
  screen or lands inside the X/Y range of a creature above.
- The space creatures: an actor grid, each with an X/Y range in its cell.
- **The crash-physics cell** runs the mechanics AND the visualization of
  impact: it checks "bullet y inside creature range?", and on a hit it
  routes to the wired **effect tile** — how the explosion LOOKS is just
  whichever tile is routed there, and can be flipped through like changing
  channels.

A student who builds this has learned: state, coordinates, loops, events,
collision, and separation of mechanics from appearance. They learned it by
watching numbers, not by reading syntax.

## Why quilt (the substrate kinship)

Cells with conserved state, tick loops, and ports — the same shape as the
quilt fabric. The educational claim is the engineering claim: a fabric of
inspectable, composable cells is the friendliest honest model of computing
we know. Watching a shopkeeper NPC tick is watching a cell with an idle
loop. Watching the bullet's y climb is watching a state transition. Same
laws, kid-sized rooms.

## Scope of the first hull (prototype, undersold)

1. A web canvas engine (no install, runs in a browser) with a tile palette
   and drag-wire fabric editor.
2. Cells tick; a state inspector panel shows any cell's numbers live.
3. Palette ships with: position actor, keyboard-input, bullet, crash-physics
   with swappable effect routing, and one NPC runtime tile (the shopkeeper,
   full idle loop) with attachable personality + character-sheet + skin tiles.
4. Two demo scenes: the space-invaders wiring, and a small community block
   (gardener + shopkeeper living upstairs) that just... lives.
5. Saved fabrics are files (JSON), never destroyed — rewire keeps history.

## Explicitly not in the first hull

Accounts, sharing, mobile, LLM-generated tiles, sound synthesis. A browser
game engine with living cells is the whole goal; gold-plating waits.

## Hull-2 addendum — the deep caverns (2026-08-30)

The second hull proves the laws hold under a different genre: a platform
Descent, not a shooter. Four mechanics from the spec — Lift, Key/Lock,
Crumble, Sign — plus exactly ONE justified extra tile, the Explorer, because
"walk on floors, ride a deck, fall when unsupported" is a tick nobody owned
and wiring cannot inject one. Everything else is wiring:

- The key bit, the lock's open bit, the bridge's gone array, the fall count —
  every rule of the level is a cell value a kid can click.
- Falling is SAFE: respawn at the start, progress bits live on their own
  cells and are KEPT. A fall is a retry, not a punishment spiral.
- The Goal is the Key tile with a different starting state; its pop routes to
  the existing Sparks confetti. New games, no new effect tiles.
- The Solid bridge is the Crumble tile with fragile=0 — the mid-game swap
  demo #2: swap it under a player mid-bridge and the wires stay, the touch
  counts carry, the pending pop cancels.
- Still not built, by name: enemies/pathfinding, sound, save/continue,
  touch.
