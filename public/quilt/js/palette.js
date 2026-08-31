/* palette.js — the founding palette of tiles.
 *
 * House law applies to kids' tools too: every state field is a plain visible
 * number/string/boolean/array (no hidden fields — N2), every tick is
 * (state, inputs, room) -> state, and no tile ever touches a neighbor
 * except through a wire (N1). Events are visible too: a tile sets
 * e.g. boomNow=1 for exactly one tick and the out() function turns that
 * into an event on the wire.
 */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const R = QS.Registry;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ============ ACTOR — position IS a cell ============ */

  R.add({
    key: 'actor', label: 'Position actor', kind: 'actor', icon: '🚀',
    desc: 'A thing with a position. Its x and y are numbers in a cell you can watch.',
    inputs: [{ name: 'move', type: 'number' }, { name: 'skin', type: 'text' }],
    outputs: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }],
    watch: ['x', 'y'],
    room: true, w: 34, h: 24,
    seed: () => ({
      name: 'actor', x: 320, y: 330, vx: 0, vy: 0, speed: 4, facing: 1,
      skin: 'rocket', minY: 8, maxY: 352, minX: 16, maxX: 624, moved: 0
    }),
    tick(s, i) {
      if (typeof i.skin === 'string' && i.skin && i.skin !== s.skin) s.skin = i.skin;
      s.vx = (Number(i.move) || 0) * s.speed;
      s.x = clamp(s.x + s.vx, s.minX, s.maxX);
      s.y = clamp(s.y + (s.vy || 0), s.minY, s.maxY);
      if (s.vx > 0) s.facing = 1; else if (s.vx < 0) s.facing = -1;
      if (s.vx || s.vy) s.moved++;
      return s;
    },
    out: s => ({ x: s.x, y: s.y }),
    draw(ctx, t) {
      const s = t.state, x = s.x, y = s.y;
      if (s.skin === 'kite') {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x + 12, y + 2); ctx.lineTo(x, y + 12); ctx.lineTo(x - 12, y + 2); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#92400e'; ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.quadraticCurveTo(x + 4, y + 20, x - 2, y + 24); ctx.stroke();
        return;
      }
      // rocket (default): a friendly little ship
      const bob = Math.sin(t.state.y) * 0; // y is honest; no fake bob for actors
      ctx.fillStyle = '#0f766e';
      ctx.beginPath();
      ctx.moveTo(x, y - 14); ctx.lineTo(x + 17 * s.facing + bob, y + 10); ctx.lineTo(x - 17 * s.facing + bob, y + 10);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#14b8a6';
      ctx.fillRect(x - 13, y + 6, 26, 7);
      ctx.fillStyle = '#bae6fd'; ctx.beginPath(); ctx.arc(x + s.facing * 2, y - 2, 4.5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#083344'; ctx.stroke();
      if (Math.abs(s.vx) > 0.1) { // flame only when the number says so
        ctx.fillStyle = '#fb923c';
        ctx.beginPath(); ctx.moveTo(x - 6, y + 13); ctx.lineTo(x, y + 13 + 6 + Math.random() * 4); ctx.lineTo(x + 6, y + 13); ctx.closePath(); ctx.fill();
      }
    }
  });

  /* ============ IO — keyboard input ============ */

  R.add({
    key: 'keyboard', label: 'Keyboard input', kind: 'io', icon: '🎮',
    desc: 'Arrow keys / A-D move, Space fires. Turn keys into numbers on wires.',
    inputs: [],
    outputs: [{ name: 'move', type: 'number' }, { name: 'fire', type: 'event' }],
    watch: ['moveDir', 'fireCount'],
    room: false,
    seed: () => ({ moveDir: 0, fireCount: 0, firedThisTick: 0, lastKey: '', keysDown: '' }),
    tick(s, i, room) {
      const eng = QS.__engine; // the app registers itself; tiles are otherwise IO-free
      s.moveDir = 0; s.keysDown = '';
      if (eng) {
        const L = eng.held['ArrowLeft'] || eng.held['a'], Rt = eng.held['ArrowRight'] || eng.held['d'];
        if (L) { s.moveDir = -1; s.lastKey = 'left'; }
        if (Rt) { s.moveDir = 1; s.lastKey = 'right'; }
        if (L && Rt) s.moveDir = 0;
        s.keysDown = Object.keys(eng.held).filter(k => eng.held[k]).join('+');
        if (eng.fireEdges > 0) {
          eng.fireEdges = 0;
          s.fireCount++; s.firedThisTick = 1; s.lastKey = 'space';
        } else s.firedThisTick = 0;
      } else s.firedThisTick = 0;
      return s;
    },
    out: s => ({ move: s.moveDir, fire: s.firedThisTick ? { n: s.fireCount } : null })
  });

  /* ============ BULLET — latches x at fire ============ */

  R.add({
    key: 'bullet', label: 'Bullet', kind: 'actor', icon: '✨',
    desc: 'On fire it latches the x it left from (ship.x!) and y climbs every tick. When crash-physics says a bullet is spent, it stops — told through a wire, never by reaching over.',
    inputs: [{ name: 'fire', type: 'event' }, { name: 'x', type: 'number' }, { name: 'die', type: 'event' }],
    outputs: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'alive', type: 'number' }],
    watch: ['x', 'y', 'alive'],
    room: true, w: 8, h: 14,
    seed: () => ({ x: 0, y: 0, alive: 0, speed: 4, startY: 318, firedCount: 0, topY: 999 }),
    tick(s, i) {
      if (i.die) s.alive = 0;                 // crash-physics owns the hit; it tells me through a wire
      if (i.fire) {
        s.alive = 1;
        // latch the wired x — but only a real number: 0 is a legit spot (the
        // left edge), NaN keeps the last spot. 'Number(i.x) || s.x' clobbered 0.
        const nx = Number(i.x);
        if (Number.isFinite(nx)) s.x = nx;
        s.y = s.startY; s.firedCount++; s.topY = s.y;
      }
      if (s.alive) {
        s.y -= s.speed;
        if (s.y < s.topY) s.topY = s.y;
        if (s.y < 6) s.alive = 0;
      }
      return s;
    },
    out: s => ({ x: s.x, y: s.y, alive: s.alive }),
    draw(ctx, t) {
      const s = t.state;
      if (!s.alive) return;
      ctx.fillStyle = 'rgba(251, 191, 36, .35)';
      ctx.fillRect(s.x - 1.5, s.y + 6, 3, 12);
      ctx.fillStyle = '#fde047';
      ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = '#b45309'; ctx.stroke();
    }
  });

  /* ============ CREATURE GRID ============ */

  R.add({
    key: 'creatureGrid', label: 'Creature grid', kind: 'actor', icon: '👾',
    desc: 'A grid of space creatures. Each one has an X/Y range in this cell.',
    inputs: [{ name: 'killIndex', type: 'event' }, { name: 'reset', type: 'event' }],
    outputs: [{ name: 'grid', type: 'any' }],
    watch: ['aliveCount', 'originX'],
    room: true, w: 640, h: 160,
    seed: () => ({
      cols: 8, rows: 3, spacingX: 48, spacingY: 36, originX: 40, originY: 36,
      drift: 0.5, stepDown: 8, alive: [1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1],
      aliveCount: 24, flashLeft: 0, flashIndex: -1, killedCount: 0, respawnCount: 0
    }),
    tick(s, i) {
      if (i.reset) {
        s.alive = s.alive.map(() => 1);
        s.originX = 40; s.originY = 36; s.drift = 0.5; s.respawnCount++;
        s.flashLeft = 0; s.flashIndex = -1;
      }
      const gridW = (s.cols - 1) * s.spacingX;
      s.originX += s.drift;
      if (s.originX < 40) { s.originX = 40; s.drift = Math.abs(s.drift); s.originY += s.stepDown; }
      if (s.originX > 600 - gridW) { s.originX = 600 - gridW; s.drift = -Math.abs(s.drift); s.originY += s.stepDown; }
      if (i.killIndex && i.killIndex.i >= 0 && i.killIndex.i < s.alive.length && s.alive[i.killIndex.i]) {
        s.alive[i.killIndex.i] = 0; s.killedCount++; s.flashIndex = i.killIndex.i; s.flashLeft = 12;
      }
      if (s.flashLeft > 0) s.flashLeft--;
      s.aliveCount = s.alive.reduce((a, b) => a + b, 0);
      return s;
    },
    out: s => ({ grid: { cols: s.cols, rows: s.rows, spacingX: s.spacingX, spacingY: s.spacingY, originX: s.originX, originY: s.originY, alive: s.alive } }),
    draw(ctx, t) {
      const s = t.state;
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const i = r * s.cols + c;
          if (!s.alive[i]) continue;
          const x = s.originX + c * s.spacingX, y = s.originY + r * s.spacingY;
          const wob = Math.sin((t.tickNow || 0) / 12 + c) * 2;
          ctx.fillStyle = r === 0 ? '#7c3aed' : r === 1 ? '#db2777' : '#0ea5e9';
          ctx.beginPath(); ctx.ellipse(x, y + wob, 13, 10, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(x - 4, y - 2 + wob, 2.4, 0, 7); ctx.arc(x + 4, y - 2 + wob, 2.4, 0, 7); ctx.fill();
          ctx.fillStyle = '#111';
          ctx.beginPath(); ctx.arc(x - 4 + (Math.cos((t.tickNow || 0) / 40) * 1), y - 2 + wob, 1.1, 0, 7); ctx.arc(x + 4, y - 2 + wob, 1.1, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.25)';
          for (let k = -1; k <= 1; k += 2) {
            ctx.beginPath(); ctx.moveTo(x + k * 8, y + 8 + wob); ctx.lineTo(x + k * 11, y + 13 + wob); ctx.stroke();
          }
          if (s.flashIndex === i && s.flashLeft > 0) {
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(x, y + wob, 16, 13, 0, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
          }
        }
      }
    }
  });

  /* ============ MECHANIC — crash physics ============ */

  R.add({
    key: 'crash', label: 'Crash physics', kind: 'mechanic', icon: '💥',
    desc: 'Owns collisions and NOTHING else. On overlap it routes a boom event to whichever effect tile is wired on. Flip the effect, never the wiring.',
    inputs: [
      { name: 'bulletX', type: 'number' }, { name: 'bulletY', type: 'number' },
      { name: 'bulletAlive', type: 'number' }, { name: 'grid', type: 'any' }
    ],
    outputs: [{ name: 'boom', type: 'event' }, { name: 'killIndex', type: 'event' }, { name: 'spent', type: 'event' }],
    watch: ['hits', 'checks'],
    room: false,
    seed: () => ({ checks: 0, hits: 0, lastHitIndex: -1, lastHitX: 0, lastHitY: 0, boomNow: 0, boomX: 0, boomY: 0, killNow: 0, killI: -1, spentNow: 0, pad: 18, echoIndex: -1, echoTick: -99 }),
    tick(s, i, room) {
      s.boomNow = 0; s.killNow = 0; s.spentNow = 0; // events last exactly one tick
      s.checks++;
      const g = i.grid;
      if (g && Number(i.bulletAlive)) {
        const bx = Number(i.bulletX), by = Number(i.bulletY);
        for (let r = g.rows - 1; r >= 0; r--) {          // bottom row first — the bullet arrives from below
          for (let c = 0; c < g.cols; c++) {
            const idx = r * g.cols + c;
            if (!g.alive[idx]) continue;
            const cx = g.originX + c * g.spacingX, cy = g.originY + r * g.spacingY;
            if (Math.abs(bx - cx) < s.pad && Math.abs(by - cy) < s.pad) {
              // Wire values are one tick old, so the kill we just routed can still
              // "overlap" on the next tick. Crash owns collisions — which includes
              // not double-reporting one. echoIndex/echoTick are visible state (N2).
              if (idx === s.echoIndex && room.tick - s.echoTick < 3) continue;
              s.hits++; s.lastHitIndex = idx; s.lastHitX = cx; s.lastHitY = cy;
              s.echoIndex = idx; s.echoTick = room.tick;
              s.boomNow = 1; s.boomX = cx; s.boomY = cy;
              s.killNow = 1; s.killI = idx; s.spentNow = 1;
              return s;
            }
          }
        }
      }
      return s;
    },
    out: s => ({
      boom: s.boomNow ? { x: s.boomX, y: s.boomY } : null,
      killIndex: s.killNow ? { i: s.killI } : null,
      spent: s.spentNow ? { } : null
    })
  });

  /* ============ EFFECTS — swappable, routed ============ */

  const explosion = (key, label, icon, life, painter, desc) => R.add({
    key, label, kind: 'effect', icon, desc,
    inputs: [{ name: 'boom', type: 'event' }],
    outputs: [],
    watch: ['framesLeft', 'totalBooms'],
    room: true, w: 10, h: 10,
    seed: () => ({ x: -40, y: -40, framesLeft: 0, life, totalBooms: 0, lastBoomTick: -1 }),
    tick(s, i, room) {
      if (i.boom) { s.x = i.boom.x; s.y = i.boom.y; s.framesLeft = s.life; s.totalBooms++; s.lastBoomTick = room.tick; }
      else if (s.framesLeft > 0) s.framesLeft--;
      return s;
    },
    draw: painter
  });

  explosion('boomPop', 'Boom: Pop', '🌟', 26, (ctx, t) => {
    const s = t.state;
    if (s.framesLeft <= 0) return;
    const p = s.framesLeft / s.life, r = 8 + (1 - p) * 22;
    ctx.fillStyle = '#f97316';
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, 3 + 4 * p, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(s.x, s.y, 5 + 8 * p, 0, 7); ctx.fill();
  }, 'The classic starburst. Swap it in wherever a boom lands.');

  explosion('boomRing', 'Boom: Ring', '💫', 30, (ctx, t) => {
    const s = t.state;
    if (s.framesLeft <= 0) return;
    const p = 1 - s.framesLeft / s.life;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, 4 + p * 26, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 2 + p * 16, 0, 7); ctx.stroke();
    ctx.lineWidth = 1;
  }, 'An expanding halo. Same boom port, different look.');

  explosion('boomSparks', 'Boom: Sparks', '🎇', 34, (ctx, t) => {
    const s = t.state;
    if (s.framesLeft <= 0) return;
    const p = s.framesLeft / s.life;
    const rnd = QS.mulberry32(s.totalBooms * 97 + 13);
    for (let k = 0; k < 10; k++) {
      const a = rnd() * Math.PI * 2, d = (1 - p) * (14 + rnd() * 18);
      ctx.strokeStyle = k % 2 ? '#f472b6' : '#facc15';
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d);
      ctx.lineTo(s.x + Math.cos(a) * (d + 5), s.y + Math.sin(a) * (d + 5));
      ctx.stroke();
    }
  }, 'Ship-style confetti sparks.');

  R.add({
    key: 'scorePing', label: 'Score ping', kind: 'effect', icon: '🏅',
    desc: 'Counts booms. Any boom event wired here becomes a score a kid can watch climb.',
    inputs: [{ name: 'boom', type: 'event' }],
    outputs: [],
    watch: ['score'],
    room: true, w: 90, h: 30,
    seed: () => ({ score: 0, flash: 0, lastPingTick: -1 }),
    tick(s, i, room) {
      if (i.boom) { s.score++; s.flash = 12; s.lastPingTick = room.tick; }
      else if (s.flash > 0) s.flash--;
      return s;
    },
    draw(ctx, t) {
      const s = t.state;
      ctx.save();
      ctx.font = 'bold 20px "Comic Sans MS", "Comic Neue", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = s.flash > 0 ? '#fde047' : '#e2e8f0';
      ctx.fillText('🏅 ' + s.score, 616, 34);
      ctx.restore();
    }
  });

  /* ============ NPC — the villager who lives here ============ */

  const ACTIONS = ['wander', 'tend', 'wave', 'rest'];
  R.add({
    key: 'npc', label: 'Villager', kind: 'npc', icon: '🧑‍🌾',
    desc: 'A runtime NPC with a full idle loop — sweep, stock, wave. Lives with ZERO input: no IO is needed for her to be alive.',
    inputs: [
      { name: 'mood', type: 'any' }, { name: 'sheet', type: 'any' }, { name: 'skin', type: 'text' },
      { name: 'friendX', type: 'number' }, { name: 'friendY', type: 'number' }
    ],
    outputs: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'hello', type: 'event' }],
    watch: ['action', 'x', 'y'],
    room: true, w: 26, h: 40,
    seed: (o) => Object.assign({
      role: 'shopkeeper', name: 'Maya', x: 220, y: 170, homeX: 220, homeY: 170,
      facing: 1, action: 'rest', actionLeft: 60, targetX: 220, targetY: 170, speed: 0.8,
      wWander: 3, wTend: 4, wWave: 2, wRest: 2,
      bWander: 0, bTend: 0, bWave: 0, bRest: 0,
      cWander: 0, cTend: 0, cWave: 0, cRest: 0, switches: 0,
      helloNow: 0, hellos: 0, nearFriend: 0, friendSeen: '',
      skin: 'classic', displayName: 'Maya', ageLabel: '', backstory: '', inventory: '',
      seed: 42, tickCount: 0, roamMin: 80, roamMax: 560
    }, o),
    tick(s, i, room) {
      s.tickCount = room.tick;
      s.helloNow = 0;
      // personality is an INPUT, never a rewrite of who she is (visible bias)
      if (i.mood && typeof i.mood === 'object') {
        s.bWander = i.mood.bWander | 0; s.bTend = i.mood.bTend | 0;
        s.bWave = i.mood.bWave | 0; s.bRest = i.mood.bRest | 0;
      }
      // the character sheet latches in as visible state
      if (i.sheet && typeof i.sheet === 'object') {
        if (i.sheet.name) s.displayName = i.sheet.name;
        // age 0 is a real age (a newborn villager!) — 'String(age || "")' hid it
        s.ageLabel = i.sheet.age === undefined ? '' : String(i.sheet.age);
        s.backstory = String(i.sheet.backstory || '');
        s.inventory = String(i.sheet.inventory || '');
      }
      if (typeof i.skin === 'string' && i.skin) s.skin = i.skin;
      // she can only "see" a friend through wires (N1) — the wire IS the sight line.
      // A null on the wire is NO sight (friend halted/absent) — Number(null) is 0,
      // which used to conjure a phantom friend standing at the origin.
      const fx = i.friendX == null ? NaN : Number(i.friendX);
      const fy = i.friendY == null ? NaN : Number(i.friendY);
      s.nearFriend = (isFinite(fx) && Math.abs(fx - s.x) < 70 && Math.abs(fy - s.y) < 46) ? 1 : 0;

      // --- the idle loop: pick an action by weighted schedule, live it, repeat ---
      if (s.actionLeft > 0) {
        s.actionLeft--;
        if (s.action === 'wander') {
          const dx = s.targetX - s.x, dy = s.targetY - s.y, d = Math.hypot(dx, dy);
          if (d > 2) { s.x += dx / d * s.speed; s.y += dy / d * s.speed; s.facing = dx >= 0 ? 1 : -1; }
        }
        // tend/wave/rest animate in draw(); state holds the counts
      } else {
        const rnd = QS.mulberry32(s.seed);
        const w = {
          wander: Math.max(0, s.wWander + s.bWander),
          tend: Math.max(0, s.wTend + s.bTend),
          wave: Math.max(0, s.wWave + s.bWave + (s.nearFriend ? 3 : 0)),
          rest: Math.max(0, s.wRest + s.bRest)
        };
        let total = w.wander + w.tend + w.wave + w.rest, pick = rnd() * total, chosen = 'rest';
        for (const a of ACTIONS) { pick -= w[a]; if (pick <= 0) { chosen = a; break; } }
        s.action = chosen; s.switches++;
        if (chosen === 'wander') {
          s.cWander++;
          s.targetX = s.roamMin + rnd() * (s.roamMax - s.roamMin);
          s.targetY = s.homeY - 26 + rnd() * 40;
          s.actionLeft = 90 + Math.floor(rnd() * 90);
        } else if (chosen === 'tend') { s.cTend++; s.actionLeft = 130 + Math.floor(rnd() * 110); }
        else if (chosen === 'wave') { s.cWave++; s.helloNow = 1; s.hellos++; s.actionLeft = 34; }
        else { s.cRest++; s.actionLeft = 90 + Math.floor(rnd() * 70); }
        s.seed = Math.floor(rnd() * 2147483647); // the seed dances — watch it!
      }
      return s;
    },
    out: s => ({ x: s.x, y: s.y, hello: s.helloNow ? { name: s.displayName } : null }),
    draw(ctx, t, env) {
      const s = t.state;
      const gardener = s.role === 'gardener';
      const bob = s.action === 'tend' ? Math.sin(s.tickCount / 3) * 1.5 : 0;
      const x = s.x, y = s.y + bob;
      // legs
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
      const stride = s.action === 'wander' ? Math.sin(s.tickCount / 4) * 3 : 0;
      ctx.beginPath(); ctx.moveTo(x - 4, y + 12); ctx.lineTo(x - 4 - stride, y + 20); ctx.moveTo(x + 4, y + 12); ctx.lineTo(x + 4 + stride, y + 20); ctx.stroke();
      // body
      ctx.fillStyle = gardener ? '#16a34a' : '#7c3aed';
      ctx.beginPath();
      ctx.moveTo(x - 9, y + 12); ctx.quadraticCurveTo(x, y - 2, x + 9, y + 12); ctx.closePath(); ctx.fill();
      if (s.skin === 'overalls') { ctx.fillStyle = '#2563eb'; ctx.fillRect(x - 7, y + 2, 14, 10); }
      // arms — one goes up when waving
      ctx.strokeStyle = gardener ? '#16a34a' : '#7c3aed';
      const waving = s.action === 'wave';
      ctx.beginPath();
      ctx.moveTo(x - 8 * s.facing, y + 6); ctx.lineTo(x - 14 * s.facing, y + (waving ? -2 : 12));
      ctx.moveTo(x + 8 * s.facing, y + 6); ctx.lineTo(x + 14 * s.facing, y + (waving ? -6 : 12));
      ctx.stroke(); ctx.lineWidth = 1;
      // head
      ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(x, y - 8, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(x + 2.5 * s.facing, y - 9, 1.2, 0, 7); ctx.arc(x + 2.5 * s.facing, y - 6, 1.2, 0, 7); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.arc(x + 2 * s.facing, y - 4, 2.5, 0.2, Math.PI - 0.2); ctx.stroke();
      // hair / hats
      if (gardener) { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.ellipse(x, y - 15, 9, 3, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(x, y - 13, 5, 3, 0, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = '#4c1d95'; ctx.beginPath(); ctx.arc(x, y - 11, 8, Math.PI, 0); ctx.fill(); }
      if (s.skin === 'party') { ctx.fillStyle = '#f472b6'; ctx.beginPath(); ctx.moveTo(x - 6, y - 16); ctx.lineTo(x, y - 30); ctx.lineTo(x + 6, y - 16); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(x, y - 30, 2, 0, 7); ctx.fill(); }
      // props per action
      if (s.action === 'tend') {
        const swing = Math.sin(s.tickCount / 3) * 4;
        if (gardener) { // watering can
          ctx.fillStyle = '#38bdf8'; ctx.fillRect(x + 12 * s.facing, y + 2 + swing, 10, 6);
          ctx.strokeStyle = '#38bdf8'; ctx.beginPath(); ctx.moveTo(x + 22 * s.facing, y + 3 + swing); ctx.lineTo(x + 27 * s.facing, y - 1 + swing); ctx.stroke();
        } else { // broom sweep
          ctx.strokeStyle = '#b45309'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x + 12 * s.facing, y - 6 + swing); ctx.lineTo(x + 20 * s.facing, y + 16); ctx.stroke();
          ctx.fillStyle = '#f59e0b'; ctx.fillRect(x + 17 * s.facing, y + 14, 7, 8);
          ctx.lineWidth = 1;
        }
      }
      if (s.action === 'rest') { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '12px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('z', x + 12, y - 14); }
      // name tag — from the character sheet if wired
      ctx.fillStyle = 'rgba(15,23,42,.75)'; ctx.font = '10px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.displayName + (s.nearFriend ? ' 💛' : ''), x, y - 26);
    }
  });

  /* ============ PERSONALITY — same skeleton, different weights ============ */

  /* ============ RUNTIME SHIP — the harbor pilot ============
   * level-2 addition. The villager's idle-loop skeleton (weighted action
   * schedule, visible bias numbers, dancing seed) wearing a ship's clothes:
   * cruise / hold / volley / cool. A personality card snaps onto the SAME
   * mood port the villagers use (bWander/bTend/bWave/bRest — same keys,
   * different verbs), so every existing personality preset also sails a ship.
   * The player keeps agency through wires: keyboard.move nudges, keyboard.fire
   * shoots. Harbor-watch duties are states too: lives (a number on this cell),
   * and the wave bell — a breach or a clear field calls the next wave. */
  const PILOT_ACTIONS = ['cruise', 'hold', 'volley', 'cool'];
  R.add({
    key: 'pilot', label: 'Harbor pilot', kind: 'npc', icon: '🛥️',
    desc: 'A ship that lives on patrol: cruise, hold station, volley, cool down. Snap a personality card on — same card slot as the villagers — and the same ship sails and fires differently. Keyboard still nudges (move) and fires (space).',
    inputs: [
      { name: 'mood', type: 'any' },      // personality card (same keys as the villager)
      { name: 'move', type: 'number' },    // keyboard nudge — the player's hand on the wheel
      { name: 'fire', type: 'event' },     // keyboard fire
      { name: 'hurt', type: 'event' },     // a breach rang the bell: a life comes off, next wave called
      { name: 'grid', type: 'any' }        // harbor watch: sees the field (read-only) to call waves
    ],
    outputs: [
      { name: 'x', type: 'number' }, { name: 'y', type: 'number' },
      { name: 'fire', type: 'event' },        // a shot leaves from x
      { name: 'onStation', type: 'number' },   // 1 = the harbor watch is on
      { name: 'wave', type: 'event' }          // call the next wave (wire me to grid.reset)
    ],
    watch: ['action', 'x', 'lives'],
    room: true, w: 46, h: 30,
    seed: (o) => Object.assign({
      name: 'Pip', x: 200, y: 158, homeY: 158, facing: 1,
      action: 'hold', actionLeft: 40, targetX: 200, speed: 1.1,
      wCruise: 3, wHold: 2, wVolley: 3, wCool: 2,
      bWander: 0, bTend: 0, bWave: 0, bRest: 0,
      cCruise: 0, cHold: 0, cVolley: 0, cCool: 0, switches: 0,
      volleyLeft: 0, shotGap: 0, fireNow: 0, shots: 0, manualShots: 0, manualTicks: 0,
      lives: 5, hurtFlash: 0, waveDelay: 0, waveNow: 0, wavesCalled: 0,
      fieldAlive: -1, clearFor: 0, sailed: 0, onStation: 1,
      minX: 60, maxX: 580, seed: 7, tickCount: 0
    }, o),
    tick(s, i, room) {
      s.tickCount = room.tick;
      s.fireNow = 0; s.waveNow = 0;
      // the personality card latches as visible bias numbers — never a rewrite of the ship
      if (i.mood && typeof i.mood === 'object') {
        s.bWander = i.mood.bWander | 0; s.bTend = i.mood.bTend | 0;
        s.bWave = i.mood.bWave | 0; s.bRest = i.mood.bRest | 0;
      }
      // a breach rang the bell: a life is a NUMBER on this cell. The wave rings
      // the same tick the hurt arrives (delay 1, decremented in-tick); the grid
      // lands the reset one wire-tick later — inside the crash tile's echo
      // window, so one boarding is one breach, not four.
      if (i.hurt) { s.lives--; s.hurtFlash = 30; s.waveDelay = 1; }
      if (s.waveDelay > 0) { s.waveDelay--; if (s.waveDelay === 0) { s.waveNow = 1; s.wavesCalled++; } }
      // the player can always take the wheel (through wires, of course)
      const nudge = Number(i.move) || 0;
      if (nudge) {
        const nx = clamp(s.x + nudge * s.speed * 1.6, s.minX, s.maxX);
        s.sailed += Math.abs(nx - s.x); s.x = nx; s.facing = nudge; s.manualTicks++;
      }
      if (i.fire) { s.fireNow = 1; s.manualShots++; }
      // harbor watch: a clear field gets its next wave (visible countdown)
      if (i.grid && typeof i.grid === 'object' && Array.isArray(i.grid.alive)) {
        s.fieldAlive = i.grid.alive.reduce((a, b) => a + b, 0);
        s.clearFor = s.fieldAlive === 0 ? s.clearFor + 1 : 0;
        if (s.clearFor === 120) { s.waveNow = 1; s.wavesCalled++; }
      } else s.fieldAlive = -1;
      // the idle loop — same skeleton as the villager's, different verbs
      if (s.actionLeft > 0) {
        s.actionLeft--;
        if (s.action === 'cruise') {
          const dx = s.targetX - s.x;
          if (Math.abs(dx) > 2) {
            const step = Math.sign(dx) * Math.min(s.speed, Math.abs(dx));
            s.x += step; s.sailed += Math.abs(step); s.facing = Math.sign(dx) || 1;
          }
        } else if (s.action === 'volley' && s.volleyLeft > 0 && --s.shotGap <= 0) {
          s.fireNow = 1; s.volleyLeft--; s.shotGap = 14;
        }
      } else {
        const rnd = QS.mulberry32(s.seed);
        const w = {
          cruise: Math.max(0, s.wCruise + s.bWander),
          hold: Math.max(0, s.wHold + s.bTend),
          volley: Math.max(0, s.wVolley + s.bWave),
          cool: Math.max(0, s.wCool + s.bRest)
        };
        let total = w.cruise + w.hold + w.volley + w.cool, pick = rnd() * total, chosen = 'hold';
        for (const a of PILOT_ACTIONS) { pick -= w[a]; if (pick <= 0) { chosen = a; break; } }
        s.action = chosen; s.switches++;
        if (chosen === 'cruise') {
          s.cCruise++; s.targetX = s.minX + rnd() * (s.maxX - s.minX); s.actionLeft = 70 + Math.floor(rnd() * 80);
        } else if (chosen === 'hold') { s.cHold++; s.actionLeft = 50 + Math.floor(rnd() * 60); }
        else if (chosen === 'volley') {
          s.cVolley++; s.volleyLeft = 1 + Math.floor(rnd() * 2); s.shotGap = 6;
          s.actionLeft = s.volleyLeft * 14 + 16;
        } else { s.cCool++; s.actionLeft = 60 + Math.floor(rnd() * 70); }
        s.seed = Math.floor(rnd() * 2147483647); // the seed dances — watch it!
      }
      if (s.fireNow) s.shots++;
      if (s.hurtFlash > 0) s.hurtFlash--;
      return s;
    },
    out: s => ({
      x: s.x, y: s.y, onStation: s.onStation,
      fire: s.fireNow ? { from: s.name } : null,
      wave: s.waveNow ? { n: s.wavesCalled } : null
    }),
    draw(ctx, t) {
      const s = t.state, x = s.x, f = s.facing;
      const yy = s.y + Math.sin(s.tickCount / 9) * 1.5; // the harbor is wavy
      if (s.action === 'cruise') {
        ctx.strokeStyle = 'rgba(125,211,252,.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 20 * f, yy + 6); ctx.quadraticCurveTo(x - 30 * f, yy + 2, x - 34 * f, yy + 8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 20 * f, yy + 9); ctx.quadraticCurveTo(x - 27 * f, yy + 6, x - 30 * f, yy + 11); ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = (s.hurtFlash > 0 && s.hurtFlash % 6 < 3) ? '#ef4444' : '#b91c1c';
      ctx.beginPath(); ctx.moveTo(x - 22, yy - 4); ctx.lineTo(x + 22, yy - 4); ctx.lineTo(x + 14, yy + 10); ctx.lineTo(x - 14, yy + 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7f1d1d'; ctx.fillRect(x - 22, yy - 6, 44, 4);
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(x - 8, yy - 14, 16, 9);
      ctx.fillStyle = '#0ea5e9'; ctx.fillRect(x - 5, yy - 12, 10, 5);
      ctx.strokeStyle = '#94a3b8'; ctx.beginPath(); ctx.moveTo(x, yy - 14); ctx.lineTo(x, yy - 26); ctx.stroke();
      ctx.fillStyle = (s.tickCount % 60 < 30) ? '#fde047' : '#a16207'; // running light
      ctx.beginPath(); ctx.arc(x, yy - 27, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = s.lives > 3 ? '#22c55e' : s.lives > 1 ? '#f59e0b' : '#ef4444'; // pennant says how the harbor is doing
      ctx.beginPath(); ctx.moveTo(x, yy - 26); ctx.lineTo(x + 10 * f, yy - 23); ctx.lineTo(x, yy - 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#475569'; ctx.fillRect(x - 3, yy - 20, 6, 7); // the cannon
      if (s.fireNow) {
        ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(x, yy - 23, 6 + Math.random() * 3, 0, 7); ctx.fill();
        ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.arc(x, yy - 26, 3, 0, 7); ctx.fill();
      }
      ctx.fillStyle = 'rgba(15,23,42,.75)'; ctx.font = 'bold 12px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚓×' + s.lives, x, yy - 34); // lives: a number a kid can read across the room
      if (s.action === 'hold') { ctx.fillStyle = 'rgba(226,232,240,.75)'; ctx.font = '10px "Comic Sans MS", sans-serif'; ctx.fillText('hold', x, yy + 22); }
    }
  });

  R.add({
    key: 'personality', label: 'Personality', kind: 'personality', icon: '🎭',
    desc: 'Snaps onto a villager. Same skeleton, different weights — the bias numbers are all visible.',
    inputs: [],
    outputs: [{ name: 'mood', type: 'any' }],
    watch: ['style', 'bWave'],
    room: false,
    seed: (o) => Object.assign({ style: 'helpful', note: 'waves more, tends more', bWander: 0, bTend: 1, bWave: 2, bRest: -1 }, o),
    tick(s) { return s; },
    out: s => ({ mood: { bWander: s.bWander, bTend: s.bTend, bWave: s.bWave, bRest: s.bRest } })
  });

  /* ============ CHARACTER SHEET — the "who am I" card ============ */

  R.add({
    key: 'sheet', label: 'Character sheet', kind: 'sheet', icon: '📋',
    desc: 'Name, age, backstory, inventory. The editable card a villager wears.',
    inputs: [],
    outputs: [{ name: 'sheet', type: 'any' }],
    watch: ['name', 'age'],
    room: false,
    seed: (o) => Object.assign({
      name: 'Maya', age: '34',
      backstory: 'Lives upstairs over the shop. Knows every neighbor by name.',
      inventory: 'broom, key, tea'
    }, o),
    tick(s) { return s; },
    out: s => ({ sheet: { name: s.name, age: s.age, backstory: s.backstory, inventory: s.inventory } })
  });

  /* ============ SKIN — appearance is a wired slot ============ */

  R.add({
    key: 'skinPick', label: 'Skin', kind: 'skin', icon: '👕',
    desc: 'Pure appearance. Swap the look, never the behavior — for people AND explosions.',
    inputs: [], outputs: [{ name: 'skin', type: 'text' }],
    watch: ['pick'],
    room: false,
    seed: (o) => Object.assign({ pick: 'party', label: 'Party hat' }, o),
    tick(s) { return s; },
    out: s => ({ skin: s.pick })
  });

  /* ============ HULL-2 — THE DEEP CAVERNS ============
   *
   * Four new mechanics from the hull-2 spec, plus ONE justified extra:
   *
   *   LIFT     — vertical mover; 8 ticks down, 8 up, waits at each end.
   *              The deck's position is on a wire: any cell that stands
   *              there rides (the explorer does — see below).
   *   PICKUP   — pops on touch and sets a bit. The KEY preset sets the bit
   *              the lock listens for; the GOAL preset sets the win bit and
   *              routes its pop to any confetti (Sparks, reused). Same tile,
   *              two stories — a preset IS a starting state.
   *   LOCK     — barrier that pops open only when the wired key-bit is set.
   *              The same one-bit plumbing that arms the harbor's dock guard.
   *   CRUMBLE  — bridge bricks that count touches; at 3 a brick shakes for
   *              popTicks (a visible countdown on its face) and is gone until
   *              it knits back (regrowIn counts down where kids can see).
   *              The SOLID preset is this same tile with fragile=0 — swap it
   *              in mid-game, wires stay, state carries (M2).
   *   SIGN     — one authored line of story. Zero IO: it only sees the player
   *              through a wire, and the line lives in its state.
   *
   *   EXPLORER — the one justified extra tile. Some cell must own "walk on
   *              floors, ride a deck, fall when unsupported, respawn safe" —
   *              no palette tile has that tick, and wiring cannot inject one.
   *              The ledges are authored starting state; the lift deck, the
   *              crumble bridge and the lock gate all arrive by wire (N1).
   *              Falling is SAFE (respawn at start) and progress bits live on
   *              their own cells — a fall costs nothing but the walk back.
   */

  /* ============ LIFT — the deck that rides the shaft ============ */

  R.add({
    key: 'lift', label: 'Lift', kind: 'mechanic', icon: '🛗',
    desc: 'A deck that rides the shaft: 8 ticks down, 8 ticks up, then it waits (the wait is a number too). Whoever stands on the deck rides — its position is on a wire, and the load lamp shows who\'s aboard. dir, phase and hold are all in the inspector.',
    inputs: [{ name: 'riderX', type: 'number' }, { name: 'riderY', type: 'number' }],
    outputs: [{ name: 'x', type: 'number' }, { name: 'deck', type: 'number' }],
    watch: ['dir', 'phase', 'deckY'],
    room: true, w: 52, h: 14,
    hit: s => ({ x: s.x, y: s.deckY, w: s.deckW + 10, h: 18 }),
    seed: () => ({
      x: 216, deckY: 80, topY: 80, bottomY: 176, legTicks: 8,
      holdTop: 64, holdBottom: 30, deckW: 44,
      dir: 'hold', next: 'down', phase: 0, holdLeft: 64, riderPad: 28,
      reversals: 0, trips: 0, riderOn: 0, riders: 0, lastRiderTick: -99, tickCount: 0
    }),
    tick(s, i, room) {
      s.tickCount = room.tick;
      const span = s.bottomY - s.topY, v = span / s.legTicks;   // 8 ticks per leg — by law
      if (s.dir === 'hold') {
        if (s.holdLeft > 0) s.holdLeft--;
        if (s.holdLeft === 0) { s.dir = s.next; s.phase = 0; }
      }
      if (s.dir !== 'hold') {
        // arrival is checked BEFORE moving: the leg that lands spends its last
        // tick as a moving tick (phase 1..8), and the next tick begins the wait
        const atEnd = s.dir === 'down' ? s.deckY >= s.bottomY - 0.001 : s.deckY <= s.topY + 0.001;
        if (atEnd) {
          s.reversals++; s.trips++;
          s.holdLeft = s.dir === 'down' ? s.holdBottom : s.holdTop;   // wait longer where riders board
          s.next = s.dir === 'down' ? 'up' : 'down';
          s.dir = 'hold'; s.phase = 0;
        } else {
          s.deckY = s.dir === 'down' ? Math.min(s.bottomY, s.deckY + v) : Math.max(s.topY, s.deckY - v);
          s.phase++;
        }
      }
      // the load bit — the lift sees its rider ONLY through wires (N1)
      const rx = Number(i.riderX), ry = Number(i.riderY);
      const on = isFinite(rx) && isFinite(ry) && Math.abs(rx - s.x) <= s.deckW / 2 + 6 && Math.abs(ry - s.deckY) <= s.riderPad ? 1 : 0;
      if (on && !s.riderOn && room.tick - s.lastRiderTick > 20) { s.riders++; s.lastRiderTick = room.tick; }
      s.riderOn = on;
      return s;
    },
    out: s => ({ x: s.x, deck: s.deckY }),
    draw(ctx, t) {
      const s = t.state, x = s.x, d = s.deckY;
      ctx.strokeStyle = 'rgba(148,163,184,.65)'; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x - 16, s.topY); ctx.lineTo(x - 16, d);
      ctx.moveTo(x + 16, s.topY); ctx.lineTo(x + 16, d); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#7c4a21'; ctx.fillRect(x - s.deckW / 2, d, s.deckW, 7);
      ctx.fillStyle = '#8d5a2b'; ctx.fillRect(x - s.deckW / 2, d, s.deckW, 3);
      ctx.strokeStyle = '#5b3416'; ctx.strokeRect(x - s.deckW / 2, d, s.deckW, 7);
      ctx.fillStyle = '#fde047';
      if (s.dir === 'up' || s.dir === 'down') {
        const up = s.dir === 'up';
        ctx.beginPath();
        ctx.moveTo(x, d + (up ? 22 : 16)); ctx.lineTo(x - 5, d + (up ? 30 : 24)); ctx.lineTo(x + 5, d + (up ? 30 : 24));
        ctx.closePath(); ctx.fill();
      } else {
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x - 8 + k * 8, d + 20, 1.8, 0, 7); ctx.fill(); }
      }
      ctx.fillStyle = s.riderOn ? '#22c55e' : '#475569';
      ctx.beginPath(); ctx.arc(x + s.deckW / 2 - 4, d - 6, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 9px ui-monospace, monospace'; ctx.textAlign = 'center';
      ctx.fillText(s.dir + (s.dir === 'hold' ? '·' + s.holdLeft : '·' + s.phase), x, d - 4);
    }
  });

  /* ============ PICKUP — pops on touch, sets a bit (key & goal) ============ */

  R.add({
    key: 'pickup', label: 'Pickup', kind: 'collectible', icon: '🔑',
    desc: 'Pops on touch and sets a bit. The KEY preset sets the bit the lock listens for; the GOAL preset sets the win bit and its pop routes to any confetti effect (Sparks, reused). Same tile, two stories — a preset IS a starting state.',
    inputs: [{ name: 'playerX', type: 'number' }, { name: 'playerY', type: 'number' }],
    outputs: [{ name: 'bit', type: 'number' }, { name: 'pop', type: 'event' }],
    watch: ['taken', 'kind'],
    room: true, w: 26, h: 26,
    seed: (o) => Object.assign({
      kind: 'key', x: 400, y: 164, pad: 15, taken: 0, popNow: 0,
      sparkle: 0, takenTick: -1, note: 'the iron key', tickCount: 0
    }, o),
    tick(s, i, room) {
      s.tickCount = room.tick;
      s.popNow = 0;
      if (!s.taken) {
        const px = Number(i.playerX), py = Number(i.playerY);
        if (isFinite(px) && isFinite(py) && Math.abs(px - s.x) <= s.pad && Math.abs(py - s.y) <= s.pad + 6) {
          s.taken = 1; s.popNow = 1; s.sparkle = 30; s.takenTick = room.tick;
        }
      }
      if (s.sparkle > 0) s.sparkle--;
      return s;
    },
    out: s => ({ bit: s.taken ? 1 : 0, pop: s.popNow ? { x: s.x, y: s.y } : null }),
    draw(ctx, t) {
      const s = t.state, tk = t.tickNow || 0;
      const bob = Math.sin(tk / 14) * 3;
      if (s.kind === 'goal') {
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 12); ctx.lineTo(s.x, s.y - 16); ctx.stroke(); ctx.lineWidth = 1;
        const wave = Math.sin(tk / 8) * 3;
        ctx.fillStyle = s.taken ? '#22c55e' : '#38bdf8';
        ctx.beginPath(); ctx.moveTo(s.x, s.y - 16); ctx.lineTo(s.x + 22 + wave, s.y - 10); ctx.lineTo(s.x, s.y - 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 9px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('GOAL', s.x, s.y + 10);
        if (s.taken) {
          ctx.fillStyle = '#fde047'; ctx.font = 'bold 12px "Comic Sans MS", sans-serif';
          ctx.fillText('REACHED!', s.x, s.y - 26);
        }
      } else if (!s.taken) {
        const x = s.x, y = s.y + bob;
        ctx.strokeStyle = '#92400e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x - 8, y, 5, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 11, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 7, y); ctx.lineTo(x + 7, y + 5); ctx.moveTo(x + 11, y); ctx.lineTo(x + 11, y + 5); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(250,204,21,.35)'; ctx.beginPath(); ctx.arc(x, y, 12 + Math.sin(tk / 10) * 2, 0, 7); ctx.fill();
      }
      if (s.sparkle > 0) {
        const p = s.sparkle / 30;
        ctx.strokeStyle = '#fde047';
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2 + tk / 20, r1 = 6 + (1 - p) * 16, r2 = r1 + 6 * p;
          ctx.beginPath();
          ctx.moveTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1);
          ctx.lineTo(s.x + Math.cos(a) * r2, s.y + Math.sin(a) * r2); ctx.stroke();
        }
      }
    }
  });

  /* ============ LOCK — pops open only when the key-bit is set ============ */

  R.add({
    key: 'lock', label: 'Lock', kind: 'mechanic', icon: '🚪',
    desc: 'A barrier that pops open ONLY when the wired key-bit is set — the same one-bit plumbing that arms the harbor\'s dock guard. Bumps while locked are counted, visible, and never punished.',
    inputs: [{ name: 'playerX', type: 'number' }, { name: 'playerY', type: 'number' }, { name: 'keyBit', type: 'number' }],
    outputs: [{ name: 'gate', type: 'any' }],
    watch: ['open', 'bumps', 'keyBit'],
    room: true, w: 14, h: 58,
    hit: s => ({ x: s.x, y: s.y - s.h / 2, w: s.w + 12, h: s.h + 6 }),
    seed: () => ({
      x: 560, y: 176, w: 12, h: 58, open: 0, keyBit: 0,
      openTick: -1, flash: 0, bumps: 0, lastBumpTick: -99, touchNow: 0, pad: 16, tickCount: 0
    }),
    tick(s, i, room) {
      s.tickCount = room.tick;
      if (s.flash > 0) s.flash--;
      const kb = Number(i.keyBit);
      if (isFinite(kb)) s.keyBit = kb ? 1 : 0;         // the bit latches as visible state
      const px = Number(i.playerX), py = Number(i.playerY);
      s.touchNow = !s.open && isFinite(px) && isFinite(py) &&
        Math.abs(px - s.x) <= s.pad && py >= s.y - s.h - 6 && py <= s.y + 8 ? 1 : 0;
      if (s.touchNow) {
        if (s.keyBit) { s.open = 1; s.openTick = room.tick; s.flash = 30; }
        else if (room.tick - s.lastBumpTick > 25) { s.bumps++; s.lastBumpTick = room.tick; }
      }
      return s;
    },
    out: s => ({ gate: { x: s.x, top: s.y - s.h, w: s.w, h: s.h, open: s.open } }),
    draw(ctx, t) {
      const s = t.state, tk = t.tickNow || 0;
      const top = s.y - s.h;
      const shake = tk - s.lastBumpTick >= 0 && tk - s.lastBumpTick < 12 ? Math.sin(tk * 1.3) * 1.5 : 0;
      ctx.fillStyle = '#3f3f46'; ctx.fillRect(s.x - s.w / 2 - 5 + shake, top - 4, s.w + 10, s.h + 4);
      if (!s.open) {
        ctx.fillStyle = '#57534e'; ctx.fillRect(s.x - s.w / 2 + shake, top, s.w, s.h);
        ctx.fillStyle = '#78716c';
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(s.x - s.w / 2 + 3 + shake, top + 8 + k * 14, 1.2, 0, 7); ctx.fill(); }
        const glow = s.keyBit ? 0.55 + Math.sin(tk / 6) * 0.3 : 0.35;
        ctx.fillStyle = 'rgba(250,204,21,' + glow + ')';
        ctx.beginPath(); ctx.arc(s.x + shake, top + s.h * 0.42, 3.4, 0, 7); ctx.fill();
        ctx.fillRect(s.x - 1 + shake, top + s.h * 0.42, 2, 7);
      } else {
        ctx.save();
        ctx.translate(s.x + s.w / 2, top); ctx.transform(1, 0, -0.35, 1, 0, 0);
        ctx.fillStyle = 'rgba(87,83,78,.9)'; ctx.fillRect(0, 0, s.w * 1.15, s.h);
        ctx.restore();
        ctx.fillStyle = 'rgba(253,224,71,' + (0.10 + 0.08 * Math.sin(tk / 8)) + ')';
        ctx.fillRect(s.x - s.w / 2, top, s.w, s.h);
        ctx.fillStyle = '#22c55e'; ctx.font = 'bold 9px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('open', s.x, top - 8);
      }
      if (s.flash > 0) {
        const p = s.flash / 30;
        ctx.strokeStyle = '#fde047';
        for (let k = 0; k < 10; k++) {
          const a = k / 10 * Math.PI * 2, r1 = 8 + (1 - p) * 22, r2 = r1 + 5 * p;
          ctx.beginPath();
          ctx.moveTo(s.x + Math.cos(a) * r1, s.y - s.h / 2 + Math.sin(a) * r1);
          ctx.lineTo(s.x + Math.cos(a) * r2, s.y - s.h / 2 + Math.sin(a) * r2); ctx.stroke();
        }
      }
    }
  });

  /* ============ CRUMBLE — the bridge that counts its touches ============ */

  R.add({
    key: 'crumble', label: 'Crumble bridge', kind: 'mechanic', icon: '🧱',
    desc: 'Bridge bricks that count their touches: at 3 a brick shakes for popTicks — a countdown painted on its face — then it is GONE until it knits back (regrowIn, also visible). Falling is safe and progress lives on other cells, so a fall is a retry, not a spiral. The Solid bridge preset is this tile with fragile=0: swap it in mid-game and the wires stay.',
    inputs: [{ name: 'playerX', type: 'number' }, { name: 'playerY', type: 'number' }],
    outputs: [{ name: 'floors', type: 'any' }],
    watch: ['pops', 'fragile'],
    room: true, w: 100, h: 12,
    hit: s => ({
      x: (Math.min.apply(null, s.cx) + Math.max.apply(null, s.cx)) / 2,
      y: s.cy[0], w: Math.max.apply(null, s.cx) - Math.min.apply(null, s.cx) + s.cw, h: 26
    }),
    seed: (o) => Object.assign({
      cw: 26, pad: 4, maxTouches: 3, popTicks: 34, regrowTicks: 200, fragile: 1,
      cx: [442, 472, 502], cy: [176, 176, 176],
      touching: [0, 0, 0], touches: [0, 0, 0], gone: [0, 0, 0],
      popIn: [0, 0, 0], regrowIn: [0, 0, 0], pops: 0, tickCount: 0
    }, o),
    tick(s, i, room) {
      s.tickCount = room.tick;
      const px = Number(i.playerX), py = Number(i.playerY);
      const has = isFinite(px) && isFinite(py);
      for (let k = 0; k < s.cx.length; k++) {
        // a touch is an EPISODE: counted when contact begins, not every tick
        const contact = has && !s.gone[k] && Math.abs(px - s.cx[k]) <= s.cw / 2 + s.pad &&
          py >= s.cy[k] - 6 && py <= s.cy[k] + 12;
        if (contact && !s.touching[k]) {
          s.touches[k]++;
          if (s.fragile && s.touches[k] >= s.maxTouches && !s.popIn[k] && !s.gone[k]) s.popIn[k] = s.popTicks + 1;
        }
        s.touching[k] = contact ? 1 : 0;
        if (!s.fragile && s.popIn[k]) s.popIn[k] = 0;   // solidified mid-shake: the pending pop cancels
        if (s.popIn[k] > 0) {
          s.popIn[k]--;
          if (s.popIn[k] === 0) { s.gone[k] = 1; s.pops++; s.regrowIn[k] = s.regrowTicks; }
        }
        if (s.gone[k]) {
          if (s.regrowIn[k] > 0) s.regrowIn[k]--;
          if (s.regrowIn[k] === 0) { s.gone[k] = 0; s.touches[k] = 0; s.touching[k] = 0; }  // the brick knits back
        }
      }
      return s;
    },
    out: s => ({ floors: { xs: s.cx, ys: s.cy, w: s.cw, gone: s.gone } }),
    draw(ctx, t) {
      const s = t.state, tk = t.tickNow || 0;
      for (let k = 0; k < s.cx.length; k++) {
        const x = s.cx[k], y = s.cy[k];
        if (s.gone[k]) {
          ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.setLineDash([3, 3]);
          ctx.strokeRect(x - s.cw / 2, y - 2, s.cw, 10); ctx.setLineDash([]);
          if (s.regrowIn[k] > 0 && s.regrowIn[k] < 100) {
            ctx.fillStyle = '#64748b'; ctx.font = '8px ui-monospace, monospace'; ctx.textAlign = 'center';
            ctx.fillText('+' + s.regrowIn[k], x, y - 6);
          }
          continue;
        }
        const shake = s.popIn[k] > 0 ? Math.sin(tk * 1.1) * 2 : 0;
        ctx.fillStyle = s.popIn[k] > 0 ? '#b45309' : (s.touches[k] >= 2 ? '#92670f' : '#6b7280');
        ctx.fillRect(x - s.cw / 2 + shake, y - 2, s.cw, 10);
        ctx.fillStyle = 'rgba(226,232,240,.5)'; ctx.fillRect(x - s.cw / 2 + shake, y - 2, s.cw, 2);
        ctx.strokeStyle = 'rgba(0,0,0,.4)';
        for (let c = 0; c < s.touches[k]; c++) {
          ctx.beginPath(); ctx.moveTo(x - 8 + c * 8 + shake, y + 8); ctx.lineTo(x - 4 + c * 8 + shake, y - 1); ctx.stroke();
        }
        if (s.popIn[k] > 0) {
          ctx.fillStyle = '#fecaca'; ctx.font = 'bold 9px ui-monospace, monospace'; ctx.textAlign = 'center';
          ctx.fillText(String(s.popIn[k]), x, y + 18);   // the timer is ON the face
        }
        if (s.touching[k]) {
          ctx.fillStyle = '#fde047'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('!', x, y - 6);
        }
      }
    }
  });

  /* ============ SIGN — one authored line, zero IO ============ */

  R.add({
    key: 'sign', label: 'Sign', kind: 'story', icon: '🪧',
    desc: 'One authored line of story. Zero IO — it only needs to see the player through a wire, and the line lives in its state where any kid can read (and re-write) it.',
    inputs: [{ name: 'playerX', type: 'number' }, { name: 'playerY', type: 'number' }],
    outputs: [],
    watch: ['near', 'reads'],
    room: true, w: 40, h: 40,
    hit: s => ({ x: s.x, y: s.y - 18, w: 48, h: 50 }),
    seed: (o) => Object.assign({
      x: 150, y: 80, line: 'a hand-painted sign', near: 0, reads: 0,
      lastReadTick: -99, range: 46, tickCount: 0
    }, o),
    tick(s, i, room) {
      s.tickCount = room.tick;
      const px = Number(i.playerX), py = Number(i.playerY);
      const near = isFinite(px) && isFinite(py) && Math.abs(px - s.x) <= s.range && Math.abs(py - s.y) <= 34 ? 1 : 0;
      if (near && !s.near) { s.reads++; s.lastReadTick = room.tick; }   // a read is a touch, not a tick
      s.near = near;
      return s;
    },
    draw(ctx, t) {
      const s = t.state;
      ctx.fillStyle = '#5b3416'; ctx.fillRect(s.x - 2, s.y - 24, 4, 24);
      ctx.fillStyle = '#8d5a2b'; ctx.fillRect(s.x - 24, s.y - 40, 48, 18);
      ctx.strokeStyle = '#5b3416'; ctx.strokeRect(s.x - 24, s.y - 40, 48, 18);
      ctx.fillStyle = '#d6c39a';
      ctx.beginPath(); ctx.arc(s.x - 19, s.y - 35, 1.2, 0, 7); ctx.arc(s.x + 19, s.y - 35, 1.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 8px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('read me', s.x, s.y - 29);
      if (s.near) {
        const words = s.line.split(' ');
        const lines = []; let cur = '';
        for (const w2 of words) {
          if ((cur + ' ' + w2).trim().length > 30) { lines.push(cur.trim()); cur = w2; } else cur += ' ' + w2;
        }
        if (cur.trim()) lines.push(cur.trim());
        const bw = Math.min(210, Math.max.apply(null, lines.map(l2 => l2.length)) * 5.6 + 16);
        const bh = lines.length * 12 + 10;
        const bx = s.x, by = s.y - 52 - bh;
        ctx.fillStyle = 'rgba(248,250,252,.95)';
        ctx.beginPath();
        ctx.moveTo(bx - bw / 2, by); ctx.lineTo(bx + bw / 2, by); ctx.lineTo(bx + bw / 2, by + bh);
        ctx.lineTo(bx + 5, by + bh); ctx.lineTo(bx, by + bh + 6); ctx.lineTo(bx - 5, by + bh);
        ctx.lineTo(bx - bw / 2, by + bh); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#94a3b8'; ctx.stroke();
        ctx.fillStyle = '#1e293b'; ctx.font = '10px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
        lines.forEach((l2, k2) => ctx.fillText(l2, bx, by + 14 + k2 * 12));
      }
    }
  });

  /* ============ EXPLORER — the justified fifth: it owns the feet ============ */

  R.add({
    key: 'explorer', label: 'Explorer', kind: 'actor', icon: '🧗',
    desc: 'Walks ledges, rides lift decks, crosses crumble bridges — and falls SAFE (respawn at the start; progress bits live on their own cells, so a fall is a retry, not a spiral). The ledges are authored starting state; the deck, the bridge and the gate arrive by wire. The one justified hull-2 tile: some cell must own walking, and wiring cannot inject a tick.',
    inputs: [
      { name: 'move', type: 'number' },      // keyboard
      { name: 'liftX', type: 'number' },      // the deck's position — standing on it IS riding
      { name: 'liftDeck', type: 'number' },
      { name: 'floors', type: 'any' },        // the crumble bridge's live cells
      { name: 'gate', type: 'any' }           // the lock's barrier (solid until its bit says open)
    ],
    outputs: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }],
    watch: ['x', 'y', 'on'],
    room: true, w: 24, h: 34,
    hit: s => ({ x: s.x, y: s.y - 15, w: 26, h: 38 }),
    seed: (o) => Object.assign({
      name: 'Wren', x: 80, y: 80, startX: 80, startY: 80, speed: 2.4,
      facing: 1, moveDir: 0, minX: 16, maxX: 624, snapUp: 14, snapDown: 16,
      floors: [[26, 200, 80], [232, 425, 176], [515, 614, 176]],   // the cavern, authored
      on: 'ledge', riding: 0, onCrumble: 0, blocked: 0,
      falling: 0, fallTicks: 0, falls: 0,
      liftX: -999, liftDeck: -999, gateSeen: 0, gateX: -999, gateTop: -999,
      gateW: 12, gateH: 58, gateOpen: 1, tickCount: 0
    }, o),
    tick(s, i, room) {
      s.tickCount = room.tick;
      s.moveDir = Number(i.move) || 0;
      const lx = Number(i.liftX), ld = Number(i.liftDeck);
      if (isFinite(lx)) s.liftX = lx;
      if (isFinite(ld)) s.liftDeck = ld;
      const g = i.gate;
      if (g && typeof g === 'object') {
        s.gateX = Number(g.x) || s.gateX; s.gateTop = Number(g.top) || s.gateTop;
        s.gateW = Number(g.w) || s.gateW; s.gateH = Number(g.h) || s.gateH;
        s.gateOpen = g.open ? 1 : 0; s.gateSeen = 1;
      }
      // falling is terminal for the walk (no mid-fall grabbing) but SAFE: respawn, keep going
      if (s.falling) {
        s.fallTicks++; s.y += Math.min(3 + s.fallTicks * 0.35, 9);
        s.on = 'air'; s.riding = 0; s.onCrumble = 0; s.blocked = 0;
        if (s.fallTicks >= 40) {
          s.x = s.startX; s.y = s.startY; s.falling = 0; s.fallTicks = 0; s.falls++; s.on = 'ledge';
        }
        return s;
      }
      if (s.moveDir) s.facing = s.moveDir;
      let nx = clamp(s.x + s.moveDir * s.speed, s.minX, s.maxX);
      // a closed gate is a wall — its box arrives by wire, never by reaching over (N1)
      s.blocked = 0;
      if (s.gateSeen && !s.gateOpen) {
        const hw = s.gateW / 2, l = s.gateX - hw, r = s.gateX + hw;
        const yIn = s.y > s.gateTop - 4 && s.y < s.gateTop + s.gateH + 4;
        if (yIn) {
          if (s.x < l && nx >= l) { nx = l - 0.5; s.blocked = 1; }
          else if (s.x > r && nx <= r) { nx = r + 0.5; s.blocked = 1; }
        }
      }
      s.x = nx;
      // support: authored ledges + the wired deck + the wired bridge cells.
      // The surface nearest the feet (just above or below) wins — that is standing.
      const cands = [];
      for (const fl of s.floors) {
        if (!fl || fl.length < 3) continue;
        if (s.x >= fl[0] && s.x <= fl[1] && fl[2] >= s.y - s.snapUp && fl[2] <= s.y + s.snapDown)
          cands.push({ y: fl[2], src: 'ledge' });
      }
      if (s.liftDeck > -900) {
        if (Math.abs(s.x - s.liftX) <= 30 && s.liftDeck >= s.y - s.snapUp - 6 && s.liftDeck <= s.y + s.snapDown + 4)
          cands.push({ y: s.liftDeck, src: 'lift' });   // wide window: the deck moves 12px a tick
      }
      const cf = i.floors;
      if (cf && Array.isArray(cf.xs)) {
        for (let k = 0; k < cf.xs.length; k++) {
          if (cf.gone && cf.gone[k]) continue;
          const w2 = (Number(cf.w) || 26) / 2 + 4;
          if (Math.abs(s.x - cf.xs[k]) <= w2 && cf.ys[k] >= s.y - s.snapUp && cf.ys[k] <= s.y + s.snapDown)
            cands.push({ y: cf.ys[k], src: 'bridge' });
        }
      }
      if (!cands.length) { s.falling = 1; s.fallTicks = 0; s.on = 'air'; return s; }
      cands.sort((a, b) => a.y - b.y);          // highest surface near the feet
      s.y = cands[0].y; s.on = cands[0].src;
      s.riding = cands[0].src === 'lift' ? 1 : 0;
      s.onCrumble = cands[0].src === 'bridge' ? 1 : 0;
      return s;
    },
    out: s => ({ x: s.x, y: s.y }),
    draw(ctx, t) {
      const s = t.state, x = s.x, y = s.y, tk = t.tickNow || 0;   // y = feet
      const flail = s.falling ? Math.sin(tk / 2) * 5 : 0;
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
      const stride = s.moveDir ? Math.sin(tk / 3) * 3.5 : 0;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 10); ctx.lineTo(x - 4 - stride, y);
      ctx.moveTo(x + 4, y - 10); ctx.lineTo(x + 4 + stride, y);
      ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = '#b45309';
      ctx.beginPath(); ctx.moveTo(x - 8, y - 9); ctx.quadraticCurveTo(x, y - 24, x + 8, y - 9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#facc15'; ctx.beginPath(); ctx.moveTo(x - 6, y - 13); ctx.lineTo(x + 6, y - 13); ctx.stroke();
      ctx.strokeStyle = '#b45309';
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 18); ctx.lineTo(x - 13, y - (s.falling ? 26 + flail : 10));
      ctx.moveTo(x + 7, y - 18); ctx.lineTo(x + 13, y - (s.falling ? 26 - flail : 10));
      ctx.stroke();
      ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(x, y - 27, 6.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(x, y - 28, 7, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(x + 4 * s.facing, y - 27, 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(253,224,71,.12)';
      ctx.beginPath(); ctx.moveTo(x + 4 * s.facing, y - 27);
      ctx.lineTo(x + 38 * s.facing, y - 40); ctx.lineTo(x + 38 * s.facing, y - 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x + 2.5 * s.facing, y - 26, 1.1, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(15,23,42,.75)'; ctx.font = '10px "Comic Sans MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.name + (s.onCrumble ? ' 🧱' : ''), x, y - 44);
      if (s.falling) { ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 10px "Comic Sans MS", sans-serif'; ctx.fillText('wheee', x, y - 54); }
      if (s.blocked) { ctx.fillStyle = '#fca5a5'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('✱', x + 12, y - 30); }
      if (s.riding) { ctx.fillStyle = '#a5f3fc'; ctx.font = '9px "Comic Sans MS", sans-serif'; ctx.fillText('riding', x, y + 10); }
    }
  });

  /* ---------- palette entries (type + starting state) ----------
   * The starting-state rule: "she is the community gardener, lives upstairs"
   * IS a starting state. Presets are the same tiles with different stories. */
  QS.PALETTE = [
    { key: 'actor', label: '🚀 Ship (actor)', type: 'actor', seed: { name: 'ship', skin: 'rocket', y: 330 } },
    { key: 'actor-kite', label: '🪁 Kite (actor)', type: 'actor', seed: { name: 'kite', skin: 'kite', y: 120, speed: 3 } },
    { key: 'keyboard', label: '🎮 Keyboard input', type: 'keyboard', seed: {} },
    { key: 'bullet', label: '✨ Bullet', type: 'bullet', seed: {} },
    { key: 'creatureGrid', label: '👾 Creature grid', type: 'creatureGrid', seed: {} },
    { key: 'crash', label: '💥 Crash physics', type: 'crash', seed: {} },
    { key: 'boomPop', label: '🌟 Effect: Boom Pop', type: 'boomPop', seed: {} },
    { key: 'boomRing', label: '💫 Effect: Boom Ring', type: 'boomRing', seed: {} },
    { key: 'boomSparks', label: '🎇 Effect: Boom Sparks', type: 'boomSparks', seed: {} },
    { key: 'scorePing', label: '🏅 Effect: Score ping', type: 'scorePing', seed: {} },
    { key: 'shopkeeper', label: '🧹 Shopkeeper (NPC)', type: 'npc', seed: { role: 'shopkeeper', name: 'Maya', x: 240, y: 180, homeX: 240, homeY: 180, wTend: 4 } },
    { key: 'gardener', label: '🌻 Gardener (NPC)', type: 'npc', seed: { role: 'gardener', name: 'Theo', x: 430, y: 230, homeX: 430, homeY: 230, wTend: 5, wWander: 4, seed: 99 } },
    { key: 'pilot', label: '🛥️ Harbor pilot (ship)', type: 'pilot', seed: {} },
    { key: 'p-curious', label: '🎭 Personality: Curious', type: 'personality', seed: { style: 'curious', note: 'wanders more, rests less', bWander: 3, bTend: 0, bWave: 0, bRest: -1 } },
    { key: 'p-shy', label: '🎭 Personality: Shy', type: 'personality', seed: { style: 'shy', note: 'hides and rests', bWander: -1, bTend: 0, bWave: -2, bRest: 3 } },
    { key: 'p-grumpy', label: '🎭 Personality: Grumpy', type: 'personality', seed: { style: 'grumpy', note: 'tends shop, waves never', bWander: -1, bTend: 3, bWave: -2, bRest: 0 } },
    { key: 'p-helpful', label: '🎭 Personality: Helpful', type: 'personality', seed: { style: 'helpful', note: 'waves more, tends more', bWander: 0, bTend: 1, bWave: 2, bRest: -1 } },
    { key: 'p-captain', label: '🎭 Personality: Sea captain', type: 'personality', seed: { style: 'captain', note: 'loves the patrol, quick on the cannon', bWander: 1, bTend: 2, bWave: 2, bRest: -1 } },
    { key: 'sheet', label: '📋 Character sheet', type: 'sheet', seed: {} },
    { key: 'skin-party', label: '👕 Skin: Party hat', type: 'skinPick', seed: { pick: 'party', label: 'Party hat' } },
    { key: 'skin-classic', label: '👕 Skin: Classic', type: 'skinPick', seed: { pick: 'classic', label: 'Classic' } },
    { key: 'skin-overalls', label: '👖 Skin: Overalls', type: 'skinPick', seed: { pick: 'overalls', label: 'Overalls' } },
    /* hull-2 — the deep caverns */
    { key: 'lift', label: '🛗 Lift', type: 'lift', seed: {} },
    { key: 'explorer', label: '🧗 Explorer (player)', type: 'explorer', seed: {} },
    { key: 'key', label: '🔑 Key', type: 'pickup', seed: { kind: 'key', note: 'the iron key' } },
    { key: 'goal', label: '🏁 Goal', type: 'pickup', tileLabel: 'Goal', seed: { kind: 'goal', x: 600, note: 'the crystal gate' } },
    { key: 'lock', label: '🚪 Lock', type: 'lock', seed: {} },
    { key: 'crumble', label: '🧱 Crumble bridge', type: 'crumble', seed: {} },
    { key: 'crumble-solid', label: '🗿 Solid bridge', type: 'crumble', tileLabel: 'Solid bridge', seed: { fragile: 0 } },
    { key: 'sign', label: '🪧 Sign', type: 'sign', seed: {} }
  ];
  QS.paletteByKey = (k) => QS.PALETTE.find(p => p.key === k);
})();
