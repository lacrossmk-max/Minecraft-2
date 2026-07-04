// ---- World: chunk generation, storage, meshing ----
'use strict';

const CHUNK = 16, HEIGHT = 64, WATER_Y = 27, VCELL = 144;

// baked face shades are soft now — real per-face normals let the sun
// differentiate the sides dynamically through the day
const FACES = [
  { dir: [1, 0, 0], shade: 0.84, texIdx: 2,
    corners: [{ pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [-1, 0, 0], shade: 0.84, texIdx: 2,
    corners: [{ pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [0, 1, 0], shade: 1.0, texIdx: 0,
    corners: [{ pos: [0, 1, 1], uv: [0, 0] }, { pos: [1, 1, 1], uv: [1, 0] }, { pos: [0, 1, 0], uv: [0, 1] }, { pos: [1, 1, 0], uv: [1, 1] }] },
  { dir: [0, -1, 0], shade: 0.55, texIdx: 1,
    corners: [{ pos: [0, 0, 0], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [1, 1] }] },
  { dir: [0, 0, 1], shade: 0.92, texIdx: 2,
    corners: [{ pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
  { dir: [0, 0, -1], shade: 0.92, texIdx: 2,
    corners: [{ pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
];

class World {
  constructor(seed, scene, materials) {
    this.seed = seed;
    this.scene = scene;
    this.mats = materials; // {opaque, alpha, water}
    this.noise = new Perlin(seed);
    this.noiseCave = new Perlin(seed ^ 0x5CA7E);
    this.chunks = new Map();   // "cx,cz" -> Uint8Array
    this.meshes = new Map();   // "cx,cz" -> {opaque, alpha, water}
    this.dirty = new Set();    // chunk keys needing remesh
    this.edits = new Map();    // "x,y,z" -> block id (player modifications)
    this.lightSources = new Map();  // chunk key -> [[x,y,z,type], ...]
    this.everMeshed = new Set();    // chunks that were meshed at least once
    this.rising = [];               // freshly loaded chunks animating in
    this._villageCache = new Map();
    this.emitters = new Map();      // chunk key -> [[wx,y,wz,level], ...] (light emitters)
  }

  // block-light emission level of a block id
  static emitLevel(id, above) {
    if (id === B.TORCH) return 14;
    if (id === B.GLOWSTONE) return 15;
    if (id === B.LAVA && above === B.AIR) return 10;   // only lava surfaces
    return 0;
  }

  // cached list of light emitters in a chunk
  getEmitters(cx, cz) {
    const k = this.key(cx, cz);
    let e = this.emitters.get(k);
    if (e) return e;
    const data = this.ensureChunk(cx, cz);
    e = [];
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let y = 0; y < HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const id = data[this.idx(lx, y, lz)];
      if (id !== B.TORCH && id !== B.GLOWSTONE && id !== B.LAVA) continue;
      const above = y + 1 < HEIGHT ? data[this.idx(lx, y + 1, lz)] : B.AIR;
      const lvl = World.emitLevel(id, above);
      if (lvl && e.length < 80) e.push([x0 + lx, y, z0 + lz, lvl]);
    }
    this.emitters.set(k, e);
    return e;
  }

  key(cx, cz) { return cx + ',' + cz; }
  idx(x, y, z) { return x + z * CHUNK + y * CHUNK * CHUNK; }

  // ---------- terrain ----------
  columnInfo(x, z) {
    const n = this.noise;
    const cont = n.fbm2(x * 0.0035, z * 0.0035, 4);          // continents / mountains
    const hills = n.fbm2(x * 0.02 + 100, z * 0.02 + 100, 3);
    const temp = n.fbm2(x * 0.0028 + 900, z * 0.0028 + 900, 2);
    const moist = n.fbm2(x * 0.0028 - 700, z * 0.0028 - 700, 2);
    let h = 30 + cont * 16 + hills * 7;
    if (cont > 0.32) h += (cont - 0.32) * 55;                // mountains
    h = Math.max(5, Math.min(HEIGHT - 8, h)) | 0;
    let biome = 'plains';
    if (temp > 0.28 && moist < 0.05) biome = 'desert';
    else if (temp < -0.3 || h > 46) biome = 'snow';
    else if (moist > 0.12) biome = 'forest';
    return { h, biome };
  }

  isCave(x, y, z) {
    if (y <= 2) return false;
    // lower threshold = more caves; surface breaches act as entrances
    return this.noiseCave.noise3(x * 0.085, y * 0.11, z * 0.085) > 0.545;
  }

  // ---------- villages ----------
  // deterministic village per grid cell (VCELL x VCELL blocks), on flat-ish land
  villageInfo(cellX, cellZ) {
    const ck = cellX + ',' + cellZ;
    if (this._villageCache.has(ck)) return this._villageCache.get(ck);
    let v = null;
    const r = hash2(cellX * 7 + 3, cellZ * 11 - 5, this.seed ^ 0x51A11);
    if (r < 0.42) {
      const jx = hash2(cellX * 13, cellZ * 17, this.seed ^ 0xABC);
      const jz = hash2(cellX * 19, cellZ * 23, this.seed ^ 0xDEF);
      const cx = cellX * VCELL + 30 + Math.floor(jx * (VCELL - 60));
      const cz = cellZ * VCELL + 30 + Math.floor(jz * (VCELL - 60));
      const { h, biome } = this.columnInfo(cx, cz);
      if (h > WATER_Y + 1 && h < 44 && (biome === 'plains' || biome === 'forest')) {
        const huts = [];
        const n = 3 + Math.floor(hash2(cx, cz, this.seed ^ 7) * 3);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + hash2(cx + i, cz - i, this.seed) * 1.2;
          const dist = 10 + hash2(cx - i, cz + i, this.seed ^ 3) * 12;
          const hx = Math.round(cx + Math.cos(a) * dist);
          const hz = Math.round(cz + Math.sin(a) * dist);
          const hi = this.columnInfo(hx, hz);
          if (hi.h > WATER_Y && Math.abs(hi.h - h) <= 5) {
            const hr = hash2(hx * 3 + 1, hz * 5 - 2, this.seed ^ 0xF00D);
            const hs = hash2(hx * 7 - 4, hz * 3 + 9, this.seed ^ 0xBEEF);
            huts.push({ x: hx, z: hz, y: hi.h + 1,
              rot: (hr * 4) | 0,                              // door faces a random side
              style: hs < 0.16 ? 2 : (hs < 0.55 ? 1 : 0) });  // wood / cobble / brick
          }
        }
        if (huts.length >= 2) v = { x: cx, z: cz, y: h + 1, huts };
      }
    }
    this._villageCache.set(ck, v);
    return v;
  }

  villageNear(x, z, maxDist) {
    const cX = Math.floor(x / VCELL), cZ = Math.floor(z / VCELL);
    let best = null, bestD = maxDist;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const v = this.villageInfo(cX + dx, cZ + dz);
      if (!v) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bestD) { best = v; bestD = d; }
    }
    return best;
  }

  treeAt(x, z) {
    const { h, biome } = this.columnInfo(x, z);
    if (h <= WATER_Y || this.isCave(x, h, z)) return null;
    const r = hash2(x, z, this.seed);
    if (biome === 'forest' && r < 0.022) return { x, z, h, kind: 'tree', r };
    if (biome === 'plains' && r < 0.004) return { x, z, h, kind: 'tree', r };
    if (biome === 'snow' && r < 0.008) return { x, z, h, kind: 'tree', r };
    if (biome === 'desert' && r < 0.006) return { x, z, h, kind: 'cactus', r };
    return null;
  }

  genChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;

    for (let lx = 0; lx < CHUNK; lx++) for (let lz = 0; lz < CHUNK; lz++) {
      const x = x0 + lx, z = z0 + lz;
      const { h, biome } = this.columnInfo(x, z);
      const beach = h <= WATER_Y + 1;
      for (let y = 0; y < HEIGHT; y++) {
        let id = B.AIR;
        if (y === 0) id = B.BEDROCK;
        else if (y <= h) {
          if (this.isCave(x, y, z)) {
            id = y < 9 ? B.LAVA : B.AIR;
          } else if (y === h) {
            if (biome === 'desert' || beach) id = B.SAND;
            else if (biome === 'snow') id = B.SNOWGRASS;
            else id = B.GRASS;
          } else if (y >= h - 3) {
            id = (biome === 'desert' || beach) ? B.SAND : B.DIRT;
          } else {
            id = B.STONE;
            const r = hash3(x, y, z, this.seed);
            if (r < 0.0016 && y < 14) id = B.DIAMOND;
            else if (r < 0.005 && y < 22) id = B.GOLD;
            else if (r < 0.012 && y < 34) id = B.IRON;
            else if (r < 0.024 && y < 44) id = B.COAL;
            else if (r > 0.99) id = B.GRAVEL;
          }
        } else if (y <= WATER_Y) {
          id = B.WATER;
        }
        if (id) data[this.idx(lx, y, lz)] = id;
      }

      // small plants (single column, no cross-chunk writes)
      const { h: hh } = { h };
      if (hh > WATER_Y && hh + 1 < HEIGHT && data[this.idx(lx, hh, lz)] === B.GRASS) {
        const r = hash2(x * 3 + 11, z * 3 - 7, this.seed);
        if (r < 0.012) data[this.idx(lx, hh + 1, lz)] = B.FLOWER;
        else if (r < 0.09) data[this.idx(lx, hh + 1, lz)] = B.TALLGRASS;
      }
    }

    // trees & cacti — scan a border so trees from neighbours reach into this chunk
    for (let tx = x0 - 3; tx < x0 + CHUNK + 3; tx++) {
      for (let tz = z0 - 3; tz < z0 + CHUNK + 3; tz++) {
        const t = this.treeAt(tx, tz);
        if (!t) continue;
        const put = (wx, wy, wz, id, keep) => {
          if (wy < 1 || wy >= HEIGHT) return;
          const lx = wx - x0, lz = wz - z0;
          if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) return;
          const i = this.idx(lx, wy, lz);
          if (keep && data[i] !== B.AIR) return;
          data[i] = id;
        };
        if (t.kind === 'cactus') {
          const ch = 2 + ((t.r * 1000) | 0) % 2;
          for (let dy = 1; dy <= ch; dy++) put(t.x, t.h + dy, t.z, B.CACTUS);
        } else {
          const th = 4 + ((t.r * 1000) | 0) % 3;
          for (let dy = th - 2; dy <= th; dy++) {
            const rad = dy === th ? 1 : 2;
            for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
              if (dy === th && Math.abs(dx) + Math.abs(dz) > 1) continue;
              put(t.x + dx, t.h + dy, t.z + dz, B.LEAVES, true);
            }
          }
          put(t.x, t.h + th + 1, t.z, B.LEAVES, true);
          for (let dy = 1; dy <= th; dy++) put(t.x, t.h + dy, t.z, B.LOG);
        }
      }
    }

    // villages: build huts that overlap this chunk
    const putV = (wx, wy, wz, id, onlyAir) => {
      if (wy < 1 || wy >= HEIGHT) return;
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) return;
      const i = this.idx(lx, wy, lz);
      if (onlyAir && data[i] !== B.AIR) return;
      data[i] = id;
    };
    const c0x = Math.floor((x0 - 24) / VCELL), c1x = Math.floor((x0 + CHUNK + 24) / VCELL);
    const c0z = Math.floor((z0 - 24) / VCELL), c1z = Math.floor((z0 + CHUNK + 24) / VCELL);
    for (let vcx = c0x; vcx <= c1x; vcx++) for (let vcz = c0z; vcz <= c1z; vcz++) {
      const v = this.villageInfo(vcx, vcz);
      if (!v) continue;
      for (const hut of v.huts) {
        const { x: hx, y: hy, z: hz, rot, style } = hut;      // hy = interior floor level
        // building material sets per style: wood / cobblestone / brick
        const wallMat = style === 2 ? B.BRICK : (style === 1 ? B.COBBLE : B.PLANKS);
        const roofMat = style === 0 ? B.COBBLE : B.PLANKS;
        const [ddx, ddz] = [[0, 1], [1, 0], [0, -1], [-1, 0]][rot];  // door direction

        // flatten a 7x7 apron so doors are never buried by terrain
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
          const inner = Math.abs(dx) <= 2 && Math.abs(dz) <= 2;
          putV(hx + dx, hy - 1, hz + dz, inner ? B.PLANKS : B.GRASS);
          for (let f = 2; f <= 6; f++) putV(hx + dx, hy - f, hz + dz, B.DIRT, true);
          for (let wy = hy; wy <= hy + 5; wy++) putV(hx + dx, wy, hz + dz, B.AIR);
        }
        // walls, door, windows
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          putV(hx + dx, hy + 3, hz + dz, roofMat);            // roof
          const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          if (!edge) continue;
          const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
          for (let wy = hy; wy <= hy + 2; wy++) {
            if (dx === ddx * 2 && dz === ddz * 2 && wy <= hy + 1) continue;   // door opening
            if (wy === hy + 1 && !corner && (dx === 0 || dz === 0) && !(dx === ddx * 2 && dz === ddz * 2)) {
              putV(hx + dx, wy, hz + dz, B.GLASS); continue;  // window on each other side
            }
            putV(hx + dx, wy, hz + dz, corner ? B.LOG : wallMat);
          }
        }
        putV(hx - ddx * 1 - (ddz !== 0 ? 1 : 0), hy, hz - ddz * 1 - (ddx !== 0 ? 1 : 0), B.CRAFT);
        putV(hx, hy + 3, hz, B.GLOWSTONE);                    // roof-centre lamp
        // lantern post beside the door path
        const px2 = hx + ddx * 3 - ddz, pz2 = hz + ddz * 3 - ddx;
        putV(px2, hy, pz2, B.LOG); putV(px2, hy + 1, pz2, B.LOG);
        putV(px2, hy + 2, pz2, B.GLOWSTONE);
      }
      // village well at the centre
      {
        const { x: wxc, z: wzc, y: wy } = v;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          for (let f = 1; f <= 5; f++) putV(wxc + dx, wy - f, wzc + dz, B.COBBLE, true);
          putV(wxc + dx, wy - 1, wzc + dz, B.COBBLE);
          const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
          putV(wxc + dx, wy, wzc + dz, edge ? B.COBBLE : B.WATER);
          for (let cy = wy + 1; cy <= wy + 3; cy++) putV(wxc + dx, cy, wzc + dz, B.AIR);
        }
      }
    }

    // apply player edits
    for (const [k, id] of this.edits) {
      const [ex, ey, ez] = k.split(',').map(Number);
      const lx = ex - x0, lz = ez - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && ey >= 0 && ey < HEIGHT) {
        data[this.idx(lx, ey, lz)] = id;
      }
    }
    return data;
  }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) { c = this.genChunk(cx, cz); this.chunks.set(k, c); }
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.ensureChunk(cx, cz);
    return c[this.idx(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  setBlock(x, y, z, id, recordEdit = true) {
    if (y < 1 || y >= HEIGHT) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const old = c[this.idx(lx, y, lz)];
    c[this.idx(lx, y, lz)] = id;
    if (recordEdit) this.edits.set(x + ',' + y + ',' + z, id);
    this.emitters.delete(this.key(cx, cz));

    // block light travels up to 14 blocks: when a light source changes, or any
    // block changes while emitters are nearby, the whole 3x3 needs a remesh
    const emits = i => i === B.TORCH || i === B.GLOWSTONE || i === B.LAVA;
    let lightNearby = emits(old) || emits(id);
    if (!lightNearby) {
      outer: for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (this.getEmitters(cx + dx, cz + dz).length) { lightNearby = true; break outer; }
      }
    }
    if (lightNearby) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (this.meshes.has(this.key(cx + dx, cz + dz)) || (dx === 0 && dz === 0)) {
          this.dirty.add(this.key(cx + dx, cz + dz));
        }
      }
      return;
    }
    this.dirty.add(this.key(cx, cz));
    if (lx === 0) this.dirty.add(this.key(cx - 1, cz));
    if (lx === CHUNK - 1) this.dirty.add(this.key(cx + 1, cz));
    if (lz === 0) this.dirty.add(this.key(cx, cz - 1));
    if (lz === CHUNK - 1) this.dirty.add(this.key(cx, cz + 1));
  }

  // ---------- meshing ----------
  buildMesh(cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    this.ensureChunk(cx, cz);
    this.ensureChunk(cx - 1, cz); this.ensureChunk(cx + 1, cz);
    this.ensureChunk(cx, cz - 1); this.ensureChunk(cx, cz + 1);

    const geo = { opaque: this._newGeoAcc(), alpha: this._newGeoAcc(), water: this._newGeoAcc(), lava: this._newGeoAcc() };
    const ts = 1 / ATLAS_TILES;
    const AO_LEVELS = [1.0, 0.8, 0.64, 0.5];

    // ---- block light: flood-fill from torches/glowstone/lava into a padded
    // volume (14 = max light range), then bake per-vertex light levels ----
    const PADL = 14, LSX = CHUNK + 2 * PADL;
    if (!this._lightBuf) {
      this._lightBuf = new Uint8Array(LSX * LSX * HEIGHT);
      this._lightQ = new Int32Array(LSX * LSX * HEIGHT);
    }
    const light = this._lightBuf;
    light.fill(0);
    const lx0 = x0 - PADL, lz0 = z0 - PADL;
    const lidx = (lx, y, lz) => (lx * LSX + lz) * HEIGHT + y;
    const Q = this._lightQ;
    let qh = 0, qt = 0;
    for (let dcx = -1; dcx <= 1; dcx++) for (let dcz = -1; dcz <= 1; dcz++) {
      for (const [ex, ey, ez, lvl] of this.getEmitters(cx + dcx, cz + dcz)) {
        const llx = ex - lx0, llz = ez - lz0;
        if (llx < 0 || llx >= LSX || llz < 0 || llz >= LSX) continue;
        const li = lidx(llx, ey, llz);
        if (light[li] < lvl) { light[li] = lvl; Q[qt++] = li; }
      }
    }
    while (qh < qt) {
      const li = Q[qh++];
      const lvl = light[li];
      if (lvl <= 1) continue;
      const y = li % HEIGHT, rest = (li - y) / HEIGHT;
      const llz = rest % LSX, llx = (rest - llz) / LSX;
      for (const [ddx, ddy, ddz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const nx = llx + ddx, ny = y + ddy, nz = llz + ddz;
        if (nx < 0 || nx >= LSX || nz < 0 || nz >= LSX || ny < 0 || ny >= HEIGHT) continue;
        const ni = lidx(nx, ny, nz);
        if (light[ni] >= lvl - 1) continue;
        if (isOpaque(this.getBlock(lx0 + nx, ny, lz0 + nz))) continue;
        light[ni] = lvl - 1;
        Q[qt++] = ni;
      }
    }
    const getLight = (wx, y, wz) => {
      const llx = wx - lx0, llz = wz - lz0;
      if (llx < 0 || llx >= LSX || llz < 0 || llz >= LSX || y < 0 || y >= HEIGHT) return 0;
      return light[lidx(llx, y, llz)];
    };

    // per-vertex ambient occlusion + smooth block light: both sample the two
    // side neighbours and the corner neighbour in the layer the face looks into
    const cornerData = (face, wx, ly, wz, aoOut, blOut) => {
      const d = face.dir;
      const axisN = d[0] !== 0 ? 0 : (d[1] !== 0 ? 1 : 2);
      const a1 = (axisN + 1) % 3, a2 = (axisN + 2) % 3;
      const bx = wx + d[0], by = ly + d[1], bz = wz + d[2];
      const baseL = getLight(bx, by, bz);
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i];
        const cu = c.pos[a1] ? 1 : -1, cv = c.pos[a2] ? 1 : -1;
        const p1 = [bx, by, bz]; p1[a1] += cu;
        const p2 = [bx, by, bz]; p2[a2] += cv;
        const pc = [bx, by, bz]; pc[a1] += cu; pc[a2] += cv;
        const s1 = isOpaque(this.getBlock(p1[0], p1[1], p1[2])) ? 1 : 0;
        const s2 = isOpaque(this.getBlock(p2[0], p2[1], p2[2])) ? 1 : 0;
        const cc = isOpaque(this.getBlock(pc[0], pc[1], pc[2])) ? 1 : 0;
        aoOut[i] = AO_LEVELS[(s1 && s2) ? 3 : s1 + s2 + cc];
        // average light over the 4 cells touching this vertex = smooth lighting
        const l = (baseL + getLight(p1[0], p1[1], p1[2]) + getLight(p2[0], p2[1], p2[2]) +
                   getLight(pc[0], pc[1], pc[2])) / 4;
        blOut[i] = Math.pow(l / 15, 1.3);
      }
    };

    const aoBuf = [1, 1, 1, 1], blBuf = [0, 0, 0, 0];
    // inset UVs by half a texel so neighbouring atlas tiles never bleed in
    const PAD = 1 / (ATLAS_TILES * TILE * 2), tsi = ts - 2 * PAD;
    const pushFace = (acc, face, x, y, z, tile, shade, opts = {}) => {
      const base = acc.pos.length / 3;
      const tu = (tile % ATLAS_TILES) * ts + PAD, tv = 1 - (Math.floor(tile / ATLAS_TILES) + 1) * ts + PAD;
      const ao = opts.ao || null;
      const tr = opts.tr ?? 1, tg = opts.tg ?? 1, tb = opts.tb ?? 1;
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i];
        const py = c.pos[1] === 1 ? (opts.hTop ?? 1) : 0;
        acc.pos.push(x + c.pos[0], y + py, z + c.pos[2]);
        if (opts.fluid) {
          // world-space UVs so the fluid texture can scroll seamlessly
          const d = face.dir;
          if (d[1] !== 0) acc.uv.push((x + c.pos[0]) * 0.25, (z + c.pos[2]) * 0.25);
          else if (d[0] !== 0) acc.uv.push((z + c.pos[2]) * 0.25, (y + py) * 0.25);
          else acc.uv.push((x + c.pos[0]) * 0.25, (y + py) * 0.25);
        } else {
          acc.uv.push(tu + c.uv[0] * tsi, tv + c.uv[1] * tsi);
        }
        const a = ao ? ao[i] : 1;
        acc.col.push(shade * a * tr, shade * a * tg, shade * a * tb);
        acc.sw.push(0);
        acc.nor.push(face.dir[0], face.dir[1], face.dir[2]);
        acc.bli.push(opts.bl ? opts.bl[i] : (opts.blFlat || 0));
      }
      // flip the quad diagonal through the darker corner pair to avoid AO seams
      if (ao && ao[0] + ao[3] < ao[1] + ao[2]) {
        acc.ind.push(base, base + 1, base + 3, base, base + 3, base + 2);
      } else {
        acc.ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    };

    const srcs = [];   // block light sources in this chunk (for the point-light pool)

    for (let ly = 0; ly < HEIGHT; ly++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const id = this.chunks.get(this.key(cx, cz))[this.idx(lx, ly, lz)];
      if (!id) continue;
      const def = BLOCKS[id];
      const wx = x0 + lx, wz = z0 + lz;
      const glow = def.glow ? 1.45 : 1;
      if (id === B.GLOWSTONE || id === B.TORCH) srcs.push([wx + 0.5, ly + 0.5, wz + 0.5, 1]);
      else if (id === B.LAVA && srcs.length < 12 && this.getBlock(wx, ly + 1, wz) === B.AIR) {
        srcs.push([wx + 0.5, ly + 1, wz + 0.5, 0]);
      }

      if (def.cross) {
        // two crossed quads
        const acc = geo.alpha, tile = def.tex[0];
        const tu = (tile % ATLAS_TILES) * ts + PAD, tv = 1 - (Math.floor(tile / ATLAS_TILES) + 1) * ts + PAD;
        const quads = [
          [[0.15, 0, 0.15], [0.85, 0, 0.85]],
          [[0.85, 0, 0.15], [0.15, 0, 0.85]],
        ];
        for (const [a, b] of quads) {
          const base = acc.pos.length / 3;
          acc.pos.push(wx + a[0], ly, wz + a[2],  wx + b[0], ly, wz + b[2],
                       wx + a[0], ly + 1, wz + a[2],  wx + b[0], ly + 1, wz + b[2]);
          acc.uv.push(tu, tv,  tu + tsi, tv,  tu, tv + tsi,  tu + tsi, tv + tsi);
          const ownL = Math.pow(getLight(wx, ly, wz) / 15, 1.3);
          for (let i = 0; i < 4; i++) { acc.col.push(0.9, 0.9, 0.9); acc.nor.push(0, 1, 0); acc.bli.push(ownL); }
          acc.sw.push(0, 0, 1, 1);           // top vertices wave in the wind
          acc.ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
        continue;
      }

      // gentle biome tint for grass tops and leaves
      let tr = 1, tg = 1, tb = 1;
      if (def.tex[0] === 0 || def.tex[0] === 9) {
        const n = this.noise.noise2(wx * 0.012 + 53, wz * 0.012 - 71);
        tr = 1 - 0.09 * (n + 0.3); tg = 1 + 0.06 * n; tb = 1 - 0.05 * (n + 0.3);
      }

      for (const face of FACES) {
        const nx = wx + face.dir[0], ny = ly + face.dir[1], nz = wz + face.dir[2];
        const nb = this.getBlock(nx, ny, nz);
        let draw;
        if (def.fluid) draw = nb !== id && !isOpaque(nb) && !isFluid(nb) || (face.dir[1] === 1 && nb === B.AIR);
        else if (def.transparent) draw = nb !== id && !isOpaque(nb);
        else draw = !isOpaque(nb);
        if (!draw) continue;
        const tile = def.tex[face.texIdx];
        const acc = def.fluid ? (id === B.LAVA ? geo.lava : geo.water)
                              : (def.transparent ? geo.alpha : geo.opaque);
        const opts = { fluid: def.fluid,
          tr: face.texIdx === 0 ? tr : 1, tg: face.texIdx === 0 ? tg : 1, tb: face.texIdx === 0 ? tb : 1 };
        if (def.fluid) {
          opts.hTop = this.getBlock(wx, ly + 1, wz) !== id ? 0.875 : 1;
          opts.blFlat = Math.pow(getLight(nx, ny, nz) / 15, 1.3);
        } else {
          cornerData(face, wx, ly, wz, aoBuf, blBuf);
          opts.bl = blBuf;
          if (!def.glow) opts.ao = aoBuf;
        }
        // leaves keep their tint on every face
        if (def.tex[0] === 9) { opts.tr = tr; opts.tg = tg; opts.tb = tb; }
        pushFace(acc, face, wx, ly, wz, tile, Math.min(1.6, face.shade * glow), opts);
      }
    }

    // dispose old meshes
    this.removeMesh(cx, cz);
    const set = {};
    for (const kind of ['opaque', 'alpha', 'water', 'lava']) {
      const acc = geo[kind];
      if (!acc.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
      if (kind === 'alpha') g.setAttribute('sway', new THREE.Float32BufferAttribute(acc.sw, 1));
      if (kind !== 'lava') g.setAttribute('blight', new THREE.Float32BufferAttribute(acc.bli, 1));
      g.setIndex(acc.ind);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.mats[kind]);
      m.matrixAutoUpdate = false;
      if (kind === 'opaque') { m.castShadow = true; m.receiveShadow = true; }
      else if (kind !== 'lava') m.receiveShadow = true;
      this.scene.add(m);
      set[kind] = m;
    }
    this.meshes.set(this.key(cx, cz), set);
    this.lightSources.set(this.key(cx, cz), srcs);
  }

  _newGeoAcc() { return { pos: [], uv: [], col: [], ind: [], sw: [], nor: [], bli: [] }; }

  removeMesh(cx, cz) {
    const k = this.key(cx, cz);
    const set = this.meshes.get(k);
    if (!set) return;
    for (const kind in set) {
      this.scene.remove(set[kind]);
      set[kind].geometry.dispose();
    }
    this.meshes.delete(k);
    this.lightSources.delete(k);
  }

  // Called each frame: mesh needed chunks near the player, drop far ones.
  update(px, pz, renderDist, budget = 1) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    // collect wanted chunks sorted by distance
    const wanted = [];
    for (let dx = -renderDist; dx <= renderDist; dx++)
      for (let dz = -renderDist; dz <= renderDist; dz++)
        wanted.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
    wanted.sort((a, b) => a[2] - b[2]);

    let done = 0;
    for (const [cx, cz, d2] of wanted) {
      const k = this.key(cx, cz);
      if (this.dirty.has(k)) { this.buildMesh(cx, cz); this.dirty.delete(k); done++; }
      else if (!this.meshes.has(k)) {
        const isNew = !this.everMeshed.has(k);
        this.buildMesh(cx, cz);
        // rise-in animation for chunks appearing at a distance
        if (isNew && d2 >= 4) this.rising.push({ k, t: 0 });
        done++;
      }
      this.everMeshed.add(k);
      if (done >= budget) break;
    }
    // unload far meshes
    for (const k of this.meshes.keys()) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > renderDist + 1) this.removeMesh(cx, cz);
    }
    // free far chunk data too — generation is deterministic and player
    // edits live in this.edits, so dropped chunks regenerate identically
    for (const k of this.chunks.keys()) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > renderDist + 4) {
        this.chunks.delete(k);
        this.emitters.delete(k);
      }
    }
    return done;
  }

  // ease freshly loaded chunks up from below instead of popping in
  animateRising(dt) {
    for (let i = this.rising.length - 1; i >= 0; i--) {
      const r = this.rising[i];
      r.t += dt;
      const e = Math.min(1, r.t / 0.45);
      const y = -7 * (1 - e) * (1 - e);
      const set = this.meshes.get(r.k);
      if (set) {
        for (const kind in set) {
          set[kind].position.y = y;
          set[kind].updateMatrix();
        }
      }
      if (e >= 1 || !set) this.rising.splice(i, 1);
    }
  }

  countMissing(px, pz, renderDist) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    let n = 0;
    for (let dx = -renderDist; dx <= renderDist; dx++)
      for (let dz = -renderDist; dz <= renderDist; dz++)
        if (!this.meshes.has(this.key(pcx + dx, pcz + dz))) n++;
    return n;
  }

  surfaceHeight(x, z) {
    for (let y = HEIGHT - 1; y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && !isFluid(id) && !BLOCKS[id].cross) return y;
    }
    return 1;
  }
}
