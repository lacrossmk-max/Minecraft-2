// ---- World: chunk generation, storage, meshing ----
'use strict';

const CHUNK = 16, HEIGHT = 64, WATER_Y = 27;

const FACES = [
  { dir: [1, 0, 0], shade: 0.72, texIdx: 2,
    corners: [{ pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [-1, 0, 0], shade: 0.72, texIdx: 2,
    corners: [{ pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [0, 1, 0], shade: 1.0, texIdx: 0,
    corners: [{ pos: [0, 1, 1], uv: [0, 0] }, { pos: [1, 1, 1], uv: [1, 0] }, { pos: [0, 1, 0], uv: [0, 1] }, { pos: [1, 1, 0], uv: [1, 1] }] },
  { dir: [0, -1, 0], shade: 0.5, texIdx: 1,
    corners: [{ pos: [0, 0, 0], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [1, 1] }] },
  { dir: [0, 0, 1], shade: 0.85, texIdx: 2,
    corners: [{ pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
  { dir: [0, 0, -1], shade: 0.85, texIdx: 2,
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
    return this.noiseCave.noise3(x * 0.085, y * 0.11, z * 0.085) > 0.58;
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
    c[this.idx(lx, y, lz)] = id;
    if (recordEdit) this.edits.set(x + ',' + y + ',' + z, id);
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

    // per-vertex ambient occlusion: check the two side neighbours and the
    // corner neighbour in the layer the face looks into
    const cornerAO = (face, wx, ly, wz, out) => {
      const d = face.dir;
      const axisN = d[0] !== 0 ? 0 : (d[1] !== 0 ? 1 : 2);
      const a1 = (axisN + 1) % 3, a2 = (axisN + 2) % 3;
      const bx = wx + d[0], by = ly + d[1], bz = wz + d[2];
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i];
        const cu = c.pos[a1] ? 1 : -1, cv = c.pos[a2] ? 1 : -1;
        const p1 = [bx, by, bz]; p1[a1] += cu;
        const p2 = [bx, by, bz]; p2[a2] += cv;
        const pc = [bx, by, bz]; pc[a1] += cu; pc[a2] += cv;
        const s1 = isOpaque(this.getBlock(p1[0], p1[1], p1[2])) ? 1 : 0;
        const s2 = isOpaque(this.getBlock(p2[0], p2[1], p2[2])) ? 1 : 0;
        const cc = isOpaque(this.getBlock(pc[0], pc[1], pc[2])) ? 1 : 0;
        out[i] = AO_LEVELS[(s1 && s2) ? 3 : s1 + s2 + cc];
      }
    };

    const aoBuf = [1, 1, 1, 1];
    const pushFace = (acc, face, x, y, z, tile, shade, opts = {}) => {
      const base = acc.pos.length / 3;
      const tu = (tile % ATLAS_TILES) * ts, tv = 1 - (Math.floor(tile / ATLAS_TILES) + 1) * ts;
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
          acc.uv.push(tu + c.uv[0] * ts, tv + c.uv[1] * ts);
        }
        const a = ao ? ao[i] : 1;
        acc.col.push(shade * a * tr, shade * a * tg, shade * a * tb);
      }
      // flip the quad diagonal through the darker corner pair to avoid AO seams
      if (ao && ao[0] + ao[3] < ao[1] + ao[2]) {
        acc.ind.push(base, base + 1, base + 3, base, base + 3, base + 2);
      } else {
        acc.ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    };

    for (let ly = 0; ly < HEIGHT; ly++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const id = this.chunks.get(this.key(cx, cz))[this.idx(lx, ly, lz)];
      if (!id) continue;
      const def = BLOCKS[id];
      const wx = x0 + lx, wz = z0 + lz;
      const glow = def.glow ? 1.45 : 1;

      if (def.cross) {
        // two crossed quads
        const acc = geo.alpha, tile = def.tex[0];
        const tu = (tile % ATLAS_TILES) * ts, tv = 1 - (Math.floor(tile / ATLAS_TILES) + 1) * ts;
        const quads = [
          [[0.15, 0, 0.15], [0.85, 0, 0.85]],
          [[0.85, 0, 0.15], [0.15, 0, 0.85]],
        ];
        for (const [a, b] of quads) {
          const base = acc.pos.length / 3;
          acc.pos.push(wx + a[0], ly, wz + a[2],  wx + b[0], ly, wz + b[2],
                       wx + a[0], ly + 1, wz + a[2],  wx + b[0], ly + 1, wz + b[2]);
          acc.uv.push(tu, tv,  tu + ts, tv,  tu, tv + ts,  tu + ts, tv + ts);
          for (let i = 0; i < 4; i++) acc.col.push(0.9, 0.9, 0.9);
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
        if (def.fluid) opts.hTop = this.getBlock(wx, ly + 1, wz) !== id ? 0.875 : 1;
        if (!def.fluid && !def.glow) { cornerAO(face, wx, ly, wz, aoBuf); opts.ao = aoBuf; }
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
      g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
      g.setIndex(acc.ind);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.mats[kind]);
      m.matrixAutoUpdate = false;
      this.scene.add(m);
      set[kind] = m;
    }
    this.meshes.set(this.key(cx, cz), set);
  }

  _newGeoAcc() { return { pos: [], uv: [], col: [], ind: [] }; }

  removeMesh(cx, cz) {
    const k = this.key(cx, cz);
    const set = this.meshes.get(k);
    if (!set) return;
    for (const kind in set) {
      this.scene.remove(set[kind]);
      set[kind].geometry.dispose();
    }
    this.meshes.delete(k);
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
    for (const [cx, cz] of wanted) {
      const k = this.key(cx, cz);
      if (this.dirty.has(k)) { this.buildMesh(cx, cz); this.dirty.delete(k); done++; }
      else if (!this.meshes.has(k)) { this.buildMesh(cx, cz); done++; }
      if (done >= budget) break;
    }
    // unload far meshes
    for (const k of this.meshes.keys()) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > renderDist + 1) this.removeMesh(cx, cz);
    }
    return done;
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
