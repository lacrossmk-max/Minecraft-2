// ---- Seeded RNG + Perlin noise (2D & 3D) ----
'use strict';

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// deterministic hash of integer coords -> [0,1)
function hash2(x, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 2246822519) + Math.imul(z, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class Perlin {
  constructor(seed) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + t * (b - a); }
  grad2(h, x, y) {
    switch (h & 3) {
      case 0: return  x + y;
      case 1: return -x + y;
      case 2: return  x - y;
      default: return -x - y;
    }
  }
  grad3(h, x, y, z) {
    const u = (h & 8) ? y : x;
    const v = (h & 12) ? ((h & 12) === 12 ? x : z) : y;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  noise2(x, y) {
    const P = this.perm;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = this.fade(x), v = this.fade(y);
    const a = P[X] + Y, b = P[X + 1] + Y;
    return this.lerp(
      this.lerp(this.grad2(P[a], x, y),     this.grad2(P[b], x - 1, y), u),
      this.lerp(this.grad2(P[a + 1], x, y - 1), this.grad2(P[b + 1], x - 1, y - 1), u),
      v);
  }
  noise3(x, y, z) {
    const P = this.perm;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = this.fade(x), v = this.fade(y), w = this.fade(z);
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
    const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    return this.lerp(
      this.lerp(
        this.lerp(this.grad3(P[AA], x, y, z),     this.grad3(P[BA], x - 1, y, z), u),
        this.lerp(this.grad3(P[AB], x, y - 1, z), this.grad3(P[BB], x - 1, y - 1, z), u), v),
      this.lerp(
        this.lerp(this.grad3(P[AA + 1], x, y, z - 1),     this.grad3(P[BA + 1], x - 1, y, z - 1), u),
        this.lerp(this.grad3(P[AB + 1], x, y - 1, z - 1), this.grad3(P[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }
  // fractal brownian motion, result roughly in [-1,1]
  fbm2(x, y, octaves) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * freq, y * freq) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
}
