// ---- Mobs: passive pigs, hostile zombies ----
'use strict';

const MOB_DEFS = {
  pig:      { w: 0.8, h: 0.9, speed: 1.4, health: 10, color: 0xeda3a8, max: 4 },
  cow:      { w: 0.9, h: 1.4, speed: 1.2, health: 12, color: 0x6b4a2f, max: 3 },
  sheep:    { w: 0.9, h: 1.3, speed: 1.1, health: 10, color: 0xe8e6e0, max: 3 },
  zombie:   { w: 0.6, h: 1.8, speed: 2.4, health: 20, color: 0x4a7a3a, max: 6 },
  skeleton: { w: 0.5, h: 1.9, speed: 2.0, health: 16, color: 0xd8d8d0, max: 4 },
  villager: { w: 0.6, h: 1.9, speed: 1.1, health: 20, color: 0x8a6c46, max: 4 },
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
    // limb pivoted at the hip so it can swing while walking
    const limb = (w, h, d, x, hipY, z, m) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, -h / 2, 0);
      const b = new THREE.Mesh(geo, m || mat);
      b.position.set(x, hipY, z);
      g.add(b); return b;
    };
    this.limbs = []; this.limbPhase = [];
    if (this.type === 'pig') {
      box(0.7, 0.5, 1.0, 0, 0.55, 0);                 // body
      box(0.45, 0.45, 0.45, 0, 0.75, -0.6);           // head
      box(0.18, 0.12, 0.06, 0, 0.68, -0.85, dark);    // snout
      const legPos = [[-0.2, -0.35], [0.2, -0.35], [-0.2, 0.35], [0.2, 0.35]];
      legPos.forEach(([x, z], i) => {
        this.limbs.push(limb(0.18, 0.35, 0.18, x, 0.35, z, dark));
        this.limbPhase.push(i === 0 || i === 3 ? 0 : Math.PI);   // diagonal gait
      });
    } else if (this.type === 'cow') {
      const white = new THREE.MeshLambertMaterial({ color: 0xf3efe6 });
      box(0.85, 0.7, 1.3, 0, 0.9, 0);                 // body
      box(0.6, 0.25, 0.5, 0, 0.62, 0.35, white);      // belly patch
      box(0.5, 0.5, 0.5, 0, 1.1, -0.85);              // head
      box(0.32, 0.2, 0.12, 0, 0.96, -1.14, white);    // snout
      box(0.1, 0.12, 0.1, -0.28, 1.38, -0.8, white);  // horns
      box(0.1, 0.12, 0.1, 0.28, 1.38, -0.8, white);
      const legPos = [[-0.26, -0.42], [0.26, -0.42], [-0.26, 0.42], [0.26, 0.42]];
      legPos.forEach(([x, z], i) => {
        this.limbs.push(limb(0.2, 0.55, 0.2, x, 0.55, z, dark));
        this.limbPhase.push(i === 0 || i === 3 ? 0 : Math.PI);
      });
    } else if (this.type === 'sheep') {
      const face = new THREE.MeshLambertMaterial({ color: 0xb5aa9c });
      box(0.9, 0.8, 1.2, 0, 0.95, 0);                 // wool body
      box(0.42, 0.42, 0.5, 0, 1.25, -0.75, face);     // head
      box(0.46, 0.3, 0.24, 0, 1.3, -0.6);             // wool cap
      const legPos = [[-0.22, -0.35], [0.22, -0.35], [-0.22, 0.35], [0.22, 0.35]];
      legPos.forEach(([x, z], i) => {
        this.limbs.push(limb(0.18, 0.55, 0.18, x, 0.55, z, face));
        this.limbPhase.push(i === 0 || i === 3 ? 0 : Math.PI);
      });
    } else if (this.type === 'skeleton') {
      const bow = new THREE.MeshLambertMaterial({ color: 0x7a5a34 });
      box(0.4, 0.65, 0.2, 0, 1.2, 0);                 // ribcage
      box(0.42, 0.42, 0.42, 0, 1.75, 0, dark);        // skull
      box(0.12, 0.12, 0.55, -0.24, 1.42, -0.3);       // aiming arm
      box(0.12, 0.5, 0.12, 0.24, 1.2, 0);             // hanging arm
      box(0.07, 0.6, 0.07, -0.24, 1.42, -0.6, bow);   // bow
      this.limbs.push(limb(0.14, 0.8, 0.14, -0.12, 0.85, 0));
      this.limbs.push(limb(0.14, 0.8, 0.14, 0.12, 0.85, 0));
      this.limbPhase.push(0, Math.PI);
    } else if (this.type === 'villager') {
      const skin = new THREE.MeshLambertMaterial({ color: 0xd6a77a });
      box(0.52, 0.8, 0.34, 0, 1.1, 0);                // brown robe torso
      box(0.44, 0.5, 0.3, 0, 0.45, 0, dark);          // robe skirt
      box(0.4, 0.4, 0.4, 0, 1.75, 0, skin);           // head
      box(0.08, 0.16, 0.08, 0, 1.68, -0.23, skin);    // the nose
      box(0.5, 0.16, 0.2, 0, 1.15, -0.2);             // folded arms
      this.limbs.push(limb(0.18, 0.45, 0.18, -0.12, 0.45, 0, dark));
      this.limbs.push(limb(0.18, 0.45, 0.18, 0.12, 0.45, 0, dark));
      this.limbPhase.push(0, Math.PI);
    } else {
      const pants = new THREE.MeshLambertMaterial({ color: 0x3a4a8a });
      box(0.5, 0.7, 0.3, 0, 1.05, 0);                 // torso
      box(0.42, 0.42, 0.42, 0, 1.6, 0, dark);         // head
      box(0.16, 0.65, 0.16, -0.34, 1.2, -0.2);        // arms (stretched forward-ish)
      box(0.16, 0.65, 0.16, 0.34, 1.2, -0.2);
      this.limbs.push(limb(0.2, 0.7, 0.2, -0.13, 0.7, 0, pants));
      this.limbs.push(limb(0.2, 0.7, 0.2, 0.13, 0.7, 0, pants));
      this.limbPhase.push(0, Math.PI);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  solidAt(x, y, z) {
    return isSolid(this.game.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }
  collides(px, py, pz) {
    const hw = this.def.w / 2;
    // samples at the very box edges — otherwise mobs sink into the ground
    // a little each frame and get snapped back up (visible jitter)
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw])
      for (const dy of [0.001, this.def.h * 0.55, this.def.h - 0.001])
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
    } else if (this.type === 'skeleton' && distToPlayer < 24 && !p.dead) {
      // ranged: keep a comfortable distance and shoot arrows
      this.yaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (distToPlayer > 13) wantMove = true;
      else if (distToPlayer < 6) { this.yaw += Math.PI; wantMove = true; }   // back off
      this.shootT = (this.shootT ?? 1.5) - dt;
      if (this.shootT <= 0 && distToPlayer <= 18 && this.hurtT <= 0) {
        this.shootT = 2.4;
        g.shootArrow(this.pos.x, this.pos.y + 1.45, this.pos.z);
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

    // the undead burn in daylight
    if ((this.type === 'zombie' || this.type === 'skeleton') && this.game.daylight > 0.6) {
      this._burnT = (this._burnT || 0) + dt;
      if (this._burnT > 1) { this._burnT = 0; this.hurt(4, null); }
    }

    // mesh sync — models are built facing local -z, movement goes toward
    // (sin yaw, cos yaw), so the mesh needs an extra half turn
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw + Math.PI;

    // walk animation
    const moving = spd > 0.05;
    this.animT = (this.animT || 0) + dt * spd * 3.5;
    for (let i = 0; i < this.limbs.length; i++) {
      const target = moving ? Math.sin(this.animT + this.limbPhase[i]) * 0.7 : 0;
      this.limbs[i].rotation.x += (target - this.limbs[i].rotation.x) * Math.min(1, dt * 12);
    }
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
          if (g.mode === 'survival') {
            if (m.type === 'pig') { g.addItem(B.PORKCHOP, 1); g.toast('+1 Kotelett'); }
            else if (m.type === 'cow') { g.addItem(B.LEATHER, 1); g.addItem(B.BEEF, 1); g.toast('+1 Leder, +1 Rindfleisch'); }
            else if (m.type === 'sheep') {
              const n = 1 + (Math.random() < 0.5 ? 1 : 0);
              g.addItem(B.WOOL, n); g.toast('+' + n + ' Wolle');
            }
          }
        }
        m.dispose();
        this.mobs.splice(i, 1);
      }
    }
  }

  trySpawn() {
    const g = this.game;
    // villagers stroll around their village during the day
    const village = g.world.villageNear(g.player.pos.x, g.player.pos.z, 56);
    if (village && g.daylight > 0.3 && this.count('villager') < MOB_DEFS.villager.max) {
      const hut = village.huts[(Math.random() * village.huts.length) | 0];
      const x = hut.x + ((Math.random() * 12) | 0) - 6;
      const z = hut.z + ((Math.random() * 12) | 0) - 6;
      const y = g.world.surfaceHeight(x, z) + 1;
      if (y > WATER_Y && isSolid(g.world.getBlock(x, y - 1, z))) {
        this.mobs.push(new Mob(g, 'villager', x + 0.5, y, z + 0.5));
        return;
      }
    }
    const night = g.daylight < 0.25;
    let type;
    if (night) type = Math.random() < 0.6 ? 'zombie' : 'skeleton';
    else { const r = Math.random(); type = r < 0.5 ? 'pig' : (r < 0.75 ? 'cow' : 'sheep'); }
    if (this.count(type) >= MOB_DEFS[type].max) return;
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 16;
    const x = Math.floor(g.player.pos.x + Math.sin(ang) * dist);
    const z = Math.floor(g.player.pos.z + Math.cos(ang) * dist);
    const y = g.world.surfaceHeight(x, z) + 1;
    if (y <= WATER_Y + 1) return;
    const ground = g.world.getBlock(x, y - 1, z);
    if (!night && ground !== B.GRASS) return;      // animals graze on grass
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
