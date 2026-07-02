// ---- Main game: setup, loop, day/night, TNT, particles, sound, save/load ----
'use strict';

class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }
  _ac() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  play(kind) {
    if (!this.enabled) return;
    try {
      const ac = this._ac(), t = ac.currentTime;
      const spec = {
        dig:     { f: 180, f2: 90, d: 0.08, type: 'square', g: 0.12 },
        place:   { f: 260, f2: 200, d: 0.07, type: 'square', g: 0.12 },
        jump:    { f: 300, f2: 380, d: 0.06, type: 'sine', g: 0.05 },
        hurt:    { f: 160, f2: 60, d: 0.25, type: 'sawtooth', g: 0.15 },
        hurtmob: { f: 220, f2: 120, d: 0.15, type: 'square', g: 0.1 },
        die:     { f: 200, f2: 40, d: 0.5, type: 'sawtooth', g: 0.15 },
        eat:     { f: 140, f2: 200, d: 0.12, type: 'square', g: 0.1 },
        craft:   { f: 420, f2: 560, d: 0.12, type: 'triangle', g: 0.12 },
        splash:  { f: 500, f2: 100, d: 0.3, type: 'sine', g: 0.08 },
        fuse:    { f: 900, f2: 900, d: 0.25, type: 'sawtooth', g: 0.06 },
        pickup:  { f: 500, f2: 800, d: 0.09, type: 'sine', g: 0.08 },
      }[kind];
      if (spec) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = spec.type;
        o.frequency.setValueAtTime(spec.f, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, spec.f2), t + spec.d);
        g.gain.setValueAtTime(spec.g, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + spec.d);
        o.connect(g); g.connect(ac.destination);
        o.start(t); o.stop(t + spec.d + 0.02);
      } else if (kind === 'boom') {
        const len = 0.6, buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
        const src = ac.createBufferSource(); src.buffer = buf;
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
        const g = ac.createGain(); g.gain.value = 0.5;
        src.connect(f); f.connect(g); g.connect(ac.destination);
        src.start(t);
      }
    } catch (e) { /* audio unavailable */ }
  }
}

class Particles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }
  burst(x, y, z, color, n = 10) {
    const geo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    const mat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x + (Math.random() - .5) * 0.6, y + Math.random() * 0.6, z + (Math.random() - .5) * 0.6);
      const v = new THREE.Vector3((Math.random() - .5) * 4, Math.random() * 4 + 1, (Math.random() - .5) * 4);
      this.scene.add(m);
      this.list.push({ m, v, life: 0.5 + Math.random() * 0.3 });
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.v.y -= 12 * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.life <= 0) {
        this.scene.remove(p.m);
        this.list.splice(i, 1);
      }
    }
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 400);
    this.sound = new Sound();
    this.particles = new Particles(this.scene);
    this.paused = false;
    this.running = false;
    this.renderDist = ('ontouchstart' in window) ? 3 : 3;
    this.timeOfDay = 0.3;               // 0..1 (0.25 = noon-ish morning start)
    this.dayLength = 600;               // seconds per full day
    this.daylight = 1;
    this.inventory = new Map();         // survival: item id -> count
    this.tnt = [];                      // active {x,y,z,t,mesh}
    this.mode = 'survival';
    this.ui = new UI(this);
    this.controls = new Controls(this);
    this._raycaster = new THREE.Raycaster();
    this._setupSky();
    this._resize();
    addEventListener('resize', () => this._resize());
    setInterval(() => { if (this.running && !this.paused) this.save(); }, 30000);
  }

  _resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  _setupSky() {
    this.skyDay = new THREE.Color(0x87ceeb);
    this.skyNight = new THREE.Color(0x0a0e28);
    this.skyDusk = new THREE.Color(0xe8894a);
    this.scene.background = this.skyDay.clone();
    this.scene.fog = new THREE.Fog(0x87ceeb, 30, 120);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.scene.add(this.ambient, this.sun);

    // sun & moon planes attached to camera-following pivot
    this.skyPivot = new THREE.Group();
    const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff4b0, fog: false }));
    sunMesh.position.set(0, 180, 0); sunMesh.rotation.x = Math.PI / 2;
    const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({ color: 0xddddee, fog: false }));
    moonMesh.position.set(0, -180, 0); moonMesh.rotation.x = -Math.PI / 2;
    this.skyPivot.add(sunMesh, moonMesh);
    this.scene.add(this.skyPivot);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const pos = [];
    for (let i = 0; i < 300; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(190);
      pos.push(v.x, Math.abs(v.y), v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, fog: false }));
    this.scene.add(this.stars);
  }

  // ---------------- world start ----------------
  start(seed, mode, save) {
    this.seed = seed;
    this.mode = mode;
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';

    const atlas = buildAtlas(seed);
    const tex = new THREE.CanvasTexture(atlas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.ui.setAtlas(atlas);

    const mats = {
      opaque: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }),
      alpha: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
      water: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
    };
    this.world = new World(seed, this.scene, mats);
    this.player = new Player(this.world, this.camera);
    this.mobs = new MobManager(this);

    if (save) {
      this.mode = save.mode;
      this.timeOfDay = save.time ?? 0.3;
      for (const [k, v] of Object.entries(save.edits || {})) this.world.edits.set(k, v);
      for (const [k, v] of Object.entries(save.inv || {})) this.inventory.set(+k, v);
      if (save.hotbar) this.ui.hotbar = save.hotbar;
      if (save.pos) this.player.pos.set(save.pos[0], save.pos[1], save.pos[2]);
      if (save.look) { this.player.yaw = save.look[0]; this.player.pitch = save.look[1]; }
      if (save.hp != null) this.player.health = save.hp;
      if (save.hunger != null) this.player.hunger = save.hunger;
    } else {
      // find a dry spawn
      let sx = 0, sz = 0;
      for (let i = 0; i < 60; i++) {
        const h = this.world.surfaceHeight(sx, sz);
        if (h > WATER_Y) break;
        sx += 12;
      }
      const sy = this.world.surfaceHeight(sx, sz) + 1;
      this.player.pos.set(sx + 0.5, sy + 0.5, sz + 0.5);
      this.spawnPoint = [sx + 0.5, sy + 0.5, sz + 0.5];
    }
    this.spawnPoint = this.spawnPoint || [this.player.pos.x, this.player.pos.y, this.player.pos.z];
    this.applyFog();
    this.ui.refreshHotbar();

    // progressive pre-load, then start loop
    const total = (this.renderDist * 2 + 1) ** 2;
    const loadStep = () => {
      this.world.update(this.player.pos.x, this.player.pos.z, this.renderDist, 3);
      const missing = this.world.countMissing(this.player.pos.x, this.player.pos.z, this.renderDist);
      document.getElementById('loadbar').style.width = ((1 - missing / total) * 100) + '%';
      if (missing > 0) { requestAnimationFrame(loadStep); return; }
      document.getElementById('loading').style.display = 'none';
      this.running = true;
      this.lastT = performance.now();
      requestAnimationFrame(t => this.loop(t));
    };
    loadStep();
  }

  applyFog() {
    const far = this.renderDist * CHUNK;
    this.scene.fog.near = far * 0.55;
    this.scene.fog.far = far * 1.05;
    this.camera.far = far * 3;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- main loop ----------------
  loop(t) {
    if (!this.running) return;
    requestAnimationFrame(tt => this.loop(tt));
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.paused) return;

    this.controls.update(dt);
    this.player.update(dt, this);
    this.world.update(this.player.pos.x, this.player.pos.z, this.renderDist, 1);
    this.mobs.update(dt);
    this.particles.update(dt);
    this.updateTnt(dt);
    this.updateDayNight(dt);

    document.getElementById('water-tint').style.display = this.player.eyeInWater ? 'block' : 'none';
    this.ui.refreshStatus();
    const p = this.player.pos;
    document.getElementById('info-top').textContent =
      `X ${p.x | 0}  Y ${p.y | 0}  Z ${p.z | 0}`;

    this.renderer.render(this.scene, this.camera);
  }

  updateDayNight(dt) {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    const ang = this.timeOfDay * Math.PI * 2;      // 0 = dawn, 0.25 = noon
    const sunH = Math.sin(ang);
    this.daylight = Math.max(0, Math.min(1, sunH * 2.2 + 0.15));
    const d = this.daylight;

    const sky = this.skyNight.clone().lerp(this.skyDay, d);
    const duskAmt = Math.max(0, 1 - Math.abs(sunH) * 5) * 0.55;
    sky.lerp(this.skyDusk, duskAmt);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);

    this.ambient.intensity = 0.35 + 0.5 * d;
    this.sun.intensity = 0.15 + 0.9 * d;
    this.sun.position.set(Math.cos(ang) * 100, Math.sin(ang) * 100, 40);
    this.stars.material.opacity = 1 - d;
    this.stars.visible = d < 0.9;
    this.stars.position.copy(this.player ? this.player.pos : new THREE.Vector3());
    this.skyPivot.position.copy(this.player ? this.player.pos : new THREE.Vector3());
    this.skyPivot.rotation.z = -ang + Math.PI / 2;

    const mins = ((this.timeOfDay * 24 + 6) % 24);
    const hh = String(mins | 0).padStart(2, '0');
    const mm = String(((mins % 1) * 60) | 0).padStart(2, '0');
    document.getElementById('clock').textContent =
      `🕐 ${hh}:${mm} ${d < 0.25 ? '🌙' : '☀'}`;
  }

  // ---------------- interactions ----------------
  raycastScreen(sx, sy) {
    const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);
    const dir = this._raycaster.ray.direction;
    return this.player.raycast(this.camera.position.clone(), dir, 6);
  }

  // Short tap / right-click: attack mob, use block, place block, or eat
  tapAction(sx, sy) {
    if (this.paused || this.player.dead) return;
    const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);

    // 1) mob in reach? -> attack
    const mob = this.mobs.raycastMob(this._raycaster);
    if (mob) { mob.hurt(5, this.player.pos); return; }

    const item = this.ui.currentItem();

    // 2) food? -> eat
    if (ITEMS[item] && ITEMS[item].food) {
      if (this.mode !== 'survival') return;
      if ((this.inventory.get(item) || 0) <= 0) return;
      if (this.player.hunger >= 19.5) { this.toast('Nicht hungrig'); return; }
      this.inventory.set(item, this.inventory.get(item) - 1);
      this.player.hunger = Math.min(20, this.player.hunger + ITEMS[item].food);
      this.sound.play('eat');
      this.ui.refreshHotbar();
      return;
    }

    const hit = this.raycastScreen(sx, sy);
    if (!hit) return;

    // 3) special blocks
    if (hit.id === B.TNT) { this.igniteTnt(hit.x, hit.y, hit.z); return; }
    if (hit.id === B.CRAFT) { this.ui.toggleInventory(); return; }

    // 4) place block
    if (!BLOCKS[item]) return;
    const bx = hit.x + hit.nx, by = hit.y + hit.ny, bz = hit.z + hit.nz;
    if (by < 1 || by >= HEIGHT) return;
    const cur = this.world.getBlock(bx, by, bz);
    if (cur !== B.AIR && !isFluid(cur) && !BLOCKS[cur]?.cross) return;
    if (isSolid(item) && this.player.placementBlocked(bx, by, bz)) return;
    if (this.mode === 'survival') {
      const have = this.inventory.get(item) || 0;
      if (have <= 0) { this.toast('Kein ' + itemName(item) + ' im Inventar'); return; }
      this.inventory.set(item, have - 1);
    }
    this.world.setBlock(bx, by, bz, item);
    this.sound.play('place');
    this.ui.refreshHotbar();
  }

  breakBlock(hit) {
    const def = BLOCKS[hit.id];
    if (!def) return;
    if (def.hard === Infinity && this.mode === 'survival') return;
    this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
    this.sound.play('dig');
    // particle color from block
    const cols = { [B.GRASS]: 0x6aa040, [B.SAND]: 0xdbcfa3, [B.STONE]: 0x7f7f7f, [B.LOG]: 0x675231, [B.LEAVES]: 0x3a8428 };
    this.particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, cols[hit.id] ?? 0x9a8866, 8);

    if (this.mode === 'survival') {
      let drop = 'drops' in def ? def.drops : hit.id;
      if (drop === 'leaves') drop = Math.random() < 0.08 ? B.APPLE : null;
      if (drop != null) {
        this.addItem(drop, 1);
        this.sound.play('pickup');
      }
    }
    this.ui.refreshHotbar();
  }

  addItem(id, n) {
    this.inventory.set(id, (this.inventory.get(id) || 0) + n);
    // auto-assign to a free hotbar slot if not present
    if (!this.ui.hotbar.includes(id)) {
      const free = this.ui.hotbar.findIndex(s => !s || (this.mode === 'survival' && !(this.inventory.get(s) > 0) && !ITEMS[s]));
      if (free >= 0) this.ui.hotbar[free] = id;
    }
    this.ui.refreshHotbar();
  }

  // ---------------- TNT ----------------
  igniteTnt(x, y, z) {
    this.world.setBlock(x, y, z, B.AIR);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98),
      new THREE.MeshBasicMaterial({ color: 0xff4433 }));
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(mesh);
    this.tnt.push({ x, y, z, t: 1.8, mesh });
    this.sound.play('fuse');
  }

  updateTnt(dt) {
    for (let i = this.tnt.length - 1; i >= 0; i--) {
      const t = this.tnt[i];
      t.t -= dt;
      t.mesh.material.color.setHex((t.t * 6 | 0) % 2 ? 0xffffff : 0xff4433);
      if (t.t <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.tnt.splice(i, 1);
        this.explode(t.x + 0.5, t.y + 0.5, t.z + 0.5, 4);
      }
    }
  }

  explode(cx, cy, cz, r) {
    this.sound.play('boom');
    this.particles.burst(cx, cy, cz, 0xff8833, 30);
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(HEIGHT - 1, cy + r); y++)
        for (let z = Math.floor(cz - r); z <= cz + r; z++) {
          const d2 = (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 + (z + .5 - cz) ** 2;
          if (d2 > r * r) continue;
          const id = this.world.getBlock(x, y, z);
          if (id === B.AIR || id === B.BEDROCK || isFluid(id)) continue;
          if (id === B.TNT) { this.igniteTnt(x, y, z); continue; }
          this.world.setBlock(x, y, z, B.AIR);
        }
    // player damage
    const pd = this.player.pos.distanceTo(new THREE.Vector3(cx, cy, cz));
    if (pd < r * 2 && this.mode === 'survival') {
      this.damagePlayer(Math.ceil((1 - pd / (r * 2)) * 14), 'Explosion');
    }
    // mob damage
    for (const m of this.mobs.mobs) {
      const md = m.pos.distanceTo(new THREE.Vector3(cx, cy, cz));
      if (md < r * 2) m.hurt(Math.ceil((1 - md / (r * 2)) * 14), new THREE.Vector3(cx, cy, cz));
    }
  }

  // ---------------- health ----------------
  damagePlayer(dmg, cause) {
    if (this.mode !== 'survival' || this.player.dead) return;
    this.player.health -= dmg;
    this.sound.play('hurt');
    const fl = document.getElementById('damage-flash');
    fl.style.display = 'block';
    setTimeout(() => fl.style.display = 'none', 150);
    if (this.player.health <= 0) {
      this.player.health = 0;
      this.player.dead = true;
      this.ui.showDeath('Todesursache: ' + cause);
    }
  }

  respawn() {
    const p = this.player;
    p.dead = false;
    p.health = p.maxHealth;
    p.hunger = 20; p.air = 10;
    p.vel.set(0, 0, 0);
    p.pos.set(this.spawnPoint[0], this.spawnPoint[1], this.spawnPoint[2]);
    this.ui.hideDeath();
  }

  // ---------------- persistence ----------------
  save() {
    if (!this.world) return;
    try {
      const save = {
        seed: this.seed, mode: this.mode, time: this.timeOfDay,
        edits: Object.fromEntries(this.world.edits),
        inv: Object.fromEntries(this.inventory),
        hotbar: this.ui.hotbar,
        pos: [this.player.pos.x, this.player.pos.y, this.player.pos.z],
        look: [this.player.yaw, this.player.pitch],
        hp: this.player.health, hunger: this.player.hunger,
      };
      localStorage.setItem('blockwelt_save', JSON.stringify(save));
    } catch (e) { console.warn('Speichern fehlgeschlagen', e); }
  }

  toast(msg, dur = 1500) {
    const el = document.getElementById('msg-toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.style.display = 'none', dur);
  }
}

// ---- boot ----
window.game = new Game();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
