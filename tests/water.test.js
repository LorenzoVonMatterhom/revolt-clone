import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PoolWater, poolVolumes, submergedFraction } from "../src/pool-water.js";
import { parseObjects, parsePrm } from "../src/revolt.js";
import { meshTriangles } from "../src/physics.js";

const buffer = path => { const bytes = fs.readFileSync(path); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };
const model = parsePrm(buffer("models/poolwater.m"));
for (const id of ["ship1", "ship2"]) test(id + " loads the original swimming pool surface and volume", () => {
  const objects = parseObjects(buffer("levels/" + id + "/" + id + ".fob"));
  const volumes = poolVolumes(objects);
  assert.equal(volumes.length, 1);
  assert.ok(Math.abs(volumes[0].half.x - 293.9) < 0.001);
  assert.equal(volumes[0].height, objects.find(o => o.type === 47 && o.flags[0] === 1).position.y);
  const water = new PoolWater(objects, model);
  assert.equal(water.group.children.length, 1);
  assert.equal(meshTriangles(water.group).indices.length, 0, "Water must not act like a solid road");
  assert.ok(water.group.children[0].geometry.index.count > 1000);
});
test("water stays confined to the pool volume", () => {
  const volume = { center: new THREE.Vector3(0, -4, 0), half: new THREE.Vector3(10, 4, 10), height: 0 };
  assert.equal(submergedFraction(new THREE.Vector3(0, 1, 0), volume, 1), 0);
  assert.equal(submergedFraction(new THREE.Vector3(11, -1, 0), volume, 1), 0);
  assert.equal(submergedFraction(new THREE.Vector3(0, -0.5, 0), volume, 1), 0.5);
  assert.equal(submergedFraction(new THREE.Vector3(0, -20, 0), volume, 1), 0);
});
test("submerged cars slow down and settle near the surface through buoyancy", async () => {
  await RAPIER.init();
  const objects = [{ type: 68, flags: [100,40,100,0], position: new THREE.Vector3(0,-4,0) }];
  const water = new PoolWater(objects, model);
  const world = new RAPIER.World({x:0,y:-42,z:0});
  world.timestep = 1/120;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,-3,0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5,0.5,1).setMass(8), body);
  const car = { body, setup: { center: new THREE.Vector3(), halfExtents: new THREE.Vector3(0.5,0.5,1) } };
  body.setLinvel({x:4,y:0,z:0},true);
  let splashes = 0; water.onSplash = () => splashes++;
  for (let i=0;i<1200;i++) { water.applyCar(car,1/120); world.step(); }
  assert.ok(Math.abs(body.linvel().x)<0.1, "Water drag must slow the car");
  assert.ok(body.translation().y>-1 && body.translation().y<0.5, "Car should float near the surface");
  assert.equal(splashes,1);
  body.setTranslation({x:30,y:-2,z:0},true);
  body.setLinvel({x:4,y:0,z:0},true);
  assert.equal(water.applyCar(car,1/120),0);
  assert.equal(body.linvel().x,4,"Dry driving must retain its velocity");
  world.free();
});
