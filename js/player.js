// ---- Player: physics, camera, input (touch + keyboard/mouse), raycast ----
'use strict';

const PLAYER_W = 0.6, PLAYER_H = 1.8, EYE = 1.62;

class Player {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.pos = new THREE.Vector3(8, 40, 8);   // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.eyeInWater = false;
    this.inLava = false;
    this.health = 20; this.maxHealth = 20;
    this.hunger = 20; this.air = 10;
    this.dead = false;
    this.fallStartVy = 0;
    // input state (set by controls)
    this.moveX = 0; this.moveZ = 0;           // -1..1
    this.jumpHeld = false; this.downHeld = false; this.sprint = false;
  }

  eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }

  lookDir() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  solidAt(x, y, z) {
    return isSolid(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  boxCollides(px, py, pz) {
    const hw = PLAYER_W / 2;
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw])
      for (const dy of [0.05, PLAYER_H / 2, PLAYER_H - 0.05])
        if (this.solidAt(px + dx, py + dy, pz + dz)) return true;
    return false;
  }

  update(dt, game) {
    if (this.dead) return;
    const w = this.world;

    // fluid checks
    const feet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    const eye = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z));
    this.inWater = feet === B.WATER || eye === B.WATER;
    this.eyeInWater = eye === B.WATER;
    this.inLava = feet === B.LAVA || eye === B.LAVA;

    // desired horizontal velocity from input, rotated by yaw
    const speed = this.flying ? 9 : (this.inWater ? 2.2 : (this.sprint ? 5.6 : 4.2));
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dx = (-this.moveZ * -sin + this.moveX * cos) * speed;
    const dz = (-this.moveZ * -cos + this.moveX * -sin) * speed;
    this.vel.x = dx; this.vel.z = dz;

    // vertical
    if (this.flying) {
      this.vel.y = this.jumpHeld ? 8 : (this.downHeld ? -8 : 0);
    } else if (this.inWater || this.inLava) {
      this.vel.y += -4 * dt;
      if (this.jumpHeld) this.vel.y = 3;
      this.vel.y = Math.max(this.vel.y, -3);
    } else {
      this.vel.y -= 22 * dt;
      if (this.jumpHeld && this.onGround) {
        this.vel.y = 7.8;
        game.sound.play('jump');
      }
      this.vel.y = Math.max(this.vel.y, -50);
    }

    // integrate with axis-separated collision
    const prevVy = this.vel.y;
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    const wasOnGround = this.onGround;
    this.onGround = false;
    const stepY = this.vel.y * dt;
    if (stepY !== 0) {
      const ny = this.pos.y + stepY;
      if (this.boxCollides(this.pos.x, ny, this.pos.z)) {
        if (stepY < 0) {
          this.onGround = true;
          // fall damage
          if (!wasOnGround && prevVy < -13 && !this.inWater && !this.flying && game.mode === 'survival') {
            const dmg = Math.floor((-prevVy - 13) * 0.9);
            if (dmg > 0) game.damagePlayer(dmg, 'Fallschaden');
          }
          this.pos.y = Math.floor(ny) + 1;
        } else {
          this.pos.y = Math.ceil(ny + PLAYER_H) - PLAYER_H - 0.001;
        }
        this.vel.y = 0;
      } else {
        this.pos.y = ny;
      }
    } else if (this.boxCollides(this.pos.x, this.pos.y - 0.02, this.pos.z)) {
      this.onGround = true;
    }
    if (this.pos.y < -10) { this.pos.y = -10; game.damagePlayer(100, 'aus der Welt gefallen'); }

    // survival ticks
    if (game.mode === 'survival') {
      // drowning
      if (this.eyeInWater) {
        this.air -= dt;
        if (this.air <= 0) { this.air = 0; this._drownT = (this._drownT || 0) + dt;
          if (this._drownT > 1) { this._drownT = 0; game.damagePlayer(2, 'Ertrinken'); } }
      } else { this.air = Math.min(10, this.air + dt * 3); this._drownT = 0; }
      // lava
      if (this.inLava) { this._lavaT = (this._lavaT || 0) + dt;
        if (this._lavaT > 0.4) { this._lavaT = 0; game.damagePlayer(3, 'Lava'); } }
      // cactus contact
      const hw = PLAYER_W / 2 + 0.05;
      for (const [ox, oz] of [[hw, 0], [-hw, 0], [0, hw], [0, -hw]]) {
        if (w.getBlock(Math.floor(this.pos.x + ox), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z + oz)) === B.CACTUS) {
          this._cacT = (this._cacT || 0) + dt;
          if (this._cacT > 0.6) { this._cacT = 0; game.damagePlayer(1, 'Kaktus'); }
        }
      }
      // hunger drains slowly; regen when full-ish
      this.hunger -= dt / 40;
      if (this.hunger < 0) { this.hunger = 0; this._starveT = (this._starveT || 0) + dt;
        if (this._starveT > 3) { this._starveT = 0; game.damagePlayer(1, 'Hunger'); } }
      if (this.hunger >= 17 && this.health < this.maxHealth) {
        this._regenT = (this._regenT || 0) + dt;
        if (this._regenT > 3) { this._regenT = 0; this.health = Math.min(this.maxHealth, this.health + 1); }
      }
    }

    // camera
    this.camera.position.copy(this.eyePos());
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.pos.clone();
    p[axis] += delta;
    if (!this.boxCollides(p.x, p.y, p.z)) { this.pos[axis] += delta; return; }
    // auto step-up small ledges when on ground
    if (this.onGround && !this.flying && !this.boxCollides(p.x, p.y + 1.01, p.z) &&
        !this.boxCollides(this.pos.x, this.pos.y + 1.01, this.pos.z)) {
      this.pos[axis] += delta; this.pos.y += 1.01; return;
    }
    if (axis === 'x') this.vel.x = 0; else this.vel.z = 0;
  }

  // DDA voxel raycast. Returns {x,y,z,nx,ny,nz,id,dist} or null.
  raycast(origin, dir, maxDist = 6) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const tDX = Math.abs(1 / (dir.x || 1e-9)), tDY = Math.abs(1 / (dir.y || 1e-9)), tDZ = Math.abs(1 / (dir.z || 1e-9));
    let tMX = (dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDX;
    let tMY = (dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDY;
    let tMZ = (dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDZ;
    let nx = 0, ny = 0, nz = 0, dist = 0;
    for (let i = 0; i < 120; i++) {
      const id = this.world.getBlock(x, y, z);
      if (id !== B.AIR && !isFluid(id)) return { x, y, z, nx, ny, nz, id, dist };
      if (tMX < tMY && tMX < tMZ) { dist = tMX; x += stepX; tMX += tDX; nx = -stepX; ny = 0; nz = 0; }
      else if (tMY < tMZ) { dist = tMY; y += stepY; tMY += tDY; nx = 0; ny = -stepY; nz = 0; }
      else { dist = tMZ; z += stepZ; tMZ += tDZ; nx = 0; ny = 0; nz = -stepZ; }
      if (dist > maxDist) return null;
    }
    return null;
  }

  placementBlocked(bx, by, bz) {
    // would the new block overlap the player's AABB?
    const hw = PLAYER_W / 2;
    return bx + 1 > this.pos.x - hw && bx < this.pos.x + hw &&
           bz + 1 > this.pos.z - hw && bz < this.pos.z + hw &&
           by + 1 > this.pos.y && by < this.pos.y + PLAYER_H;
  }
}

// ================= Input handling =================
class Controls {
  constructor(game) {
    this.game = game;
    this.touchMode = 'ontouchstart' in window;
    this.sensitivity = 0.25;
    this.lookTouch = null;      // {id, lastX, lastY, startX, startY, startT, moved}
    this.joyTouch = null;
    this.breakTarget = null;    // {key, progress, need, sx, sy}
    this.keys = {};
    this._lastJumpTap = 0;
    this._bindTouch();
    this._bindKeyboard();
  }

  // ---------- touch ----------
  // Dynamic joystick: touching anywhere on the left 45% of the screen spawns
  // the joystick under the finger; everything else is look / dig / place.
  _bindTouch() {
    const joy = document.getElementById('joystick');
    const nub = joy.querySelector('.nub');
    const canvas = document.getElementById('game-canvas');
    const g = this.game;

    window.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (this.joyTouch !== null && t.identifier === this.joyTouch) this._joyMove(t, nub);
        else if (this.lookTouch && t.identifier === this.lookTouch.id) {
          const lt = this.lookTouch;
          const dx = t.clientX - lt.lastX, dy = t.clientY - lt.lastY;
          g.player.yaw -= dx * 0.0075 * this.sensitivity * 4;
          g.player.pitch -= dy * 0.0075 * this.sensitivity * 4;
          g.player.pitch = Math.max(-1.55, Math.min(1.55, g.player.pitch));
          lt.lastX = t.clientX; lt.lastY = t.clientY;
          if (Math.abs(t.clientX - lt.startX) + Math.abs(t.clientY - lt.startY) > 14) lt.moved = true;
        }
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    const endTouch = e => {
      for (const t of e.changedTouches) {
        if (this.joyTouch !== null && t.identifier === this.joyTouch) {
          this.joyTouch = null;
          g.player.moveX = 0; g.player.moveZ = 0; g.player.sprint = false;
          joy.classList.remove('active');
          joy.style.left = ''; joy.style.top = '';
          nub.style.left = '41px'; nub.style.top = '41px';
        }
        if (this.lookTouch && t.identifier === this.lookTouch.id) {
          const lt = this.lookTouch;
          const dur = performance.now() - lt.startT;
          if (!lt.moved && dur < 250 && !this.breakBroke) {
            g.tapAction(lt.startX, lt.startY);   // short tap: place / use
          }
          this.lookTouch = null;
          this.stopBreaking();
        }
      }
    };
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);

    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.joyTouch === null && t.clientX < innerWidth * 0.45) {
          // movement touch: spawn the joystick under the finger
          this.joyTouch = t.identifier;
          this.joyOrigin = { x: t.clientX, y: t.clientY };
          joy.style.left = (t.clientX - 65) + 'px';
          joy.style.top = (t.clientY - 65) + 'px';
          joy.classList.add('active');
          nub.style.left = '41px'; nub.style.top = '41px';
        } else if (!this.lookTouch) {
          this.lookTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY,
            startX: t.clientX, startY: t.clientY, startT: performance.now(), moved: false };
          this.breakBroke = false;
          this.startBreaking(t.clientX, t.clientY);
        }
      }
    }, { passive: false });

    // buttons
    const bind = (id, down, up) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
      if (up) {
        el.addEventListener('touchend', e => { e.preventDefault(); up(); }, { passive: false });
        el.addEventListener('touchcancel', () => up(), { passive: false });
      }
      el.addEventListener('mousedown', e => { e.stopPropagation(); down(); });
      if (up) el.addEventListener('mouseup', () => up());
    };
    bind('btn-jump', () => {
      const now = performance.now();
      if (now - this._lastJumpTap < 300 && g.mode === 'creative') {
        g.player.flying = !g.player.flying;
        g.toast(g.player.flying ? 'Fliegen: an' : 'Fliegen: aus');
        document.getElementById('btn-down').style.display = g.player.flying ? 'flex' : 'none';
      }
      this._lastJumpTap = now;
      g.player.jumpHeld = true;
    }, () => { g.player.jumpHeld = false; });
    bind('btn-down', () => { g.player.downHeld = true; }, () => { g.player.downHeld = false; });
    bind('btn-inv', () => g.ui.toggleInventory());
    bind('btn-pause', () => g.ui.togglePause());
  }

  _joyMove(t, nub) {
    const R = 52;
    let dx = (t.clientX - this.joyOrigin.x) / R, dy = (t.clientY - this.joyOrigin.y) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const g = this.game;
    const dead = len < 0.12;                 // small deadzone against drift
    g.player.moveX = dead ? 0 : dx;
    g.player.moveZ = dead ? 0 : dy;
    g.player.sprint = len > 0.95 && dy < -0.5;
    nub.style.left = (41 + dx * 40) + 'px';
    nub.style.top = (41 + dy * 40) + 'px';
  }

  // ---------- breaking (hold) ----------
  startBreaking(sx, sy) {
    const g = this.game;
    const hit = g.raycastScreen(sx, sy);
    if (!hit) { this.breakTarget = null; return; }
    const def = BLOCKS[hit.id];
    if (!def || def.hard === Infinity && g.mode === 'survival') { this.breakTarget = null; return; }
    const need = g.mode === 'creative' ? 0.22 : Math.max(0.15, def.hard);
    this.breakTarget = { key: hit.x + ',' + hit.y + ',' + hit.z, hit, progress: 0, need, sx, sy, delay: 0.22 };
  }
  stopBreaking() {
    this.breakTarget = null;
    document.getElementById('break-ring').style.display = 'none';
  }

  update(dt) {
    const g = this.game;
    // keyboard movement
    if (!this.touchMode || document.pointerLockElement) {
      const k = this.keys;
      g.player.moveX = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0);
      g.player.moveZ = (k['KeyS'] ? 1 : 0) - (k['KeyW'] ? 1 : 0);
      g.player.jumpHeld = !!k['Space'];
      g.player.downHeld = !!k['ShiftLeft'];
      g.player.sprint = !!k['ControlLeft'];
    }
    // hold-to-break progress
    const bt = this.breakTarget;
    if (bt) {
      bt.delay -= dt;
      if (bt.delay <= 0) {
        // retarget in case the view drifted (desktop: crosshair)
        bt.progress += dt;
        const ring = document.getElementById('break-ring');
        ring.style.display = 'block';
        ring.style.left = bt.sx + 'px'; ring.style.top = bt.sy + 'px';
        const deg = Math.min(360, bt.progress / bt.need * 360);
        ring.style.background = `conic-gradient(#fff ${deg}deg, transparent ${deg}deg)`;
        if (bt.progress >= bt.need) {
          g.breakBlock(bt.hit);
          this.breakBroke = true;
          this.stopBreaking();
          // allow continuing to dig: re-target after short pause
          if (this.lookTouch) {
            setTimeout(() => { if (this.lookTouch) this.startBreaking(this.lookTouch.lastX, this.lookTouch.lastY); }, 60);
          } else if (this.mouseDown) {
            this.startBreaking(innerWidth / 2, innerHeight / 2);
          }
        }
      }
    }
  }

  // ---------- keyboard / mouse (desktop) ----------
  _bindKeyboard() {
    const g = this.game;
    const canvas = document.getElementById('game-canvas');
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE') g.ui.toggleInventory();
      if (e.code === 'Escape') g.ui.togglePause();
      if (e.code === 'KeyF' && g.mode === 'creative') {
        g.player.flying = !g.player.flying;
        g.toast(g.player.flying ? 'Fliegen: an' : 'Fliegen: aus');
      }
      if (e.code.startsWith('Digit')) {
        const n = +e.code.slice(5);
        if (n >= 1 && n <= 9) g.ui.selectSlot(n - 1);
      }
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    canvas.addEventListener('mousedown', e => {
      if (this.touchMode && !document.pointerLockElement) return;
      if (!document.pointerLockElement) { canvas.requestPointerLock(); return; }
      if (e.button === 0) { this.mouseDown = true; this.startBreaking(innerWidth / 2, innerHeight / 2); if (this.breakTarget) this.breakTarget.delay = 0; }
      if (e.button === 2) g.tapAction(innerWidth / 2, innerHeight / 2);
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; this.stopBreaking(); });
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      if (!document.pointerLockElement) return;
      g.player.yaw -= e.movementX * 0.0022 * this.sensitivity * 4;
      g.player.pitch -= e.movementY * 0.0022 * this.sensitivity * 4;
      g.player.pitch = Math.max(-1.55, Math.min(1.55, g.player.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      document.getElementById('crosshair').style.display = document.pointerLockElement ? 'block' : 'none';
    });
  }
}
