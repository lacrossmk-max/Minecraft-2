// ---- UI: hotbar, inventory, crafting, HUD, menus ----
'use strict';

class UI {
  constructor(game) {
    this.game = game;
    this.selected = 0;
    this.hotbar = [B.GRASS, B.DIRT, B.STONE, B.PLANKS, B.LOG, B.GLASS, B.SAND, B.TNT, B.FLOWER];
    this.atlasUrl = null;
    this._buildHotbar();
    this._bindMenus();
  }

  setAtlas(canvas) {
    this.atlasUrl = canvas.toDataURL();
    this.refreshHotbar();
  }

  // ---------------- hotbar ----------------
  _buildHotbar() {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot' + (i === this.selected ? ' sel' : '');
      s.innerHTML = '<div class="icon"></div><div class="cnt"></div>';
      s.addEventListener('pointerdown', e => { e.stopPropagation(); this.selectSlot(i); });
      bar.appendChild(s);
    }
  }

  selectSlot(i) {
    this.selected = i;
    this.refreshHotbar();
    const id = this.hotbar[i];
    if (id) this.game.toast(itemName(id), 700);
  }

  currentItem() { return this.hotbar[this.selected] || 0; }

  refreshHotbar() {
    const g = this.game;
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((s, i) => {
      s.classList.toggle('sel', i === this.selected);
      const id = this.hotbar[i];
      const icon = s.querySelector('.icon'), cnt = s.querySelector('.cnt');
      if (id && this.atlasUrl) {
        icon.style.backgroundImage = `url(${this.atlasUrl})`;
        icon.style.backgroundPosition = tileCss(id);
        icon.style.display = 'block';
        if (g.mode === 'survival') {
          const have = g.inventory.get(id) || 0;
          cnt.textContent = have > 0 ? have : '';
          icon.style.opacity = have > 0 ? 1 : 0.25;
        } else {
          cnt.textContent = '';
          icon.style.opacity = 1;
        }
      } else {
        icon.style.display = 'none';
        cnt.textContent = '';
      }
    });
  }

  // ---------------- status bars ----------------
  refreshStatus() {
    const g = this.game, p = g.player;
    const hr = document.getElementById('health-row');
    const gr = document.getElementById('hunger-row');
    const ar = document.getElementById('air-row');
    if (g.mode !== 'survival') { hr.textContent = ''; gr.textContent = ''; ar.textContent = ''; return; }
    const hearts = Math.ceil(p.health / 2), full = 10;
    hr.textContent = '❤'.repeat(Math.max(0, hearts)) + '🖤'.repeat(Math.max(0, full - hearts));
    const food = Math.ceil(p.hunger / 2);
    gr.textContent = '🍗'.repeat(Math.max(0, food)) + '· '.repeat(Math.max(0, full - food)).trim();
    ar.textContent = p.eyeInWater ? '⬤'.repeat(Math.max(0, Math.ceil(p.air))) : '';
  }

  // ---------------- inventory & crafting ----------------
  toggleInventory() {
    const el = document.getElementById('inventory');
    const open = el.style.display !== 'flex';
    el.style.display = open ? 'flex' : 'none';
    this.game.paused = open || document.getElementById('pause-menu').style.display === 'flex';
    if (open) this.refreshInventory();
  }

  refreshInventory() {
    const g = this.game;
    const grid = document.getElementById('inv-grid');
    grid.innerHTML = '';
    document.getElementById('inv-title').textContent =
      g.mode === 'creative' ? 'Kreativ-Inventar' : 'Inventar';
    const ids = g.mode === 'creative'
      ? CREATIVE_BLOCKS
      : [...g.inventory.entries()].filter(([, n]) => n > 0).map(([id]) => id);

    for (const id of ids) {
      const s = document.createElement('div');
      s.className = 'slot';
      const n = g.mode === 'survival' ? (g.inventory.get(id) || 0) : '';
      s.innerHTML = `<div class="icon" style="background-image:url(${this.atlasUrl});background-position:${tileCss(id)}"></div><div class="cnt">${n}</div>`;
      s.title = itemName(id);
      s.addEventListener('pointerdown', () => {
        this.hotbar[this.selected] = id;
        this.refreshHotbar();
        this.game.toast(itemName(id) + ' → Slot ' + (this.selected + 1), 900);
      });
      grid.appendChild(s);
    }
    if (!ids.length) grid.innerHTML = '<div style="padding:14px;color:#999;font-size:13px">Baue Blöcke ab, um sie zu sammeln!</div>';

    // crafting (survival only)
    const cl = document.getElementById('craft-list');
    const ct = document.getElementById('craft-title');
    if (g.mode === 'creative') { cl.style.display = 'none'; ct.style.display = 'none'; return; }
    cl.style.display = 'block'; ct.style.display = 'block';
    cl.innerHTML = '';
    for (const r of RECIPES) {
      const row = document.createElement('div');
      row.className = 'recipe';
      const needTxt = r.in.map(([id, n]) => `${n}× ${itemName(id)}`).join(' + ');
      const can = r.in.every(([id, n]) => (g.inventory.get(id) || 0) >= n);
      row.innerHTML = `
        <div class="icon" style="background-image:url(${this.atlasUrl});background-position:${tileCss(r.out)}"></div>
        <div class="txt"><b>${r.n}× ${itemName(r.out)}</b><br><span style="color:#aaa">${needTxt}</span></div>
        <button ${can ? '' : 'disabled'}>Herstellen</button>`;
      row.querySelector('button').addEventListener('pointerdown', e => {
        e.stopPropagation();
        if (!r.in.every(([id, n]) => (g.inventory.get(id) || 0) >= n)) return;
        for (const [id, n] of r.in) g.inventory.set(id, g.inventory.get(id) - n);
        g.addItem(r.out, r.n);
        g.sound.play('craft');
        this.refreshInventory();
        this.refreshHotbar();
      });
      cl.appendChild(row);
    }
  }

  // ---------------- chest ----------------
  openChest(key) {
    const g = this.game;
    this.chestKey = key;
    if (!g.chests.has(key)) g.chests.set(key, new Map());
    document.getElementById('chest-ui').style.display = 'flex';
    g.paused = true;
    this.refreshChest();
  }

  closeChest() {
    document.getElementById('chest-ui').style.display = 'none';
    this.chestKey = null;
    this.game.paused = false;
    this.refreshHotbar();
  }

  refreshChest() {
    const g = this.game;
    const chest = g.chests.get(this.chestKey);
    if (!chest) return;

    const fillGrid = (el, entries, emptyText, onTap) => {
      el.innerHTML = '';
      let any = false;
      for (const [id, n] of entries) {
        if (n <= 0) continue;
        any = true;
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = `<div class="icon" style="background-image:url(${this.atlasUrl});background-position:${tileCss(id)}"></div><div class="cnt">${n}</div>`;
        s.title = itemName(id);
        s.addEventListener('pointerdown', () => onTap(id, n));
        el.appendChild(s);
      }
      if (!any) el.innerHTML = `<div class="empty-note">${emptyText}</div>`;
    };

    // chest side: tap -> take the whole stack
    fillGrid(document.getElementById('chest-grid'), chest, 'Diese Truhe ist leer.', (id, n) => {
      chest.set(id, 0);
      g.addItem(id, n);
      g.sound.play('pickup');
      this.refreshChest();
    });
    // inventory side: tap -> store the whole stack
    fillGrid(document.getElementById('chest-inv-grid'), g.inventory, 'Dein Inventar ist leer.', (id, n) => {
      g.inventory.set(id, 0);
      chest.set(id, (chest.get(id) || 0) + n);
      g.sound.play('place');
      this.refreshChest();
    });
  }

  // ---------------- pause / menus ----------------
  togglePause() {
    const el = document.getElementById('pause-menu');
    const open = el.style.display !== 'flex';
    el.style.display = open ? 'flex' : 'none';
    if (open) document.getElementById('inventory').style.display = 'none';
    this.game.paused = open;
    if (open && document.pointerLockElement) document.exitPointerLock();
  }

  _bindMenus() {
    const g = this.game;
    const $ = id => document.getElementById(id);

    $('btn-inv-close').addEventListener('pointerdown', () => this.toggleInventory());
    $('btn-chest-close').addEventListener('pointerdown', () => this.closeChest());
    $('btn-resume').addEventListener('pointerdown', () => this.togglePause());
    $('btn-save').addEventListener('pointerdown', () => { g.save(); g.toast('Welt gespeichert ✓'); });
    $('btn-quit').addEventListener('pointerdown', () => { g.save(); location.reload(); });
    $('btn-respawn').addEventListener('pointerdown', () => g.respawn());

    const fs = () => {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) {
        // iPhone Safari has no fullscreen API
        g.toast('Vollbild: „Zum Home-Bildschirm hinzufügen" nutzen', 3000);
        return;
      }
      if (!document.fullscreenElement) req.call(el);
      else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    };
    $('btn-fullscreen').addEventListener('pointerdown', fs);
    $('btn-fullscreen2').addEventListener('pointerdown', fs);

    $('rd-row').querySelectorAll('.mbtn').forEach(b => b.addEventListener('pointerdown', () => {
      $('rd-row').querySelectorAll('.mbtn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      g.renderDist = +b.dataset.rd;
      g.applyFog();
    }));
    $('sens-row').querySelectorAll('.mbtn').forEach(b => b.addEventListener('pointerdown', () => {
      $('sens-row').querySelectorAll('.mbtn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      g.controls.sensitivity = +b.dataset.s;
    }));
    $('btn-sound').addEventListener('pointerdown', () => {
      g.sound.enabled = !g.sound.enabled;
      $('btn-sound').textContent = 'Sound: ' + (g.sound.enabled ? 'An' : 'Aus');
    });
    $('btn-shadow').addEventListener('pointerdown', () => {
      g.shadowsOn = !g.shadowsOn;
      g.applyShadows();
      $('btn-shadow').textContent = 'Schatten: ' + (g.shadowsOn ? 'An' : 'Aus');
    });

    // title screen
    let mode = 'survival';
    $('mode-survival').addEventListener('pointerdown', () => {
      mode = 'survival';
      $('mode-survival').classList.add('on'); $('mode-creative').classList.remove('on');
    });
    $('mode-creative').addEventListener('pointerdown', () => {
      mode = 'creative';
      $('mode-creative').classList.add('on'); $('mode-survival').classList.remove('on');
    });
    $('btn-new').addEventListener('pointerdown', () => {
      const seedTxt = $('seed-input').value.trim();
      const seed = seedTxt ? (isNaN(+seedTxt) ? hashStr(seedTxt) : +seedTxt) : (Math.random() * 1e9) | 0;
      localStorage.removeItem('blockwelt_save');
      g.start(seed, mode, null);
    });
    if (localStorage.getItem('blockwelt_save')) {
      $('btn-continue').style.display = 'block';
      $('btn-continue').addEventListener('pointerdown', () => {
        try {
          const save = JSON.parse(localStorage.getItem('blockwelt_save'));
          g.start(save.seed, save.mode, save);
        } catch (e) { g.toast('Speicherstand beschädigt'); }
      });
    }
  }

  showDeath(cause) {
    document.getElementById('death-cause').textContent = cause || '';
    document.getElementById('death-screen').style.display = 'flex';
  }
  hideDeath() {
    document.getElementById('death-screen').style.display = 'none';
  }
}
