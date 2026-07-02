// ---- Mobs: passive pigs, hostile zombies ----
'use strict';

const MOB_DEFS = {
  pig:    { w: 0.8, h: 0.9, speed: 1.4, health: 10, color: 0xeda3a8, max: 6 },
  zombie: { w: 0.6, h: 1.8, speed: 2.4, health: 20, color: 0x4a7a3a, max: 8 },
};

class Mob {
  constructor(game, type, x, y, z) {
    this.game = game;
    this.type = type;
    this.def = MOB_DEFS[type];
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = this.def.health;
    this.wanderT = 0;
    this.wanderDir = 0;
    this.attackT = 0;
    this.hurtT = 0;
    this.onGround = false;
    this.mesh = this._buildMesh();
    game.scene.add(this.mesh);
  }

  _buildMesh() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: this.def.color });
    const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.def.color).multiplyScalar(0.7) });
    const box = (w, h, d, x, y, z, m) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat);
      b.position.set(x, y, z);
      g.add(b); return b;
    };
    if (this.type === 'pig') {
      box(0.7, 0.5, 1.0, 0, 0.55, 0);                 // body
      box(0.45, 0.45, 0.45, 0, 0.75, -0.6);           // head
      box(0.18, 0.12, 0.06, 0, 0.68, -0.85, dark);    // snout
      for (const [x, z] of [[-0.2, -0.35], [0.2, -0.35], [-0.2, 0.35], [0.2, 0.35]])
        box(0.18, 0.35, 0.18, x, 0.18, z, dark);      // legs
    } else {
      const pants = new THREE.MeshLambertMaterial({ color: 0x3a4a8a });
      box(0.5, 0.7, 0.3, 0, 1.05, 0);                 // torso
      box(0.42, 0.42, 0.42, 0, 1.6, 0, dark);         // head
      box(0.16, 0.65, 0.16, -0.34, 1.2, -0.2);        // arms (stretched forward-ish)
      box(0.16, 0.65, 0.16, 0.34, 1.2, -0.2);
      box(0.2, 0.7, 0.2, -0.13, 0.35, 0, pants);      // legs
      box(0.2, 0.7, 0.2, 0.13, 0.35, 0, pants);
    }
    return g;
  }

  solidAt(x, y, z) {
    return isSolid(this.game.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }
  collides(px, py, pz) {
    const hw = this.def.w / 2;
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw])
      for (const dy of [0.05, this.def.h - 0.05])
        if (this.solidAt(px + dx, py + dy, pz + dz)) return true;
    return false;
  }

  update(dt) {
    const g = this.game, p = g.player;
    const distToPlayer = this.pos.distanceTo(p.pos);
    this.hurtT = Math.max(0, this.hurtT - dt);

    // ---- AI ----
    let wantMove = false;
    if (this.type === 'zombie' && distToPlayer < 24 && !p.dead) {
      this.yaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      wantMove = distToPlayer > 1.2;
      this.attackT -= dt;
      if (distToPlayer < 1.6 && this.attackT <= 0 && g.mode === 'survival') {
        this.attackT = 1.2;
        g.damagePlayer(3, 'Zombie');
        const kb = new THREE.Vector3(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize();
        p.vel.y = 4; p.pos.x += kb.x * 0.3; p.pos.z += kb.z * 0.3;
      }
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 2 + Math.random() * 4;
        this.wanderDir = Math.random() < 0.35 ? 0 : 1;
        this.yaw = Math.random() * Math.PI * 2;
      }
      wantMove = this.wanderDir === 1;
    }

    // ---- physics ----
    const spd = wantMove ? this.def.speed * (this.hurtT > 0 ? 0.4 : 1) : 0;
    this.vel.x = Math.sin(this.yaw) * spd;
    this.vel.z = Math.cos(this.yaw) * spd;
    this.vel.y -= 22 * dt;
    this.vel.y = Math.max(this.vel.y, -40);

    // water float
    const inWater = isFluid(g.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.3), Math.floor(this.pos.z)));
    if (inWater) this.vel.y = Math.max(this.vel.y, 1.5);

    for (const axis of ['x', 'z']) {
      const d = this.vel[axis] * dt;
      if (!d) continue;
      const np = this.pos.clone(); np[axis] += d;
      if (!this.collides(np.x, np.y, np.z)) this.pos[axis] += d;
      else if (this.onGround && !this.collides(np.x, np.y + 1.01, np.z)) {
        // jump over obstacle
        this.vel.y = 7;
      }
    }
    const ny = this.pos.y + this.vel.y * dt;
    this.onGround = false;
    if (this.collides(this.pos.x, ny, this.pos.z)) {
      if (this.vel.y < 0) { this.onGround = true; this.pos.y = Math.floor(ny) + 1; }
      this.vel.y = 0;
    } else {
      this.pos.y = ny;
    }
    if (this.pos.y < -20) this.health = 0;

    // zombies burn in daylight
    if (this.type === 'zombie' && this.game.daylight > 0.6) {
      this._burnT = (this._burnT || 0) + dt;
      if (this._burnT > 1) { this._burnT = 0; this.hurt(4, null); }
    }

    // mesh sync
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    const flash = this.hurtT > 0;
    this.mesh.traverse(o => { if (o.isMesh) o.material.emissive?.setHex(flash ? 0x883333 : 0x000000); });
  }

  hurt(dmg, from) {
    this.health -= dmg;
    this.hurtT = 0.4;
    this.game.sound.play('hurtmob');
    if (from) {
      const kb = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
      this.pos.x += kb.x * 0.6; this.pos.z += kb.z * 0.6;
      this.vel.y = 5;
      // flee
      this.yaw = Math.atan2(kb.x, kb.z);
      this.wanderDir = 1; this.wanderT = 1.5;
    }
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
  }
}

class MobManager {
  constructor(game) {
    this.game = game;
    this.mobs = [];
    this.spawnT = 0;
  }

  count(type) { return this.mobs.filter(m => m.type === type).length; }

  update(dt) {
    const g = this.game;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 3;
      this.trySpawn();
    }
    for (const m of this.mobs) m.update(dt);
    // remove dead / far mobs
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const far = m.pos.distanceTo(g.player.pos) > 70;
      if (m.health <= 0 || far) {
        if (m.health <= 0 && !far) {
          g.particles.burst(m.pos.x, m.pos.y + 0.5, m.pos.z, m.def.color, 12);
          g.sound.play('die');
          if (m.type === 'pig' && g.mode === 'survival') {
            g.addItem(B.PORKCHOP, 1);
            g.toast('+1 Kotelett');
          }
        }
        m.dispose();
        this.mobs.splice(i, 1);
      }
    }
  }

  trySpawn() {
    const g = this.game;
    const night = g.daylight < 0.25;
    const type = night ? 'zombie' : 'pig';
    if (this.count(type) >= MOB_DEFS[type].max) return;
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 16;
    const x = Math.floor(g.player.pos.x + Math.sin(ang) * dist);
    const z = Math.floor(g.player.pos.z + Math.cos(ang) * dist);
    const y = g.world.surfaceHeight(x, z) + 1;
    if (y <= WATER_Y + 1) return;
    const ground = g.world.getBlock(x, y - 1, z);
    if (type === 'pig' && ground !== B.GRASS) return;
    if (!isSolid(ground)) return;
    this.mobs.push(new Mob(g, type, x + 0.5, y, z + 0.5));
  }

  // returns the mob hit by a camera ray through screen point, within reach
  raycastMob(raycaster, maxDist = 4.5) {
    let best = null, bestD = maxDist;
    for (const m of this.mobs) {
      const hits = raycaster.intersectObject(m.mesh, true);
      if (hits.length && hits[0].distance < bestD) { best = m; bestD = hits[0].distance; }
    }
    return best;
  }

  clear() {
    for (const m of this.mobs) m.dispose();
    this.mobs = [];
  }
}
