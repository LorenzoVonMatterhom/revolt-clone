import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { LEVELS } from "../src/levels.js";
import { parseObjects, parseInfo } from "../src/revolt.js";
import { initializePhysics, MeshPhysics } from "../src/physics.js";
import { PowerupSystem, POWERUPS, createPowerState, choosePowerup, awardPowerup } from "../src/powerups.js";

const buffer = (path) => { const bytes = readFileSync(path); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => ({ ok: true, arrayBuffer: async () => buffer(url.slice(1)) });
const assets = await PowerupSystem.loadAssets();
globalThis.fetch = originalFetch;
await initializePhysics();
const power = (id) => POWERUPS.find((powerup) => powerup.id === id);

test("oil and bearing use the matching original atlas icons and sound effects", () => {
  assert.deepEqual(power("oil").icon, [192, 224]);
  assert.deepEqual(power("bearing").icon, [0, 192]);
  assert.equal(power("oil").sound, "oildrop");
  assert.equal(power("bearing").sound, "balldrop");
});

test("electro pulse and shockwave have correct icons and the cannon keeps its speed but travels farther", () => {
  assert.deepEqual(power("shockwave").icon,[64,192]);
  assert.deepEqual(power("electro").icon,[224,224]);
  const f=fixture();
  f.racers[0].velocity.set(0,0,50);
  awardPowerup(f.racers[0].powerups,power("shockwave"),false);
  f.system.fire(f.racers[0],f.racers);
  assert.equal(f.system.projectiles[0].velocity.z,155);
  assert.equal(f.system.projectiles[0].life,10);
  const start=f.system.projectiles[0].mesh.position.z;
  f.system.updateProjectiles(4,f.racers);
  assert.equal(f.system.projectiles.length,1);
  assert.equal(f.system.projectiles[0].life,6);
  assert.ok(Math.abs(f.system.projectiles[0].mesh.position.z-start-620)<0.00001);
  f.system.updateProjectiles(6.01,f.racers);
  assert.equal(f.system.projectiles.length,0);
  f.cleanup();
});

function fixture(objects = []) {
  const scene = new THREE.Scene();
  const terrain = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial());
  floor.rotation.x = -Math.PI / 2; terrain.add(floor); scene.add(terrain);
  const physics = new MeshPhysics(terrain);
  const racers = [0, 1, 2].map((i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 8), new THREE.MeshBasicMaterial());
    mesh.position.set(i * 80, 2, 0); scene.add(mesh);
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...mesh.position.toArray()));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1, 4).setMass(8), body);
    return { mesh, position: mesh.position, velocity: new THREE.Vector3(), car: { body }, isPlayer: true, placeScore: i, powerups: createPowerState() };
  });
  const system = new PowerupSystem(scene, physics, terrain, objects, assets);
  return { system, racers, physics, cleanup: () => { system.dispose(racers); physics.dispose(); } };
}

test("all track FOB pickups preserve the original placement and elevation", () => {
  for (const level of LEVELS) {
    const base = `levels/${level.id}/${level.id}`;
    const source = buffer(`${base}.fob`), origin = parseInfo(readFileSync(`${base}.inf`, "utf8")).STARTPOS;
    const objects = parseObjects(source, origin), view = new DataView(source);
    assert.equal(objects.length, view.getInt32(0, true));
    objects.forEach((object, index) => {
      const offset = 4 + index * 56;
      assert.equal(object.type, view.getInt32(offset, true));
      for (let axis = 0; axis < 3; axis++) assert.equal(object.position.getComponent(axis), (view.getFloat32(offset + 20 + axis * 4, true) - origin[axis]) * 0.1 * (axis === 1 ? -1 : 1));
    });
  }
  assert.throws(() => parseObjects(new ArrayBuffer(8)), /Invalid/);
});

test("pickup uses original colored lightning-bolt geometry and only powerup object types", () => {
  const f = fixture([{ type: 30, position: new THREE.Vector3(20, 8, 0), flags: [0,0,0,1] }, { type: 50, position: new THREE.Vector3(40, 4, 0), flags: [0,0,0,1] }, { type: 50, position: new THREE.Vector3(), flags: [1,0,0,0] }, { type: 55, position: new THREE.Vector3(), flags: [0,0,0,0] }]);
  assert.equal(f.system.pickups.length, 2);
  const mesh = f.system.pickups[0].mesh.children[0];
  assert.equal(mesh.geometry, assets.models.pickup.children[0].geometry);
  assert.equal(mesh.material.map, null);
  assert.ok(mesh.geometry.attributes.color.count > 0);
  assert.equal(f.system.pickups[0].position.y, 8);
  f.cleanup();
});

test("position-weighted draws exclude stars for leaders and CPU but allow a rare last-place star", () => {
  assert.equal(choosePowerup(1, 4, false, () => 0).id, "shockwave");
  assert.notEqual(choosePowerup(1, 4, false, () => 0.99999).id, "star");
  assert.equal(choosePowerup(4, 4, false, () => 0.99999).id, "star");
  assert.notEqual(choosePowerup(4, 4, true, () => 0.99999).id, "star");
});

test("cannon has increased selection probability in each race-position table", () => {
  for (const [place, cpu, chance] of [[1,false,10/105],[2,false,20/110],[4,false,40/120],[2,true,20/110]]) {
    const samples=12000;
    let cannons=0;
    for(let i=0;i<samples;i++) if(choosePowerup(place,4,cpu,()=> (i+0.5)/samples).id === "shockwave") cannons++;
    assert.ok(Math.abs(cannons/samples-chance)<1/samples);
  }
});

test("temporary debug selector gives every item instantly and clears it safely", () => {
  const f=fixture(),racer=f.racers[0];
  for(const item of POWERUPS) {
    assert.ok(f.system.debugGive(racer,item.id));
    assert.equal(racer.powerups.rolling,0);
    if(item.id==="bomb") { assert.equal(racer.powerups.bomb,10); assert.equal(racer.powerups.held,null); }
    else { assert.equal(racer.powerups.held,item); assert.equal(racer.powerups.shots,item.shots); }
  }
  f.system.debugClear(racer);
  assert.deepEqual(racer.powerups,createPowerState());
  assert.equal(f.system.debugGive(racer,"invalid"),false);
  f.cleanup();
});

test("one held item, roulette lockout, and pickup respawn", () => {
  const f = fixture([{ type: 30, position: new THREE.Vector3(0, 3, 0), flags: [0,0,0,1] }]);
  const pickup = f.system.pickups[0];
  assert.ok(f.system.collect(f.racers[0], pickup, f.racers));
  assert.equal(pickup.active, false);
  assert.equal(f.system.fire(f.racers[0], f.racers), false);
  assert.equal(awardPowerup(f.racers[0].powerups, power("battery")), false);
  f.racers[0].position.x = 250;
  for (let i = 0; i < 81; i++) f.system.update(0.1, f.racers);
  assert.equal(pickup.active, true);
  f.cleanup();
});

test("three-shot packs consume individual shots and respect cooldown", () => {
  const f = fixture(); awardPowerup(f.racers[0].powerups, power("fireworks"), false);
  for (let shot = 0; shot < 3; shot++) {
    assert.ok(f.system.fire(f.racers[0], f.racers));
    assert.equal(f.system.fire(f.racers[0], f.racers), false);
    f.racers[0].powerups.cooldown = 0;
  }
  assert.equal(f.system.projectiles.length, 3);
  assert.equal(f.racers[0].powerups.held, null);
  f.cleanup();
});

test("turbo lasts eight seconds and cancels an electrical power cut", () => {
  const f = fixture(), state = f.racers[0].powerups;
  state.disabled = 4; awardPowerup(state, power("battery"), false);
  f.system.fire(f.racers[0], f.racers);
  assert.equal(state.boost, 8); assert.equal(state.disabled, 0);
  f.system.update(1, f.racers); assert.equal(state.boost, 7);
  f.cleanup();
});

test("global pulse cuts opponents' power, local pulse affects nearby cars only", () => {
  const f = fixture(); awardPowerup(f.racers[0].powerups, power("star"), false);
  f.system.fire(f.racers[0], f.racers);
  assert.equal(f.racers[0].powerups.disabled, 0);
  assert.equal(f.racers[1].powerups.disabled, 4);
  f.racers.forEach((r) => { r.powerups = createPowerState(); });
  f.racers[1].position.x = 20;
  awardPowerup(f.racers[0].powerups, power("electro"), false); f.system.fire(f.racers[0], f.racers); f.system.update(0.01, f.racers);
  assert.ok(f.racers[1].powerups.disabled > 1);
  assert.equal(f.racers[2].powerups.disabled, 0);
  f.cleanup();
});

test("bomb starts automatically, transfers its remaining fuse, then explodes", () => {
  const f = fixture(); awardPowerup(f.racers[0].powerups, power("bomb"), false);
  assert.equal(f.racers[0].powerups.held, null);
  f.racers[1].position.x = 6; f.system.update(0.01, f.racers);
  assert.equal(f.racers[0].powerups.bomb, 0);
  assert.ok(f.racers[1].powerups.bomb > 9.9);
  f.racers[1].powerups.bomb = 0.01; f.system.update(0.02, f.racers);
  assert.equal(f.racers[1].powerups.bomb, 0);
  assert.ok(f.racers[1].car.body.linvel().y > 0);
  f.cleanup();
});

test("oil reduces grip and a clone detonates on collection", () => {
  const f = fixture(); awardPowerup(f.racers[0].powerups, power("oil"), false);
  f.system.fire(f.racers[0], f.racers); f.racers[1].position.copy(f.system.hazards[0].mesh.position); f.system.update(0.8, f.racers);
  assert.ok(f.racers[1].powerups.slippery > 0);
  f.system.reset(f.racers); awardPowerup(f.racers[0].powerups, power("clone"), false); f.system.fire(f.racers[0], f.racers);
  f.racers[1].position.copy(f.system.hazards[0].mesh.position); f.system.update(0.8, f.racers);
  assert.equal(f.system.hazards.length, 0);
  assert.ok(f.racers[1].car.body.linvel().y > 0);
  f.cleanup();
});

test("ball bearing and water balloons are real dynamic bodies, resets remove them", () => {
  const f = fixture(); awardPowerup(f.racers[0].powerups, power("bearing"), false); f.system.fire(f.racers[0], f.racers);
  assert.ok(f.system.hazards[0].body.mass() >= 39);
  f.racers[0].powerups.cooldown = 0; awardPowerup(f.racers[0].powerups, power("balloons"), false); f.system.fire(f.racers[0], f.racers);
  assert.ok(f.system.projectiles[0].body.isDynamic());
  f.system.reset(f.racers);
  assert.equal(f.system.projectiles.length + f.system.hazards.length, 0);
  assert.equal(f.physics.world.bodies.len(), 3);
  f.cleanup();
});

test("rocket sweep hits mesh walls and shockwaves flip a car only once", () => {
  const f = fixture();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(100, 30, 1), new THREE.MeshBasicMaterial());
  wall.position.set(0, 10, 20); f.system.terrain.add(wall); f.system.terrain.updateMatrixWorld(true);
  awardPowerup(f.racers[0].powerups, power("firework"), false); f.system.fire(f.racers[0], f.racers);
  f.system.updateProjectiles(0.2, f.racers); assert.equal(f.system.projectiles.length, 0);
  f.system.terrain.remove(wall); f.racers[1].position.set(0, 2, 15);
  f.racers[0].powerups.cooldown = 0; awardPowerup(f.racers[0].powerups, power("shockwave"), false); f.system.fire(f.racers[0], f.racers);
  f.system.updateProjectiles(0.01, f.racers); const first = f.racers[1].car.body.linvel().y;
  f.system.updateProjectiles(0.01, f.racers); assert.equal(f.racers[1].car.body.linvel().y, first); assert.ok(first > 0);
  f.cleanup();
});

test("AI racers collect and activate held pickups after roulette", () => {
  const f = fixture([{ type: 30, position: new THREE.Vector3(80, 3, 0), flags: [0,0,0,1] }]);
  f.racers[1].isPlayer = false;
  assert.ok(f.system.collect(f.racers[1], f.system.pickups[0], f.racers));
  // Fix the draw so this tests AI activation rather than random weapon choice.
  f.racers[1].powerups.held = power("battery"); f.racers[1].powerups.shots = 1;
  for (let i = 0; i < 12; i++) f.system.update(0.1, f.racers);
  assert.ok(f.racers[1].powerups.boost > 7);
  assert.equal(f.racers[1].powerups.held, null);
  f.cleanup();
});

test("a burst balloon removes its body and temporarily reduces nearby grip", () => {
  const f = fixture();
  awardPowerup(f.racers[0].powerups, power("balloons"), false); f.system.fire(f.racers[0], f.racers);
  const projectile = f.system.projectiles[0];
  f.racers[1].position.copy(projectile.mesh.position); projectile.life = 0;
  f.system.updateProjectiles(0.01, f.racers);
  assert.equal(f.system.projectiles.length, 0);
  assert.equal(f.racers[1].powerups.slippery, 4);
  assert.equal(f.physics.world.bodies.len(), 3);
  f.cleanup();
});
