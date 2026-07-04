// ---- Block registry + procedurally generated texture atlas ----
'use strict';

const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, LOG: 6, LEAVES: 7,
  PLANKS: 8, GLASS: 9, WATER: 10, BEDROCK: 11, SNOWGRASS: 12, COAL: 13,
  IRON: 14, GOLD: 15, DIAMOND: 16, BRICK: 17, CACTUS: 18, FLOWER: 19,
  GLOWSTONE: 20, CRAFT: 21, TNT: 22, LAVA: 23, GRAVEL: 24, TALLGRASS: 25,
  TORCH: 26,
  // non-placeable items (food)
  APPLE: 100, PORKCHOP: 101
};

// tex: [top, bottom, side] atlas tile indices
const BLOCKS = {
  [B.GRASS]:     { name: 'Grasblock',        tex: [0, 2, 1],    hard: 0.7, drops: B.DIRT },
  [B.DIRT]:      { name: 'Erde',             tex: [2, 2, 2],    hard: 0.6 },
  [B.STONE]:     { name: 'Stein',            tex: [3, 3, 3],    hard: 2.2, drops: B.COBBLE },
  [B.COBBLE]:    { name: 'Bruchstein',       tex: [4, 4, 4],    hard: 2.4 },
  [B.SAND]:      { name: 'Sand',             tex: [5, 5, 5],    hard: 0.6 },
  [B.LOG]:       { name: 'Holzstamm',        tex: [7, 7, 6],    hard: 1.4 },
  [B.LEAVES]:    { name: 'Laub',             tex: [9, 9, 9],    hard: 0.25, drops: 'leaves' },
  [B.PLANKS]:    { name: 'Holzbretter',      tex: [8, 8, 8],    hard: 1.4 },
  [B.GLASS]:     { name: 'Glas',             tex: [10, 10, 10], hard: 0.4, transparent: true, drops: null },
  [B.WATER]:     { name: 'Wasser',           tex: [11, 11, 11], fluid: true },
  [B.BEDROCK]:   { name: 'Grundgestein',     tex: [12, 12, 12], hard: Infinity },
  [B.SNOWGRASS]: { name: 'Schneegras',       tex: [14, 2, 13],  hard: 0.7, drops: B.DIRT },
  [B.COAL]:      { name: 'Kohle-Erz',        tex: [15, 15, 15], hard: 2.6 },
  [B.IRON]:      { name: 'Eisen-Erz',        tex: [16, 16, 16], hard: 3.0 },
  [B.GOLD]:      { name: 'Gold-Erz',         tex: [17, 17, 17], hard: 3.0 },
  [B.DIAMOND]:   { name: 'Diamant-Erz',      tex: [18, 18, 18], hard: 3.5 },
  [B.BRICK]:     { name: 'Ziegelstein',      tex: [19, 19, 19], hard: 2.4 },
  [B.CACTUS]:    { name: 'Kaktus',           tex: [21, 21, 20], hard: 0.5 },
  [B.FLOWER]:    { name: 'Blume',            tex: [22, 22, 22], hard: 0.05, cross: true },
  [B.GLOWSTONE]: { name: 'Leuchtstein',      tex: [24, 24, 24], hard: 0.4, glow: true },
  [B.CRAFT]:     { name: 'Werkbank',         tex: [25, 8, 26],  hard: 1.4 },
  [B.TNT]:       { name: 'TNT',              tex: [28, 28, 27], hard: 0.1 },
  [B.LAVA]:      { name: 'Lava',             tex: [29, 29, 29], fluid: true, glow: true },
  [B.GRAVEL]:    { name: 'Kies',             tex: [30, 30, 30], hard: 0.7 },
  [B.TALLGRASS]: { name: 'Hohes Gras',       tex: [23, 23, 23], hard: 0.05, cross: true, drops: null },
  [B.TORCH]:     { name: 'Fackel',           tex: [33, 33, 33], hard: 0.05, cross: true, glow: true, emit: 14 },
};

const ITEMS = {
  [B.APPLE]:    { name: 'Apfel',    tile: 31, food: 4 },
  [B.PORKCHOP]: { name: 'Kotelett', tile: 32, food: 8 },
};

function itemName(id)  { return BLOCKS[id] ? BLOCKS[id].name : (ITEMS[id] ? ITEMS[id].name : '?'); }
function itemTile(id)  { return BLOCKS[id] ? BLOCKS[id].tex[2] : (ITEMS[id] ? ITEMS[id].tile : 0); }
function isSolid(id)   { const b = BLOCKS[id]; return !!b && !b.fluid && !b.cross; }
function isOpaque(id)  { const b = BLOCKS[id]; return !!b && !b.fluid && !b.cross && !b.transparent; }
function isFluid(id)   { const b = BLOCKS[id]; return !!b && !!b.fluid; }

// Blocks offered in the creative inventory
const CREATIVE_BLOCKS = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.GRAVEL, B.LOG, B.LEAVES,
  B.PLANKS, B.GLASS, B.BRICK, B.SNOWGRASS, B.COAL, B.IRON, B.GOLD, B.DIAMOND,
  B.TORCH, B.GLOWSTONE, B.CRAFT, B.TNT, B.CACTUS, B.FLOWER, B.TALLGRASS, B.WATER, B.LAVA, B.BEDROCK
];

// Simplified crafting recipes: { out, n, in: [[id, count], ...] }
const RECIPES = [
  { out: B.PLANKS, n: 4, in: [[B.LOG, 1]] },
  { out: B.TORCH,  n: 8, in: [[B.LOG, 1], [B.COAL, 1]] },
  { out: B.CRAFT,  n: 1, in: [[B.PLANKS, 4]] },
  { out: B.GLASS,  n: 2, in: [[B.SAND, 1], [B.COAL, 1]] },
  { out: B.BRICK,  n: 4, in: [[B.COBBLE, 4]] },
  { out: B.GLOWSTONE, n: 1, in: [[B.GOLD, 2], [B.COAL, 1]] },
  { out: B.TNT,    n: 1, in: [[B.SAND, 4], [B.COAL, 1]] },
];

// ---------------- Texture atlas (8x8 tiles, 16px each) ----------------
const ATLAS_TILES = 8, TILE = 16;

function buildAtlas(seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_TILES * TILE;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(seed ^ 0xA71A5);

  function px(tx, ty, x, y, r, g, b, a = 255) {
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a / 255})`;
    ctx.fillRect(tx * TILE + x, ty * TILE + y, 1, 1);
  }
  function tilePos(i) { return [i % ATLAS_TILES, Math.floor(i / ATLAS_TILES)]; }

  // fill tile with base color + per-pixel jitter
  function noisy(i, r, g, b, jitter = 18, fn = null) {
    const [tx, ty] = tilePos(i);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const j = (rand() - 0.5) * 2 * jitter;
      let c = [r + j, g + j, b + j, 255];
      if (fn) c = fn(x, y, c) || c;
      if (c[3] > 0) px(tx, ty, x, y, c[0], c[1], c[2], c[3]);
    }
  }
  function speck(i, n, r, g, b, size = 2) {
    const [tx, ty] = tilePos(i);
    for (let k = 0; k < n; k++) {
      const x = 1 + (rand() * (TILE - size - 2)) | 0, y = 1 + (rand() * (TILE - size - 2)) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(tx * TILE + x, ty * TILE + y, size, size);
    }
  }

  noisy(0, 106, 170, 64);                                    // 0 grass top
  noisy(1, 134, 96, 67, 14, (x, y, c) => {                   // 1 grass side
    if (y < 3) return [100 + (rand() - .5) * 30, 165, 60, 255];
    if (y === 3 && rand() < 0.5) return [100, 165, 60, 255];
    return c;
  });
  noisy(2, 134, 96, 67);                                     // 2 dirt
  noisy(3, 127, 127, 127, 12, (x, y, c) => {                 // 3 stone
    if (rand() < 0.06) return [c[0] - 25, c[1] - 25, c[2] - 25, 255];
    return c;
  });
  noisy(4, 110, 110, 110, 20, (x, y, c) => {                 // 4 cobblestone
    if ((x % 5 === 0 && (y + (x / 5 | 0) * 2) % 4 < 2) || y % 5 === 0) return [70, 70, 70, 255];
    return c;
  });
  noisy(5, 219, 207, 163, 12);                               // 5 sand
  noisy(6, 103, 82, 49, 10, (x, y, c) => {                   // 6 log side
    if (x % 4 === 0) return [76, 60, 34, 255];
    return c;
  });
  noisy(7, 155, 125, 78, 8, (x, y, c) => {                   // 7 log top (rings)
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if ((d | 0) % 2 === 0) return [124, 99, 58, 255];
    return c;
  });
  noisy(8, 162, 130, 78, 8, (x, y, c) => {                   // 8 planks
    if (y % 4 === 3) return [110, 86, 48, 255];
    if (x === 7 && y < 4) return [110, 86, 48, 255];
    if (x === 2 && y >= 8 && y < 12) return [110, 86, 48, 255];
    return c;
  });
  noisy(9, 58, 132, 40, 22, (x, y, c) => {                   // 9 leaves
    if (rand() < 0.12) return [38, 96, 26, 255];
    return c;
  });
  noisy(10, 200, 230, 240, 6, (x, y, c) => {                 // 10 glass
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) return [160, 190, 200, 255];
    if (x - y === 3 || x - y === 4) return [235, 250, 255, 255];
    return [0, 0, 0, 0];                                     // transparent center
  });
  noisy(11, 47, 92, 203, 14);                                // 11 water
  noisy(12, 60, 60, 62, 26);                                 // 12 bedrock
  noisy(13, 134, 96, 67, 14, (x, y, c) => {                  // 13 snowy grass side
    if (y < 4) return [235 + (rand() - .5) * 14, 240, 245, 255];
    return c;
  });
  noisy(14, 240, 245, 250, 8);                               // 14 snow top
  noisy(15, 127, 127, 127, 12); speck(15, 6, 35, 35, 35);    // 15 coal ore
  noisy(16, 127, 127, 127, 12); speck(16, 6, 216, 175, 147); // 16 iron ore
  noisy(17, 127, 127, 127, 12); speck(17, 6, 252, 222, 80);  // 17 gold ore
  noisy(18, 127, 127, 127, 12); speck(18, 6, 93, 236, 245);  // 18 diamond ore
  noisy(19, 150, 97, 83, 10, (x, y, c) => {                  // 19 brick
    if (y % 4 === 0) return [188, 175, 165, 255];
    const off = ((y / 4) | 0) % 2 ? 0 : 4;
    if ((x + off) % 8 === 0) return [188, 175, 165, 255];
    return c;
  });
  noisy(20, 15, 125, 40, 10, (x, y, c) => {                  // 20 cactus side
    if (x % 4 === 1) return [8, 90, 25, 255];
    if (rand() < 0.04) return [220, 230, 190, 255];
    return c;
  });
  noisy(21, 30, 140, 50, 10);                                // 21 cactus top
  noisy(22, 0, 0, 0, 0, (x, y) => {                          // 22 flower (cross)
    const cx = 8, cy = 5, d = Math.abs(x - cx) + Math.abs(y - cy);
    if (d <= 2 && !(x === cx && y === cy)) return [214, 48, 48, 255];
    if (x === cx && y === cy) return [252, 222, 80, 255];
    if (x === cx && y > 7) return [40, 130, 40, 255];
    if (y === 11 && (x === cx - 1 || x === cx + 1)) return [40, 130, 40, 255];
    return [0, 0, 0, 0];
  });
  noisy(23, 0, 0, 0, 0, (x, y) => {                          // 23 tall grass (cross)
    const blades = [2, 5, 8, 11, 13];
    for (const bx of blades) {
      const h = 5 + ((bx * 7) % 8);
      if (Math.abs(x - bx) <= 0 && y >= 16 - h) return [90 + (rand() * 30), 160, 55, 255];
    }
    return [0, 0, 0, 0];
  });
  noisy(24, 252, 212, 96, 30, (x, y, c) => {                 // 24 glowstone
    if (rand() < 0.15) return [200, 140, 60, 255];
    return c;
  });
  noisy(25, 162, 130, 78, 8, (x, y, c) => {                  // 25 crafting table top
    if (x < 2 || y < 2 || x > 13 || y > 13) return [110, 80, 45, 255];
    if ((x + y) % 8 < 2 && x > 3 && x < 12 && y > 3 && y < 12) return [120, 90, 50, 255];
    return c;
  });
  noisy(26, 162, 130, 78, 8, (x, y, c) => {                  // 26 crafting table side
    if (y < 2) return [110, 80, 45, 255];
    if (x > 3 && x < 7 && y > 5 && y < 9) return [140, 60, 40, 255];
    if (x > 9 && x < 13 && y > 5 && y < 9) return [90, 90, 100, 255];
    return c;
  });
  noisy(27, 190, 45, 35, 14, (x, y, c) => {                  // 27 TNT side
    if (y > 5 && y < 10) return [235, 230, 215, 255];
    if (y === 7 && x % 3 === 1) return [20, 20, 20, 255];
    return c;
  });
  noisy(28, 190, 45, 35, 14, (x, y, c) => {                  // 28 TNT top
    if (x > 4 && x < 11 && y > 4 && y < 11) return [60, 50, 40, 255];
    return c;
  });
  noisy(29, 235, 110, 20, 32, (x, y, c) => {                 // 29 lava
    if (rand() < 0.2) return [250, 210, 60, 255];
    return c;
  });
  noisy(30, 132, 126, 120, 26, (x, y, c) => {                // 30 gravel
    if (rand() < 0.15) return [95, 88, 82, 255];
    return c;
  });
  noisy(31, 0, 0, 0, 0, (x, y) => {                          // 31 apple item
    const dx = x - 7.5, dy = y - 9;
    if (dx * dx + dy * dy < 25) return [200, 30, 30, 255];
    if (x === 8 && y > 2 && y < 5) return [100, 70, 40, 255];
    if (y === 3 && x > 8 && x < 12) return [60, 140, 50, 255];
    return [0, 0, 0, 0];
  });
  noisy(32, 0, 0, 0, 0, (x, y) => {                          // 32 porkchop item
    const dx = (x - 9) / 5, dy = (y - 7) / 6;
    if (dx * dx + dy * dy < 1) return [235, 150, 150, 255];
    if (y > 10 && y < 13 && x > 2 && x < 6) return [240, 230, 210, 255];
    return [0, 0, 0, 0];
  });

  noisy(33, 0, 0, 0, 0, (x, y) => {                          // 33 torch (cross)
    if ((x === 7 || x === 8) && y >= 6 && y <= 14) return [102, 76, 42, 255];  // stick
    if ((x === 7 || x === 8) && (y === 4 || y === 5)) return [255, 226, 130, 255];
    if ((x === 6 || x === 9) && (y === 4 || y === 5)) return [255, 176, 56, 255];
    if (x >= 6 && x <= 9 && y === 3) return [255, 244, 190, 255];
    return [0, 0, 0, 0];
  });

  // 40..43: crack overlay stages (random cracks radiating from the centre)
  for (let s = 0; s < 4; s++) {
    const [tx, ty] = tilePos(40 + s);
    const cracks = 3 + s * 2;
    for (let k = 0; k < cracks; k++) {
      let x = 6 + (rand() * 5) | 0, y = 6 + (rand() * 5) | 0;
      let dx = rand() < 0.5 ? 1 : -1, dy = rand() < 0.5 ? 1 : -1;
      const len = 3 + s * 2 + (rand() * 3) | 0;
      for (let j = 0; j < len; j++) {
        px(tx, ty, Math.max(0, Math.min(15, x)), Math.max(0, Math.min(15, y)), 15, 15, 15, 190);
        if (rand() < 0.6) x += dx; else y += dy;
        if (rand() < 0.2) dx = -dx;
        if (rand() < 0.2) dy = -dy;
      }
    }
  }

  return cv;
}

// 64x64 scrolling texture for water / lava surfaces
function makeFluidCanvas(kind, seed = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(seed ^ (kind === 'water' ? 0x77A7E5 : 0x1AFA9));
  const base = kind === 'water' ? [36, 86, 194] : [198, 72, 14];
  const blob = kind === 'water' ? [66, 128, 228] : [250, 186, 52];
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 2) for (let x = 0; x < 64; x += 2) {
    const j = (rand() - 0.5) * 22;
    ctx.fillStyle = `rgb(${base[0] + j | 0},${base[1] + j | 0},${base[2] + j | 0})`;
    ctx.fillRect(x, y, 2, 2);
  }
  for (let i = 0; i < 26; i++) {
    const r = 2 + rand() * 5;
    ctx.fillStyle = `rgba(${blob[0]},${blob[1]},${blob[2]},${0.25 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.arc(rand() * 64, rand() * 64, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv;
}

// CSS background-position for an atlas tile (element uses background-size:800% 800%)
function tileCss(id) {
  const t = itemTile(id);
  const x = t % ATLAS_TILES, y = Math.floor(t / ATLAS_TILES);
  return `${(x / (ATLAS_TILES - 1)) * 100}% ${(y / (ATLAS_TILES - 1)) * 100}%`;
}
