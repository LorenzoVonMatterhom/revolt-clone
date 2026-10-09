import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { setWheelPose, engineProfile, CarResetFade } from "../src/car-effects.js";
import { loadCar } from "../src/revolt.js";

test("reset fades every car part out, repositions once while invisible, then restores its materials", () => {
  const root = new THREE.Group();
  const body = new THREE.MeshBasicMaterial();
  const glass = new THREE.MeshBasicMaterial({transparent:true,opacity:0.4,depthWrite:false});
  root.add(new THREE.Mesh(new THREE.BoxGeometry(),body),new THREE.Mesh(new THREE.BoxGeometry(),glass));
  const fade = new CarResetFade(root); let resets = 0;
  assert.ok(fade.start(() => { resets++; assert.equal(body.opacity,0); }));
  assert.equal(fade.start(() => resets++),false);
  fade.update(0.125); assert.equal(body.opacity,0.5); assert.equal(glass.opacity,0.2); assert.equal(resets,0);
  fade.update(0.125); assert.equal(resets,1); assert.equal(body.opacity,0);
  fade.update(0.2); assert.ok(Math.abs(body.opacity-0.5)<0.00001);
  fade.update(0.3); assert.equal(resets,1); assert.equal(fade.active,false);
  assert.equal(body.opacity,1); assert.equal(body.transparent,false); assert.equal(body.depthWrite,true);
  assert.equal(glass.opacity,0.4); assert.equal(glass.transparent,true); assert.equal(glass.depthWrite,false);
});

test("canceling a reset restores the car without repositioning it", () => {
  const root=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  const fade=new CarResetFade(root); let resets=0;
  fade.start(()=>resets++); fade.update(0.1); fade.cancel(); fade.update(1);
  assert.equal(resets,0); assert.equal(root.material.opacity,1); assert.equal(root.material.transparent,false);
});

test("steering keeps the tire axle horizontal at every wheel rotation", () => {
  const wheel = new THREE.Group(), tire = new THREE.Group();
  wheel.add(tire);
  wheel.userData.tire = tire;
  for (const steering of [-0.5, 0, 0.5]) for (const roll of [0, 1, 3, 5, 100]) {
    setWheelPose(wheel, steering, roll);
    wheel.updateMatrixWorld(true);
    const axle = new THREE.Vector3(1, 0, 0).transformDirection(tire.matrixWorld);
    const expected = new THREE.Vector3(Math.cos(steering), 0, -Math.sin(steering));
    assert.ok(axle.distanceTo(expected) < 0.000001, "Rolling must not tilt the steering axle");
  }
});

test("original car settings select engine samples and steerable wheels", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(String(url).slice(1)));
  try {
    for (const [id, expectedClass, sample] of [["rc", 0, "electro"], ["volken", 0, "electro"], ["phat", 0, "electro"], ["cougar", 1, "petrol"]]) {
      const car = await loadCar(id, id);
      assert.equal(car.userData.engineClass, expectedClass);
      assert.equal(engineProfile(car.userData.engineClass).sample, `/wavs/${sample}.wav`);
      assert.ok(readFileSync(`wavs/${sample}.wav`).length > 44);
      assert.deepEqual(car.userData.physics.wheels.map((w) => w.turnable), [true, true, false, false]);
      assert.ok(car.userData.physics.wheels.slice(0, 2).every((w) => w.steerRatio > 0));
      car.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
  } finally { globalThis.fetch = realFetch; }
});
