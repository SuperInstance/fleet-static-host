/* inspector.js — the LIVE STATE INSPECTOR. The soul of the product.
 *
 * Click any tile, in either view, and every field of its state updates
 * every tick. M1: every key is shown. N2: nothing is hidden. The row
 * builder (QS.Inspect.rowsFor) is shared with the contract tests, so
 * "the inspector shows everything" is a TESTED claim, not a hope.
 */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});
  const fmt = (v) => {
    if (v === null) return '—';
    if (typeof v === 'number') return (Math.round(v * 100) / 100).toString();
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  };
  QS.Inspect = { fmt };

  /* Row model shared with tests: one row per visible key.
   * Arrays get one row per cell (a kid can watch creature 5 die). */
  QS.Inspect.rowsFor = function (state) {
    const rows = [];
    for (const k of Object.keys(state)) {
      const v = state[k];
      if (Array.isArray(v)) {
        rows.push({ key: k, kind: 'array', value: v.length + ' items', raw: v });
        v.forEach((cell, i) => rows.push({ key: k + '[' + i + ']', kind: 'cell', value: fmt(cell), dot: !!cell }));
      } else if (v !== null && typeof v === 'object') {
        rows.push({ key: k, kind: 'object', value: '{…}', raw: v });
        for (const kk of Object.keys(v)) rows.push({ key: k + '.' + kk, kind: 'field', value: fmt(v[kk]) });
      } else {
        rows.push({ key: k, kind: typeof v, value: fmt(v) });
      }
    }
    return rows;
  };

  QS.Inspector = function (el, app) {
    this.el = el; this.app = app;
    this.sel = null;      // {kind:'tile'|'wire', id}
    this.built = '';      // cache key for the DOM rebuild
    this.el.innerHTML = '<div class="insp-empty">Click a tile or a wire 👆<br><small>watch its numbers change every tick</small></div>';
  };

  QS.Inspector.prototype = {
    select(kind, id) { this.sel = { kind, id }; this.built = ''; this.refresh(true); },

    refresh(force) {
      if (!this.sel) return;
      if (this.sel.kind === 'wire') {
        // rebuilding a wire panel every frame is wasteful; every ~10 ticks is plenty
        if (!this._wireTick || force || this.app.fabric.tick - this._wireTick >= 10) {
          this._wireTick = this.app.fabric.tick;
          return this.renderWire();
        }
        return;
      }
      const t = this.app.fabric.tile(this.sel.id) || null;
      if (!t) { this.el.innerHTML = '<div class="insp-empty">retired — its story is in the history below 📜</div>'; this.sel = null; return; }
      if (force || this.built !== t.id + ':' + t.type) this.buildTile(t);
      this.updateValues(t);
    },

    buildTile(t) {
      const def = QS.Registry.get(t.type);
      this.built = t.id + ':' + t.type;
      const rows = QS.Inspect.rowsFor(t.state);
      let h = '<div class="insp-head"><span class="insp-icon">' + def.icon + '</span>' +
        '<div><div class="insp-title">' + t.label + '</div>' +
        '<div class="insp-sub">' + t.id + ' · ' + def.kind + ' · tick ' + '<span data-tick></span></div></div></div>';
      if (t.halted) {
        h += '<div class="insp-halt">⚠ halted at tick ' + t.halted.tick + ': ' + this.esc(t.halted.message) +
          '<br><small>M3: it halted ITSELF. The room keeps running.</small><br>' +
          '<button data-act="resume">▶ try again</button></div>';
      }
      h += '<div class="insp-desc">' + this.esc(def.desc) + '</div>';
      // swap — M2: wires survive by port name
      const samePorts = QS.PALETTE.filter(p => p.type === t.type);
      if (samePorts.length > 1 || (t.paletteKey && samePorts.length >= 1 && samePorts[0].key !== t.paletteKey) || true) {
        h += '<div class="insp-swap"><label>swap tile (wires stay)</label><select data-act="swap"><option value="">choose…</option>';
        for (const p of QS.PALETTE) {
          if (p.key === t.paletteKey) continue;
          const d = QS.Registry.get(p.type);
          const sharedIn = (d.inputs || []).some(x => (def.inputs || []).some(y => y.name === x.name));
          const sharedOut = (d.outputs || []).some(x => (def.outputs || []).some(y => y.name === x.name));
          if (p.type !== t.type && !(sharedIn || sharedOut)) continue;
          h += '<option value="' + p.key + '">' + p.label + (sharedIn || sharedOut || p.type === t.type ? '' : '') + '</option>';
        }
        h += '</select></div>';
      }
      h += '<div class="insp-ports"><div class="insp-ports-in">' +
        (def.inputs || []).map(p => '<span class="port-chip in" title="input · ' + p.type + '">→ ' + p.name + ' <i>(' + p.type + ')</i></span>').join('') +
        '</div><div class="insp-ports-out">' +
        (def.outputs || []).map(p => '<span class="port-chip out" title="output · ' + p.type + '">' + p.name + ' → <i>(' + p.type + ')</i></span>').join('') +
        '</div></div>';
      h += '<table class="insp-table"><thead><tr><th>state</th><th>value</th></tr></thead><tbody>';
      for (const r of rows) {
        h += '<tr class="row-' + r.kind + '" data-k="' + this.esc(r.key) + '"><td class="k">' + this.esc(r.key) +
          '</td><td class="v"' + (r.kind === 'cell' ? ' data-dot="' + (r.dot ? 1 : 0) + '"' : '') + '></td></tr>';
      }
      h += '</tbody></table>';
      h += '<div class="insp-actions"><button data-act="pause-tile" title="freeze this tile only">⏸ pause tile</button>' +
        '<button data-act="remove" class="danger" title="retire the tile — kept in history, never destroyed">retire tile</button></div>';
      h += '<div class="insp-hist"><div class="insp-hist-title">📜 rewire history <small>(append-only — N4)</small></div><div class="insp-hist-list" data-hist></div></div>';
      this.el.innerHTML = h;

      this.el.querySelectorAll('button[data-act], select[data-act]').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          const act = btn.getAttribute('data-act');
          const f = this.app.fabric;
          if (act === 'resume') { this.app.engine.resume(t.id); this.built = ''; }
          if (act === 'remove') {
            if (confirm('Retire ' + t.label + '? Its story stays in history (nothing is destroyed).')) {
              f.removeTile(t.id); this.sel = null;
              this.el.innerHTML = '<div class="insp-empty">retired 📜 see history</div>';
            }
          }
          if (act === 'pause-tile') { t.halted = t.halted || { message: 'paused by builder', tick: f.tick }; f.record('tile-pause', t.label + ' paused by builder'); this.built = ''; }
          if (act === 'swap' && btn.value) {
            f.swapTile(t.id, btn.value);   // preset starting state rides along inside swapTile
            this.built = '';
          }
          // repaint now, not at the next frame — when the room is PAUSED there
          // is no next frame, and 'app.draw' never existed (silent no-op before)
          this.refresh(true);
          if (this.app.editor) this.app.editor.draw();
        });
      });
      this.updateValues(t);
    },

    updateValues(t) {
      const rows = QS.Inspect.rowsFor(t.state);
      const map = {};
      this.el.querySelectorAll('td.v').forEach(td => { map[td.parentNode.getAttribute('data-k')] = td; });
      for (const r of rows) {
        const td = map[r.key];
        if (!td) { this.buildTile(t); return; }  // key set changed → rebuild
        if (r.kind === 'cell') {
          td.parentNode.setAttribute('data-dot', r.dot ? 1 : 0);
        }
        td.textContent = r.value;
      }
      const tickEl = this.el.querySelector('[data-tick]');
      if (tickEl) tickEl.textContent = this.app.fabric.tick;
      const hist = this.el.querySelector('[data-hist]');
      if (hist) {
        const items = this.app.fabric.history.slice(-14);
        hist.innerHTML = items.map(x =>
          '<div class="hist-row"><span class="hist-i">#' + x.i + '</span> t' + x.tick + ' · ' + this.esc(x.kind) +
          '<br><small>' + this.esc(x.detail) + '</small></div>').join('');
      }
    },

    renderWire() {
      const w = this.app.fabric.wire(this.sel.id);
      if (!w) { this.sel = null; this.el.innerHTML = '<div class="insp-empty">wire gone (history kept)</div>'; return; }
      const f = this.app.fabric;
      const a = f.tile(w.from), b = f.tile(w.to);
      if (!a || !b) {   // one end retired — the wire is an orphan; its story is kept (N4)
        this.el.innerHTML = '<div class="insp-head"><span class="insp-icon">🔌</span><div><div class="insp-title">wire ' + w.id + ' ⚠ orphan</div>' +
          '<div class="insp-sub">one end was retired — the wire waits here</div></div></div>' +
          '<div class="insp-halt">⚠ orphaned wire. The tile it served was retired; unwind this wire whenever you like — nothing is deleted, the story is in history below.</div>' +
          '<div class="insp-actions"><button data-act="cut" class="danger">✂ unwind (kept in history)</button></div>' +
          '<div class="insp-hist"><div class="insp-hist-title">📜 rewire history</div><div class="insp-hist-list" data-hist></div></div>';
        this.el.querySelector('button[data-act="cut"]').addEventListener('click', () => { f.removeWire(w.id); this.sel = null; this.el.innerHTML = '<div class="insp-empty">unwound 📜 see history</div>'; });
        const hist = this.el.querySelector('[data-hist]');
        hist.innerHTML = f.history.slice(-14).map(x =>
          '<div class="hist-row"><span class="hist-i">#' + x.i + '</span> t' + x.tick + ' · ' + this.esc(x.kind) +
          '<br><small>' + this.esc(x.detail) + '</small></div>').join('');
        return;
      }
      const da = QS.Registry.get(a.type), db = QS.Registry.get(b.type);
      const po = (da.outputs || []).find(p => p.name === w.fromPort), pi = (db.inputs || []).find(p => p.name === w.toPort);
      this.el.innerHTML = '<div class="insp-head"><span class="insp-icon">🔌</span><div><div class="insp-title">wire ' + w.id + '</div>' +
        '<div class="insp-sub">' + a.label + '.' + w.fromPort + ' → ' + b.label + '.' + w.toPort + '</div></div></div>' +
        '<div class="insp-desc">' + this.esc(a.label) + ' publishes <b>' + w.fromPort + '</b> (' + (po && po.type) + ') and ' +
        this.esc(b.label) + ' listens on <b>' + w.toPort + '</b> (' + (pi && pi.type) + '). Numbers on a wire are one tick old — honest.</div>' +
        (w.flag ? '<div class="insp-halt">⚠ ' + this.esc(w.flag) + (w.flag === 'type-mismatch' ? ' — flagged, NOT coerced. Fix either end when you like.' : '') + '</div>' : '') +
        '<div class="insp-actions"><button data-act="cut" class="danger">✂ unwind (kept in history)</button></div>' +
        '<div class="insp-hist"><div class="insp-hist-title">📜 rewire history</div><div class="insp-hist-list" data-hist></div></div>';
      this.el.querySelector('button[data-act="cut"]').addEventListener('click', () => { f.removeWire(w.id); this.select('tile', w.to); });
      const hist = this.el.querySelector('[data-hist]');
      hist.innerHTML = f.history.slice(-14).map(x =>
        '<div class="hist-row"><span class="hist-i">#' + x.i + '</span> t' + x.tick + ' · ' + this.esc(x.kind) +
        '<br><small>' + this.esc(x.detail) + '</small></div>').join('');
    },

    esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  };
})();
