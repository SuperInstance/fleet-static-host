/* engine.js — the cellular runtime.
 *
 * Everything here is DOM-free so the contract tests can run the exact same
 * code in a browser page AND under node (see run-tests.js).
 *
 * Contract mapping (docs/TILE-CONTRACT.md):
 *  - tick(state, inputs, room) -> state          (contract §2)
 *  - inputs are deep-cloned per wire per tick     (N1: no aliasing into a neighbor's state)
 *  - room is a fresh frozen object {tick,w,h}     (N3: no mechanic can grab the world)
 *  - a throwing tile halts ITSELF; the room runs on (M3)
 *  - every fabric mutation appends to fabric.history (N4: nothing is deleted)
 */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});

  /* ---------- tiny utils ---------- */

  QS.deepClone = function (v) {
    if (v === null || typeof v !== 'object') return v;
    try { return structuredClone(v); }
    catch (e) { return JSON.parse(JSON.stringify(v)); }
  };

  // Deterministic PRNG — the seed lives in tile state, so kids can watch it dance.
  QS.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const PORT_TYPES = ['number', 'text', 'event', 'any'];
  QS.PORT_TYPES = PORT_TYPES;
  // Ports are typed LOOSELY: mismatch is flagged by the editor, never coerced.
  QS.portsCompatible = function (a, b) {
    return !a || !b || a === 'any' || b === 'any' || a === b;
  };

  /* ---------- tile registry ----------
   * A def is:
   * {
   *   key, label, kind, icon, desc,
   *   inputs:  [{name, type}],
   *   outputs: [{name, type}],
   *   seed(opts) -> fresh plain state (all visible fields),
   *   tick(state, inputs, room) -> state,
   *   out(state) -> {portName: value}   // wires carry these, one tick old
   *   watch: ['x','y']                  // keys printed on the fabric card
   *   room: bool                        // draws a face in the room view
   *   draw(ctx, tile, env)              // the face
   *   w, h                              // face hit box in the room
   *   hit(state) -> {x,y,w,h}           // optional click target override (editor)
   * }
   */
  const Registry = {
    defs: {},
    order: [],
    add(def) {
      if (!def.key || !def.tick) throw new Error('tile def needs key + tick');
      for (const p of (def.inputs || []).concat(def.outputs || [])) {
        if (PORT_TYPES.indexOf(p.type) < 0) throw new Error('bad port type on ' + def.key + '.' + p.name);
      }
      this.defs[def.key] = def;
      this.order.push(def.key);
      return def;
    },
    get(key) { return this.defs[key]; },
    all() { return this.order.map(k => this.defs[k]); }
  };
  QS.Registry = Registry;

  /* ---------- fabric: tiles + wires + history ---------- */

  let TILE_SEQ = 1, WIRE_SEQ = 1, HIST_SEQ = 1;

  class Fabric {
    constructor(opts) {
      opts = opts || {};
      this.name = opts.name || 'untitled fabric';
      this.room = { w: opts.w || 640, h: opts.h || 360 };
      this.decor = opts.decor || 'stars';       // room backdrop key, painted by scenes
      this.tiles = [];                          // live tiles
      this.wires = [];                          // {id, from, fromPort, to, toPort, flag}
      this.retired = [];                        // removed tiles, kept forever (N4)
      this.history = [];                        // {i, tick, kind, detail} — append only (N4)
      this.tick = 0;
    }

    record(kind, detail) {
      this.history.push({ i: HIST_SEQ++, tick: this.tick, kind, detail });
    }

    tile(id) { return this.tiles.find(t => t.id === id); }
    wire(id) { return this.wires.find(w => w.id === id); }

    addTile(paletteKey, fx, fy, stateOverride) {
      // palette entries may be presets ("Shopkeeper") of a registry type ("npc") —
      // the starting-state rule: a preset IS a starting state.
      const pal = QS.paletteByKey ? QS.paletteByKey(paletteKey) : null;
      const typeKey = pal ? pal.type : paletteKey;
      const def = Registry.get(typeKey);
      if (!def) throw new Error('unknown tile type: ' + paletteKey);
      const state = Object.assign(def.seed({}), (pal && pal.seed) || {}, stateOverride || {});
      // fx/fy 0 is a real fabric coordinate — only missing (null/undefined)
      // takes the default spot. 'fx || 80' used to clobber the top-left corner.
      const tile = {
        id: 't' + (TILE_SEQ++), type: def.key, paletteKey: pal ? pal.key : paletteKey,
        label: (pal && pal.tileLabel) || def.label, fx: fx == null ? 80 : fx, fy: fy == null ? 80 : fy,
        state, halted: null, out: {}
      };
      this.tiles.push(tile);
      this.record('tile-add', 'added ' + def.label + ' (' + tile.id + ')');
      return tile;
    }

    // Removing retires instead of destroying — the story stays in the file. (N4)
    removeTile(id) {
      const t = this.tile(id);
      if (!t) return;
      this.tiles = this.tiles.filter(x => x.id !== id);
      for (const w of this.wires) {
        if (w.from === id || w.to === id) w.flag = 'orphan';
      }
      this.retired.push(t);
      this.record('tile-remove', 'retired ' + t.label + ' (' + t.id + ') — its wires are flagged, its story kept');
    }

    defOf(t) { return Registry.get(t.type); }

    addWire(fromId, fromPort, toId, toPort) {
      if (fromId === toId) return null;
      const a = this.tile(fromId), b = this.tile(toId);
      if (!a || !b) return null;
      const da = this.defOf(a), db = this.defOf(b);
      const po = (da.outputs || []).find(p => p.name === fromPort);
      const pi = (db.inputs || []).find(p => p.name === toPort);
      if (!po || !pi) return null;
      const w = {
        id: 'w' + (WIRE_SEQ++), from: fromId, fromPort,
        to: toId, toPort, flag: null
      };
      if (!QS.portsCompatible(po.type, pi.type)) w.flag = 'type-mismatch';
      // orphaned wires (their tile was retired) no longer occupy a port —
      // a kid rewiring the freed input must not see a phantom shared-port flag
      const shared = this.wires.filter(x => x.to === toId && x.toPort === toPort && x.flag !== 'orphan').length;
      if (shared) w.flag = w.flag || 'shared-port';
      this.wires.push(w);
      this.record('wire-add', 'wired ' + a.label + '.' + fromPort + ' → ' + b.label + '.' + toPort +
        (w.flag ? '  ⚠ ' + w.flag : ''));
      return w;
    }

    // Removing a wire is a rewire: history keeps it. (N4)
    // A wire whose tile was retired is still unwindable — the label falls
    // back to the retired tile so the story is told, never lost to a TypeError.
    removeWire(id) {
      const w = this.wire(id);
      if (!w) return;
      this.wires = this.wires.filter(x => x.id !== id);
      const labelOf = (tid) => {
        const t = this.tile(tid) || this.retired.find(r => r.id === tid);
        return t ? t.label : tid;
      };
      this.record('wire-remove', 'unwired ' + labelOf(w.from) + '.' + w.fromPort +
        ' → ' + labelOf(w.to) + '.' + w.toPort + ' (kept in history)');
    }

    // M2: replacing a tile keeps its wires by port name; only unmatched
    // ports get flagged for re-wiring. Nothing silently reconnects.
    swapTile(id, newPaletteKey) {
      const t = this.tile(id);
      const pal = QS.paletteByKey ? QS.paletteByKey(newPaletteKey) : null;
      const typeKey = pal ? pal.type : newPaletteKey;
      const def = Registry.get(typeKey);
      if (!t || !def) return null;
      const oldLabel = t.label;
      const fresh = def.seed({});
      // carry over state keys that exist in the new seed (same names = same meaning),
      // then let the preset's starting state ride on top (the starting-state rule)
      for (const k of Object.keys(fresh)) {
        if (k in t.state && typeof t.state[k] === typeof fresh[k]) fresh[k] = t.state[k];
      }
      Object.assign(fresh, (pal && pal.seed) || {});
      t.type = def.key; t.paletteKey = pal ? pal.key : newPaletteKey;
      t.label = (pal && pal.tileLabel) || def.label;
      t.state = fresh; t.halted = null;
      const din = (def.inputs || []).map(p => p.name);
      const dout = (def.outputs || []).map(p => p.name);
      let kept = 0, flagged = 0;
      for (const w of this.wires) {
        if (w.from !== id && w.to !== id) continue;
        const ok = w.from === id ? dout.indexOf(w.fromPort) >= 0 : din.indexOf(w.toPort) >= 0;
        if (ok && w.flag !== 'type-mismatch') { w.flag = null; kept++; }
        else { w.flag = 'orphan-port'; flagged++; }
      }
      this.record('tile-swap', 'swapped ' + oldLabel + ' → ' + def.label +
        ' (' + kept + ' wire' + (kept === 1 ? '' : 's') + ' kept by port name' +
        (flagged ? ', ' + flagged + ' flagged for re-wire' : '') + ')');
      return t;
    }

    // M4: the file fully captures tiles, wires, state, history.
    save() {
      return JSON.stringify({
        format: 'quilt-fabric-1',
        name: this.name, room: this.room, decor: this.decor, tick: this.tick,
        tiles: this.tiles.map(t => ({
          id: t.id, type: t.type, paletteKey: t.paletteKey,
          label: t.label, fx: t.fx, fy: t.fy, state: t.state
        })),
        wires: this.wires,
        retired: this.retired.map(t => ({ id: t.id, type: t.type, label: t.label, state: t.state })),
        history: this.history
      }, null, 2);
    }

    static load(json) {
      const d = typeof json === 'string' ? JSON.parse(json) : json;
      if (d.format !== 'quilt-fabric-1') throw new Error('not a quilt fabric file');
      const f = new Fabric({ name: d.name, w: d.room && d.room.w, h: d.room && d.room.h });
      f.decor = d.decor || 'stars';
      f.tick = d.tick || 0;
      f.tiles = (d.tiles || []).map(td => {
        const def = Registry.get(td.type);
        const state = Object.assign(def ? def.seed({}) : {}, td.state || {});
        return {
          id: td.id, type: td.type, paletteKey: td.paletteKey || td.type,
          label: td.label || (def ? def.label : td.type),
          fx: td.fx, fy: td.fy, state, halted: null, out: {}
        };
      });
      f.wires = d.wires || [];
      f.retired = d.retired || [];
      f.history = d.history || [];
      // loading KEEPS the old history and appends — never deletes. (N4)
      f.record('load', 'loaded fabric "' + f.name + '" (' + f.tiles.length + ' tiles, ' +
        f.wires.length + ' wires, ' + f.history.length + ' history entries kept)');
      // id sequences must cover EVERY id in the file — live, retired, wired,
      // historical — or a fresh tile can re-issue a retired tile's id. A
      // malformed id (hand-edited file) yields NaN; Math.max(x, NaN) is NaN,
      // which would poison every future id — so guard with isFinite.
      const bump = (id, cur) => {
        const n = +String(id).slice(1);
        return Number.isFinite(n) ? Math.max(cur, n + 1) : cur;
      };
      for (const t of f.tiles) TILE_SEQ = bump(t.id, TILE_SEQ);
      for (const t of f.retired) TILE_SEQ = bump(t.id, TILE_SEQ);
      for (const w of f.wires) WIRE_SEQ = bump(w.id, WIRE_SEQ);
      for (const h of f.history) HIST_SEQ = bump(h.i, HIST_SEQ);
      return f;
    }
  }
  QS.Fabric = Fabric;

  /* ---------- engine: the fixed-timestep heart ---------- */

  class Engine {
    constructor(fabric) {
      this.fabric = fabric;
      this.held = {};        // key state for io tiles
      this.fireEdges = 0;    // queued fire presses (edge-triggered)
      this.acc = 0;
      this.last = null;
      this.running = false;
      this.onFrame = null;   // hook for the editor
    }

    press(k) { this.held[k] = 1; }
    release(k) { this.held[k] = 0; }
    fire() { this.fireEdges++; }

    // Inputs for one tile: values published on wires LAST tick, deep-cloned
    // so no tile can reach into a neighbor's state through a shared object. (N1)
    inputsFor(tile, snapshot) {
      const inputs = {};
      for (const w of this.fabric.wires) {
        if (w.to !== tile.id) continue;
        const src = this.fabric.tile(w.from);
        if (!src) continue;
        const v = snapshot[src.id] && w.fromPort in snapshot[src.id] ? snapshot[src.id][w.fromPort] : null;
        inputs[w.toPort] = QS.deepClone(v);
      }
      return inputs;
    }

    doTick() {
      const f = this.fabric;
      // snapshot of last tick's outputs — numbers on a wire are one tick old,
      // which keeps every tile order-independent and honest. The snapshot is
      // DEEP-CLONED: a tile whose out() embeds a state array by reference (the
      // creature grid does) must not rewrite, mid-tick, what its neighbors
      // already received — otherwise later-ordered tiles see same-tick
      // mutations and earlier-ordered ones don't.
      const snapshot = {};
      for (const t of f.tiles) snapshot[t.id] = QS.deepClone(t.out);
      const room = Object.freeze({ tick: f.tick, w: f.room.w, h: f.room.h });
      for (const t of f.tiles) {
        if (t.halted) continue;               // M3: a halted tile sits out; the room runs on
        const def = Registry.get(t.type);
        if (!def) { t.halted = { message: 'unknown tile type ' + t.type, tick: f.tick }; continue; }
        try {
          const inputs = this.inputsFor(t, snapshot);
          const ns = def.tick(t.state, inputs, room);
          t.state = ns || t.state;
          t.out = def.out ? def.out(t.state) : {};
        } catch (e) {
          t.halted = { message: (e && e.message) || String(e), tick: f.tick };
          t.out = {};
          f.record('tile-halt', t.label + ' halted: ' + t.halted.message);
        }
      }
      f.tick++;
    }

    step(n) { if (n == null) n = 1; for (let i = 0; i < n; i++) this.doTick(); return this; }

    resume(tileId) {
      const t = this.fabric.tile(tileId);
      if (t) { t.halted = null; this.fabric.record('tile-resume', t.label + ' resumed'); }
    }

    // Browser frame loop: fixed 60 ticks/sec, render hook each frame.
    start() {
      this.running = true;
      this.last = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(now - this.last, 250);
        this.last = now;
        this.acc += dt;
        const TICK = 1000 / 60;
        let guard = 0;
        while (this.acc >= TICK && guard < 8) { this.doTick(); this.acc -= TICK; guard++; }
        if (this.onFrame) this.onFrame();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    stop() { this.running = false; }
  }
  QS.Engine = Engine;
})();
