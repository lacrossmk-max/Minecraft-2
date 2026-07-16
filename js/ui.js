// ---- UI: hotbar, slot inventory, crafting, chest, HUD, menus ----
'use strict';

class UI {
  constructor(game) {
    this.game = game;
    this.selected = 0;          // hotbar index (inv slots 0..8)
    this.cursor = null;         // picked-up stack {id,count} while an overlay is open
    this.chestKey = null;
    this.craftSel = -1;         // selected recipe card index
    this.atlasUrl = null;
    this._buildHotbar();
    this._bindMenus();
  }

  setAtlas(canvas) {
    this.atlasUrl = canvas.toDataURL();
    this.refreshHotbar();
  }

  // ---------------- hotbar (HUD) ----------------
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
    const s = this.game.inv[i];
    if (s) this.game.toast(itemName(s.id), 700);
  }

  currentItem() {
    const s = this.game.inv[this.selected];
    return s ? s.id : 0;
  }

  refreshHotbar() {
    const g = this.game;
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((el, i) => {
      el.classList.toggle('sel', i === this.selected);
      this._paintSlot(el, g.inv[i]);
    });
  }

  _paintSlot(el, s) {
    const icon = el.querySelector('.icon'), cnt = el.querySelector('.cnt');
    if (s && this.atlasUrl) {
      icon.style.backgroundImage = `url(${this.atlasUrl})`;
      icon.style.backgroundPosition = tileCss(s.id);
      icon.style.display = 'block';
      icon.style.opacity = 1;
      cnt.textContent = (this.game.mode === 'survival' && s.count > 1) ? s.count : '';
      el.title = itemName(s.id);
    } else {
      icon.style.display = 'none';
      cnt.textContent = '';
      el.title = '';
    }
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

  // ---------------- slot grids & the pick-up cursor ----------------
  _listRef(list) {
    if (list === 'inv') return this.game.inv;
    if (list === 'chest') return this.game.chests.get(this.chestKey);
    return null;
  }

  // render `arr` slots into element `el` (subRange = [start,end) of indices)
  _renderGrid(el, list, start, end) {
    const arr = this._listRef(list);
    el.innerHTML = '';
    for (let i = start; i < end; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = '<div class="icon"></div><div class="cnt"></div>';
      this._paintSlot(s, arr[i]);
      if (list === 'inv' && i === this.selected) s.classList.add('sel');
      s.addEventListener('pointerdown', e => { e.stopPropagation(); this.tapSlot(list, i); });
      el.appendChild(s);
    }
  }

  tapSlot(list, i) {
    const g = this.game;
    const arr = this._listRef(list);
    if (!arr) return;
    const cur = this.cursor, target = arr[i];
    if (cur) {
      if (!target) {
        arr[i] = cur; this.cursor = null;
      } else if (target.id === cur.id) {
        const max = g.stackMax(cur.id);
        const take = Math.min(cur.count, max - target.count);
        target.count += take; cur.count -= take;
        if (cur.count <= 0) this.cursor = null;
      } else {
        arr[i] = cur; this.cursor = target;   // swap
      }
      g.sound.play('place');
    } else if (target) {
      this.cursor = target;
      arr[i] = null;
      g.sound.play('pickup');
    }
    this.refreshAllGrids();
  }

  // creative palette: tap an entry to grab a full stack onto the cursor
  tapPalette(id) {
    this.cursor = { id, count: this.game.stackMax(id) };
    this.game.sound.play('pickup');
    this.refreshAllGrids();
  }

  // put whatever is on the cursor back into the inventory (or discard in creative)
  dropCursor() {
    if (!this.cursor) return;
    if (this.game.mode === 'survival') {
      const left = this.game.invAdd(this.cursor.id, this.cursor.count);
      if (left > 0) this.game.toast('Inventar voll — Rest verworfen');
    }
    this.cursor = null;
    this.refreshAllGrids();
  }

  _refreshCursorBar() {
    for (const bar of document.querySelectorAll('.cursor-bar')) {
      if (!this.cursor) { bar.style.display = 'none'; continue; }
      bar.style.display = 'flex';
      this._paintSlot(bar.querySelector('.slot'), this.cursor);
      bar.querySelector('.cnt').textContent = this.cursor.count > 1 ? this.cursor.count : '';
      bar.querySelector('.cursor-hint').textContent =
        itemName(this.cursor.id) + ' — tippe einen Slot (oder hier zum Ablegen)';
    }
  }

  refreshAllGrids() {
    const invOpen = document.getElementById('inventory').style.display === 'flex';
    const chestOpen = document.getElementById('chest-ui').style.display === 'flex';
    if (invOpen) {
      this._renderGrid(document.getElementById('inv-grid'), 'inv', 9, 36);
      this._renderGrid(document.getElementById('inv-hotbar'), 'inv', 0, 9);
      this.refreshCrafting();
    }
    if (chestOpen) {
      this._renderGrid(document.getElementById('chest-grid'), 'chest', 0, 15);
      this._renderGrid(document.getElementById('chest-inv-grid'), 'inv', 0, 36);
    }
    this._refreshCursorBar();
    this.refreshHotbar();
  }

  // ---------------- inventory & crafting ----------------
  toggleInventory() {
    const el = document.getElementById('inventory');
    const open = el.style.display !== 'flex';
    if (!open) this.dropCursor();
    el.style.display = open ? 'flex' : 'none';
    this.game.paused = open || document.getElementById('pause-menu').style.display === 'flex';
    if (open) {
      this.craftSel = -1;
      this._nearTable = this._checkNearTable();
      this.refreshInventory();
    }
  }

  _checkNearTable() {
    const g = this.game, p = g.player.pos;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    for (let dx = -5; dx <= 5; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++) {
      if (g.world.getBlock(px + dx, py + dy, pz + dz) === B.CRAFT) return true;
    }
    return false;
  }

  refreshInventory() {
    const g = this.game;
    document.getElementById('inv-title').textContent =
      g.mode === 'creative' ? 'Kreativ-Inventar' : 'Inventar';

    // creative palette
    const palWrap = document.getElementById('palette-wrap');
    if (g.mode === 'creative') {
      palWrap.style.display = 'block';
      const pal = document.getElementById('palette-grid');
      pal.innerHTML = '';
      const ids = [...CREATIVE_BLOCKS, B.PICK_DIA, B.SWORD_DIA, B.APPLE, B.BEEF];
      for (const id of ids) {
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = '<div class="icon"></div><div class="cnt"></div>';
        this._paintSlot(s, { id, count: 1 });
        s.addEventListener('pointerdown', e => { e.stopPropagation(); this.tapPalette(id); });
        pal.appendChild(s);
      }
    } else {
      palWrap.style.display = 'none';
    }

    this.refreshAllGrids();
  }

  refreshCrafting() {
    const g = this.game;
    const wrap = document.getElementById('craft-cards');
    const detail = document.getElementById('craft-detail');
    const title = document.getElementById('craft-title');
    if (g.mode === 'creative') {
      wrap.style.display = 'none'; detail.style.display = 'none'; title.style.display = 'none';
      return;
    }
    wrap.style.display = 'grid'; title.style.display = 'block';
    title.textContent = this._nearTable ? 'Handwerk (Werkbank in Reichweite)' : 'Handwerk';
    wrap.innerHTML = '';

    RECIPES.forEach((r, idx) => {
      const locked = !r.basic && !this._nearTable;
      const can = !locked && r.in.every(([id, n]) => g.invCount(id) >= n);
      const card = document.createElement('div');
      card.className = 'craft-card ' + (locked ? 'locked' : (can ? 'ok' : 'miss')) +
        (idx === this.craftSel ? ' picked' : '');
      card.innerHTML = `<div class="icon" style="background-image:url(${this.atlasUrl});background-position:${tileCss(r.out)}"></div>` +
        (r.n > 1 ? `<div class="cnt">${r.n}</div>` : '') +
        (locked ? '<div class="lock">🔒</div>' : '');
      card.title = itemName(r.out);
      card.addEventListener('pointerdown', e => {
        e.stopPropagation();
        this.craftSel = idx;
        this.refreshCrafting();
      });
      wrap.appendChild(card);
    });

    // detail panel for the selected recipe
    if (this.craftSel < 0 || this.craftSel >= RECIPES.length) {
      detail.style.display = 'none';
      return;
    }
    const r = RECIPES[this.craftSel];
    const locked = !r.basic && !this._nearTable;
    const maxTimes = locked ? 0 :
      Math.min(64, ...r.in.map(([id, n]) => Math.floor(g.invCount(id) / n)));
    detail.style.display = 'block';
    const chips = r.in.map(([id, n]) => {
      const have = g.invCount(id);
      return `<span class="chip ${have >= n ? 'have' : 'lack'}">
        <span class="icon" style="background-image:url(${this.atlasUrl});background-position:${tileCss(id)}"></span>
        ${n}× ${itemName(id)} <small>(${have})</small></span>`;
    }).join('');
    detail.innerHTML = `
      <div class="craft-name"><b>${r.n}× ${itemName(r.out)}</b>${locked ? ' — 🔒 Werkbank benötigt' : ''}</div>
      <div class="chips">${chips}</div>
      <div class="craft-btns">
        <button id="craft-one" ${maxTimes >= 1 ? '' : 'disabled'}>Herstellen</button>
        <button id="craft-max" ${maxTimes >= 2 ? '' : 'disabled'}>Max (${maxTimes})</button>
      </div>`;
    const doCraft = times => {
      for (let t = 0; t < times; t++) {
        if (!r.in.every(([id, n]) => g.invCount(id) >= n)) break;
        for (const [id, n] of r.in) g.invRemove(id, n);
        g.addItem(r.out, r.n);
      }
      g.sound.play('craft');
      this.refreshAllGrids();
    };
    detail.querySelector('#craft-one').addEventListener('pointerdown', e => { e.stopPropagation(); doCraft(1); });
    detail.querySelector('#craft-max').addEventListener('pointerdown', e => { e.stopPropagation(); doCraft(maxTimes); });
  }

  // ---------------- chest ----------------
  openChest(key) {
    const g = this.game;
    this.chestKey = key;
    if (!g.chests.has(key)) g.chests.set(key, new Array(15).fill(null));
    document.getElementById('chest-ui').style.display = 'flex';
    g.paused = true;
    this.refreshAllGrids();
  }

  closeChest() {
    this.dropCursor();
    document.getElementById('chest-ui').style.display = 'none';
    this.chestKey = null;
    this.game.paused = false;
    this.refreshHotbar();
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
    document.querySelectorAll('.cursor-bar').forEach(bar =>
      bar.addEventListener('pointerdown', e => { e.stopPropagation(); this.dropCursor(); }));
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
