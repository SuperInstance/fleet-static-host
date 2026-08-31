# TILE-CONTRACT — what every quilt-scratch tile must and must not do

*Normative. A tile that breaks a MUST is a bug; a tile that breaks a
"never" is a recall.*

## A tile IS

1. **A state** — plain visible numbers/strings, inspectable at any tick.
   No hidden fields. If the engine can see it, the inspector shows it.
2. **A tick loop** — `tick(state, inputs, room) -> state`. Runs every frame
   whether or not any IO arrives. An idle NPC is a tile whose tick does
   its life with zero inputs.
3. **Ports** — named inputs and outputs. Wires connect ports. A wire
   carries values (numbers, strings, events); ports are typed loosely
   (number / text / event / any) and mismatches are flagged in the editor,
   not silently coerced.
4. **A face** — appearance is a SKIN slot wired like any other port. The
   logic never knows what it looks like.

## A tile MUST

- M1. Be inspectable: the state inspector shows every field, live.
- M2. Be swappable: replacing a tile keeps its wires by port name; only
  unmatched ports re-wire.
- M3. Fail visibly: a tile that errors halts ITSELF, shows its error in
  its face, and the room keeps running without it.
- M4. Be saveable: a fabric file (JSON) fully captures tiles, wires,
  state, and history of rewires.

## A tile NEVER

- N1. Reaches into another tile's state except through a wire.
- N2. Hides a number the inspector can't show.
- N3. Mutates the room outside its declared mechanic slice (a
  crash-physics tile owns collisions; it may not move the ship).
- N4. Destroys history (rewires append; nothing is deleted).

## Starting-state rule

Every actor tile takes a **starting state** — "she is the community
gardener, lives upstairs" is a starting state: role, home cell, initial
inventory, initial mood weights. From tick 1 the student's community runs
itself, and every divergence from the starting state is visible in the
inspector. That divergence IS the game.
