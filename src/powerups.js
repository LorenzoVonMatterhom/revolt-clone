import * as THREE from "three";
import { createShockwaveVisual, updateShockwaveVisual, disposeShockwaveVisual } from "./shockwave-visual.js";
import { updateBatteryGlow, disposeBatteryGlow } from "./battery-glow.js";
import { createElectricPulse, disposeElectricPulse } from "./electric-pulse.js";
import { gameAssetUrl } from "./assets.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { parsePrm, makeMeshes, decodeBitmap } from "./revolt.js";

export const POWERUPS = [
  { id: "shockwave", name: "Shockwave", shots: 1, icon: [64, 192], sound: "shockfire" },
  { id: "firework", name: "Firework", shots: 1, icon: [64, 224], sound: "firefire" },
  { id: "fireworks", name: "Firework Pack", shots: 3, icon: [96, 224], sound: "firefire" },
  { id: "bomb", name: "Bomb", shots: 1, icon: [32, 224], sound: "fuse" },
  { id: "balloons", name: "Water Balloons", shots: 3, icon: [128, 224], sound: "wbombfire" },
  { id: "electro", name: "Electro Pulse", shots: 1, icon: [224, 224], sound: "electrozap" },
  { id: "oil", name: "Oil Slick", shots: 1, icon: [192, 224], sound: "oildrop" },
  { id: "bearing", name: "Ball Bearing", shots: 1, icon: [0, 192], sound: "balldrop" },
  { id: "battery", name: "Turbo Battery", shots: 1, icon: [32, 192], sound: "turbo" },
  { id: "clone", name: "Clone Pick Up", shots: 1, icon: [160, 224], sound: "pickgen" },
  { id: "star", name: "Global Pulse", shots: 1, icon: [96, 192], sound: "starfire" },
];
const WEIGHTS = { first: [10,18,5,10,5,18,18,4,8,9,0], middle: [20,10,10,10,10,10,10,10,10,10,0], last: [40,3,15,2,15,2,2,21,17,2,1], cpu: [20,10,5,10,10,5,15,15,10,10,0] };
export function choosePowerup(place, count, cpu, random = Math.random) {
  const weights = WEIGHTS[cpu ? "cpu" : place === 1 ? "first" : place === count ? "last" : "middle"];
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll < 0) return POWERUPS[i]; }
  return POWERUPS[9];
}
export function createPowerState() {
  return { held: null, shots: 0, rolling: 0, cooldown: 0, boost: 0, disabled: 0, slippery: 0, oilWheels: [], electro: 0, bomb: 0, bombLock: 0 };
}
export function awardPowerup(state, powerup, roulette = true) {
  if (state.held || state.rolling > 0 || (state.bomb > 0 && powerup.id === "bomb")) return false;
  state.held = powerup; state.shots = powerup.shots; state.rolling = roulette ? 1 : 0;
  if (powerup.id === "bomb" && !roulette) { state.bomb = 10; state.held = null; state.shots = 0; }
  return true;
}

export class PowerupSystem {
  static async loadAssets() {
    const bitmap = async (name) => decodeBitmap(await (await fetch(gameAssetUrl(`/gfx/${name}.bmp`))).arrayBuffer());
    const [fx, icons, explosions] = await Promise.all([bitmap("fxpage1"), bitmap("fxpage2"), bitmap("fxpage3")]);
    const models = {};
    for (const name of ["pickup", "star", "firework", "wbomb", "ball", "fuse"]) {
      const source = parsePrm(await (await fetch(gameAssetUrl(`/models/${name}.m`))).arrayBuffer());
      const mesh = makeMeshes([source], { 0: fx }, [0, 0, 0]);
      const bounds = new THREE.Box3().setFromObject(mesh), center = bounds.getCenter(new THREE.Vector3());
      mesh.children.forEach((child) => child.position.sub(center));
      models[name] = mesh;
    }
    return { models, fx, icons, explosions };
  }

  constructor(scene, physics, terrain, objects, assets, playSound = () => {}) {
    this.scene = scene; this.physics = physics; this.terrain = terrain; this.assets = assets; this.playSound = playSound;
    this.group = new THREE.Group(); this.group.name = "Original pickups and weapons"; scene.add(this.group);
    this.pickups = objects.filter((o) => o.type === 30 || (o.type === 50 && o.flags[0] === 0)).map((o) => {
      const mesh = assets.models[o.type === 50 ? "star" : "pickup"].clone(true);
      mesh.name = o.type === 50 ? "Original global-pulse star" : "Original pickup.m";
      mesh.position.copy(o.position); this.group.add(mesh);
      return { mesh, position: o.position.clone(), star: o.type === 50, active: true, respawn: 0 };
    });
    this.projectiles = []; this.hazards = []; this.effects = []; this.time = 0;
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
  }

  reset(racers) {
    for (const entity of [...this.projectiles, ...this.hazards, ...this.effects]) this.remove(entity);
    this.projectiles = []; this.hazards = []; this.effects = []; this.time = 0;
    for (const pickup of this.pickups) { pickup.active = true; pickup.respawn = 0; pickup.mesh.visible = true; }
    for (const racer of racers) {
      this.restoreCar(racer); racer.powerups = createPowerState();
    }
  }

  remove(entity) {
    this.group.remove(entity.mesh);
    if (entity.body) this.physics.world.removeRigidBody(entity.body);
    if (entity.kind === "shockwave") disposeShockwaveVisual(entity.mesh);
    else if (entity.unique) { entity.mesh.geometry?.dispose(); entity.mesh.material?.dispose(); }
    if (entity.texture) { entity.mesh.material.dispose(); entity.texture.dispose(); }
  }

  dispose(racers) { this.reset(racers); this.scene.remove(this.group); }

  setBombAppearance(racer, active) {
    const fuse = racer.mesh.userData.bombFuse;
    racer.mesh.traverse(object => {
      if (!object.material || object.userData.batteryGlowFX || object.userData.electricPulseFX || fuse?.getObjectById(object.id)) return;
      if (active && !object.userData.bombOriginalMaterial) {
        object.userData.bombOriginalMaterial = object.material;
        const black = material => object.isLine
          ? new THREE.LineBasicMaterial({ color: 0x000000 })
          : object.isPoints ? new THREE.PointsMaterial({ color: 0x000000, size: material.size })
          : new THREE.MeshBasicMaterial({ color: 0x000000, side: material.side });
        object.material = Array.isArray(object.material) ? object.material.map(black) : black(object.material);
      } else if (!active && object.userData.bombOriginalMaterial) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        object.material = object.userData.bombOriginalMaterial;
        delete object.userData.bombOriginalMaterial;
      }
    });
  }

  restoreCar(racer) {
    racer.mesh.userData.antenna?.setFuseRemaining(null);
    delete racer.mesh.userData.bombBurning;
    disposeBatteryGlow(racer.mesh);
    this.setBombAppearance(racer, false);
    disposeElectricPulse(racer.mesh);
    if (racer.mesh.userData.bombFuse) {
      racer.mesh.remove(racer.mesh.userData.bombFuse);
      delete racer.mesh.userData.bombFuse;
    }
    racer.mesh.traverse((o) => { if (o.material?.color && o.userData.powerupColor) o.material.color.copy(o.userData.powerupColor); });
  }

  updateElectricPulse(racer) {
    if ((racer.powerups.electro <= 0 && racer.powerups.disabled <= 0) || racer.powerups.bomb > 0) { disposeElectricPulse(racer.mesh); return; }
    const shell = racer.mesh.userData.electricPulse ??= createElectricPulse(racer.mesh);
    shell.material.uniforms.time.value = this.time;
    shell.material.uniforms.strength.value = Math.min(1, Math.max(racer.powerups.electro, racer.powerups.disabled) * 4);
  }

  forward(racer) { return new THREE.Vector3(0, 0, 1).applyQuaternion(racer.mesh.quaternion).normalize(); }

  flash(position, color = 0xffb326, radius = 12) {
    const texture = this.assets.explosions.clone();
    texture.repeat.set(0.125, 0.125); texture.offset.set(0, 0.75); texture.needsUpdate = true;
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.copy(position); mesh.scale.setScalar(radius);
    this.group.add(mesh); this.effects.push({ mesh, life: 0.5, radius, texture });
  }

  bolt(from, to) {
    const points = Array.from({ length: 9 }, (_, i) => {
      const point = from.clone().lerp(to, i / 8).add(new THREE.Vector3(0, 2, 0));
      if (i > 0 && i < 8) point.add(new THREE.Vector3(Math.sin(i * 7 + this.time * 20) * 1.4, Math.cos(i * 9) * 1.4, 0));
      return point;
    });
    const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xd9ccff, transparent: true, blending: THREE.AdditiveBlending }));
    this.group.add(mesh); this.effects.push({ mesh, life: 0.16, bolt: true, unique: true });
  }

  explode(position, racers, owner = null, radius = 20, sound = "puttbang") {
    this.flash(position); this.playSound(sound, position);
    for (const racer of racers) {
      const distance = racer.position.distanceTo(position);
      if (distance > radius || (owner === racer && distance > 6)) continue;
      const direction = racer.position.clone().sub(position); direction.y = 0;
      if (direction.lengthSq() < 0.01) direction.set(1, 0, 0);
      direction.normalize().multiplyScalar(120 * (1 - distance / radius)); direction.y = 150;
      racer.car.body.applyImpulse(direction, true);
      racer.car.body.applyTorqueImpulse({ x: 70, y: 20, z: 50 }, true);
    }
  }

  spawnProjectile(racer, kind) {
    const forward = this.forward(racer);
    const mesh = kind === "shockwave" ? createShockwaveVisual() : this.assets.models[kind === "balloons" ? "wbomb" : "firework"].clone(true);
    if (kind === "balloons") mesh.scale.setScalar(0.4);
    mesh.position.copy(racer.position).addScaledVector(forward, 12); mesh.position.y += 3;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
    this.group.add(mesh);
    // Fireworks must be able to catch the doubled-speed cars.
    const projectileSpeed = kind === "balloons" ? 85 : kind === "firework" ? 210 : 105;
    const launchLift = kind === "balloons" ? 26 : 0;
    const entity = { mesh, owner: racer, kind, velocity: forward.multiplyScalar(projectileSpeed).add(racer.velocity), life: kind === "shockwave" ? 10 : 5, unique: kind === "shockwave", bounces: 0, previousVy: launchLift, hitCars: new Set() };
    if (kind === "balloons") {
      entity.body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...mesh.position.toArray()).setLinvel(entity.velocity.x, launchLift, entity.velocity.z).setCcdEnabled(true));
      this.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.8).setRestitution(0.65).setMass(0.2), entity.body);
    }
    this.projectiles.push(entity);
  }

  dropHazard(racer, kind) {
    const position = racer.position.clone().addScaledVector(this.forward(racer), -14);
    const floor = this.physics.groundAt(position, 5, 40);
    if (floor === null) return;
    position.y = floor + 0.08;
    let mesh;
    if (kind === "clone") mesh = this.assets.models.pickup.clone(true);
    else if (kind === "bearing") { mesh = this.assets.models.ball.clone(true); mesh.scale.setScalar(0.35); position.y += 3.5; }
    else { mesh = new THREE.Mesh(new THREE.CircleGeometry(8, 24), new THREE.MeshBasicMaterial({ color: 0x121017, transparent: true, opacity: 0.85, depthWrite: false })); mesh.rotation.x = -Math.PI / 2; }
    mesh.position.copy(position); this.group.add(mesh);
    if (kind === "clone") mesh.position.y += 4;
    const hazard = { kind, mesh, owner: racer, life: 30, armed: 0.7, unique: kind === "oil" };
    if (kind === "bearing") {
      hazard.body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...position.toArray()).setLinvel(racer.velocity.x * 0.6, 0, racer.velocity.z * 0.6).setCcdEnabled(true));
      this.physics.world.createCollider(RAPIER.ColliderDesc.ball(3.5).setMass(40).setFriction(0.8).setRestitution(0.2), hazard.body);
    }
    this.hazards.push(hazard);
  }

  fire(racer, racers) {
    const state = racer.powerups;
    if (!state?.held || state.rolling > 0 || state.cooldown > 0 || racer.finished) return false;
    const powerup = state.held;
    state.cooldown = 0.35;
    this.playSound(powerup.sound, racer.position);
    if (["shockwave", "firework", "fireworks", "balloons"].includes(powerup.id)) this.spawnProjectile(racer, powerup.id === "fireworks" ? "firework" : powerup.id);
    else if (["oil", "bearing", "clone"].includes(powerup.id)) this.dropHazard(racer, powerup.id);
    else if (powerup.id === "battery") { state.boost = 8; state.disabled = 0; updateBatteryGlow(racer.mesh, true, this.time, state.boost); }
    else if (powerup.id === "electro") { state.electro = 8; this.updateElectricPulse(racer); }
    else if (powerup.id === "star") {
      for (const other of racers) if (other !== racer) other.powerups.disabled = 4;
      this.flash(racer.position, 0x70ddff, 30);
    }
    if (--state.shots <= 0) { state.held = null; state.shots = 0; }
    return true;
  }

  debugGive(racer, id) {
    const powerup = POWERUPS.find((item) => item.id === id);
    if (!powerup) return false;
    this.restoreCar(racer);
    racer.powerups = createPowerState();
    awardPowerup(racer.powerups, powerup, false);
    return true;
  }

  debugClear(racer) {
    this.restoreCar(racer);
    racer.powerups = createPowerState();
    for (const collection of ["projectiles", "hazards"]) this[collection] = this[collection].filter((entity) => {
      if (entity.owner !== racer) return true;
      this.remove(entity); return false;
    });
  }

  collect(racer, pickup, racers) {
    const sorted = [...racers].sort((a, b) => b.placeScore - a.placeScore);
    const powerup = pickup.star ? POWERUPS.at(-1) : choosePowerup(sorted.indexOf(racer) + 1, racers.length, !racer.isPlayer);
    if (!awardPowerup(racer.powerups, powerup)) return false;
    pickup.active = false; pickup.respawn = 8; pickup.mesh.visible = false;
    if (racer.isPlayer) this.playSound("pickup", racer.position);
    return true;
  }

  update(dt, racers) {
    this.time += dt;
    for (const racer of racers) {
      const state = racer.powerups ??= createPowerState();
      for (const key of ["cooldown", "boost", "disabled", "slippery", "electro", "bombLock"]) state[key] = Math.max(0, state[key] - dt);
      state.oilWheels = (state.oilWheels ?? []).map(time => Math.max(0, time - dt));
      if (state.rolling > 0) {
        state.rolling = Math.max(0, state.rolling - dt);
        if (state.rolling === 0 && state.held?.id === "bomb") { state.bomb = 10; state.held = null; state.shots = 0; this.playSound("fuse", racer.position); }
      }
      if (state.bomb > 0) {
        state.bomb = Math.max(0, state.bomb - dt);
        if (state.bomb === 0) this.explode(racer.position, racers);
        else if (state.bombLock === 0) {
          const other = racers.find((other) => other !== racer && other.powerups.bomb === 0 && other.powerups.bombLock === 0 && other.position.distanceTo(racer.position) < 12);
          if (other) {
            other.powerups.bomb = state.bomb; other.powerups.bombLock = 1;
            state.bomb = 0; state.bombLock = 1;
          }
        }
      }
      updateBatteryGlow(racer.mesh, state.boost > 0 && state.bomb === 0, this.time, state.boost);
      this.setBombAppearance(racer, state.bomb > 0);
      racer.mesh.traverse((object) => {
        if (state.bomb > 0 || !object.material?.color) return;
        object.userData.powerupColor ??= object.material.color.clone();
        object.material.color.copy(object.userData.powerupColor);

      });
      this.updateElectricPulse(racer);
      if (state.electro > 0) for (const other of racers) {
        if (other !== racer && other.position.distanceTo(racer.position) < 35) {
          other.powerups.disabled = Math.max(other.powerups.disabled, 2);
          if (Math.floor(this.time * 6) !== Math.floor((this.time - dt) * 6)) this.bolt(racer.position, other.position);
        }
      }
      if (state.bomb > 0) {
        racer.mesh.userData.bombBurning = true;
        const antenna = racer.mesh.userData.antenna;
        antenna?.setFuseRemaining(state.bomb / 10);
        if (Math.floor(this.time * 5) !== Math.floor((this.time - dt) * 5)) {
          const spark = antenna ? racer.mesh.localToWorld(antenna.tip.position.clone()) : racer.position.clone().add(new THREE.Vector3(0, 6, 0));
          this.flash(spark, 0xff9b21, 1.2);
        }
      } else if (racer.mesh.userData.bombBurning) this.restoreCar(racer);
      if (!racer.isPlayer && state.held && state.rolling === 0 && state.cooldown === 0) this.fire(racer, racers);
    }
    for (const pickup of this.pickups) {
      pickup.mesh.rotation.y += dt * 2;
      pickup.mesh.position.y = pickup.position.y + Math.sin(this.time * 3 + pickup.position.x) * 0.35;
      if (!pickup.active) {
        pickup.respawn -= dt;
        if (pickup.respawn <= 0) { pickup.active = true; pickup.mesh.visible = true; }
      }
      if (pickup.active) for (const racer of racers) {
        if (!racer.finished && racer.position.distanceTo(pickup.position) < 10 && this.collect(racer, pickup, racers)) break;
      }
    }
    this.updateProjectiles(dt, racers);
    for (const hazard of this.hazards) {
      hazard.life -= dt; hazard.armed -= dt;
      if (hazard.body) { hazard.mesh.position.copy(hazard.body.translation()); hazard.mesh.quaternion.copy(hazard.body.rotation()); }
      if (hazard.kind === "clone") hazard.mesh.rotation.y += dt * 2;
      if (hazard.armed <= 0 && hazard.kind !== "bearing") for (const racer of racers) {
        if (hazard.kind === "oil") {
          const vehicle = racer.car.vehicle;
          let touched = false;
          for (let i = 0; i < (vehicle?.numWheels() ?? 0); i++) {
            if (!vehicle.wheelIsInContact(i)) continue;
            const point = vehicle.wheelContactPoint(i);
            if (!point || Math.abs(point.y - hazard.mesh.position.y) > 3) continue;
            const width = racer.car.setup.wheels[i].halfWidth ?? 0.5;
            if (Math.hypot(point.x - hazard.mesh.position.x, point.z - hazard.mesh.position.z) > 8 + width) continue;
            racer.powerups.oilWheels[i] = 4; touched = true;
          }
          if (!vehicle && racer.position.distanceTo(hazard.mesh.position) < 10) touched = true;
          if (touched) racer.powerups.slippery = 4;
          continue;
        }
        const delta = racer.position.clone().sub(hazard.mesh.position);
        if (Math.abs(delta.y) < 8 && Math.hypot(delta.x, delta.z) < 10) {
          if (hazard.kind === "clone") { this.explode(hazard.mesh.position, racers); hazard.life = 0; break; }
          racer.powerups.slippery = 4;
        }
      }
    }
    this.hazards = this.hazards.filter((hazard) => { if (hazard.life > 0) return true; this.remove(hazard); return false; });
    this.effects = this.effects.filter((effect) => {
      effect.life -= dt;
      effect.mesh.material.opacity = Math.max(0, effect.life * (effect.bolt ? 6.25 : 2));
      if (!effect.bolt) effect.mesh.scale.setScalar(effect.radius * (2 - effect.life));
      if (effect.life > 0) return true;
      this.remove(effect); return false;
    });
  }

  steerFirework(projectile, dt, racers) {
    const position = projectile.mesh.position;
    let closest = Infinity;
    projectile.target = null;
    for (const racer of racers) {
      if (racer === projectile.owner || racer.finished) continue;
      const distance = racer.position.distanceToSquared(position);
      if (distance < closest) { closest = distance; projectile.target = racer; }
    }
    if (!projectile.target) return;
    const speed = projectile.velocity.length();
    if (speed < 0.001) return;
    const distance = Math.sqrt(closest);
    const aim = projectile.target.position.clone().add(new THREE.Vector3(0, 2, 0))
      .addScaledVector(projectile.target.velocity, Math.min(0.75, distance / speed)).sub(position);
    // Turn tightly near the target instead of circling it. Preserve flight speed
    // through turns and steer yaw separately so U-turns do not dive underground.
    const turn = Math.max(8, speed * 1.5 / Math.max(8, distance)) * dt;
    const yaw = Math.atan2(projectile.velocity.x, projectile.velocity.z);
    const desiredYaw = Math.atan2(aim.x, aim.z);
    const yawDelta = Math.atan2(Math.sin(desiredYaw - yaw), Math.cos(desiredYaw - yaw));
    const heading = yaw + THREE.MathUtils.clamp(yawDelta, -turn, turn);
    const pitch = Math.atan2(projectile.velocity.y, Math.hypot(projectile.velocity.x, projectile.velocity.z));
    const desiredPitch = Math.atan2(aim.y, Math.hypot(aim.x, aim.z));
    const elevation = pitch + THREE.MathUtils.clamp(desiredPitch - pitch, -turn, turn);
    projectile.velocity.set(Math.sin(heading) * Math.cos(elevation), Math.sin(elevation), Math.cos(heading) * Math.cos(elevation)).multiplyScalar(speed);
  }

  updateProjectiles(dt, racers) {
    for (const projectile of this.projectiles) {
      projectile.life -= dt;
      if (projectile.kind === "shockwave") updateShockwaveVisual(projectile.mesh, dt, projectile.velocity.length());
      const previous = projectile.mesh.position.clone();
      if (projectile.body) {
        projectile.mesh.position.copy(projectile.body.translation());
        const vy = projectile.body.linvel().y;
        if (projectile.previousVy < -1 && vy > 1) projectile.bounces++;
        projectile.previousVy = vy;
        if (projectile.bounces > 1) projectile.life = 0;
      } else {
        if (projectile.kind === "firework") this.steerFirework(projectile, dt, racers);
        projectile.mesh.position.addScaledVector(projectile.velocity, dt);
        projectile.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), projectile.velocity.clone().normalize());
        const segment = projectile.mesh.position.clone().sub(previous);
        this.ray.set(previous, segment.clone().normalize()); this.ray.far = segment.length();
        const hit = this.ray.intersectObject(this.terrain, true)[0];
        if (hit) { projectile.mesh.position.copy(hit.point); projectile.life = 0; }
      }
      const segment = new THREE.Line3(previous, projectile.mesh.position);
      for (const racer of racers) {
        if (racer === projectile.owner || projectile.hitCars.has(racer)) continue;
        const closest = segment.closestPointToPoint(racer.position, true, new THREE.Vector3());
        if (closest.distanceTo(racer.position) > (projectile.kind === "shockwave" ? 12 : 8)) continue;
        projectile.hitCars.add(racer);
        if (projectile.kind === "shockwave") {
          const body = racer.car.body;
          // Give every chassis the same launch and roll, regardless of mass or inertia.
          const velocity = body.linvel();
          body.applyImpulse({ x: 0, y: body.mass() * Math.max(0, 24 - velocity.y), z: 0 }, true);
          const roll = new THREE.Vector3(0, 0, 14).applyQuaternion(body.rotation());
          const spin = body.angvel();
          body.setAngvel({ x: spin.x + roll.x, y: spin.y + roll.y, z: spin.z + roll.z }, true);
        }
        else projectile.life = 0;
      }
      if (projectile.life <= 0 && projectile.kind === "balloons") {
        this.flash(projectile.mesh.position, 0x88dfff, 15); this.playSound("wbombhit", projectile.mesh.position);
        for (const racer of racers) if (racer.position.distanceTo(projectile.mesh.position) < 22) racer.powerups.slippery = 4;
      } else if (projectile.life <= 0 && projectile.kind === "firework") this.explode(projectile.mesh.position, racers, projectile.owner, 20, "firebang");
    }
    this.projectiles = this.projectiles.filter((projectile) => { if (projectile.life > 0) return true; this.remove(projectile); return false; });
  }

  drawIcon(canvas, powerup) {
    const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!powerup) return;
    const image = this.assets.icons.image, [x, y] = powerup.icon;
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let row = 0; row < 32; row++) pixels.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + 32) * 4), row * 128);
    const small = document.createElement("canvas"); small.width = small.height = 32;
    small.getContext("2d").putImageData(new ImageData(pixels, 32, 32), 0, 0);
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  }
}
