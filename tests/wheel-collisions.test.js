import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MeshPhysics, initializePhysics } from "../src/physics.js";

await initializePhysics();
function scene(wallX) {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 100));
  floor.position.y = -0.5; group.add(floor);
  if (wallX !== undefined) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8, 100));
    wall.position.set(wallX, 4, 0); group.add(wall);
  }
  return group;
}
function carMesh() {
  const mesh = new THREE.Group();
  mesh.userData.physics = {
    halfExtents: new THREE.Vector3(0.6, 0.3, 1.5),
    center: new THREE.Vector3(0, 1, 0),
    wheels: [-1, 1].flatMap(x => [-1.3, 1.3].map(z => ({
      position: new THREE.Vector3(x, 0.5, z), radius: 0.5, halfWidth: 0.2,
    }))),
  };
  return mesh;
}
test("tire-only wall overlap is rejected by reset placement", () => {
  const physics = new MeshPhysics(scene(1.2));
  try {
    const car = physics.createCar(carMesh()), rotation = new THREE.Quaternion();
    assert.equal(car.wheelColliders.length, 4);
    assert.equal(physics.overlapsCar(car, new THREE.Vector3(0, 0.8, 0), rotation), true);
    assert.ok(physics.placeCar(car, new THREE.Vector3(0, 0, 0), rotation));
    assert.equal(physics.overlapsCar(car, new THREE.Vector3().copy(car.body.translation()), rotation), false);
  } finally { physics.dispose(); }
});
test("wheel shapes follow steering and suspension without changing chassis mass", () => {
  const physics = new MeshPhysics(scene());
  try {
    const car = physics.createCar(carMesh());
    assert.ok(Math.abs(car.body.mass() - 8) < 0.001);
    car.body.setTranslation({ x: 0, y: 0.8, z: 0 }, true);
    physics.updateVehicle(car, 1 / 120, 0, 0, 1, false);
    car.wheelColliders.forEach((tire, i) => {
      const wheel = car.setup.wheels[i];
      assert.ok(Math.abs(tire.translationWrtParent().y -
        (wheel.position.y + 0.6 - car.vehicle.wheelSuspensionLength(i))) < 0.0001);
      const axle = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().copy(tire.rotationWrtParent()));
      assert.ok(wheel.position.z > 0 ? Math.abs(axle.z) > 0.1 : Math.abs(axle.z) < 0.0001);
    });
  } finally { physics.dispose(); }
});
test("a fast sideways tire collision stops the wheels before the chassis reaches a wall", () => {
  const physics = new MeshPhysics(scene(4));
  try {
    const car = physics.createCar(carMesh());
    car.body.setTranslation({ x: 0, y: 0.8, z: 0 }, true);
    car.body.setLinvel({ x: 80, y: 0, z: 0 }, true);
    for (let i = 0; i < 120; i++) {
      physics.updateVehicle(car, 1 / 120, 0, 0, 0, false);
      physics.step();
    }
    assert.ok(car.body.translation().x < 3, "Outside tire must hit the wall before the narrower chassis");
    assert.ok(Number.isFinite(car.body.translation().y));
  } finally { physics.dispose(); }
});
