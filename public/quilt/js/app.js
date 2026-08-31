/* app.js — boot, header, palette sidebar, save/load. */
(function () {
  'use strict';
  const QS = (window.QS = window.QS || {});

  QS.App = function () {
    this.fabric = QS.Scenes.invaders();
    this.engine = new QS.Engine(this.fabric);
    QS.__engine = this.engine;   // io tiles read key state from here — the ONE sanctioned engine hook
    this.editor = new QS.Editor(document.getElementById('stage'), this);
    this.inspector = new QS.Inspector(document.getElementById('inspector'), this);
    this.buildPalette();
    this.buildHeader();
    this.wireKeys();
    this.engine.onFrame = () => { this.editor.draw(); this.inspector.refresh(); };
    this.engine.start();
    this.editor.view = 'room';
  };

  QS.App.prototype = {
    buildPalette() {
      const el = document.getElementById('palette');
      el.innerHTML = '<div class="pal-title">🧩 tiles</div>';
      for (const p of QS.PALETTE) {
        const b = document.createElement('button');
        b.className = 'pal-item';
        b.innerHTML = '<span class="pal-label">' + p.label + '</span>';
        b.title = (QS.Registry.get(p.type).desc || '') + '  (click to add)';
        b.addEventListener('click', () => this.addTile(p));
        el.appendChild(b);
      }
    },
    addTile(p) {
      this.editor.view = 'fabric';   // adding a tile takes you to the fabric to place it
      const x = 200 + (this.fabric.tiles.length % 5) * 40;
      const y = 90 + (this.fabric.tiles.length % 7) * 55;
      const t = this.fabric.addTile(p.key, x, y, p.seed);
      this.inspector.select('tile', t.id);
      this.updateViewButtons();
    },
    buildHeader() {
      const sceneSel = document.getElementById('scene-sel');
      for (const s of QS.Scenes.list) {
        const o = document.createElement('option');
        o.value = s.key; o.textContent = s.label;
        sceneSel.appendChild(o);
      }
      sceneSel.addEventListener('change', () => this.loadScene(sceneSel.value));
      document.getElementById('btn-view').addEventListener('click', () => {
        this.editor.view = this.editor.view === 'room' ? 'fabric' : 'room';
        this.updateViewButtons();
      });
      document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
      document.getElementById('btn-step').addEventListener('click', () => {
        if (this.engine.running) this.togglePlay();
        this.engine.step(1); this.editor.draw(); this.inspector.refresh(true);
      });
      document.getElementById('btn-save').addEventListener('click', () => this.saveFile());
      document.getElementById('btn-load').addEventListener('click', () => document.getElementById('file-in').click());
      document.getElementById('file-in').addEventListener('change', e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => { try { this.loadFabric(r.result); } catch (err) { alert('could not load: ' + err.message); } };
        r.readAsText(f);
        e.target.value = '';
      });
      document.getElementById('btn-new').addEventListener('click', () => {
        if (!confirm('Start a fresh empty fabric? (This scene reloads; saved files are never touched.)')) return;
        this.loadFabricFromFabric(new QS.Fabric({ name: 'my fabric', decor: 'stars' }));
      });
      this.updateViewButtons(); this.updatePlayButton();
    },
    loadScene(key) {
      const s = QS.Scenes.list.find(x => x.key === key);
      if (s) this.loadFabricFromFabric(s.build());
    },
    loadFabricFromFabric(f) {
      const wasRunning = this.engine.running;
      this.engine.stop();
      this.fabric = f;
      this.engine = new QS.Engine(f);
      QS.__engine = this.engine;
      this.editor.app = this; this.editor.pending = null; this.editor.drag = null;
      this.inspector.select(null);
      this.inspector.el.innerHTML = '<div class="insp-empty">Click a tile or a wire 👆<br><small>watch its numbers change every tick</small></div>';
      this.engine.onFrame = () => { this.editor.draw(); this.inspector.refresh(); };
      if (wasRunning || true) this.engine.start();
      this.updatePlayButton();
    },
    loadFabric(json) {
      this.loadFabricFromFabric(QS.Fabric.load(json));
    },
    togglePlay() {
      if (this.engine.running) this.engine.stop(); else this.engine.start();
      this.updatePlayButton();
    },
    updatePlayButton() {
      document.getElementById('btn-play').textContent = this.engine.running ? '⏸ pause' : '▶ play';
    },
    updateViewButtons() {
      document.getElementById('btn-view').textContent = this.editor.view === 'room' ? '🧵 see fabric' : '🪟 see room';
    },
    saveFile() {
      const blob = new Blob([this.fabric.save()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = this.fabric.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.quilt.json';
      a.click();
      URL.revokeObjectURL(a.href);
      this.fabric.record('save', 'saved fabric file — a fabric file is forever (M4)');
    },
    wireKeys() {
      window.addEventListener('keydown', e => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
        const eng = this.engine;
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') eng.press('ArrowLeft');
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') eng.press('ArrowRight');
        if (e.key === ' ') { if (!e.repeat) eng.fire(); }
      });
      window.addEventListener('keyup', e => {
        const eng = this.engine;
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') eng.release('ArrowLeft');
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') eng.release('ArrowRight');
      });
    }
  };

  window.addEventListener('DOMContentLoaded', () => { window.app = new QS.App(); });
})();
