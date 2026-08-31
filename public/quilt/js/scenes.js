/* scenes.js — the two founding scenes.
 *
 * 1. "Space invaders, in cells" — the canonical wiring from VISION.md:
 *    keyboard nudges the ship actor; fire writes the bullet with x = ship.x;
 *    the bullet's y climbs; crash-physics watches the bullet against the
 *    creature grid and routes a boom to the wired effect + score.
 * 2. "Community block" — a shopkeeper and a gardener who just... live.
 *    Zero IO. Their sight line to each other is literally a wire.
 */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});

  const W = (f, a, ap, b, bp) => { const w = f.addWire(a, ap, b, bp); if (!w) throw new Error('bad wire ' + a + '.' + ap + '→' + b + '.' + bp); return w; };

  QS.Scenes = {};

  /* ---------- space invaders ---------- */

  QS.Scenes.invaders = function () {
    const f = new QS.Fabric({ name: 'space invaders (canonical example)', decor: 'stars' });
    const kb = f.addTile('keyboard', 40, 40);
    const ship = f.addTile('actor', 40, 170, { name: 'ship', skin: 'rocket', x: 320, y: 330, speed: 4.5 });
    const bul = f.addTile('bullet', 40, 300);
    const grid = f.addTile('creatureGrid', 300, 40);
    const crash = f.addTile('crash', 300, 300);
    const boom = f.addTile('boomPop', 560, 170);
    const score = f.addTile('scorePing', 560, 40);
    // the wiring IS the program:
    W(f, kb.id, 'move', ship.id, 'move');       // keys nudge ship.x
    W(f, ship.id, 'x', bul.id, 'x');            // bullet latches the spot it left from
    W(f, kb.id, 'fire', bul.id, 'fire');
    W(f, bul.id, 'x', crash.id, 'bulletX');     // crash owns collisions — and nothing else
    W(f, bul.id, 'y', crash.id, 'bulletY');
    W(f, bul.id, 'alive', crash.id, 'bulletAlive');
    W(f, grid.id, 'grid', crash.id, 'grid');
    W(f, crash.id, 'killIndex', grid.id, 'killIndex');
    W(f, crash.id, 'spent', bul.id, 'die');       // the hit belongs to crash; it TELLS the bullet
    W(f, crash.id, 'boom', boom.id, 'boom');    // how the explosion LOOKS = this one wire
    W(f, crash.id, 'boom', score.id, 'boom');   // fan-out: the same event, two effects
    f.history.unshift({ i: 0, tick: 0, kind: 'scene', detail: 'founded scene "space invaders" — the wiring IS the program' });
    return f;
  };

  /* ---------- community block ---------- */

  QS.Scenes.community = function () {
    const f = new QS.Fabric({ name: 'community block (they just live)', decor: 'block' });
    const maya = f.addTile('npc', 60, 60, { role: 'shopkeeper', name: 'Maya', displayName: 'Maya', x: 210, y: 190, homeX: 210, homeY: 190, roamMin: 120, roamMax: 330, seed: 42 });
    const theo = f.addTile('npc', 60, 330, { role: 'gardener', name: 'Theo', displayName: 'Theo', x: 470, y: 240, homeX: 470, homeY: 240, roamMin: 380, roamMax: 580, seed: 99, wTend: 5 });
    const moodM = f.addTile('personality', 340, 60, { style: 'helpful', note: 'waves more, tends more', bTend: 1, bWave: 2, bRest: -1 });
    const moodT = f.addTile('personality', 340, 330, { style: 'curious', note: 'wanders more, rests less', bWander: 3, bRest: -1 });
    const sheetM = f.addTile('sheet', 480, 60, { name: 'Maya', age: '34', backstory: 'Lives upstairs over the shop. Sweep, stock, wave — that is a good day.', inventory: 'broom, key, tea' });
    const sheetT = f.addTile('sheet', 480, 330, { name: 'Theo', age: '61', backstory: 'Retired ferryman. Grows tomatoes for the whole block.', inventory: 'trowel, seeds, hat' });
    const skinM = f.addTile('skinPick', 620, 60, { pick: 'party', label: 'Party hat' });
    // personality, sheet, skin — all snap on through wires, all swappable
    W(f, moodM.id, 'mood', maya.id, 'mood');
    W(f, sheetM.id, 'sheet', maya.id, 'sheet');
    W(f, skinM.id, 'skin', maya.id, 'skin');
    W(f, moodT.id, 'mood', theo.id, 'mood');
    W(f, sheetT.id, 'sheet', theo.id, 'sheet');
    // the sight lines: each can only see the other through a wire (N1)
    W(f, theo.id, 'x', maya.id, 'friendX');
    W(f, theo.id, 'y', maya.id, 'friendY');
    W(f, maya.id, 'x', theo.id, 'friendX');
    W(f, maya.id, 'y', theo.id, 'friendY');
    f.history.unshift({ i: 0, tick: 0, kind: 'scene', detail: 'founded scene "community block" — no keyboard anywhere; the cells live on their own' });
    return f;
  };

  /* ---------- harbor defense (level-2) ----------
   * The invaders geometry, inverted: the formation still descends, but the
   * thing it advances toward is FIXED — Bea the lighthouse keeper, who never
   * leaves her dock (that is her starting state). The player's ship is a
   * RUNTIME tile: it patrols and volleys on its own idle loop, a personality
   * card snaps onto its mood port, and the keyboard can still take the wheel.
   * The composition trick worth showing a kid: the dock guard is the SAME
   * crash tile as the shot checker — invaders wires the bullet's position
   * into it; harbor wires the KEEPER's position into it. New game, no new
   * mechanic. When a creature boards the dock: the breach booms on a
   * swappable effect (swap Ring→Sparks mid-game — same wire), a life comes
   * off the pilot's cell through the hurt wire, and the pilot rings the next
   * wave. Every number — lives, score, breaches, waves — is state on a cell. */
  QS.Scenes.harbor = function () {
    const f = new QS.Fabric({ name: 'harbor defense (protect the dock)', decor: 'harbor' });
    const kb = f.addTile('keyboard', 24, 24);
    const pilot = f.addTile('pilot', 24, 108, { name: 'Pip' });
    const cap = f.addTile('p-captain', 24, 258);
    const bul = f.addTile('bullet', 196, 300, { startY: 146, speed: 5 });
    const grid = f.addTile('creatureGrid', 226, 24, { originX: 40, originY: 30, drift: 1.1, stepDown: 16 });
    const shot = f.addTile('crash', 226, 200);   // bullet vs grid — the invaders wiring
    const dock = f.addTile('crash', 226, 300);   // keeper vs grid — same tile, new wiring
    const keeper = f.addTile('npc', 420, 24, {
      role: 'shopkeeper', name: 'Bea', displayName: 'Bea',
      x: 320, y: 330, homeX: 320, homeY: 330,
      roamMin: 320, roamMax: 320,   // she never leaves her dock — that IS the starting state
      wWander: 0, wTend: 6, wWave: 1, wRest: 3, seed: 5
    });
    const sheet = f.addTile('sheet', 588, 24, {
      name: 'Bea', age: '58',
      backstory: 'Keeper of the harbor light. She sweeps her dock between waves and never leaves it.',
      inventory: 'broom, lantern, bell'
    });
    const pop = f.addTile('boomPop', 420, 130);    // how a creature-hit LOOKS
    const ring = f.addTile('boomRing', 420, 230);  // how a breach LOOKS — swap me mid-game
    const score = f.addTile('scorePing', 588, 130);
    // the player layer — hands on the wheel through wires
    W(f, kb.id, 'move', pilot.id, 'move');
    W(f, kb.id, 'fire', pilot.id, 'fire');
    // the personality card: swap this ONE card, same ship, different sailor
    W(f, cap.id, 'mood', pilot.id, 'mood');
    // the gun (the invaders wiring, pointed at a self-sailing ship)
    W(f, pilot.id, 'x', bul.id, 'x');
    W(f, pilot.id, 'fire', bul.id, 'fire');
    W(f, bul.id, 'x', shot.id, 'bulletX');
    W(f, bul.id, 'y', shot.id, 'bulletY');
    W(f, bul.id, 'alive', shot.id, 'bulletAlive');
    W(f, grid.id, 'grid', shot.id, 'grid');
    W(f, shot.id, 'killIndex', grid.id, 'killIndex');
    W(f, shot.id, 'spent', bul.id, 'die');
    W(f, shot.id, 'boom', pop.id, 'boom');        // creature-hit look: swappable too
    W(f, shot.id, 'boom', score.id, 'boom');      // fan-out: the same event, two effects
    // the dock guard — the SAME crash tile, pointed at the keeper's POSITION CELL
    W(f, keeper.id, 'x', dock.id, 'bulletX');
    W(f, keeper.id, 'y', dock.id, 'bulletY');
    W(f, pilot.id, 'onStation', dock.id, 'bulletAlive');  // the watch is on → the guard is armed
    W(f, grid.id, 'grid', dock.id, 'grid');
    W(f, dock.id, 'boom', ring.id, 'boom');       // how a breach LOOKS — the swap point
    W(f, dock.id, 'boom', pilot.id, 'hurt');      // a life is a number on the pilot, told through a wire
    // the pilot rings the waves (breach bell or all-clear) — and keeps an eye on the field
    W(f, grid.id, 'grid', pilot.id, 'grid');
    W(f, pilot.id, 'wave', grid.id, 'reset');
    // the keeper's card
    W(f, sheet.id, 'sheet', keeper.id, 'sheet');
    f.history.unshift({ i: 0, tick: 0, kind: 'scene', detail: 'founded scene "harbor defense" — same crash tile, new wiring: it now guards the keeper\'s position cell' });
    return f;
  };

  /* ---------- the deep caverns (hull-2) ----------
   * A descent: start ledge → lift shaft → key room guarded by a crumble
   * bridge (the FIRST brick is worn — authored state, visible from tick 1)
   * → lock gate → goal, whose pop routes to Sparks confetti (reused, not
   * rebuilt). Two signs tell the story (Maya's map, Theo's joke); the
   * community block chats in the deep gallery below — they just live there.
   * The level itself is a ~24×14 lattice over the 640×360 room. Every rule
   * of the run is a cell value: key.bit, lock.open, crumble.gone[],
   * explorer.falls. Falling is safe and the key is kept — a fall is a
   * retry, not a spiral. */
  QS.Scenes.cavern = function () {
    const f = new QS.Fabric({ name: 'the deep caverns (hull-2)', decor: 'cavern' });
    const kb = f.addTile('keyboard', 24, 24);
    const lift = f.addTile('lift', 24, 110);
    const bridge = f.addTile('crumble', 200, 24, { touches: [2, 0, 0] });   // the worn first brick IS the level
    const lock = f.addTile('lock', 200, 130);
    const key = f.addTile('key', 200, 230);
    const goal = f.addTile('goal', 200, 320);
    const mapNote = f.addTile('sign', 376, 24, {
      x: 150, y: 80,
      line: "MAYA'S MAP: lift down, key past the worn brick, gate at the end. — M."
    });
    const joke = f.addTile('sign', 376, 130, {
      x: 350, y: 176,
      line: "THEO: the bridge holds. it held for me. mostly. — T"
    });
    const wren = f.addTile('explorer', 24, 300, { name: 'Wren' });
    const confetti = f.addTile('boomSparks', 376, 230);   // the goal's pop lands here — Sparks, reused
    // the community block, chatting in the deep gallery
    const jun = f.addTile('shopkeeper', 552, 24, {
      name: 'Jun', displayName: 'Jun', x: 150, y: 310, homeX: 150, homeY: 310,
      roamMin: 90, roamMax: 250, seed: 31
    });
    const rosa = f.addTile('gardener', 552, 130, {
      name: 'Rosa', displayName: 'Rosa', x: 490, y: 310, homeX: 490, homeY: 310,
      roamMin: 400, roamMax: 580, seed: 77
    });
    const chattyJun = f.addTile('p-helpful', 552, 230);
    const chattyRosa = f.addTile('p-curious', 552, 320);
    // the player layer
    W(f, kb.id, 'move', wren.id, 'move');
    // the lift: its deck is a floor that moves — standing on it is riding
    W(f, lift.id, 'x', wren.id, 'liftX');
    W(f, lift.id, 'deck', wren.id, 'liftDeck');
    W(f, wren.id, 'x', lift.id, 'riderX');       // the lift's load lamp watches back
    W(f, wren.id, 'y', lift.id, 'riderY');
    // the bridge is a floor that can leave
    W(f, bridge.id, 'floors', wren.id, 'floors');
    // the gate is a wall until its bit says otherwise
    W(f, lock.id, 'gate', wren.id, 'gate');
    // everyone who needs to see the player, sees the player through a wire
    W(f, wren.id, 'x', key.id, 'playerX');   W(f, wren.id, 'y', key.id, 'playerY');
    W(f, wren.id, 'x', goal.id, 'playerX');  W(f, wren.id, 'y', goal.id, 'playerY');
    W(f, wren.id, 'x', lock.id, 'playerX');  W(f, wren.id, 'y', lock.id, 'playerY');
    W(f, wren.id, 'x', bridge.id, 'playerX'); W(f, wren.id, 'y', bridge.id, 'playerY');
    W(f, wren.id, 'x', mapNote.id, 'playerX'); W(f, wren.id, 'y', mapNote.id, 'playerY');
    W(f, wren.id, 'x', joke.id, 'playerX');   W(f, wren.id, 'y', joke.id, 'playerY');
    // the one-bit plumbing the harbor proved: key sets it, lock eats it
    W(f, key.id, 'bit', lock.id, 'keyBit');
    // confetti reused from Sparks — same boom port, no new effect tile
    W(f, goal.id, 'pop', confetti.id, 'boom');
    // the chatter: personality cards + sight lines
    W(f, chattyJun.id, 'mood', jun.id, 'mood');
    W(f, chattyRosa.id, 'mood', rosa.id, 'mood');
    W(f, jun.id, 'x', rosa.id, 'friendX'); W(f, jun.id, 'y', rosa.id, 'friendY');
    W(f, rosa.id, 'x', jun.id, 'friendX'); W(f, rosa.id, 'y', jun.id, 'friendY');
    f.history.unshift({ i: 0, tick: 0, kind: 'scene', detail: 'founded scene "the deep caverns" — the level is a starting state; the hazards are wires' });
    return f;
  };

  QS.Scenes.list = [
    { key: 'invaders', label: '🛸 Space invaders', build: QS.Scenes.invaders },
    { key: 'community', label: '🏘️ Community block', build: QS.Scenes.community },
    { key: 'harbor', label: '⚓ Harbor defense', build: QS.Scenes.harbor },
    { key: 'cavern', label: '🕳️ The deep caverns', build: QS.Scenes.cavern }
  ];

  /* ---------- room backdrops (pure paint, not tiles) ---------- */

  QS.Scenes.decor = {
    stars(ctx, w, h, tick) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0b1035'); g.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const rnd = QS.mulberry32(7);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 60; i++) {
        const x = rnd() * w, y = rnd() * h * 0.8, tw = Math.sin(tick / 30 + i) > 0 ? 1.6 : 1;
        ctx.fillRect(x, y, tw, tw);
      }
      ctx.fillStyle = '#c7a17a'; ctx.fillRect(0, h - 24, w, 24);
      ctx.fillStyle = '#a97e56';
      for (let x = 10; x < w; x += 40) ctx.fillRect(x, h - 24, 20, 4);
    },
    harbor(ctx, w, h, tick) {
      // dusk sky down to water
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0b1e3d'); g.addColorStop(0.62, '#1d4a6e'); g.addColorStop(1, '#0a2a43');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // moon + a few stars
      ctx.fillStyle = 'rgba(253,230,138,.25)'; ctx.beginPath(); ctx.arc(80, 52, 30, 0, 7); ctx.fill();
      ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(80, 52, 20, 0, 7); ctx.fill();
      const rnd = QS.mulberry32(11);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      for (let i = 0; i < 34; i++) {
        const x = rnd() * w, y = rnd() * 140;
        if (Math.sin(tick / 40 + i) > 0) ctx.fillRect(x, y, 1.5, 1.5);
      }
      // water sheen
      ctx.strokeStyle = 'rgba(125,211,252,.16)';
      for (let k = 0; k < 5; k++) {
        const y = 200 + k * 22;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x / 60 + tick / 30 + k) * 2.5);
        ctx.stroke();
      }
      // Bea's dock along the bottom
      ctx.fillStyle = '#7c4a21'; ctx.fillRect(0, 318, w, 42);
      ctx.fillStyle = '#8d5a2b';
      for (let x = 0; x < w; x += 52) ctx.fillRect(x, 318, 48, 8);
      ctx.fillStyle = '#5b3416';
      for (let x = 18; x < w; x += 52) ctx.fillRect(x, 332, 10, 26);
      // the lighthouse (right bank)
      ctx.fillStyle = 'rgba(253,224,71,.14)';
      ctx.beginPath(); ctx.moveTo(602, 183); ctx.lineTo(430, 130); ctx.lineTo(430, 236); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.moveTo(598, 318); ctx.lineTo(604, 190); ctx.lineTo(626, 190); ctx.lineTo(632, 318); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#dc2626'; ctx.fillRect(601, 226, 29, 14); ctx.fillRect(601, 262, 30, 14);
      ctx.fillStyle = '#fde047'; ctx.fillRect(602, 176, 26, 14);
    },
    /* the deep caverns backdrop — pure paint, not tiles. The ledges painted
     * here MATCH the explorer's authored floors: [26,200]@80, [232,425]@176,
     * [515,614]@176 on a ~24×14 lattice. */
    cavern(ctx, w, h, tick) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#171233'); g.addColorStop(0.55, '#120e26'); g.addColorStop(1, '#090614');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // far crystal glow
      const rnd = QS.mulberry32(23);
      for (let i = 0; i < 26; i++) {
        const x = rnd() * w, y = 60 + rnd() * 250, tw = (Math.sin(tick / 40 + i * 1.7) + 1) / 2;
        ctx.fillStyle = i % 2 ? 'rgba(94,234,212,' + (0.07 + 0.16 * tw) + ')' : 'rgba(244,114,182,' + (0.07 + 0.16 * tw) + ')';
        ctx.beginPath(); ctx.arc(x, y, 2 + 3 * tw, 0, 7); ctx.fill();
      }
      // stalactites
      ctx.fillStyle = '#1d1837';
      for (let x = 8; x < w; x += 52) {
        const len = 18 + (x * 7) % 29;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 22, 0); ctx.lineTo(x + 11, len); ctx.closePath(); ctx.fill();
      }
      // side walls
      ctx.fillStyle = '#14102a'; ctx.fillRect(0, 0, 14, h); ctx.fillRect(w - 14, 0, 14, h);
      // the ledges (matching the authored floors exactly)
      const ledge = (x1, x2, y) => {
        ctx.fillStyle = '#241d42'; ctx.fillRect(x1, y, x2 - x1, 9);
        ctx.fillStyle = '#312a56'; ctx.fillRect(x1, y, x2 - x1, 2);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        for (let x = x1 + 8; x < x2 - 6; x += 26) ctx.fillRect(x, y + 4, 13, 3);
      };
      ledge(26, 200, 80); ledge(232, 425, 176); ledge(515, 614, 176);
      // the lift shaft rails
      ctx.strokeStyle = 'rgba(148,163,184,.16)';
      ctx.beginPath(); ctx.moveTo(200, 80); ctx.lineTo(200, 176);
      ctx.moveTo(232, 80); ctx.lineTo(232, 176); ctx.stroke();
      // the pit under the bridge
      ctx.fillStyle = '#07040f';
      ctx.beginPath(); ctx.moveTo(414, 182); ctx.lineTo(531, 182); ctx.lineTo(531, h); ctx.lineTo(414, h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0d0919';
      ctx.beginPath(); ctx.moveTo(414, 182); ctx.lineTo(424, 214); ctx.lineTo(414, 246); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(531, 182); ctx.lineTo(521, 208); ctx.lineTo(531, 240); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(226,232,240,.05)';
      for (let k = 0; k < 5; k++) {
        const y = 210 + k * 26;
        ctx.beginPath(); ctx.moveTo(422 - k * 2, y); ctx.lineTo(523 + k * 2, y); ctx.stroke();
      }
      // the deep gallery — where the neighbors picnic
      ctx.fillStyle = '#241d42'; ctx.fillRect(0, 330, w, 30);
      ctx.fillStyle = '#312a56'; ctx.fillRect(0, 330, w, 2);
      for (const lx of [110, 300, 500]) {
        ctx.strokeStyle = '#5b3416'; ctx.beginPath(); ctx.moveTo(lx, 330); ctx.lineTo(lx, 314); ctx.stroke();
        const p2 = (Math.sin(tick / 20 + lx) + 1) / 2;
        ctx.fillStyle = 'rgba(253,224,71,' + (0.5 + 0.4 * p2) + ')';
        ctx.beginPath(); ctx.arc(lx, 312, 4, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(253,224,71,.08)';
        ctx.beginPath(); ctx.arc(lx, 312, 12 + 6 * p2, 0, 7); ctx.fill();
      }
      ctx.fillStyle = 'rgba(226,232,240,.22)'; ctx.font = '10px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('the deep gallery — the neighbors just live down here', w / 2, 352);
    },
    block(ctx, w, h) {
      ctx.fillStyle = '#bfe3c6'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#a8d5b0'; ctx.fillRect(0, h - 60, w, 60);
      // path
      ctx.fillStyle = '#e8d9b8'; ctx.fillRect(0, 250, w, 34);
      ctx.fillStyle = '#d6c39a';
      for (let x = 20; x < w; x += 44) ctx.fillRect(x, 264, 18, 5);
      // the shop (Maya lives upstairs)
      ctx.fillStyle = '#f4a261'; ctx.fillRect(140, 120, 120, 130);
      ctx.fillStyle = '#e76f51'; ctx.beginPath(); ctx.moveTo(132, 120); ctx.lineTo(200, 78); ctx.lineTo(268, 120); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5e4132'; ctx.fillRect(178, 196, 34, 54);
      ctx.fillStyle = '#ffd166'; ctx.fillRect(154, 140, 26, 22); ctx.fillRect(214, 140, 26, 22);
      ctx.fillStyle = '#fff3c4'; ctx.font = 'bold 11px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('UPSTAIRS: HOME', 200, 138);
      ctx.fillText('MAYA\'S SHOP', 200, 190);
      // awning
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#e63946' : '#f1faee'; ctx.fillRect(146 + i * 24, 210, 24, 12); }
      // the garden (Theo's patch)
      ctx.fillStyle = '#8d6e63'; ctx.fillRect(400, 210, 180, 60);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        ctx.fillStyle = '#6d4c41'; ctx.fillRect(412 + c * 42, 222 + r * 26, 32, 16);
        ctx.fillStyle = '#66bb6a'; ctx.beginPath(); ctx.arc(428 + c * 42, 230 + r * 26, 6, 0, 7); ctx.fill();
        ctx.fillStyle = '#ef5350'; ctx.beginPath(); ctx.arc(428 + c * 42, 226 + r * 26, 2.5, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#5d4037'; ctx.font = 'bold 11px "Comic Sans MS", sans-serif';
      ctx.fillText('THEO\'S GARDEN', 490, 288);
      // sun
      ctx.fillStyle = '#ffe082'; ctx.beginPath(); ctx.arc(586, 40, 22, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ffe082';
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(586 + Math.cos(a) * 26, 40 + Math.sin(a) * 26);
        ctx.lineTo(586 + Math.cos(a) * 34, 40 + Math.sin(a) * 34); ctx.stroke();
      }
    }
  };
})();
