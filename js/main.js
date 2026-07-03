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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // the terrain is static, so re-rendering the shadow map every frame is
    // wasted work — refresh it a few times per second instead
    this.renderer.shadowMap.autoUpdate = false;
    this.shadowsOn = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 400);
    this.sound = new Sound();
    this.particles = new Particles(this.scene);
    this.paused = false;
    this.running = false;
    this.renderDist = 4;
    this.timeOfDay = 0.3;               // 0..1 (0.25 = noon-ish morning start)
    this.dayLength = 1200;              // seconds per full day (20 min, like the classics)
    this.weather = { type: 'clear', t: 90 + Math.random() * 90 };
    this.daylight = 1;
    this.inventory = new Map();         // survival: item id -> count
    this.tnt = [];                      // active {x,y,z,t,mesh}
    this.mode = 'survival';
    this.ui = new UI(this);
    this.controls = new Controls(this);
    this._raycaster = new THREE.Raycaster();
    this._setupSky();
    this._setupWeather();
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
    this.scene.fog = new THREE.Fog(0x87ceeb, 30, 120);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    // sun shadows: a tight shadow box that follows the player. A smaller
    // frustum packs the 2048² map into the area right around the player, so
    // shadows are sharp and clearly visible instead of blurred to nothing.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 20; sc.far = 400;
    sc.left = sc.bottom = -48; sc.right = sc.top = 48;
    sc.updateProjectionMatrix();   // required after changing the frustum
    // normalBias offsets along the surface normal — the right tool for blocky
    // geometry; keeps shadows attached to their caster without acne
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.6;
    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.scene.add(this.ambient, this.sun, this.sunTarget);

    // pool of point lights assigned to the nearest glowstone / lava sources
    this.lightPool = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffc27a, 0, 15, 1.7);
      this.scene.add(l);
      this.lightPool.push(l);
    }

    // gradient sky dome (zenith -> horizon), follows the player
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x3878d8) }, bottom: { value: new THREE.Color(0xa9d2f5) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
        void main(){
          float h = clamp(normalize(vP).y, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, pow(h, 0.55)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(340, 24, 12), this.skyMat);
    this.skyDome.renderOrder = -10;
    this.scene.add(this.skyDome);

    // glowing round sun + pale moon on a rotating pivot
    const discTex = (inner, outer, glow) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d');
      const gr = c.createRadialGradient(32, 32, 4, 32, 32, 30);
      gr.addColorStop(0, inner);
      gr.addColorStop(glow, outer);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    this.skyPivot = new THREE.Group();
    const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(46, 46),
      new THREE.MeshBasicMaterial({ map: discTex('rgba(255,250,220,1)', 'rgba(255,214,120,0.85)', 0.42),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sunMesh.position.set(0, 180, 0); sunMesh.rotation.x = Math.PI / 2;
    const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(22, 22),
      new THREE.MeshBasicMaterial({ map: discTex('rgba(228,232,248,1)', 'rgba(190,198,230,0.9)', 0.55),
        transparent: true, depthWrite: false, fog: false }));
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

    // scrolling fluid textures (world-space UVs come from the mesher)
    const fluidTex = kind => {
      const t = new THREE.CanvasTexture(makeFluidCanvas(kind, seed));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    this.waterTex = fluidTex('water');
    this.lavaTex = fluidTex('lava');

    const alphaMat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    // plants wave in the wind: displace cross-quad top vertices (sway=1)
    alphaMat.onBeforeCompile = shader => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = 'attribute float sway;\nuniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.x += sway * sin(uTime * 1.7 + position.x * 0.9 + position.z * 0.7) * 0.075;
         transformed.z += sway * cos(uTime * 1.3 + position.x * 0.7 + position.z * 1.1) * 0.075;`);
      this._alphaShader = shader;
    };
    const mats = {
      opaque: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }),
      alpha: alphaMat,
      water: new THREE.MeshLambertMaterial({ map: this.waterTex, vertexColors: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
      lava: new THREE.MeshBasicMaterial({ map: this.lavaTex, vertexColors: true, side: THREE.DoubleSide }),
    };
    this.world = new World(seed, this.scene, mats);
    this.player = new Player(this.world, this.camera);
    this.mobs = new MobManager(this);
    this._setupPreview(tex);
    this._setupClouds();
    this._setupHand(tex);
    this._setupCrack(tex);
    this._setupAmbient();

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

  // ---------------- build preview (ghost block + selection outline) ----------------
  _setupPreview(tex) {
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.65 }));
    this.outline.visible = false;
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ghost.visible = false;
    this._ghostId = 0;
    this.scene.add(this.outline, this.ghost);
  }

  // rewrite a BoxGeometry's UVs to show atlas tiles (face order +x,-x,+y,-y,+z,-z)
  _setCubeUVs(geometry, tiles) {
    const corner = [[0, 1], [1, 1], [0, 0], [1, 0]];
    const uv = geometry.getAttribute('uv');
    const ts = 1 / ATLAS_TILES;
    for (let f = 0; f < 6; f++) {
      const t = tiles[f];
      const tu = (t % ATLAS_TILES) * ts, tv = 1 - (Math.floor(t / ATLAS_TILES) + 1) * ts;
      for (let v = 0; v < 4; v++) {
        uv.setXY(f * 4 + v, tu + corner[v][0] * ts, tv + corner[v][1] * ts);
      }
    }
    uv.needsUpdate = true;
  }

  _blockTiles(id) {
    const def = BLOCKS[id];
    return [def.tex[2], def.tex[2], def.tex[0], def.tex[1], def.tex[2], def.tex[2]];
  }

  _setGhostTile(id) {
    if (id === this._ghostId) return;
    this._ghostId = id;
    if (BLOCKS[id]) this._setCubeUVs(this.ghost.geometry, this._blockTiles(id));
  }

  updatePreview() {
    const hit = this.raycastScreen(innerWidth / 2, innerHeight / 2);
    if (!hit || this.player.dead) {
      this.outline.visible = false; this.ghost.visible = false;
      return;
    }
    this.outline.visible = true;
    this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    // ghost only when a tap would actually place the selected block here
    const item = this.ui.currentItem();
    const digging = this.controls.digHeld || this.controls.mouseDown;
    let ok = !digging && !!BLOCKS[item] && hit.id !== B.TNT && hit.id !== B.CRAFT;
    const bx = hit.x + hit.nx, by = hit.y + hit.ny, bz = hit.z + hit.nz;
    if (ok) {
      const cur = this.world.getBlock(bx, by, bz);
      ok = by >= 1 && by < HEIGHT &&
        (cur === B.AIR || isFluid(cur) || !!BLOCKS[cur]?.cross) &&
        !(isSolid(item) && this.player.placementBlocked(bx, by, bz)) &&
        (this.mode === 'creative' || (this.inventory.get(item) || 0) > 0);
    }
    if (ok) {
      this._setGhostTile(item);
      this.ghost.position.set(bx + 0.5, by + 0.5, bz + 0.5);
      this.ghost.visible = true;
    } else {
      this.ghost.visible = false;
    }
  }

  // ---------------- first-person hand ----------------
  _setupHand(tex) {
    this.hand = new THREE.Group();
    this.handBlock = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34),
      new THREE.MeshLambertMaterial({ map: tex }));
    this.handItem = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38),
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    this.hand.add(this.handBlock, this.handItem);
    this.hand.position.set(0.42, -0.36, -0.62);
    this.hand.rotation.set(0.1, Math.PI / 7, 0);
    this.camera.add(this.hand);
    this.scene.add(this.camera);
    this._handId = -1;
    this._swingT = 1;
    this._walkT = 0;
  }

  swingHand(force) {
    if (force || this._swingT >= 1) this._swingT = 0;
  }

  updateHand(dt) {
    const id = this.ui.currentItem();
    if (id !== this._handId) {
      this._handId = id;
      if (BLOCKS[id]) {
        this._setCubeUVs(this.handBlock.geometry, this._blockTiles(id));
        this.handBlock.visible = true; this.handItem.visible = false;
      } else if (ITEMS[id]) {
        const t = ITEMS[id].tile, ts = 1 / ATLAS_TILES;
        const tu = (t % ATLAS_TILES) * ts, tv = 1 - (Math.floor(t / ATLAS_TILES) + 1) * ts;
        const corner = [[0, 1], [1, 1], [0, 0], [1, 0]];
        const uv = this.handItem.geometry.getAttribute('uv');
        for (let v = 0; v < 4; v++) uv.setXY(v, tu + corner[v][0] * ts, tv + corner[v][1] * ts);
        uv.needsUpdate = true;
        this.handBlock.visible = false; this.handItem.visible = true;
      } else {
        this.handBlock.visible = false; this.handItem.visible = false;
      }
    }
    // walk bob
    const p = this.player;
    const spd = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && spd > 0.5) this._walkT += dt * spd * 1.7;
    const bobY = Math.sin(this._walkT * 2) * 0.016;
    const bobX = Math.cos(this._walkT) * 0.012;
    // swing (dig / place / attack)
    this._swingT = Math.min(1, this._swingT + dt * 3.5);
    const s = Math.sin(this._swingT * Math.PI);
    this.hand.position.set(0.42 + bobX - s * 0.1, -0.36 + bobY - s * 0.12, -0.62 - s * 0.08);
    this.hand.rotation.set(0.1 - s * 1.1, Math.PI / 7 + s * 0.3, 0);
  }

  // ---------------- crack overlay while digging ----------------
  _setupCrack(tex) {
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.3,
        polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
    this.crack.visible = false;
    this._crackStage = -1;
    this.scene.add(this.crack);
  }

  setCrack(bt) {
    if (!bt || bt.progress <= 0.03) {
      this.crack.visible = false; this._crackStage = -1;
      return;
    }
    const stage = Math.min(3, Math.floor(bt.progress / bt.need * 4));
    if (stage !== this._crackStage) {
      this._crackStage = stage;
      const t = 40 + stage;
      this._setCubeUVs(this.crack.geometry, [t, t, t, t, t, t]);
    }
    this.crack.position.set(bt.hit.x + 0.5, bt.hit.y + 0.5, bt.hit.z + 0.5);
    this.crack.visible = true;
  }

  // ---------------- weather (rain / snow / thunder) ----------------
  _setupWeather() {
    // rain: short vertical line segments falling around the player
    const nR = 280;
    this.rainDrops = new Float32Array(nR * 3);
    for (let i = 0; i < nR; i++) {
      this.rainDrops.set([(Math.random() - 0.5) * 36, Math.random() * 24 - 4, (Math.random() - 0.5) * 36], i * 3);
    }
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nR * 6), 3));
    this.rain = new THREE.LineSegments(rGeo,
      new THREE.LineBasicMaterial({ color: 0x9db8e0, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    // snow: drifting points
    const nS = 350;
    this.snowFlakes = new Float32Array(nS * 3);
    for (let i = 0; i < nS; i++) {
      this.snowFlakes.set([(Math.random() - 0.5) * 36, Math.random() * 24 - 4, (Math.random() - 0.5) * 36], i * 3);
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nS * 3), 3));
    this.snow = new THREE.Points(sGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9 }));
    this.snow.frustumCulled = false; this.snow.visible = false;
    this.scene.add(this.rain, this.snow);
  }

  updateWeather(dt) {
    const w = this.weather;
    w.t -= dt;
    if (w.t <= 0) {
      const r = Math.random();
      const prev = w.type;
      w.type = r < 0.55 ? 'clear' : (r < 0.85 ? 'rain' : 'storm');
      w.t = 90 + Math.random() * 150;
      if (w.type !== 'clear' && prev === 'clear') {
        this.toast(w.type === 'storm' ? 'Ein Gewitter zieht auf …' : 'Es beginnt zu regnen …', 2500);
      }
    }
    // smooth strength for lighting/fog effects
    const target = w.type === 'storm' ? 1 : (w.type === 'rain' ? 0.6 : 0);
    this.rainAmt = (this.rainAmt || 0) + (target - (this.rainAmt || 0)) * Math.min(1, dt * 0.5);

    const biome = this.world.columnInfo(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z)).biome;
    const raining = w.type !== 'clear' && biome !== 'desert' && !this.player.eyeInWater;
    const snowing = raining && biome === 'snow';
    this.rain.visible = raining && !snowing;
    this.snow.visible = snowing;
    if (raining) this._updatePrecip(dt, snowing);

    // thunder flash + boom during storms
    this._flashT = Math.max(0, (this._flashT || 0) - dt);
    if (w.type === 'storm') {
      this._thunderT = (this._thunderT ?? 5) - dt;
      if (this._thunderT <= 0) {
        this._thunderT = 5 + Math.random() * 9;
        this._flashT = 0.22;
        this.sound.play('boom');
      }
    }
  }

  _updatePrecip(dt, snow) {
    const p = this.player.pos;
    if (snow) {
      const attr = this.snow.geometry.getAttribute('position');
      const f = this.snowFlakes;
      const t = performance.now() * 0.001;
      for (let i = 0; i < f.length; i += 3) {
        f[i + 1] -= 3.2 * dt;
        f[i] += Math.sin(t + i) * dt * 0.5;
        if (f[i + 1] < -4) { f[i + 1] = 20; f[i] = (Math.random() - 0.5) * 36; f[i + 2] = (Math.random() - 0.5) * 36; }
        attr.setXYZ(i / 3, f[i], f[i + 1], f[i + 2]);
      }
      attr.needsUpdate = true;
      this.snow.position.copy(p);
    } else {
      const attr = this.rain.geometry.getAttribute('position');
      const d = this.rainDrops;
      for (let i = 0; i < d.length; i += 3) {
        d[i + 1] -= 26 * dt;
        if (d[i + 1] < -4) { d[i + 1] = 20; d[i] = (Math.random() - 0.5) * 36; d[i + 2] = (Math.random() - 0.5) * 36; }
        const v = (i / 3) * 2;
        attr.setXYZ(v, d[i], d[i + 1], d[i + 2]);
        attr.setXYZ(v + 1, d[i], d[i + 1] + 0.65, d[i + 2]);
      }
      attr.needsUpdate = true;
      this.rain.position.copy(p);
    }
  }

  // ---------------- ambient particles (fireflies / leaves / bubbles / splashes) ----------------
  _softDot(rgba) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const c = cv.getContext('2d');
    const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, rgba); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _makePoints(n, mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  _setupAmbient() {
    // fireflies: soft additive glowing dots that drift at night
    this.fireN = 46;
    this.fireData = [];
    this.fireflies = this._makePoints(this.fireN, new THREE.PointsMaterial({
      size: 0.5, map: this._softDot('rgba(190,255,120,1)'), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: true }));
    for (let i = 0; i < this.fireN; i++) this.fireData.push({ x: 0, y: -999, z: 0, ph: Math.random() * 6.28, spawned: false });

    // falling leaves: small drifting quads that spawn under tree canopies
    this.leafN = 40;
    this.leafData = [];
    this.leaves = this._makePoints(this.leafN, new THREE.PointsMaterial({
      size: 0.28, map: this._softDot('rgba(96,150,54,1)'), transparent: true,
      depthWrite: false, sizeAttenuation: true, fog: true }));
    for (let i = 0; i < this.leafN; i++) this.leafData.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vz: 0, ph: 0 });

    // rising bubbles underwater
    this.bubbleN = 30;
    this.bubbleData = [];
    this.bubbles = this._makePoints(this.bubbleN, new THREE.PointsMaterial({
      size: 0.12, map: this._softDot('rgba(220,240,255,1)'), transparent: true,
      opacity: 0.8, depthWrite: false, sizeAttenuation: true, fog: false }));
    for (let i = 0; i < this.bubbleN; i++) this.bubbleData.push({ life: 0, x: 0, y: -999, z: 0 });

    // rain splashes on the ground
    this.splashN = 40;
    this.splashData = [];
    this.splashes = this._makePoints(this.splashN, new THREE.PointsMaterial({
      size: 0.18, map: this._softDot('rgba(160,190,225,1)'), transparent: true,
      opacity: 0.6, depthWrite: false, sizeAttenuation: true, fog: true }));
    for (let i = 0; i < this.splashN; i++) this.splashData.push({ life: 0, x: 0, y: -999, z: 0 });
  }

  updateAmbient(dt) {
    const p = this.player.pos, w = this.world;
    const night = this.daylight < 0.42;
    const raining = (this.rainAmt || 0) > 0.15;
    const biome = w.columnInfo(Math.floor(p.x), Math.floor(p.z)).biome;

    // ---- fireflies (night, not raining, warm biomes) ----
    const fireOn = night && !raining && biome !== 'snow' && biome !== 'desert';
    const fa = this.fireflies.geometry.getAttribute('position');
    const t = performance.now() * 0.001;
    for (let i = 0; i < this.fireN; i++) {
      const f = this.fireData[i];
      if (!fireOn) { fa.setXYZ(i, 0, -999, 0); continue; }
      if (!f.spawned || Math.hypot(f.x - p.x, f.z - p.z) > 26) {
        const a = Math.random() * 6.28, r = 4 + Math.random() * 16;
        f.x = p.x + Math.cos(a) * r; f.z = p.z + Math.sin(a) * r;
        f.y = w.surfaceHeight(Math.floor(f.x), Math.floor(f.z)) + 0.8 + Math.random() * 2.2;
        f.spawned = true;
      }
      f.x += Math.sin(t * 0.7 + f.ph) * dt * 0.5;
      f.z += Math.cos(t * 0.5 + f.ph * 1.7) * dt * 0.5;
      f.y += Math.sin(t * 1.3 + f.ph) * dt * 0.35;
      fa.setXYZ(i, f.x, f.y, f.z);
    }
    fa.needsUpdate = true;
    this.fireflies.material.opacity = fireOn ? 0.6 + 0.4 * Math.sin(t * 3) : 0;
    this.fireflies.material.size = 0.42 + 0.12 * Math.sin(t * 4);

    // ---- falling leaves (day, near tree canopies) ----
    const la = this.leaves.geometry.getAttribute('position');
    this._leafSpawnT = (this._leafSpawnT || 0) - dt;
    const leavesOn = !raining && this.daylight > 0.3;
    if (leavesOn && this._leafSpawnT <= 0) {
      this._leafSpawnT = 0.18;
      for (let tries = 0; tries < 4; tries++) {
        const lx = Math.floor(p.x + (Math.random() - 0.5) * 26);
        const lz = Math.floor(p.z + (Math.random() - 0.5) * 26);
        const top = w.surfaceHeight(lx, lz);
        // is there a leaf block overhead with air below it?
        for (let y = top; y > top - 8 && y > 1; y--) {
          if (w.getBlock(lx, y, lz) === B.LEAVES && w.getBlock(lx, y - 1, lz) === B.AIR) {
            const slot = this.leafData.find(d => d.life <= 0);
            if (slot) {
              slot.life = 4 + Math.random() * 3;
              slot.x = lx + Math.random(); slot.y = y - 0.2; slot.z = lz + Math.random();
              slot.vx = (Math.random() - 0.5) * 0.5; slot.vz = (Math.random() - 0.5) * 0.5;
              slot.ph = Math.random() * 6.28;
            }
            break;
          }
        }
      }
    }
    for (let i = 0; i < this.leafN; i++) {
      const d = this.leafData[i];
      if (d.life <= 0) { la.setXYZ(i, 0, -999, 0); continue; }
      d.life -= dt;
      d.y -= dt * 0.8;
      d.x += (d.vx + Math.sin(t * 2 + d.ph) * 0.4) * dt;
      d.z += (d.vz + Math.cos(t * 1.7 + d.ph) * 0.4) * dt;
      // settle on the ground
      if (d.y <= w.surfaceHeight(Math.floor(d.x), Math.floor(d.z)) + 0.1) d.life = Math.min(d.life, 0.6);
      la.setXYZ(i, d.x, d.y, d.z);
    }
    la.needsUpdate = true;

    // ---- bubbles underwater ----
    const ba = this.bubbles.geometry.getAttribute('position');
    if (this.player.eyeInWater) {
      if (Math.random() < dt * 20) {
        const slot = this.bubbleData.find(d => d.life <= 0);
        if (slot) { slot.life = 1.2; slot.x = p.x + (Math.random() - .5) * 0.8;
          slot.y = p.y + 1.4 + Math.random() * 0.4; slot.z = p.z + (Math.random() - .5) * 0.8; }
      }
    }
    for (let i = 0; i < this.bubbleN; i++) {
      const d = this.bubbleData[i];
      if (d.life <= 0) { ba.setXYZ(i, 0, -999, 0); continue; }
      d.life -= dt; d.y += dt * 1.6; d.x += Math.sin(t * 5 + i) * dt * 0.15;
      ba.setXYZ(i, d.x, d.y, d.z);
    }
    ba.needsUpdate = true;

    // ---- rain splashes on the ground ----
    const sa = this.splashes.geometry.getAttribute('position');
    if (raining && biome !== 'desert' && !this.player.eyeInWater) {
      const spawns = Math.floor(this.rainAmt * 3) + 1;
      for (let k = 0; k < spawns; k++) {
        const slot = this.splashData.find(d => d.life <= 0);
        if (!slot) break;
        const sx = Math.floor(p.x + (Math.random() - 0.5) * 20);
        const sz = Math.floor(p.z + (Math.random() - 0.5) * 20);
        const sy = w.surfaceHeight(sx, sz) + 1;
        slot.life = 0.35; slot.x = sx + Math.random(); slot.y = sy + 0.02; slot.z = sz + Math.random();
      }
    }
    for (let i = 0; i < this.splashN; i++) {
      const d = this.splashData[i];
      if (d.life <= 0) { sa.setXYZ(i, 0, -999, 0); continue; }
      d.life -= dt;
      sa.setXYZ(i, d.x, d.y, d.z);
    }
    sa.needsUpdate = true;
    this.splashes.material.size = 0.1 + 0.2 * (1 - Math.min(1, this.splashData[0] ? this.splashData[0].life / 0.35 : 0));
  }

  // ---------------- block lights (glowstone / lava) ----------------
  updateBlockLights(dt) {
    this._lightT = (this._lightT || 0) - dt;
    if (this._lightT > 0) return;
    this._lightT = 0.3;
    const p = this.player.pos;
    const near = [];
    for (const arr of this.world.lightSources.values()) {
      for (const s of arr) {
        const d2 = (s[0] - p.x) ** 2 + (s[1] - p.y) ** 2 + (s[2] - p.z) ** 2;
        if (d2 < 1600) near.push([d2, s]);
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      if (i < near.length) {
        const s = near[i][1];
        l.position.set(s[0], s[1], s[2]);
        l.color.setHex(s[3] === 1 ? 0xffc27a : 0xff7733);
        l.intensity = s[3] === 1 ? 1.6 : 1.1;
      } else {
        l.intensity = 0;
      }
    }
  }

  applyShadows() {
    this.renderer.shadowMap.enabled = this.shadowsOn;
    this.sun.castShadow = this.shadowsOn;
    this.scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  }

  // ---------------- clouds ----------------
  _setupClouds() {
    this.clouds = new THREE.Group();
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true,
      opacity: 0.5, depthWrite: false, fog: false });
    const rand = mulberry32(4242);
    for (let i = 0; i < 22; i++) {
      // each cloud is a cluster of flat boxes merged into ONE geometry (one draw call)
      const pos = [], norm = [], ind = [];
      const parts = 2 + (rand() * 4) | 0;
      for (let k = 0; k < parts; k++) {
        const box = new THREE.BoxGeometry(8 + rand() * 16, 1.6, 6 + rand() * 12);
        box.translate((rand() - 0.5) * 18, (rand() - 0.5) * 1.5, (rand() - 0.5) * 14);
        const off = pos.length / 3;
        pos.push(...box.getAttribute('position').array);
        norm.push(...box.getAttribute('normal').array);
        for (let j = 0; j < box.index.count; j++) ind.push(box.index.array[j] + off);
        box.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      geo.setIndex(ind);
      const cloud = new THREE.Mesh(geo, this.cloudMat);
      cloud.position.set((rand() - 0.5) * 460, 82 + rand() * 8, (rand() - 0.5) * 460);
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
  }

  updateClouds(dt) {
    const px = this.player.pos.x, pz = this.player.pos.z;
    for (const m of this.clouds.children) {
      m.position.x += dt * 1.6;
      if (m.position.x - px > 230) m.position.x -= 460;
      if (px - m.position.x > 230) m.position.x += 460;
      if (m.position.z - pz > 230) m.position.z -= 460;
      if (pz - m.position.z > 230) m.position.z += 460;
    }
    this.cloudMat.opacity = 0.15 + 0.35 * this.daylight;
  }

  applyFog() {
    const far = this.renderDist * CHUNK;
    this.fogNear = far * 0.6;
    this.fogFar = far * 1.02;
    this.scene.fog.near = this.fogNear;
    this.scene.fog.far = this.fogFar;
    // keep the far plane fixed so sun, moon and stars (radius ~190) never clip
    this.camera.far = 400;
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
    this.world.animateRising(dt);
    this.mobs.update(dt);
    this.particles.update(dt);
    this.updateTnt(dt);
    this.updateWeather(dt);
    this.updateDayNight(dt);
    this.updateBlockLights(dt);
    this.updateAmbient(dt);
    this.updatePreview();
    this.updateClouds(dt);
    this.updateHand(dt);

    // scrolling fluid surfaces + wind time for waving plants
    const tw = t * 0.001;
    this.waterTex.offset.set((tw * 0.03) % 1, (tw * 0.018) % 1);
    this.lavaTex.offset.set((tw * 0.008) % 1, (tw * 0.005) % 1);
    if (this._alphaShader) this._alphaShader.uniforms.uTime.value = tw;

    // subtle FOV boost while sprinting / flying
    const pl = this.player;
    const movingNow = Math.abs(pl.moveX) + Math.abs(pl.moveZ) > 0.1;
    const targetFov = 72 + (pl.sprint && movingNow ? 8 : 0) + (pl.flying ? 5 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    // throttled shadow map refresh (terrain is static, ~9 Hz is plenty and
    // keeps the extra shadow pass affordable on phones). Shadows are only ever
    // turned off by the player via the pause-menu toggle, never automatically.
    if (this.shadowsOn) {
      this._shadowT = (this._shadowT || 0) - dt;
      if (this._shadowT <= 0) { this._shadowT = 0.11; this.renderer.shadowMap.needsUpdate = true; }
    }

    document.getElementById('water-tint').style.display = this.player.eyeInWater ? 'block' : 'none';
    this.ui.refreshStatus();
    const p = this.player.pos;

    // village compass (updated once per second)
    this._villT = (this._villT || 0) - dt;
    if (this._villT <= 0) {
      this._villT = 1;
      const v = this.world.villageNear(p.x, p.z, 350);
      if (v) {
        const dx = v.x - p.x, dz = v.z - p.z;
        const dist = Math.hypot(dx, dz) | 0;
        if (dist <= 28) this._villTxt = '  ·  🏘 Dorf';
        else {
          const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
          const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
          this._villTxt = `  ·  🏘 ${dist}m ${dirs[Math.round(a / 45) % 8]}`;
        }
      } else this._villTxt = '';
    }
    document.getElementById('info-top').textContent =
      `X ${p.x | 0}  Y ${p.y | 0}  Z ${p.z | 0}${this._villTxt || ''}`;

    this.renderer.render(this.scene, this.camera);
  }

  updateDayNight(dt) {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    const ang = this.timeOfDay * Math.PI * 2;      // 0 = dawn, 0.25 = noon
    const sunH = Math.sin(ang);
    this.daylight = Math.max(0, Math.min(1, sunH * 2.2 + 0.15));
    const d = this.daylight;
    const duskAmt = Math.max(0, 1 - Math.abs(sunH) * 5) * 0.6;

    const rainAmt = (this.rainAmt || 0);
    const flash = Math.max(0, (this._flashT || 0)) / 0.22;

    // sky dome gradient: zenith + horizon, tinted warm at dawn/dusk, grey in rain
    const top = new THREE.Color(0x04060f).lerp(new THREE.Color(0x2f74d8), d);
    const bottom = new THREE.Color(0x0b1026).lerp(new THREE.Color(0xaad4f2), d);
    bottom.lerp(new THREE.Color(0xf08a45), duskAmt);
    top.lerp(new THREE.Color(0x5a4a72), duskAmt * 0.4);
    const grey = new THREE.Color(0x6e7d8a);
    top.lerp(grey, rainAmt * 0.5 * Math.max(0.25, d));
    bottom.lerp(grey, rainAmt * 0.55 * Math.max(0.25, d));
    if (flash > 0) { top.lerp(new THREE.Color(0xffffff), flash * 0.7); bottom.lerp(new THREE.Color(0xffffff), flash * 0.7); }
    this.skyMat.uniforms.top.value.copy(top);
    this.skyMat.uniforms.bottom.value.copy(bottom);
    this._skyHorizon = bottom;

    // ambient + real directional sun (terrain has normals, so the sun shades
    // faces by direction and cast shadows clearly darken the ground). Lower
    // ambient = stronger shadow contrast.
    this.ambient.intensity = (0.32 + 0.18 * d) * (1 - rainAmt * 0.28) + flash * 1.6;
    this.sun.intensity = (0.25 + 1.15 * d) * (1 - rainAmt * 0.55);
    this.sun.color.setHex(0xffffff).lerp(new THREE.Color(0xff9b50), duskAmt);
    // clouds react to weather
    this.cloudMat.color.setHex(0xffffff).lerp(grey, rainAmt * 0.8);
    this.stars.material.opacity = (1 - d) * (1 - rainAmt);
    this.stars.visible = d < 0.9 && rainAmt < 0.9;
    const pp = this.player ? this.player.pos : new THREE.Vector3();
    this.stars.position.copy(pp);
    this.skyPivot.position.copy(pp);
    this.skyDome.position.copy(pp);
    this.skyPivot.rotation.z = -ang + Math.PI / 2;

    // sun light + shadow box follow the player. The light MUST sit on the same
    // side as the visible sun disc (skyPivot places it at -cos(ang) in x), or
    // shadows fall toward the sun instead of away from it.
    this.sun.position.set(pp.x - Math.cos(ang) * 120, Math.max(26, sunH * 120), pp.z + 18);
    this.sunTarget.position.copy(pp);

    // fog: dense blue under water, orange in lava, closer in rain, else horizon-coloured
    const fog = this.scene.fog;
    if (this.player && this.player.eyeInWater) {
      fog.color.setHex(0x10306e); fog.near = 1; fog.far = 16;
    } else if (this.player && this.player.eyeInLava) {
      fog.color.setHex(0xd85a10); fog.near = 0.1; fog.far = 3;
    } else {
      fog.color.copy(bottom);
      fog.near = this.fogNear * (1 - rainAmt * 0.25);
      fog.far = this.fogFar * (1 - rainAmt * 0.22);
    }

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
    this.swingHand(true);
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
