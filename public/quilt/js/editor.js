/* editor.js — the fabric editor + the room view. One canvas, two views.
 *
 * FABRIC view: every tile is a card with named ports. Drag a card to move
 * it; drag from an output port (right) to an input port (left) to wire.
 * Type mismatches are FLAGGED (red dashed), never coerced — contract §3.
 *
 * ROOM view: the game a kid sees — actor/NPC/effect faces at their x,y.
 * Click a face to inspect it; drag an actor and watch its x,y numbers move.
 */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const WIRE_COLORS = { number: '#38bdf8', text: '#c084fc', event: '#fb923c', any: '#94a3b8' };

  QS.Editor = function (canvas, app) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.app = app;
    this.view = 'room';               // 'room' | 'fabric'
    this.pending = null;              // {fromTile, fromPort, x, y}
    this.drag = null;                 // {kind:'card'|'face'|'pan', ...}
    this.hoverPort = null;
    this.mouse = { x: 0, y: 0 };
    this.roomOX = 80; this.roomOY = 48; // room offset inside canvas
    this.bind();
  };

  QS.Editor.prototype = {
    /* ---------- geometry ---------- */
    cardW: 158,
    portPos(t, name, isOut) {
      const def = QS.Registry.get(t.type);
      const list = isOut ? (def.outputs || []) : (def.inputs || []);
      const i = list.findIndex(p => p.name === name);
      const h = this.cardH(def);
      const x = t.fx + (isOut ? this.cardW : 0);
      const y = t.fy + 26 + i * 15 + 6;
      return { x, y, h, ok: i >= 0, type: list[i] && list[i].type };
    },
    cardH(def) {
      const n = Math.max((def.inputs || []).length, (def.outputs || []).length, 1);
      return 30 + n * 15 + 16;
    },
    portAt(x, y, wantOut) {
      for (const t of this.app.fabric.tiles) {
        const def = QS.Registry.get(t.type);
        const list = wantOut ? (def.outputs || []) : (def.inputs || []);
        for (const p of list) {
          const pos = this.portPos(t, p.name, wantOut);
          if (pos.ok && Math.hypot(x - pos.x, y - pos.y) < 9) return { tile: t, port: p.name, type: p.type, pos };
        }
      }
      return null;
    },
    cardAt(x, y) {
      for (let i = this.app.fabric.tiles.length - 1; i >= 0; i--) {
        const t = this.app.fabric.tiles[i];
        const def = QS.Registry.get(t.type);
        if (x >= t.fx && x <= t.fx + this.cardW && y >= t.fy && y <= t.fy + this.cardH(def)) return t;
      }
      return null;
    },
    faceAt(x, y) { // room coordinates
      for (let i = this.app.fabric.tiles.length - 1; i >= 0; i--) {
        const t = this.app.fabric.tiles[i];
        const def = QS.Registry.get(t.type);
        if (!def.room || !def.draw) continue;
        const s = t.state;
        let hx = s.x, hy = s.y, hw = def.w || 20, hh = def.h || 20;
        if (def.hit) { const b = def.hit(s) || {}; hx = b.x; hy = b.y; hw = b.w; hh = b.h; }
        else if (t.type === 'creatureGrid') { hx = 320; hy = 100; hw = 640; hh = 160; }
        else if (t.type === 'scorePing') { hx = 600; hy = 20; hw = 80; hh = 30; }
        if (Math.abs(x - hx) < hw / 2 + 6 && Math.abs(y - hy) < hh / 2 + 6) return t;
      }
      return null;
    },
    wireAt(x, y) {
      for (const w of this.app.fabric.wires) {
        const a = this.app.fabric.tile(w.from), b = this.app.fabric.tile(w.to);
        if (!a || !b) continue;
        const p1 = this.portPos(a, w.fromPort, true), p2 = this.portPos(b, w.toPort, false);
        if (!p1.ok && !p2.ok) continue;
        for (let k = 1; k < 10; k++) {  // sample the bezier
          const u = k / 10;
          const bx = this.bez(p1.x, p1.y, p1.x + 46, p1.y, p2.x - 46, p2.y, p2.x, p2.y, u);
          if (Math.hypot(bx.x - x, bx.y - y) < 7) return w;
        }
      }
      return null;
    },
    bez(x0, y0, x1, y1, x2, y2, x3, y3, u) {
      const v = 1 - u;
      return {
        x: v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3,
        y: v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3
      };
    },

    /* ---------- input ---------- */
    bind() {
      const cv = this.canvas;
      cv.addEventListener('mousedown', e => this.down(e));
      window.addEventListener('mousemove', e => this.move(e));
      window.addEventListener('mouseup', e => this.up(e));
    },
    pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (this.canvas.width / r.width), y: (e.clientY - r.top) * (this.canvas.height / r.height) };
    },
    down(e) {
      const p = this.pos(e);
      this.mouse = p;
      if (this.view === 'fabric') {
        const po = this.portAt(p.x, p.y, true);
        if (po) {
          // anchor the preview at the port it left from — x0/y0 were never set
          // before, so the preview collapsed into a squiggle at the cursor
          this.pending = {
            fromTile: po.tile, fromPort: po.port, type: po.type,
            x: po.pos.x, y: po.pos.y, x0: po.pos.x, y0: po.pos.y
          };
          return;
        }
        const card = this.cardAt(p.x, p.y);
        if (card) {
          this.app.inspector.select('tile', card.id);
          this.drag = { kind: 'card', tile: card, dx: p.x - card.fx, dy: p.y - card.fy, moved: false };
          return;
        }
        const w = this.wireAt(p.x, p.y);
        if (w) { this.app.inspector.select('wire', w.id); return; }
        this.app.inspector.select(null);
      } else {
        const rx = p.x - this.roomOX, ry = p.y - this.roomOY;
        const face = this.faceAt(rx, ry);
        if (face) {
          this.app.inspector.select('tile', face.id);
          const def = QS.Registry.get(face.type);
          if (def.draw && ['actor', 'npc', 'pilot', 'bullet', 'explorer'].includes(face.type) && 'x' in face.state) {
            this.drag = { kind: 'face', tile: face, moved: false };
          }
          return;
        }
        this.app.inspector.select(null);
      }
    },
    move(e) {
      const p = this.pos(e);
      this.mouse = p;
      if (this.pending) { this.pending.x = p.x; this.pending.y = p.y; return; }
      if (!this.drag) return;
      if (this.drag.kind === 'card') {
        this.drag.tile.fx = Math.max(4, p.x - this.drag.dx);
        this.drag.tile.fy = Math.max(4, p.y - this.drag.dy);
        this.drag.moved = true;
      } else if (this.drag.kind === 'face') {
        const s = this.drag.tile.state;   // dragging an actor moves ITS OWN x,y — visible numbers!
        s.x = Math.max(8, Math.min(this.app.fabric.room.w - 8, p.x - this.roomOX));
        s.y = Math.max(8, Math.min(this.app.fabric.room.h - 8, p.y - this.roomOY));
        this.drag.moved = true;
      }
    },
    up(e) {
      const p = this.pos(e);
      if (this.pending) {
        const tgt = this.portAt(p.x, p.y, false);
        if (tgt && tgt.tile.id !== this.pending.fromTile.id) {
          this.app.fabric.addWire(this.pending.fromTile.id, this.pending.fromPort, tgt.tile.id, tgt.port);
        }
        this.pending = null;
        return;
      }
      this.drag = null;
    },

    /* ---------- draw ---------- */
    draw() {
      const ctx = this.ctx, f = this.app.fabric;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.view === 'room') this.drawRoom(ctx);
      else this.drawFabric(ctx);
      this.drawHud(ctx);
    },

    drawRoom(ctx) {
      const f = this.app.fabric;
      const d = QS.Scenes.decor[f.decor] || QS.Scenes.decor.stars;
      ctx.save();
      ctx.translate(this.roomOX, this.roomOY);
      ctx.beginPath(); ctx.rect(0, 0, f.room.w, f.room.h); ctx.clip();
      d(ctx, f.room.w, f.room.h, f.tick);
      for (const t of f.tiles) {
        const def = QS.Registry.get(t.type);
        if (!def.room || !def.draw) continue;
        t.tickNow = f.tick;
        if (t.halted) this.drawHaltedFace(ctx, t);
        else def.draw(ctx, t, this);
      }
      ctx.restore();
      // room frame
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
      ctx.strokeRect(this.roomOX, this.roomOY, f.room.w, f.room.h);
      ctx.lineWidth = 1;
    },

    drawHaltedFace(ctx, t) {  // M3: the error is ON the face
      const s = t.state;
      const x = s.x !== undefined ? s.x : 320;
      const y = s.y !== undefined ? s.y : (s.deckY !== undefined ? s.deckY : 180);
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 18, y - 14, 36, 28, 6) : ctx.rect(x - 18, y - 14, 36, 28); ctx.fill();
      ctx.fillStyle = '#fecaca'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚠', x, y + 5);
      ctx.font = '9px sans-serif';
      ctx.fillText('halted — click me', x, y + 22);
    },

    drawFabric(ctx) {
      const f = this.app.fabric;
      // grid dots
      ctx.fillStyle = 'rgba(148,163,184,.18)';
      for (let x = 10; x < this.canvas.width; x += 26)
        for (let y = 10; y < this.canvas.height; y += 26) ctx.fillRect(x, y, 2, 2);
      // wires first (under cards)
      for (const w of f.wires) this.drawWire(ctx, w);
      // pending wire
      if (this.pending) {
        ctx.strokeStyle = WIRE_COLORS[this.pending.type] || '#fff';
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(this.pending.x0, this.pending.y0);
        ctx.bezierCurveTo(this.pending.x + 46, this.pending.y, this.mouse.x - 46, this.mouse.y, this.mouse.x, this.mouse.y);
        ctx.stroke(); ctx.setLineDash([]);
      }
      for (const t of f.tiles) this.drawCard(ctx, t);
      // banner: flags a kid should see
      const flags = f.wires.filter(w => w.flag);
      const halted = f.tiles.filter(t => t.halted);
      let msg = [];
      if (flags.length) msg.push('⚠ ' + flags.length + ' wire' + (flags.length > 1 ? 's' : '') + ' flagged (' + flags.map(w => w.flag).filter((v, i, a) => a.indexOf(v) === i).join(', ') + ')');
      if (halted.length) msg.push('⚠ ' + halted.length + ' tile' + (halted.length > 1 ? 's' : '') + ' halted — the room runs on');
      if (msg.length) {
        ctx.fillStyle = 'rgba(127,29,29,.92)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(12, this.canvas.height - 44, this.canvas.width - 24, 32, 8) : ctx.rect(12, this.canvas.height - 44, this.canvas.width - 24, 32);
        ctx.fill();
        ctx.fillStyle = '#fecaca'; ctx.font = '12px "Comic Sans MS", sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(msg.join('   ·   '), 24, this.canvas.height - 23);
      }
    },

    drawWire(ctx, w) {
      const f = this.app.fabric;
      const a = f.tile(w.from), b = f.tile(w.to);
      const p1 = a ? this.portPos(a, w.fromPort, true) : null;
      const p2 = b ? this.portPos(b, w.toPort, false) : null;
      const sel = this.app.inspector.sel && this.app.inspector.sel.kind === 'wire' && this.app.inspector.sel.id === w.id;
      let color = WIRE_COLORS[(p1 && p1.type) || 'any'] || '#94a3b8';
      if (w.flag) color = '#ef4444';
      ctx.strokeStyle = color;
      ctx.lineWidth = sel ? 4 : 2;
      if (w.flag) ctx.setLineDash([6, 4]);
      const from = p1 && p1.ok ? p1 : { x: 40, y: this.canvas.height / 2 };
      const to = p2 && p2.ok ? p2 : { x: this.canvas.width - 40, y: this.canvas.height / 2 };
      ctx.beginPath(); ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(from.x + 46, from.y, to.x - 46, to.y, to.x, to.y);
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      // travelling pulse on event wires carrying a value this tick
      if (a && a.out && w.fromPort in a.out && a.out[w.fromPort] !== null && typeof a.out[w.fromPort] !== 'undefined') {
        const u = (this.app.fabric.tick % 20) / 20;
        const pt = this.bez(from.x, from.y, from.x + 46, from.y, to.x - 46, to.y, to.x, to.y, u);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.4, 0, 7); ctx.fill();
      }
      if (w.flag) { // ⚠ at the middle
        const m = this.bez(from.x, from.y, from.x + 46, from.y, to.x - 46, to.y, to.x, to.y, 0.5);
        ctx.fillStyle = '#ef4444'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('⚠', m.x, m.y - 6);
      }
      // port dots
      ctx.fillStyle = color;
      for (const p of [from, to]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill(); }
    },

    drawCard(ctx, t) {
      const def = QS.Registry.get(t.type);
      const h = this.cardH(def);
      const sel = this.app.inspector.sel && this.app.inspector.sel.kind === 'tile' && this.app.inspector.sel.id === t.id;
      ctx.fillStyle = t.halted ? '#7f1d1d' : (def.kind === 'effect' ? '#3b1d54' : def.kind === 'mechanic' ? '#0c4a6e' : def.kind === 'npc' ? '#14532d' : '#1e293b');
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(t.fx, t.fy, this.cardW, h, 10) : ctx.rect(t.fx, t.fy, this.cardW, h);
      ctx.fill();
      if (sel) { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2.5; } else { ctx.strokeStyle = '#475569'; }
      ctx.stroke(); ctx.lineWidth = 1;
      // head
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 12px "Comic Sans MS", sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(def.icon + ' ' + t.label, t.fx + 8, t.fy + 17);
      if (t.halted) { ctx.fillStyle = '#fca5a5'; ctx.font = 'bold 11px sans-serif'; ctx.fillText('⚠ ' + t.halted.message.slice(0, 22), t.fx + 8, t.fy + h - 6); }
      // live watch numbers — the numbers ARE on the cards
      if (!t.halted && def.watch) {
        ctx.fillStyle = '#a5f3fc'; ctx.font = '11px ui-monospace, monospace';
        const txt = def.watch.map(k => k + '=' + QS.Inspect.fmt(t.state[k])).join('  ');
        ctx.fillText(txt.slice(0, 26), t.fx + 8, t.fy + h - 6);
      }
      // ports
      ctx.font = '9.5px "Comic Sans MS", sans-serif';
      (def.inputs || []).forEach((p, i) => {
        const y = t.fy + 26 + i * 15 + 6;
        ctx.fillStyle = WIRE_COLORS[p.type];
        ctx.beginPath(); ctx.arc(t.fx, y, 4, 0, 7); ctx.fill();
        ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left';
        ctx.fillText(p.name, t.fx + 7, y + 3);
      });
      (def.outputs || []).forEach((p, i) => {
        const y = t.fy + 26 + i * 15 + 6;
        ctx.fillStyle = WIRE_COLORS[p.type];
        ctx.beginPath(); ctx.arc(t.fx + this.cardW, y, 4, 0, 7); ctx.fill();
        ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'right';
        ctx.fillText(p.name, t.fx + this.cardW - 7, y + 3);
      });
      ctx.textAlign = 'left';
    },

    drawHud(ctx) {
      const f = this.app.fabric;
      ctx.fillStyle = 'rgba(15,23,42,.8)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(12, 12, 230, 26, 8) : ctx.rect(12, 12, 230, 26);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0'; ctx.font = '12px "Comic Sans MS", sans-serif';
      ctx.fillText((this.view === 'room' ? '🪟 room' : '🧵 fabric') + '  ·  tick ' + f.tick +
        (this.app.engine.running ? '  ·  ▶ running' : '  ·  ⏸ paused'), 22, 29);
    }
  };
})();
