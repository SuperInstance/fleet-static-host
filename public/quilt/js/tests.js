/* tests.js — the CONTRACT TESTS. House law applies to kids' tools too.
 *
 * Every palette tile is checked against M1–M4 and N1–N4 from
 * docs/TILE-CONTRACT.md. These run in test.html (browser) AND
 * run-tests.js (node) against the exact same engine code.
 */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const results = [];
  let curSuite = '';
  const T = (name, fn) => {
    try { fn(); results.push({ suite: curSuite, name, ok: true }); }
    catch (e) { results.push({ suite: curSuite, name, ok: false, err: e.message }); }
  };
  const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };

  /* rogue tiles used to attack the contract from inside */
  const rogues = () => {
    QS.Registry.add({
      key: 'rogue-alias', label: 'rogue alias', kind: 'mechanic', icon: '🦹',
      inputs: [{ name: 'grid', type: 'any' }, { name: 'mood', type: 'any' }],
      outputs: [], room: false,
      seed: () => ({ pokes: 0 }),
      tick(s, i) { if (i.grid && i.grid.alive) { i.grid.alive[3] = 0; i.grid.originX = -999; s.pokes++; } if (i.mood) i.mood.bWave = 999; return s; },
      out: () => ({})
    });
    QS.Registry.add({
      key: 'rogue-spy', label: 'rogue spy', kind: 'mechanic', icon: '🕵️',
      inputs: [{ name: 'skin', type: 'text' }],
      outputs: [], room: false,
      seed: () => ({ gotType: 'none', roomFrozen: 0, sawTilesKey: 0 }),
      tick(s, i, room) {
        if (i.skin !== null && typeof i.skin !== 'undefined') s.gotType = typeof i.skin;
        s.roomFrozen = Object.isFrozen(room) ? 1 : 0;
        s.sawTilesKey = 'tiles' in room ? 1 : 0;
        return s;
      },
      out: () => ({})
    });
    QS.Registry.add({
      key: 'rogue-throw', label: 'rogue thrower', kind: 'mechanic', icon: '💣',
      inputs: [], outputs: [], room: false,
      seed: () => ({ n: 0 }),
      tick(s) { s.n++; if (s.n === 6) throw new Error('I am a bad tile and I feel fine'); return s; },
      out: () => ({})
    });
    QS.Registry.add({
      key: 'rogue-mirror', label: 'rogue mirror', kind: 'mechanic', icon: '🪞',
      inputs: [{ name: 'grid', type: 'any' }],
      outputs: [], room: false,
      seed: () => ({ lastAlive: '', deadSeenTick: -1 }),
      tick(s, i, room) {
        if (i.grid && i.grid.alive) {
          s.lastAlive = i.grid.alive.join('');
          if (s.lastAlive.indexOf('0') >= 0 && s.deadSeenTick < 0) s.deadSeenTick = room.tick;
        }
        return s;
      },
      out: () => ({})
    });
  };

  const freshEngine = (fabric) => { const e = new QS.Engine(fabric); QS.__engine = e; return e; };

  const suites = {

    'Registry sanity — every tile is well-formed': () => {
      T('every def has key, label, seed, tick, ports with legal types', () => {
        for (const def of QS.Registry.all()) {
          ok(def.key && def.label && def.seed && def.tick, def.key + ' incomplete');
          for (const p of (def.inputs || []).concat(def.outputs || []))
            ok(QS.PORT_TYPES.includes(p.type), def.key + '.' + p.name + ' bad port type');
        }
      });
      T('every state is plain visible data (no functions, no undefined, JSON-round-trips)', () => {
        for (const p of QS.PALETTE) {
          const def = QS.Registry.get(p.type);
          const st = Object.assign(def.seed({}), p.seed || {});
          const rt = JSON.parse(JSON.stringify(st));
          eq(JSON.stringify(rt), JSON.stringify(st), p.key + ' state is not JSON-honest');
        }
      });
      T('out() publishes only declared ports', () => {
        for (const def of QS.Registry.all()) {
          const st = def.seed({});
          const o = def.out ? def.out(st) : {};
          const names = (def.outputs || []).map(x => x.name);
          for (const k of Object.keys(o)) ok(names.includes(k), def.key + '.out leaks port ' + k);
        }
      });
      T('watch keys exist in seed state', () => {
        for (const def of QS.Registry.all())
          for (const k of (def.watch || []))
            ok(k in def.seed({}), def.key + ' watches missing key ' + k);
      });
    },

    'Idle life — a cell ticks whether or not any IO arrives': () => {
      T('every palette tile survives 300 ticks alone, unhaltered', () => {
        for (const p of QS.PALETTE) {
          const f = new QS.Fabric({ name: 'solo ' + p.key });
          f.addTile(p.key, 40, 40, p.seed);
          const e = freshEngine(f);
          e.step(300);
          const t = f.tiles[0];
          ok(!t.halted, p.key + ' halted alone: ' + (t.halted && t.halted.message));
        }
      });
      T('the shopkeeper lives with ZERO wires: idle loop switches actions on its own', () => {
        const f = new QS.Fabric({ name: 'solo npc' });
        const npc = f.addTile('shopkeeper', 40, 40);
        const e = freshEngine(f);
        e.step(1500);
        const s = npc.state;
        const kinds = ['cWander', 'cTend', 'cWave', 'cRest'].filter(k => s[k] > 0).length;
        ok(kinds >= 2, 'shopkeeper only did ' + kinds + ' action kinds in 1500 ticks');
        ok(s.switches >= 3, 'shopkeeper never rescheduled (' + s.switches + ' switches)');
        ok(s.tickCount > 1400, 'shopkeeper did not tick');
      });
      T('personality changes the idle weights (same skeleton, different numbers)', () => {
        const mk = (seed) => {
          const f = new QS.Fabric({});
          const npc = f.addTile('shopkeeper', 40, 40);
          const per = f.addTile('personality', 200, 40, seed);
          f.addWire(per.id, 'mood', npc.id, 'mood');
          freshEngine(f).step(1200);
          return npc.state;
        };
        const helpful = mk({ style: 'helpful', bWave: 2, bTend: 1, bRest: -1 });
        const shy = mk({ style: 'shy', bWander: -1, bWave: -2, bRest: 3 });
        eq(helpful.bWave, 2, 'helpful bias not applied');
        eq(shy.bRest, 3, 'shy bias not applied');
        ok(helpful.cWave > shy.cWave, 'helpful did not wave more than shy (' + helpful.cWave + ' vs ' + shy.cWave + ')');
      });
    },

    'M1 + N2 — inspectable, nothing hidden': () => {
      T('inspector rows cover EVERY state key, in every tile, in both scenes', () => {
        for (const sc of QS.Scenes.list) {
          const f = sc.build();
          for (const t of f.tiles) {
            const rows = QS.Inspect.rowsFor(t.state);
            for (const k of Object.keys(t.state)) {
              ok(rows.some(r => r.key === k || r.key.startsWith(k + '[') || r.key.startsWith(k + '.')),
                t.label + ' hides key "' + k + '" from the inspector (N2)');
            }
          }
        }
      });
      T('creature arrays render one row per cell — a kid can watch creature[5] die', () => {
        const f = QS.Scenes.invaders();
        const grid = f.tiles.find(t => t.type === 'creatureGrid');
        const rows = QS.Inspect.rowsFor(grid.state);
        ok(rows.some(r => r.key === 'alive[5]'), 'alive[5] row missing');
        eq(rows.filter(r => r.key.startsWith('alive[')).length, grid.state.alive.length, 'alive rows');
      });
      T('no rogue hidden fields sneak in during a run', () => {
        const f = QS.Scenes.invaders();
        freshEngine(f).step(240);
        for (const t of f.tiles) {
          for (const [k, v] of Object.entries(t.state)) {
            ok(['number', 'string', 'boolean', 'object'].includes(typeof v), t.label + '.' + k + ' became a ' + typeof v);
            if (typeof v === 'object' && v !== null) ok(Array.isArray(v) || v.constructor === Object, t.label + '.' + k + ' exotic object');
          }
        }
      });
    },

    'N1 — no tile reaches into a neighbor except through a wire': () => {
      T('a rogue tile mutating its wire INPUT cannot corrupt the owner\'s state', () => {
        const f = QS.Scenes.invaders();
        const rogue = f.addTile('rogue-alias', 500, 400);
        f.addWire(f.tiles.find(t => t.type === 'creatureGrid').id, 'grid', rogue.id, 'grid');
        const e = freshEngine(f);
        e.step(30);
        const grid = f.tiles.find(t => t.type === 'creatureGrid');
        eq(rogue.state.pokes, 29, 'rogue never received grid');
        eq(grid.state.alive[3], 1, 'rogue KILLED creature 3 through the wire — aliasing leak (N1)');
        eq(grid.state.originX > 39 && grid.state.originX < 80, true, 'rogue moved the grid (N1)');
      });
      T('the engine hands a tile ONLY its own ports — inputs are copies', () => {
        const f = new QS.Fabric({});
        const spy = f.addTile('rogue-spy', 40, 40);
        const per = f.addTile('personality', 40, 200);
        const rogue = f.addTile('rogue-alias', 300, 40);
        f.addWire(per.id, 'mood', rogue.id, 'mood');
        freshEngine(f).step(5);
        eq(per.state.style, 'helpful', 'personality state polluted');
        ok(!('bWave' in per.state && per.state.bWave === 999), 'personality state polluted');
      });
    },

    'N3 — a mechanic owns its slice and nothing else': () => {
      T('the room handed to tick is frozen and has no door to other tiles', () => {
        const f = new QS.Fabric({});
        const spy = f.addTile('rogue-spy', 40, 40);
        freshEngine(f).step(3);
        eq(spy.state.roomFrozen, 1, 'room was NOT frozen');
        eq(spy.state.sawTilesKey, 0, 'room exposes other tiles');
      });
      T('crash-physics may not move the ship: it owns collisions only', () => {
        const f = QS.Scenes.invaders();
        const ship = f.tiles.find(t => t.type === 'actor');
        const crash = f.tiles.find(t => t.type === 'crash');
        const x0 = ship.state.x;
        freshEngine(f).step(120);
        eq(typeof crash.state.checks, 'number', 'crash never checked');
        ok(Math.abs(ship.state.x - x0) < 0.001, 'the ship drifted without input — who moved it?');
      });
    },

    'M3 — fail visibly, halt ITSELF, the room runs on': () => {
      T('a throwing tile halts itself with the error on record', () => {
        const f = QS.Scenes.invaders();
        const boom = f.addTile('rogue-throw', 700, 400);
        const e = freshEngine(f);
        e.step(20);
        ok(boom.halted, 'thrower never halted');
        eq(boom.halted.message, 'I am a bad tile and I feel fine');
      });
      T('the room keeps running without it — neighbors keep ticking', () => {
        const f = new QS.Fabric({});
        const npc = f.addTile('shopkeeper', 40, 40);
        f.addTile('rogue-throw', 300, 40);
        const e = freshEngine(f);
        e.step(60);
        const t1 = npc.state.tickCount;
        e.step(60);
        ok(npc.state.tickCount > t1, 'the shopkeeper stopped when her neighbor broke (M3)');
        ok(f.tiles[1].halted, 'bad tile should be halted');
      });
      T('resume works — the tile rejoins the room', () => {
        const f = new QS.Fabric({});
        const bad = f.addTile('rogue-throw', 40, 40);
        const e = freshEngine(f);
        e.step(20); ok(bad.halted, 'pre-halt');
        e.resume(bad.id);
        e.step(2);
        ok(!bad.halted, 'resume failed');
      });
    },

    'M2 — swappable: wires survive by port name': () => {
      T('swapping the explosion keeps the boom wire — flip the channel, not the wiring', () => {
        const f = QS.Scenes.invaders();
        const pop = f.tiles.find(t => t.type === 'boomPop');
        const crash = f.tiles.find(t => t.type === 'crash');
        const wire = f.wires.find(w => w.from === crash.id && w.to === pop.id && w.fromPort === 'boom');
        ok(wire, 'no boom wire to start');
        const same = f.swapTile(pop.id, 'boomRing');
        ok(f.wire(wire.id), 'the wire object VANISHED on swap (M2)');
        eq(f.wire(wire.id).to, same.id, 'wire no longer lands on the swapped tile');
        eq(f.wire(wire.id).flag, null, 'kept wire wrongly flagged');
      });
      T('swapping to a tile without the port flags the wire for re-wire — kept, not deleted', () => {
        const f = QS.Scenes.invaders();
        const pop = f.tiles.find(t => t.type === 'boomPop');
        const crash = f.tiles.find(t => t.type === 'crash');
        const n0 = f.wires.length;
        f.swapTile(pop.id, 'shopkeeper');
        eq(f.wires.length, n0, 'wires deleted on swap (N4/M2)');
        const w = f.wires.find(x => x.from === crash.id && x.fromPort === 'boom');
        ok(w && w.flag === 'orphan-port', 'orphaned boom wire should be flagged, not gone');
      });
      T('port types are loose: mismatch is FLAGGED, never coerced', () => {
        const f = new QS.Fabric({});
        const spy = f.addTile('rogue-spy', 40, 40);
        const actor = f.addTile('actor', 300, 40);
        const w = f.addWire(actor.id, 'x', spy.id, 'skin');   // number → text
        ok(w, 'wire refused');
        eq(w.flag, 'type-mismatch', 'mismatch not flagged');
        freshEngine(f).step(2);
        eq(spy.state.gotType, 'number', 'value was coerced (contract §3 says flagged, not coerced)');
      });
    },

    'M4 — saveable: the file IS the fabric': () => {
      T('save → load round-trips tiles, wires, state, history', () => {
        const f = QS.Scenes.invaders();
        freshEngine(f).step(120);
        const json = f.save();
        const g = QS.Fabric.load(json);
        eq(g.tiles.length, f.tiles.length, 'tile count changed');
        eq(g.wires.length, f.wires.length, 'wire count changed');
        ok(g.history.length >= f.history.length, 'history lost on load (N4)');
        for (let i = 0; i < f.tiles.length; i++) {
          eq(JSON.stringify(g.tiles[i].state), JSON.stringify(f.tiles[i].state), 'state drifted for ' + f.tiles[i].label);
        }
        const t = g.tiles.find(x => x.type === 'crash');
        ok(t && t.state.checks > 0, 'loaded state lost its numbers');
      });
      T('retired tiles are kept in the file — nothing is destroyed', () => {
        const f = QS.Scenes.invaders();
        const score = f.tiles.find(t => t.type === 'scorePing');
        f.removeTile(score.id);
        const g = QS.Fabric.load(f.save());
        eq(g.retired.length, 1, 'retired tile vanished from the file (N4)');
        eq(g.retired[0].type, 'scorePing');
        eq(g.tiles.length, 6, 'retired tile still live?');
      });
    },

    'N4 — history is append-only': () => {
      T('rewires append; no operation ever shortens history', () => {
        const f = QS.Scenes.invaders();
        const lens = [f.history.length];
        const a = f.tiles[0], b = f.tiles[1];
        const w = f.addWire(a.id, (QS.Registry.get(a.type).outputs[0] || {}).name, b.id, (QS.Registry.get(b.type).inputs[0] || {}).name);
        lens.push(f.history.length);
        if (w) f.removeWire(w.id);
        lens.push(f.history.length);
        const pop = f.tiles.find(t => t.type === 'boomPop');
        f.swapTile(pop.id, 'boomRing');
        lens.push(f.history.length);
        f.removeTile(f.tiles[f.tiles.length - 1].id);
        lens.push(f.history.length);
        const g = QS.Fabric.load(f.save());
        lens.push(g.history.length);
        for (let i = 1; i < lens.length; i++)
          ok(lens[i] >= lens[i - 1], 'history SHRANK at step ' + i + ': ' + lens.join(','));
        const ids = g.history.map(h => h.i);
        eq(new Set(ids).size, ids.length, 'history indices not unique');
      });
    },

    'Wire honesty — one kill is one boom, in any tile order': () => {
      const shot = (flip) => {
        const f = QS.Scenes.invaders();
        if (flip) {   // a kid who added crash BEFORE grid — same wires, different add order
          const ci = f.tiles.findIndex(t => t.type === 'crash');
          const gi = f.tiles.findIndex(t => t.type === 'creatureGrid');
          f.tiles.splice(gi, 0, f.tiles.splice(ci, 1)[0]);
        }
        const e = freshEngine(f);
        const ship = f.tiles.find(t => t.type === 'actor');
        e.step(5); ship.state.x = 210; e.step(2); e.fire(); e.step(90);
        const grab = ty => f.tiles.find(t => t.type === ty).state;
        return { hits: grab('crash').hits, kills: grab('creatureGrid').killedCount,
          alive: grab('creatureGrid').aliveCount, score: grab('scorePing').score,
          booms: grab('boomPop').totalBooms };
      };
      T('one kill is one boom and one score — even if crash was added before grid', () => {
        const r = shot(true);
        eq(r.hits, 1, 'crash double-counted the hit: ' + JSON.stringify(r));
        eq(r.booms, 1, 'the effect boomed twice for one kill');
        eq(r.score, 1, 'score double-pinged one kill');
        eq(r.kills, 1, 'the grid killed more than one creature');
        eq(r.alive, 23, 'aliveCount wrong after one shot');
      });
      T('the outcome is identical in either add order — tiles are order-independent', () => {
        eq(JSON.stringify(shot(false)), JSON.stringify(shot(true)),
          'same fabric, different tile order, different numbers');
      });
      T('a wire carries LAST tick\'s publication — a later tile must not see a same-tick in-place mutation', () => {
        const f = QS.Scenes.invaders();
        const mirror = f.addTile('rogue-mirror', 700, 300);   // added last → ticks after the grid
        const grid = f.tiles.find(t => t.type === 'creatureGrid');
        const crash = f.tiles.find(t => t.type === 'crash');
        f.addWire(grid.id, 'grid', mirror.id, 'grid');
        const e = freshEngine(f);
        const ship = f.tiles.find(t => t.type === 'actor');
        e.step(5); ship.state.x = 210; e.step(2); e.fire(); e.step(90);
        eq(crash.state.hits, 1, 'setup: expected exactly one hit');
        ok(mirror.state.deadSeenTick > 0, 'mirror never saw the kill');
        eq(mirror.state.deadSeenTick - crash.state.echoTick, 2,
          'a later tile saw the grid\'s in-place kill in the SAME tick — the wire is a live alias, not a snapshot');
      });
    },

    'Scene smoke — space invaders, wired per VISION.md': () => {
      let f, e, ship, bul, crash, grid, boom, score;
      T('the canonical wiring is present', () => {
        f = QS.Scenes.invaders();
        e = freshEngine(f);
        ship = f.tiles.find(t => t.type === 'actor');
        bul = f.tiles.find(t => t.type === 'bullet');
        crash = f.tiles.find(t => t.type === 'crash');
        grid = f.tiles.find(t => t.type === 'creatureGrid');
        boom = f.tiles.find(t => t.type === 'boomPop');
        score = f.tiles.find(t => t.type === 'scorePing');
        const has = (a, ap, b, bp) => f.wires.some(w => w.from === a.id && w.fromPort === ap && w.to === b.id && w.toPort === bp);
        ok(has(f.tiles[0], 'move', ship, 'move'), 'keyboard→ship.move missing');
        ok(has(ship, 'x', bul, 'x'), 'ship.x→bullet.x missing');
        ok(has(bul, 'y', crash, 'bulletY'), 'bullet.y→crash missing');
        ok(has(grid, 'grid', crash, 'grid'), 'grid→crash missing');
        ok(has(crash, 'boom', boom, 'boom'), 'crash→effect missing');
        ok(has(crash, 'killIndex', grid, 'killIndex'), 'crash→grid kill missing');
        ok(has(crash, 'boom', score, 'boom'), 'crash→score fan-out missing');
        ok(has(crash, 'spent', bul, 'die'), 'crash→bullet spent missing (bullet must be TOLD, not reach over)');
      });
      T('keys nudge ship.x — the position is a number in a cell', () => {
        const x0 = ship.state.x;
        e.press('ArrowLeft'); e.step(4); e.release('ArrowLeft');
        ok(ship.state.x < x0, 'ship did not move left');
        const xLeft = ship.state.x;
        e.press('ArrowRight'); e.step(4); e.release('ArrowRight');
        ok(ship.state.x > xLeft + 8, 'ship did not come back right (got ' + ship.state.x + ' after ' + xLeft + ')');
      });
      T('fire latches ship.x into the bullet at the exact spot it left', () => {
        e.step(10);            // flush any stale move on the wire
        ship.state.x = 210;
        e.step(2);             // let ship.x flow down the wire
        e.fire(); e.step(3);   // keyboard publishes, bullet latches
        eq(bul.state.firedCount, 1, 'no shot fired');
        eq(bul.state.x, 210, 'bullet did NOT latch ship.x (position-is-a-cell!)');
        ok(bul.state.alive === 1, 'bullet not alive');
        ok(bul.state.y < bul.state.startY, 'bullet y does not climb');
      });
      T('bullet y climbs until it lands inside a creature range → boom routed to the effect', () => {
        e.step(70);
        ok(crash.state.hits >= 1, 'no hit after 70 ticks under a column');
        eq(grid.state.aliveCount, 23, 'creature not killed');
        ok(score.state.score >= 1, 'score ping did not fire');
        ok(boom.state.totalBooms >= 1, 'effect never boomed');
      });
      T('swap the effect mid-game: same wire, new explosion, no rewiring', () => {
        e.step(20);           // let the first shot fully finish
        const wire = f.wires.find(w => w.from === crash.id && w.fromPort === 'boom' && w.to === boom.id);
        f.swapTile(boom.id, 'boomSparks');
        e.step(5);
        ship.state.x = 306;   // under column 5
        e.step(2); e.fire(); e.step(70);
        const sparks = f.tiles.find(t => t.type === 'boomSparks');
        ok(sparks.state.totalBooms >= 1, 'swapped effect never received a boom');
        ok(f.wire(wire.id) && f.wire(wire.id).to === sparks.id, 'the boom wire did not survive the swap');
      });
      T('nobody halted while playing', () => {
        for (const t of f.tiles) ok(!t.halted, t.label + ' halted: ' + (t.halted && t.halted.message));
      });
    },

    'Scene smoke — community block: they just live': () => {
      T('two villagers, zero IO tiles, both alive after a minute of sim', () => {
        const f = QS.Scenes.community();
        const e = freshEngine(f);
        ok(!f.tiles.some(t => QS.Registry.get(t.type).kind === 'io'), 'community scene should have NO io tiles');
        e.step(3600);
        const maya = f.tiles.find(t => t.state.name === 'Maya');
        const theo = f.tiles.find(t => t.state.name === 'Theo');
        for (const t of f.tiles) ok(!t.halted, t.label + ' halted: ' + (t.halted && t.halted.message));
        const mActs = maya.state.cWander + maya.state.cTend + maya.state.cWave + maya.state.cRest;
        const tActs = theo.state.cWander + theo.state.cTend + theo.state.cWave + theo.state.cRest;
        ok(mActs >= 5, 'Maya barely lived (' + mActs + ' actions)');
        ok(tActs >= 5, 'Theo barely lived (' + tActs + ' actions)');
      });
      T('the character sheet latches onto the villager as visible state', () => {
        const f = QS.Scenes.community();
        const e = freshEngine(f);
        e.step(10);
        const maya = f.tiles.find(t => t.state.name === 'Maya');
        eq(maya.state.displayName, 'Maya', 'sheet name did not latch');
        ok(maya.state.backstory.indexOf('upstairs') >= 0, 'backstory did not latch');
        ok(maya.state.ageLabel !== '', 'age did not latch');
      });
      T('personality wires land as visible bias numbers', () => {
        const f = QS.Scenes.community();
        freshEngine(f).step(5);
        const maya = f.tiles.find(t => t.state.name === 'Maya');
        eq(maya.state.bWave, 2, 'helpful bias not visible in state');
        eq(maya.state.bRest, -1, 'helpful rest bias missing');
      });
      T('the sight-line wires work: villagers can only see each other through wires', () => {
        const f = QS.Scenes.community();
        const e = freshEngine(f);
        e.step(3600);
        const maya = f.tiles.find(t => t.state.name === 'Maya');
        const theo = f.tiles.find(t => t.state.name === 'Theo');
        ok(maya.state.cWave + theo.state.cWave >= 1, 'nobody ever waved');
        ok(maya.state.hellos + theo.state.hellos >= 1, 'no hello events');
      });
    },

    'Scene smoke — harbor defense: protect the dock': () => {
      const build = () => {
        const f = QS.Scenes.harbor();
        const e = freshEngine(f);
        const pilot = f.tiles.find(t => t.type === 'pilot');
        const bul = f.tiles.find(t => t.type === 'bullet');
        const grid = f.tiles.find(t => t.type === 'creatureGrid');
        const crashes = f.tiles.filter(t => t.type === 'crash');
        const keeper = f.tiles.find(t => t.type === 'npc');
        const card = f.tiles.find(t => t.type === 'personality');
        return { f, e, pilot, bul, grid, shot: crashes[0], dock: crashes[1], keeper, card,
          pop: f.tiles.find(t => t.type === 'boomPop'),
          ring: f.tiles.find(t => t.type === 'boomRing'),
          score: f.tiles.find(t => t.type === 'scorePing') };
      };
      T('the harbor wiring is present — same tiles, new program', () => {
        const { f, pilot, grid, shot, dock, keeper, pop, ring, score } = build();
        eq(f.tiles.filter(t => t.type === 'crash').length, 2, 'harbor wants TWO crash tiles (shot + dock guard)');
        const has = (a, ap, b, bp) => f.wires.some(w => w.from === a.id && w.fromPort === ap && w.to === b.id && w.toPort === bp);
        ok(has(f.tiles[0], 'move', pilot, 'move'), 'keyboard→pilot.move missing');
        ok(has(f.tiles[0], 'fire', pilot, 'fire'), 'keyboard→pilot.fire missing');
        ok(has(f.tiles.find(t => t.type === 'personality'), 'mood', pilot, 'mood'), 'personality card not latched to the ship');
        const bul = f.tiles.find(t => t.type === 'bullet');
        ok(has(pilot, 'x', bul, 'x'), 'pilot.x→bullet.x missing');
        ok(has(pilot, 'fire', bul, 'fire'), 'pilot.fire→bullet.fire missing');
        ok(has(shot, 'boom', pop, 'boom') && has(shot, 'boom', score, 'boom'), 'kill-boom fan-out missing');
        ok(has(keeper, 'x', dock, 'bulletX') && has(keeper, 'y', dock, 'bulletY'), 'the dock guard must watch the keeper\'s POSITION CELL');
        ok(has(pilot, 'onStation', dock, 'bulletAlive'), 'pilot.onStation→dock.bulletAlive missing');
        ok(has(dock, 'boom', ring, 'boom'), 'dock→breach-effect wire missing');
        ok(has(dock, 'boom', pilot, 'hurt'), 'dock→pilot.hurt missing (lives travel on a wire, not a global)');
        ok(has(pilot, 'wave', grid, 'reset'), 'pilot.wave→grid.reset missing');
      });
      T('the pilot lives alone: full idle loop, zero input, never halted', () => {
        const f = new QS.Fabric({});
        const p = f.addTile('pilot', 40, 40);
        freshEngine(f).step(2000);
        ok(!p.halted, 'pilot halted alone');
        ok(p.state.switches >= 3, 'pilot never rescheduled its idle loop');
        const kinds = ['cCruise', 'cHold', 'cVolley', 'cCool'].filter(k => p.state[k] > 0).length;
        ok(kinds >= 2, 'pilot idle loop too narrow (' + kinds + ' action kinds)');
        ok(p.state.shots > 0, 'pilot never fired on its own');
      });
      T('the pilot shrugs off garbage on every port — nothing hidden, nothing fragile', () => {
        const def = QS.Registry.get('pilot');
        const st = def.seed({});
        for (const junk of [42, 'x', { bWander: '9' }, null]) {
          def.tick(st, { mood: junk, move: junk, fire: junk, hurt: junk, grid: junk }, { tick: 3, w: 640, h: 360 });
        }
        eq(st.lives, 2, 'lives should drop exactly 3 times (three truthy junks)');
        ok(!st.halted, 'garbage input halted the pilot');
      });
      T('swap the personality CARD: same ship, same wires, different sailor (M2)', () => {
        const { f, e, pilot, card } = build();
        const moodWire = f.wires.find(w => w.from === card.id && w.to === pilot.id && w.toPort === 'mood');
        ok(moodWire, 'no mood wire to start');
        e.step(3);
        eq(pilot.state.bTend, 2, 'captain card biases did not latch as visible state');
        eq(pilot.state.bWave, 2, 'captain card biases did not latch as visible state');
        e.step(1200);
        const vol1 = pilot.state.cVolley, sail1 = pilot.state.sailed;
        f.swapTile(card.id, 'p-shy');
        ok(f.wire(moodWire.id) && f.wire(moodWire.id).to === pilot.id, 'mood wire did not survive the card swap (M2)');
        eq(f.wire(moodWire.id).flag, null, 'kept mood wire wrongly flagged');
        e.step(3);
        eq(pilot.state.bRest, 3, 'shy card biases did not latch after swap');
        eq(pilot.state.bWave, -2, 'shy card biases did not latch after swap');
        e.step(1200);
        ok(pilot.state.cVolley - vol1 < vol1, 'the shy card did not slow the cannon');
        ok(pilot.state.sailed - sail1 < sail1, 'the shy card did not calm the sailing');
      });
      T('space fires: the shot latches the pilot\'s x — position-is-a-cell', () => {
        const { e, pilot, bul } = build();
        e.step(5);
        const fired = bul.state.firedCount;
        e.fire(); e.step(3);
        eq(bul.state.firedCount, fired + 1, 'manual fire never reached the bullet');
        ok(Math.abs(bul.state.x - pilot.state.x) < 8, 'bullet did not latch the pilot\'s x');
        ok(bul.state.y < 150, 'bullet y does not climb from the patrol lane');
      });
      T('a kill routes through crash to the effect and the score — visible numbers move', () => {
        const { e, pilot, grid, shot, pop, score } = build();
        e.step(5);
        pilot.state.x = 210; e.step(2); e.fire(); e.step(100);
        ok(shot.state.hits >= 1, 'no creature hit in 100 ticks under the lane');
        eq(score.state.score, shot.state.hits, 'score and hits disagree');
        eq(pop.state.totalBooms, shot.state.hits, 'effect booms and hits disagree');
        eq(grid.state.aliveCount, 24 - shot.state.hits, 'aliveCount does not match the kills');
        for (const t of [pilot, grid, shot, pop, score]) ok(!t.halted, t.label + ' halted');
      });
      T('a breach: creature boards the dock → effect booms, life comes off, next wave — all cells', () => {
        const { e, pilot, grid, shot, dock, keeper, ring } = build();
        e.step(5);
        eq(pilot.state.lives, 5, 'pilot should start with 5 lives');
        grid.state.originX = 320 - 2 * grid.state.spacingX;  // a live column over the keeper
        grid.state.originY = 250;                            // bottom row at her dock
        e.step(8);
        eq(dock.state.hits, 1, 'the dock guard miscounted the boarding');
        eq(pilot.state.lives, 4, 'a life did not come off the pilot cell');
        eq(ring.state.totalBooms, 1, 'the breach effect never boomed');
        ok(grid.state.respawnCount >= 1, 'the next wave was never called');
        eq(pilot.state.wavesCalled, grid.state.respawnCount, 'pilot and grid disagree on waves');
        ok(Math.abs(keeper.state.x - 320) < 3, 'the keeper left her dock');
        ok(Math.abs(keeper.state.y - 330) < 3, 'the keeper left her dock');
        for (const t of [pilot, grid, dock, keeper, ring, shot]) ok(!t.halted, t.label + ' halted');
      });
      T('swap the BREACH EFFECT mid-game: same wire, next boom lands on the new channel (M2)', () => {
        const { f, e, grid, dock, ring } = build();
        e.step(3);
        const wire = f.wires.find(w => w.from === dock.id && w.fromPort === 'boom' && w.to === ring.id);
        ok(wire, 'no breach-effect wire to start');
        grid.state.originX = 320 - 2 * grid.state.spacingX; grid.state.originY = 250;
        e.step(8);
        eq(ring.state.totalBooms, 1, 'setup: first breach should boom on Ring');
        f.swapTile(ring.id, 'boomSparks');
        const sparks = f.tile(ring.id);
        eq(sparks.type, 'boomSparks', 'swap failed');
        ok(f.wire(wire.id) && f.wire(wire.id).to === sparks.id, 'the boom wire did not survive the swap');
        eq(f.wire(wire.id).flag, null, 'kept boom wire wrongly flagged');
        grid.state.originY = 250;  // second boarding — after the wave reset
        e.step(8);
        // totalBooms CARRIED OVER the swap (the cell remembers its booms — N4 spirit)
        // and then grew by exactly one: 1 carried + 1 new = 2
        eq(sparks.state.totalBooms, 2, 'the swapped effect never received the next boom');
        eq(dock.state.hits, 2, 'dock guard miscounted after swap');
      });
      T('all-clear: when the field is empty the pilot calls the next wave', () => {
        const { e, grid, pilot } = build();
        e.step(5);
        grid.state.alive = grid.state.alive.map(() => 0);   // the kid shot them all
        e.step(140);
        eq(pilot.state.wavesCalled, 1, 'pilot never called the wave on a clear field');
        eq(grid.state.respawnCount, 1, 'grid never reset');
        eq(grid.state.aliveCount, 24, 'the next wave did not arrive');
      });
      T('the keeper lives at her dock — starting state held, idle loop alive', () => {
        const { e, keeper } = build();
        e.step(1500);
        ok(Math.abs(keeper.state.x - 320) < 3, 'the keeper wandered off her dock');
        ok(Math.abs(keeper.state.y - 330) < 3, 'the keeper wandered off her dock');
        ok(keeper.state.cTend + keeper.state.cRest + keeper.state.cWave >= 5, 'the keeper is not really living');
        ok(keeper.state.displayName === 'Bea' && keeper.state.backstory.indexOf('harbor light') >= 0, 'character sheet did not latch');
      });
      T('save → load round-trips the harbor mid-fight (M4)', () => {
        const { f, e } = build();
        e.step(400);
        const g = QS.Fabric.load(f.save());
        eq(g.tiles.length, f.tiles.length, 'tile count changed');
        eq(g.wires.length, f.wires.length, 'wire count changed');
        ok(g.history.length >= f.history.length, 'history lost on load (N4)');
        for (let i = 0; i < f.tiles.length; i++)
          eq(JSON.stringify(g.tiles[i].state), JSON.stringify(f.tiles[i].state), 'state drifted for ' + f.tiles[i].label);
        const p = g.tiles.find(t => t.type === 'pilot');
        ok(p && p.state.lives === 5 && p.state.cHold + p.state.cCruise + p.state.cVolley >= 2, 'loaded pilot lost its numbers');
      });
    },

    'Hull-2 — the deep caverns: lift, key/lock, crumble, sign': () => {
      const byType = (f, ty) => f.tiles.find(t => t.type === ty);
      const pickupOf = (f, kind) => f.tiles.find(t => t.type === 'pickup' && t.state.kind === kind);

      T('the lift: legs are exactly 8 ticks down / 8 up, waits at each end — dir, phase, hold all in its cell', () => {
        const f = new QS.Fabric({});
        const lift = f.addTile('lift', 40, 40);
        const e = freshEngine(f);
        const samples = [];
        for (let n = 0; n < 300; n++) {
          e.step(1);
          samples.push({ dir: lift.state.dir, ph: lift.state.phase, y: lift.state.deckY });
        }
        const changes = [];
        samples.forEach((s2, idx) => { if (idx > 0 && s2.dir !== samples[idx - 1].dir) changes.push({ t: idx + 1, dir: s2.dir }); });
        ok(changes.length >= 4, 'the lift never got moving (' + changes.length + ' dir changes in 300 ticks)');
        eq(changes[0].dir, 'down', 'the lift should depart downward first');
        eq(changes[1].dir, 'hold', 'no wait at the bottom of the shaft');
        eq(changes[1].t - changes[0].t, 8, 'the down leg is not 8 ticks');
        eq(changes[2].dir, 'up', 'the lift should come back up');
        eq(changes[2].t - changes[1].t, 30, 'the bottom wait is not holdBottom ticks');
        eq(changes[3].dir, 'hold', 'no wait at the top of the shaft');
        eq(changes[3].t - changes[2].t, 8, 'the up leg is not 8 ticks');
        eq(changes[4].t - changes[3].t, 64, 'the top wait is not holdTop ticks');
        for (const s2 of samples) {
          ok(s2.y >= 79.99 && s2.y <= 176.01, 'the deck left its shaft (deckY=' + s2.y + ')');
          ok(s2.ph >= 0 && s2.ph <= 8, 'phase out of range: ' + s2.ph);
          if (s2.dir !== 'hold') ok(s2.ph >= 1, 'phase should count 1..8 during a leg');
          else eq(s2.ph, 0, 'phase should rest at 0 during a hold');
        }
        ok(lift.state.reversals >= 3, 'reversals never counted');
      });

      T('the lift carries whoever stands on it — rider bit visible on BOTH cells', () => {
        const f = new QS.Fabric({});
        const kb = f.addTile('keyboard', 500, 40);
        const lift = f.addTile('lift', 40, 40);
        const p = f.addTile('explorer', 300, 40);
        f.addWire(kb.id, 'move', p.id, 'move');
        f.addWire(lift.id, 'x', p.id, 'liftX');
        f.addWire(lift.id, 'deck', p.id, 'liftDeck');
        f.addWire(p.id, 'x', lift.id, 'riderX');
        f.addWire(p.id, 'y', lift.id, 'riderY');
        const e = freshEngine(f);
        e.press('ArrowRight');
        let n = 0;
        while (!p.state.riding && n++ < 200) e.step(1);      // board during the top hold
        e.release('ArrowRight');                              // step on, STAND, ride
        ok(p.state.riding === 1, 'never boarded the deck (x=' + p.state.x + ')');
        eq(lift.state.riderOn, 1, 'the lift never saw its rider through the wire');
        eq(lift.state.riders, 1, 'boarding miscounted');
        while (p.state.y < 175 && n++ < 300) e.step(1);       // ride the descent
        ok(Math.abs(p.state.y - 176) < 0.01, 'the deck did not carry the rider down (y=' + p.state.y + ')');
        eq(p.state.falls, 0, 'the rider fell through the deck');
        eq(p.state.on, 'lift', 'riding bit not set while aboard');
      });

      T('the key pops on touch and sets its bit — the pop lasts exactly one tick', () => {
        const f = new QS.Fabric({});
        const kb = f.addTile('keyboard', 500, 40);
        const p = f.addTile('explorer', 300, 40, { x: 340, y: 176, floors: [[232, 425, 176]] });
        const key = f.addTile('key', 40, 200, { x: 392, y: 164 });
        f.addWire(kb.id, 'move', p.id, 'move');
        f.addWire(p.id, 'x', key.id, 'playerX');
        f.addWire(p.id, 'y', key.id, 'playerY');
        const e = freshEngine(f);
        e.press('ArrowRight');
        let n = 0;
        while (!key.state.taken && n++ < 80) e.step(1);
        eq(key.state.taken, 1, 'the key never popped on touch');
        eq(key.state.popNow, 1, 'the pop event should be live on the touch tick');
        ok(key.state.sparkle > 0, 'no sparkle countdown');
        ok(key.state.takenTick > 0, 'takenTick not recorded');
        e.step(1);
        eq(key.state.popNow, 0, 'the pop lasted longer than one tick');
        eq(QS.Registry.get('pickup').out(key.state).bit, 1, 'the bit did not set');
      });

      T('the lock: closed without the bit (bumps counted), pops open with it, then lets the player through', () => {
        // run A — no key anywhere: the door is a wall
        const mk = (withKey) => {
          const f = new QS.Fabric({});
          const kb = f.addTile('keyboard', 500, 40);
          const p = f.addTile('explorer', 300, 40, { x: 500, y: 176, floors: [[400, 614, 176]] });
          const lock = f.addTile('lock', 40, 200);
          f.addWire(kb.id, 'move', p.id, 'move');
          f.addWire(p.id, 'x', lock.id, 'playerX');
          f.addWire(p.id, 'y', lock.id, 'playerY');
          f.addWire(lock.id, 'gate', p.id, 'gate');
          if (withKey) {
            const key = f.addTile('key', 200, 200, { x: 492, y: 164 });
            f.addWire(p.id, 'x', key.id, 'playerX');
            f.addWire(p.id, 'y', key.id, 'playerY');
            f.addWire(key.id, 'bit', lock.id, 'keyBit');
          }
          return { f, p, lock };
        };
        let a = mk(false);
        let e = freshEngine(a.f);
        e.press('ArrowRight');
        let n = 0;
        while (a.p.state.x < 559 && n++ < 80) e.step(1);
        eq(a.lock.state.open, 0, 'the door opened without the key!');
        ok(a.lock.state.bumps >= 1, 'bumps not counted while leaning on the door');
        ok(a.p.state.blocked === 1, 'the player was not blocked by the closed gate');
        ok(a.p.state.x < 554, 'the player walked through a closed gate');
        ok(QS.Registry.get('lock').out(a.lock.state).gate.open === 0, 'the gate output lied');
        // run B — key on the path: bit latches, door pops, player passes
        a = mk(true);
        e = freshEngine(a.f);
        e.press('ArrowRight');
        n = 0;
        while (!a.lock.state.open && n++ < 80) e.step(1);
        eq(a.lock.state.keyBit, 1, 'the one-bit plumbing never latched on the lock');
        eq(a.lock.state.open, 1, 'the lock never popped with the key');
        eq(a.lock.state.bumps, 0, 'bumped a door we had the key for');
        ok(a.lock.state.flash > 0, 'no open flash');
        n = 0;
        while (a.p.state.x < 575 && n++ < 60) e.step(1);
        ok(a.p.state.x > 566, 'still blocked after the door opened');
      });

      T('crumble: 3 touches → visible countdown → pop; the brick knits back (a fall is a retry)', () => {
        const f = new QS.Fabric({});
        const kb = f.addTile('keyboard', 500, 40);
        const p = f.addTile('explorer', 300, 40, { x: 400, y: 176 });
        const cr = f.addTile('crumble', 40, 200, { touches: [2, 0, 0] });   // the worn first brick
        f.addWire(kb.id, 'move', p.id, 'move');
        f.addWire(p.id, 'x', cr.id, 'playerX');
        f.addWire(p.id, 'y', cr.id, 'playerY');
        f.addWire(cr.id, 'floors', p.id, 'floors');
        const e = freshEngine(f);
        e.press('ArrowRight');
        let n = 0;
        while (cr.state.touches[0] < 3 && n++ < 80) e.step(1);
        e.release('ArrowRight');                       // stop ON the worn brick
        eq(cr.state.touches[0], 3, 'the worn brick miscounted its touches');
        eq(cr.state.popIn[0], 34, 'the shake timer did not arm at popTicks');
        eq(cr.state.gone[0], 0, 'popped before the countdown ran');
        e.step(34);
        eq(cr.state.gone[0], 1, 'the brick never popped');
        eq(cr.state.pops, 1, 'pops miscounted');
        n = 0;
        while (p.state.falls < 1 && n++ < 120) e.step(1);
        eq(p.state.falls, 1, 'standing on the popped brick did not drop the player');
        n = 0;
        while (cr.state.gone[0] && n++ < 300) e.step(1);
        eq(cr.state.gone[0], 0, 'the bridge never knit back');
        eq(cr.state.touches[0], 0, 'the knitted brick kept its old touches');
      });

      T('sign: one authored line, zero IO — reads count touches, not ticks', () => {
        const def = QS.Registry.get('sign');
        eq(def.outputs.length, 0, 'a sign should publish nothing');
        for (const pt of def.inputs) eq(pt.type, 'number', 'sign port is not a plain number: ' + pt.name);
        const f = new QS.Fabric({});
        const kb = f.addTile('keyboard', 500, 40);
        const p = f.addTile('explorer', 300, 40, { x: 120, y: 176, floors: [[26, 300, 176]] });
        const s2 = f.addTile('sign', 40, 200, { x: 200, y: 176, line: 'THEO: the bridge holds. mostly. — T' });
        f.addWire(kb.id, 'move', p.id, 'move');
        f.addWire(p.id, 'x', s2.id, 'playerX');
        f.addWire(p.id, 'y', s2.id, 'playerY');
        const e = freshEngine(f);
        eq(s2.state.near, 0, 'near without a player?');
        e.press('ArrowRight');
        let n = 0;
        while (!s2.state.near && n++ < 80) e.step(1);
        eq(s2.state.near, 1, 'walking past did not light the sign');
        eq(s2.state.reads, 1, 'first touch should be one read');
        e.step(50);                                     // stand there and stare
        eq(s2.state.reads, 1, 'reads counted TICKS, not touches');
        n = 0;
        while (s2.state.near && n++ < 80) e.step(1);
        eq(s2.state.near, 0, 'never walked away');
        eq(typeof s2.state.line, 'string', 'the authored line is not inspectable text');
      });

      T('the goal reuses the Sparks confetti — pop lands on the same boom port (no new effect tile)', () => {
        const f = new QS.Fabric({});
        const kb = f.addTile('keyboard', 500, 40);
        const p = f.addTile('explorer', 300, 40, { x: 240, y: 176, floors: [[200, 400, 176]] });
        const goal = f.addTile('goal', 40, 200, { x: 300, y: 164 });
        const sp = f.addTile('boomSparks', 200, 200);
        f.addWire(kb.id, 'move', p.id, 'move');
        f.addWire(p.id, 'x', goal.id, 'playerX');
        f.addWire(p.id, 'y', goal.id, 'playerY');
        f.addWire(goal.id, 'pop', sp.id, 'boom');
        const e = freshEngine(f);
        e.press('ArrowRight');
        let n = 0;
        while (!goal.state.taken && n++ < 80) e.step(1);
        e.step(2);                                   // the pop rides the wire for a tick before it lands
        eq(goal.state.taken, 1, 'the goal was never reached');
        eq(sp.state.totalBooms, 1, 'the confetti never boomed');
        ok(sp.state.framesLeft > 0, 'the confetti already faded');
        ok(Math.abs(sp.state.x - 300) < 1 && Math.abs(sp.state.y - 164) < 1, 'confetti boomed in the wrong place');
      });

      T('key → lock → goal integration: the whole cavern run, every checkpoint a cell value', () => {
        const f = QS.Scenes.cavern();
        const e = freshEngine(f);
        const X = byType(f, 'explorer').state;
        const lift = byType(f, 'lift'), cr = byType(f, 'crumble'), lock = byType(f, 'lock');
        const key = pickupOf(f, 'key'), goal = pickupOf(f, 'goal');
        const sp = byType(f, 'boomSparks');
        const signs = f.tiles.filter(t => t.type === 'sign');
        // 1 — walk to the shaft and board the lift
        e.press('ArrowRight');
        let n = 0;
        while (!X.riding && n++ < 240) e.step(1);
        ok(X.riding === 1, 'never boarded the lift');
        e.release('ArrowRight');
        eq(lift.state.riders, 1, 'the lift never counted its rider');
        // 2 — ride down, step off onto the key floor
        n = 0;
        while (X.y < 175 && n++ < 240) e.step(1);
        ok(Math.abs(X.y - 176) < 0.01, 'not carried to the bottom of the shaft');
        e.press('ArrowRight');
        n = 0;
        while (X.x < 260 && n++ < 80) e.step(1);
        e.release('ArrowRight');
        ok(X.x > 250, 'did not step off the deck');
        // 3 — one straight walk: key → worn bridge → gate
        e.press('ArrowRight');
        n = 0;
        while (!lock.state.open && n++ < 300) e.step(1);
        eq(key.state.taken, 1, 'the key was never taken');
        eq(QS.Registry.get('pickup').out(key.state).bit, 1, 'the key bit never set');
        eq(lock.state.keyBit, 1, 'the bit never latched on the lock (one-bit plumbing)');
        eq(lock.state.open, 1, 'the lock never popped');
        eq(lock.state.bumps, 0, 'bumped the gate despite holding the key');
        eq(cr.state.touches[0], 3, 'the worn brick miscounted');
        ok(cr.state.pops >= 1, 'the bridge never crumbled');
        eq(cr.state.gone[0], 1, 'the worn brick never popped');
        eq(X.falls, 0, 'the explorer fell on the clean run');
        ok(X.x > 540, 'never made it past the gate');
        ok(signs[0].state.reads >= 1 && signs[1].state.reads >= 1, 'a story sign was never read');
        // 4 — the goal, and the confetti reused from Sparks
        n = 0;
        while (!goal.state.taken && n++ < 80) e.step(1);
        e.release('ArrowRight');
        e.step(2);                                   // the pop rides the wire for a tick before it lands
        eq(goal.state.taken, 1, 'the goal was never reached');
        eq(sp.state.totalBooms, 1, 'the confetti never boomed for the win');
        for (const t of f.tiles) ok(!t.halted, t.label + ' halted: ' + (t.halted && t.halted.message));
      });

      // the descent everyone shares: board during the top hold, STAND for the ride, step off at the bottom
      const descend = (e, X) => {
        e.release('ArrowRight');
        e.press('ArrowRight');
        let n = 0;
        while (!X.riding && n++ < 240) e.step(1);
        e.release('ArrowRight');
        n = 0;
        while (X.y < 175 && n++ < 240) e.step(1);
        e.press('ArrowRight');
        n = 0;
        while (X.x < 260 && n++ < 80) e.step(1);
        e.release('ArrowRight');
      };

      T('falling is a safe respawn at start and the key-bit is KEPT — no punishment spiral', () => {
        const f = QS.Scenes.cavern();
        const e = freshEngine(f);
        const X = byType(f, 'explorer').state;
        const cr = byType(f, 'crumble');
        const key = pickupOf(f, 'key');
        descend(e, X);
        e.press('ArrowRight');
        let n = 0;
        while (!(key.state.taken && cr.state.touches[0] >= 3) && n++ < 400) e.step(1);
        e.release('ArrowRight');                 // stop ON the shaking worn brick
        ok(cr.state.popIn[0] > 0, 'the worn brick is not shaking');
        n = 0;
        while (X.falls < 1 && n++ < 150) e.step(1);
        eq(X.falls, 1, 'never fell through the popped brick');
        ok(Math.abs(X.x - 80) < 0.01 && Math.abs(X.y - 80) < 0.01, 'did not respawn at the start');
        eq(key.state.taken, 1, 'THE KEY WAS LOST ON RESPAWN — punishment spiral');
        eq(QS.Registry.get('pickup').out(key.state).bit, 1, 'the key bit did not survive the fall');
        n = 0;
        while (cr.state.gone[0] && n++ < 300) e.step(1);
        eq(cr.state.gone[0], 0, 'the bridge never knit back after the fall');
      });

      T('swap demo #2 — Crumble→Solid mid-bridge: wires stay, state carries, the pending pop cancels (M2)', () => {
        const f = QS.Scenes.cavern();
        const e = freshEngine(f);
        const X = byType(f, 'explorer').state;
        const cr = byType(f, 'crumble');
        descend(e, X);
        e.press('ArrowRight');
        let n = 0;
        while (!(cr.state.popIn[0] > 0) && n++ < 400) e.step(1);   // mid-bridge, brick shaking underfoot
        ok(X.onCrumble === 1 || Math.abs(X.x - 425) < 6, 'not actually mid-bridge (x=' + X.x + ')');
        const w = f.wires.find(x2 => x2.from === cr.id && x2.fromPort === 'floors');
        ok(w, 'no floors wire to start');
        f.swapTile(cr.id, 'crumble-solid');
        ok(f.wire(w.id) && f.wire(w.id).from === cr.id && f.wire(w.id).toPort === 'floors', 'the floors wire did not survive the swap (M2)');
        eq(f.wire(w.id).flag, null, 'the kept floors wire is wrongly flagged');
        eq(cr.state.touches[0], 3, 'touches did not carry across the swap');
        eq(cr.state.fragile, 0, 'the solid preset did not ride on top of the carried state');
        e.step(2);
        eq(cr.state.popIn[0], 0, 'the pending pop did not cancel on solidifying');
        n = 0;
        while (X.x < 540 && n++ < 300) e.step(1);
        e.release('ArrowRight');
        eq(X.falls, 0, 'the explorer fell after solidifying the bridge mid-crossing');
        ok(X.x >= 540, 'never finished the crossing');
        eq(cr.state.gone.join(''), '000', 'a solid bridge still lost a brick');
        ok(f.history.some(h2 => h2.kind === 'tile-swap'), 'the swap was not recorded in history (N4)');
      });

      T('the cavern round-trips through a save file mid-adventure (M4)', () => {
        const f = QS.Scenes.cavern();
        const e = freshEngine(f);
        e.press('ArrowRight'); e.step(120); e.release('ArrowRight'); e.step(40);
        const g = QS.Fabric.load(f.save());
        eq(g.tiles.length, f.tiles.length, 'tile count changed');
        eq(g.wires.length, f.wires.length, 'wire count changed');
        ok(g.history.length >= f.history.length, 'history lost on load (N4)');
        for (let i2 = 0; i2 < f.tiles.length; i2++)
          eq(JSON.stringify(g.tiles[i2].state), JSON.stringify(f.tiles[i2].state), 'state drifted for ' + f.tiles[i2].label);
        const k2 = g.tiles.find(t => t.type === 'pickup' && t.state.kind === 'key');
        const k1 = f.tiles.find(t => t.type === 'pickup' && t.state.kind === 'key');
        eq(k2.state.taken, k1.state.taken, 'the key bit drifted');
        const c2 = g.tiles.find(t => t.type === 'crumble');
        eq(JSON.stringify(c2.state.touches), JSON.stringify(f.tiles.find(t => t.type === 'crumble').state.touches), 'bridge touches drifted');
        const ex2 = g.tiles.find(t => t.type === 'explorer');
        eq(ex2.state.falls, f.tiles.find(t => t.type === 'explorer').state.falls, 'fall count drifted');
      });
    },

    'Debug-refine 2026-08-30 — falsy zeros & orphan hygiene': () => {
      T('removeWire on an orphaned wire must not throw — the retired label still tells the story', () => {
        const f = QS.Scenes.invaders();
        const bul = f.tiles.find(t => t.type === 'bullet');
        const wid = f.wires.find(w => w.from === bul.id).id;
        f.removeTile(bul.id);                     // wires stay, flagged orphan (N4)
        const h0 = f.history.length;
        f.removeWire(wid);                        // threw TypeError before the fix
        eq(f.history.length, h0 + 1, 'wire-remove was not recorded');
        ok(f.history[f.history.length - 1].detail.indexOf('Bullet') >= 0, 'retired label lost from the story');
      });
      T('a fresh wire into a freed input is NOT flagged shared-port', () => {
        const f = new QS.Fabric({});
        const k1 = f.addTile('keyboard', 40, 40), k2 = f.addTile('keyboard', 40, 200), ship = f.addTile('actor', 300, 40);
        f.addWire(k1.id, 'move', ship.id, 'move');
        f.removeTile(k1.id);                      // the old move wire is orphaned, kept
        const w = f.addWire(k2.id, 'move', ship.id, 'move');
        eq(w.flag, null, 'phantom shared-port flag from an orphaned wire');
      });
      T('load never re-issues a retired tile id', () => {
        const tiles = [];
        for (let i = 800; i <= 839; i++) tiles.push({ id: 't' + i, type: 'actor', state: {} });
        const json = JSON.stringify({ format: 'quilt-fabric-1', name: 'seq', tiles, wires: [],
          retired: [{ id: 't840', type: 'scorePing', label: 'Score ping', state: {} }], history: [] });
        const g = QS.Fabric.load(json);
        const nt = g.addTile('actor', 40, 40);
        ok(nt.id !== 't840', 'new tile re-issued retired id t840 (got ' + nt.id + ')');
        ok(!g.retired.some(t => t.id === nt.id), 'duplicate id across live and retired');
      });
      T('a malformed id in a file cannot corrupt the id sequence', () => {
        const json = JSON.stringify({ format: 'quilt-fabric-1', name: 'bad',
          tiles: [{ id: 'tOOPS', type: 'actor', state: {} }], wires: [], retired: [], history: [] });
        const g = QS.Fabric.load(json);
        const nt = g.addTile('actor', 40, 40);
        ok(/^t\d+$/.test(nt.id), 'id sequence corrupted: ' + nt.id);
      });
      T('addTile honors fabric coordinate 0 — the top-left corner is a real place', () => {
        const f = new QS.Fabric({});
        const t = f.addTile('actor', 0, 0);
        eq(t.fx, 0, 'fx=0 clobbered to 80 (falsy-zero)');
        eq(t.fy, 0, 'fy=0 clobbered to 80 (falsy-zero)');
        const t2 = f.addTile('actor');
        eq(t2.fx, 80, 'default placement must not change');
      });
      T('step(0) advances zero ticks — zero means zero', () => {
        const f = new QS.Fabric({});
        const e = new QS.Engine(f);
        e.step(0);
        eq(f.tick, 0, 'step(0) ticked anyway');
        e.step();
        eq(f.tick, 1, 'step() default of one tick must not change');
      });
      T('a bullet latches a legitimate x=0 — the left edge is a real place to shoot from', () => {
        const d = QS.Registry.get('bullet');
        const s = d.seed({});
        s.x = 210;                                 // the stale spot it would keep
        d.tick(s, { fire: { n: 1 }, x: 0 }, { tick: 0, w: 640, h: 360 });
        eq(s.x, 0, 'x=0 was clobbered by the stale 210 (falsy-zero)');
        const s2 = d.seed({});
        s2.x = 210;
        d.tick(s2, { fire: { n: 1 }, x: NaN }, { tick: 0, w: 640, h: 360 });
        eq(s2.x, 210, 'NaN on the wire keeps the old x (semantics unchanged)');
      });
      T('a villager does not see a phantom friend at the origin when the sight wire carries null', () => {
        const d = QS.Registry.get('npc');
        const s = d.seed({ x: 30, y: 30 });        // standing near (0,0)
        d.tick(s, { friendX: null, friendY: null }, { tick: 1, w: 640, h: 360 });
        eq(s.nearFriend, 0, 'Number(null)=0 conjured a friend at the origin');
      });
      T('a character sheet age of 0 shows as "0", not blank', () => {
        const d = QS.Registry.get('npc');
        const s = d.seed({});
        d.tick(s, { sheet: { name: 'Bea', age: 0, backstory: '', inventory: '' } }, { tick: 1, w: 640, h: 360 });
        eq(s.ageLabel, '0', 'age 0 was hidden by String(x || "")');
      });
    }
  };

  QS.Tests = {
    run(log) {
      rogues();
      results.length = 0;
      curSuite = '';
      for (const [suite, fn] of Object.entries(suites)) { curSuite = suite; fn(); }
      const pass = results.filter(r => r.ok).length, fail = results.length - pass;
      if (log) for (const r of results) log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '  — ' + r.err));
      if (log) log(pass + ' passed, ' + fail + ' failed');
      return { pass, fail, results };
    },
    render() {
      const el = document.getElementById('results');
      const { pass, fail, results } = this.run();
      let html = '<div class="test-suite">🧪 quilt-scratch contract tests — ' +
        '<span style="color:' + (fail ? '#dc2626' : '#16a34a') + '">' + pass + ' passed / ' + fail + ' failed</span></div>';
      html += '<p class="test-note">These check every palette tile against the MUSTs (M1–M4) and the NEVERs (N1–N4) from docs/TILE-CONTRACT.md. Rogue tiles (🦹) try to break the laws from inside; the engine must hold.</p>';
      let suite = '';
      for (const r of results) {
        if (r.suite !== suite) { suite = r.suite; html += '<div class="test-suite">' + suite + '</div>'; }
        html += '<div class="test-result ' + (r.ok ? 'test-pass' : 'test-fail') + '">' +
          (r.ok ? '✓' : '✗') + ' ' + r.name + (r.err ? ' — <b>' + r.err + '</b>' : '') + '</div>';
      }
      el.innerHTML = html;
      document.title = fail ? '(' + fail + ' failed) quilt-scratch tests' : '✓ all pass — quilt-scratch tests';
    }
  };
})();
