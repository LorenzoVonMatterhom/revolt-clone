import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FlexibleAntenna } from "../src/car-effects.js";

function antenna() {
  const car = new THREE.Group();
  const aerial = new FlexibleAntenna(car, { offset: new THREE.Vector3(0, 1, -1), direction: new THREE.Vector3(0, 1, 0), length: 2 });
  return { car, aerial };
}
test("antenna stays anchored and upright at rest", () => {
  const { car, aerial } = antenna();
  for (let i = 0; i < 600; i++) aerial.update(1 / 120);
  assert.ok(aerial.points[0].distanceTo(car.localToWorld(aerial.offset.clone())) < 0.00001);
  assert.ok(aerial.tip.position.y > 2.8);
  for (let i = 1; i <= aerial.count; i++) assert.ok(Math.abs(aerial.points[i].distanceTo(aerial.points[i - 1]) - aerial.segmentLength) < 0.02);
});
test("acceleration bends the antenna and it settles after movement stops", () => {
  const { car, aerial } = antenna();
  for (let i = 0; i < 30; i++) { car.position.x += 0.03; aerial.update(1 / 120); }
  const bent = Math.abs(aerial.tip.position.x);
  assert.ok(bent > 0.05, "Tip must lag behind the moving car");
  for (let i = 0; i < 1200; i++) aerial.update(1 / 120);
  assert.ok(Math.abs(aerial.tip.position.x) < bent * 0.1, "Spring damping must settle the tip");
});
test("turning and bumps move the tip, and reset teleports keep it finite", () => {
  const { car, aerial } = antenna();
  car.rotation.z = 0.3;
  car.position.y += 0.15;
  aerial.update(1 / 60);
  assert.ok(aerial.points.every(p => p.toArray().every(Number.isFinite)));
  assert.ok(aerial.tip.position.distanceTo(new THREE.Vector3(0, 3, -1)) > 0.01);
  car.position.set(100, 10, -100);
  aerial.update(1 / 60);
  assert.ok(aerial.points[0].distanceTo(car.localToWorld(aerial.offset.clone())) < 0.00001);
  assert.ok(aerial.tip.position.distanceTo(new THREE.Vector3(0, 3, -1)) < 0.00001);
});

test("bomb burns the antenna down from its moving tip and restores it", () => {
  const { aerial } = antenna();
  const full = aerial.tip.position.clone();
  aerial.setFuseRemaining(.5);
  assert.equal(aerial.rods.filter(rod => rod.visible).length, 4);
  assert.ok(aerial.tip.position.y < full.y);
  assert.equal(aerial.tip.material.color.getHex(), 0xffae32);
  aerial.update(1/60);
  assert.equal(aerial.rods.filter(rod => rod.visible).length, 4);
  aerial.setFuseRemaining(.01);
  assert.equal(aerial.rods.filter(rod => rod.visible).length, 1);
  aerial.setFuseRemaining(null);
  assert.ok(aerial.rods.every(rod => rod.visible));
  assert.ok(aerial.tip.position.distanceTo(full) < .02);
  assert.equal(aerial.tip.material.color.getHex(), 0xd3272e);
});
