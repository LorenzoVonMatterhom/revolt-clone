import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { SkidMarks } from "../src/skid-marks.js";
import { FlexibleAntenna } from "../src/car-effects.js";
import { LEVELS } from "../src/levels.js";
import { parseObjects, parseInfo, loadCar } from "../src/revolt.js";
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

function fixture(objects = [], playSound) {
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
  const system = new PowerupSystem(scene, physics, terrain, objects, assets, playSound);
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
  const sounds = [];
  const f = fixture([], sound => sounds.push(sound)); awardPowerup(f.racers[0].powerups, power("bomb"), false);
  assert.equal(f.racers[0].powerups.held, null);
  f.racers[1].position.x = 6; f.system.update(0.01, f.racers);
  assert.equal(f.racers[0].powerups.bomb, 0);
  assert.ok(f.racers[1].powerups.bomb > 9.9);
  f.racers[1].powerups.bomb = 0.01; f.system.update(0.02, f.racers);
  assert.equal(f.racers[1].powerups.bomb, 0);
  assert.ok(f.racers[1].car.body.linvel().y > 0);
  assert.ok(sounds.includes("puttbang"));
  assert.ok(!sounds.includes("firebang"));
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
  const sounds = [];
  const f = fixture([], sound => sounds.push(sound));
  f.racers[1].position.set(0, 2, 80); f.racers[2].position.set(0, 2, 160);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(100, 30, 1), new THREE.MeshBasicMaterial());
  wall.position.set(0, 10, 20); f.system.terrain.add(wall); f.system.terrain.updateMatrixWorld(true);
  awardPowerup(f.racers[0].powerups, power("firework"), false); f.system.fire(f.racers[0], f.racers);
  f.system.updateProjectiles(0.2, f.racers); assert.equal(f.system.projectiles.length, 0);
  assert.ok(sounds.includes("firebang"));
  assert.ok(!sounds.includes("puttbang"));
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

test("electro pulse creates an animated car aura and cleans it up on expiry and reset", () => {
  const f = fixture(), racer = f.racers[0];
  try {
    awardPowerup(racer.powerups, power("electro"), false); f.system.fire(racer, f.racers);
    const aura = racer.mesh.userData.electricPulse;
    assert.ok(aura?.material.isShaderMaterial);
    assert.equal(aura.parent, racer.mesh);
    assert.equal(aura.material.depthWrite, false);
    f.system.update(0.1, f.racers);
    assert.ok(aura.material.uniforms.time.value > 0);
    assert.equal(racer.mesh.userData.electricPulse, aura, "Aura should reuse its geometry each frame");
    f.system.update(8, f.racers);
    assert.equal(racer.mesh.userData.electricPulse, undefined);
    assert.equal(aura.parent, null);
    f.system.debugGive(racer,"electro"); f.system.fire(racer,f.racers);
    assert.ok(racer.mesh.userData.electricPulse);
    f.system.reset(f.racers);
    assert.equal(racer.mesh.userData.electricPulse, undefined);
  } finally { f.cleanup(); }
});

test("water balloons travel over 100 units before landing and inherit car speed", () => {
  for (const carSpeed of [0, 30]) {
    const f = fixture();
    try {
      f.racers[0].velocity.z = carSpeed;
      awardPowerup(f.racers[0].powerups, power("balloons"), false);
      f.system.fire(f.racers[0], f.racers);
      const projectile = f.system.projectiles[0];
      assert.ok(Math.abs(projectile.body.linvel().z - (85 + carSpeed)) < 0.001);
      for (let i=0; i<360 && projectile.bounces === 0; i++) {
        f.physics.step(); f.system.updateProjectiles(1/120, f.racers);
      }
      assert.equal(projectile.bounces, 1, "Balloon must still land and bounce");
      assert.ok(projectile.mesh.position.z > 110 + carSpeed, "Throw should reach distant cars before its first bounce");
    } finally { f.cleanup(); }
  }
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

for (const [label, near, far] of [
  ["beside the shooter", [45, 2, 12], [0, 2, 100]],
  ["behind the shooter", [0, 2, -60], [100, 2, 180]],
  ["beyond the old homing range", [120, 2, 240], [0, 2, 450]],
]) test(`fireworks find the closest opponent ${label}`, () => {
  const f = fixture();
  try {
    f.racers[1].position.set(...near); f.racers[2].position.set(...far);
    awardPowerup(f.racers[0].powerups, power("firework"), false);
    f.system.fire(f.racers[0], f.racers);
    const rocket = f.system.projectiles[0], speed = rocket.velocity.length();
    f.system.updateProjectiles(1 / 120, f.racers);
    assert.equal(rocket.target, f.racers[1]);
    assert.ok(Math.abs(rocket.velocity.length() - speed) < 0.00001);
  } finally { f.cleanup(); }
});

test("fireworks turn sharply enough to hit opponents beside and behind the car", () => {
  for (const position of [[60, 2, 12], [0, 2, -50]]) {
    const f = fixture();
    try {
      f.racers[1].position.set(...position); f.racers[2].finished = true;
      awardPowerup(f.racers[0].powerups, power("fireworks"), false);
      f.system.fire(f.racers[0], f.racers);
      const rocket = f.system.projectiles[0];
      for (let frame = 0; frame < 240 && f.system.projectiles.length; frame++) f.system.updateProjectiles(1 / 120, f.racers);
      assert.ok(rocket.hitCars.has(f.racers[1]), `Missed opponent at ${position}`);
      assert.ok(f.racers[1].car.body.linvel().y > 0);
    } finally { f.cleanup(); }
  }
});

test("fireworks lead a moving opponent and preserve inherited speed through turns", () => {
  const f = fixture();
  try {
    f.racers[0].velocity.set(0, 0, 120);
    f.racers[1].position.set(90, 2, 180); f.racers[1].velocity.set(120, 0, 0);
    f.racers[2].finished = true;
    awardPowerup(f.racers[0].powerups, power("firework"), false);
    f.system.fire(f.racers[0], f.racers);
    const rocket = f.system.projectiles[0], speed = rocket.velocity.length();
    assert.ok(speed > 300);
    for (let frame = 0; frame < 360 && f.system.projectiles.length; frame++) {
      f.racers[1].position.addScaledVector(f.racers[1].velocity, 1 / 120);
      f.system.updateProjectiles(1 / 120, f.racers);
      assert.ok(Math.abs(rocket.velocity.length() - speed) < 0.00001);
    }
    assert.ok(rocket.hitCars.has(f.racers[1]), "Rocket must intercept the moving car");
    assert.equal(rocket.target, f.racers[1], "Finished racers must not draw the rocket away");
  } finally { f.cleanup(); }
});

for (const id of ["rc", "cougar", "sugo", "phat"]) test(`shockwave overturns the original ${id} chassis`, async () => {
  const f = fixture();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(url.slice(1)));
  let mesh;
  try {
    mesh = await loadCar(id, id);
    const car = f.physics.createCar(mesh, { autoRighting: false });
    car.body.setTranslation({ x: 0, y: 2, z: 15 }, true);
    const target = { mesh, position: new THREE.Vector3(0, 2, 15), velocity: new THREE.Vector3(), car, powerups: createPowerState() };
    awardPowerup(f.racers[0].powerups, power("shockwave"), false);
    f.system.fire(f.racers[0], [f.racers[0], target]);
    f.system.updateProjectiles(1 / 120, [f.racers[0], target]);
    assert.ok(car.body.linvel().y >= 23.9);
    let inverted = false;
    for (let frame = 0; frame < 72; frame++) {
      f.physics.updateVehicle(car, 1 / 120, 0, 0, 0, false);
      f.physics.step();
      if (new THREE.Vector3(0, 1, 0).applyQuaternion(car.body.rotation()).y < -0.5) inverted = true;
    }
    assert.ok(inverted, `${id} should roll past upside down after a hit`);
  } finally {
    globalThis.fetch = savedFetch;
    f.cleanup();
    mesh?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test("bomb makes textured, emissive and multi-material car parts solid black and restores originals", () => {
  const f = fixture(), racer = f.racers[0];
  const texture = new THREE.Texture();
  const bright = new THREE.MeshStandardMaterial({ color: 0xff6633, emissive: 0xffffff, map: texture });
  const glass = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .3 });
  const part = new THREE.Mesh(new THREE.BoxGeometry(), [bright, glass]); racer.mesh.add(part);
  const original = racer.mesh.material;
  try {
    f.system.debugGive(racer, "bomb"); f.system.update(.01, f.racers);
    assert.equal(racer.mesh.material.color.getHex(), 0);
    for (const material of part.material) {
      assert.equal(material.color.getHex(), 0);
      assert.equal(material.isMeshBasicMaterial, true);
      assert.equal(material.map, null);
      assert.equal(material.transparent, false);
    }
    assert.equal(bright.color.getHex(), 0xff6633);
    f.system.debugClear(racer);
    assert.equal(racer.mesh.material, original);
    assert.equal(part.material[0], bright); assert.equal(part.material[1], glass);
    assert.equal(bright.color.getHex(), 0xff6633);
    assert.equal(original.color.getHex(), 0xffffff);
    f.system.debugGive(racer, "bomb"); f.system.update(.01, f.racers);
    racer.powerups.bomb = .001; f.system.update(.01, f.racers);
    assert.equal(racer.mesh.material, original);
    assert.equal(part.material[0], bright);
  } finally { f.cleanup(); texture.dispose(); }
});

test("battery adds a reusable orange surface shader and restores the car on expiry and reset", () => {
  const f = fixture(), racer = f.racers[0], original = racer.mesh.material;
  try {
    awardPowerup(racer.powerups, power("battery"), false); f.system.fire(racer, f.racers);
    const glow = racer.mesh.userData.batteryGlow;
    assert.ok(glow.material.isShaderMaterial);
    assert.equal(glow.meshes[0].geometry, racer.mesh.geometry);
    assert.equal(glow.meshes[0].parent, racer.mesh);
    assert.equal(racer.mesh.material, original);
    f.system.update(.1, f.racers);
    assert.equal(racer.mesh.userData.batteryGlow, glow);
    assert.ok(glow.material.uniforms.time.value > 0);
    f.system.update(8, f.racers);
    assert.equal(racer.mesh.userData.batteryGlow, undefined);
    assert.equal(glow.meshes[0].parent, null);
    f.system.debugGive(racer, "battery"); f.system.fire(racer, f.racers);
    f.system.reset(f.racers); assert.equal(racer.mesh.userData.batteryGlow, undefined);
    f.system.debugGive(racer, "battery"); f.system.fire(racer, f.racers);
    racer.powerups.bomb = 5; f.system.update(.01, f.racers);
    assert.equal(racer.mesh.userData.batteryGlow, undefined);
    assert.equal(racer.mesh.material.color.getHex(), 0);
  } finally { f.cleanup(); }
});

test("shockwave has a glowing blue-white core and a growing bead trail with resource cleanup", () => {
  const f = fixture();
  try {
    awardPowerup(f.racers[0].powerups, power("shockwave"), false); f.system.fire(f.racers[0], f.racers);
    const mesh = f.system.projectiles[0].mesh;
    assert.equal(mesh.children.length, 15);
    assert.equal(mesh.children[2].material.color.getHex(), 0xffffff);
    assert.equal(mesh.children[0].material.blending, THREE.AdditiveBlending);
    assert.ok(mesh.userData.beads.every(bead => !bead.visible));
    f.system.updateProjectiles(.1, [f.racers[0]]);
    assert.ok(mesh.userData.beads[0].visible);
    assert.ok(!mesh.userData.beads[11].visible);
    let textures = 0, materials = 0;
    mesh.userData.shockwaveTexture.addEventListener("dispose", () => textures++);
    mesh.children.forEach(part => part.material.addEventListener("dispose", () => materials++));
    f.system.reset(f.racers);
    assert.equal(textures, 1); assert.equal(materials, 15);
  } finally { f.cleanup(); }
});

test("electric lightning follows body surfaces, preserves paint, and affects shocked opponents", () => {
  const f = fixture(), racer = f.racers[0], target = f.racers[1];
  const original = racer.mesh.material;
  racer.mesh.material.color.set(0xdd2233);
  target.position.set(20,2,0);
  try {
    awardPowerup(racer.powerups, power("electro"), false); f.system.fire(racer,f.racers); f.system.update(.1,f.racers);
    const effect = racer.mesh.userData.electricPulse;
    assert.ok(effect.isGroup);
    assert.equal(effect.userData.overlays[0].geometry,racer.mesh.geometry);
    assert.equal(effect.userData.overlays[0].parent,racer.mesh);
    assert.equal(racer.mesh.material,original);
    assert.equal(original.color.getHex(),0xdd2233);
    assert.ok(target.powerups.disabled>0);
    f.system.update(.1,f.racers);
    assert.ok(target.mesh.userData.electricPulse);
    const overlay=effect.userData.overlays[0];
    f.system.reset(f.racers);
    assert.equal(overlay.parent,null);
    assert.equal(racer.mesh.material,original);
  } finally { f.cleanup(); }
});

test("ticking bomb leaves the item slot free and transferring it preserves held power-ups", () => {
  const f = fixture();
  try {
    const owner = f.racers[0], other = f.racers[1];
    awardPowerup(owner.powerups,power("bomb"),false);
    assert.ok(awardPowerup(owner.powerups,power("fireworks"),false));
    assert.ok(f.system.fire(owner,f.racers));
    assert.ok(owner.powerups.bomb > 0);
    awardPowerup(other.powerups,power("battery"),false);
    other.position.set(6,2,0);
    f.system.update(.01,f.racers);
    assert.equal(owner.powerups.bomb,0);
    assert.ok(other.powerups.bomb>0);
    assert.equal(other.powerups.held.id,"battery");
    assert.equal(owner.powerups.held.id,"fireworks");
    assert.ok(f.system.fire(other,f.racers));
    assert.ok(other.powerups.boost>0);
    assert.ok(other.powerups.bomb>0);
  } finally { f.cleanup(); }
});

test("bomb countdown burns the real flexible antenna and restores it after explosion", () => {
  const f = fixture(), racer = f.racers[0];
  const antenna = racer.mesh.userData.antenna = new FlexibleAntenna(racer.mesh, {
    offset: new THREE.Vector3(0,2,-1), direction: new THREE.Vector3(0,1,0), length: 4,
  });
  try {
    awardPowerup(racer.powerups,power("bomb"),false);
    f.system.update(5,f.racers);
    assert.equal(antenna.fuseFraction,.5);
    assert.equal(antenna.rods.filter(rod=>rod.visible).length,4);
    assert.equal(racer.mesh.userData.bombFuse,undefined);
    f.system.update(5,f.racers);
    assert.equal(antenna.fuseFraction,null);
    assert.ok(antenna.rods.every(rod=>rod.visible));
  } finally { f.cleanup(); }
});

test("oil coats the wheels touching the slick and the coating expires with low friction", () => {
  const f=fixture(),owner=f.racers[0],other=f.racers[1];
  let touches=true;
  try {
    awardPowerup(owner.powerups,power("oil"),false);f.system.fire(owner,f.racers);
    const oil=f.system.hazards[0];oil.armed=0;
    other.car.setup={wheels:[{halfWidth:.5},{halfWidth:.5}]};
    other.car.vehicle={numWheels:()=>2,wheelIsInContact:()=>touches,
      wheelContactPoint:i=>({x:oil.mesh.position.x+i*20,y:oil.mesh.position.y,z:oil.mesh.position.z})};
    f.system.update(.01,f.racers);
    assert.equal(other.powerups.oilWheels[0],4);
    assert.ok(!(other.powerups.oilWheels[1]>0));assert.equal(other.powerups.slippery,4);
    touches=false;f.system.update(4.01,f.racers);
    assert.equal(other.powerups.oilWheels[0],0);assert.equal(other.powerups.slippery,0);
  } finally {f.cleanup();}
});

test("a real car crossing freshly dropped oil immediately leaves full-width oily tire marks", async () => {
  const f=fixture(), savedFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  const marks=new SkidMarks(f.system.scene);
  let mesh;
  try {
    mesh=await loadCar("rc","RC Bandit");
    const car=f.physics.createCar(mesh);
    f.physics.placeCar(car,new THREE.Vector3(5,0,-40),new THREE.Quaternion());
    const target={mesh,position:mesh.position,velocity:new THREE.Vector3(),car,sliding:false,isPlayer:true,powerups:createPowerState()};
    for(let frame=0;frame<120;frame++){f.physics.updateVehicle(car,1/120,0,0,0,false);f.physics.step();}
    target.position.copy(car.body.translation());
    awardPowerup(f.racers[0].powerups,power("oil"),false);f.system.fire(f.racers[0],f.racers);
    car.body.setLinvel({x:0,y:0,z:90},true);
    for(let frame=0;frame<66;frame++){
      f.physics.updateVehicle(car,1/120,0,0,0,false,target.powerups.slippery>0?.025:1,2.1);f.physics.step();
      target.position.copy(car.body.translation());mesh.quaternion.copy(car.body.rotation());
      f.system.update(1/120,[target]);marks.track(target);
    }
    assert.ok(target.powerups.oilWheels.some(time=>time>0),"A following car must pick up fresh oil before 0.7 seconds");
    assert.ok(marks.count>10,"Real wheel contacts must produce visible trail geometry");
    const edge=new THREE.Vector3().fromArray(marks.positions,0).distanceTo(new THREE.Vector3().fromArray(marks.positions,3));
    assert.ok(edge>=.8,"Oil tracks should span the tire tread, not a thin skid line");
  } finally {globalThis.fetch=savedFetch;marks.dispose();f.cleanup();mesh?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
});
