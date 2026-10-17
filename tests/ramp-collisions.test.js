import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as THREE from "three";
import { loadCar, loadLevel, disposeLevel } from "../src/revolt.js";
import { initializePhysics, MeshPhysics, meshTriangles } from "../src/physics.js";

await initializePhysics();
const ramps = [
  { map: "nhood1", name: "diagonal ramp", normal: [-0.243, 0.516, -0.821] },
  { map: "nhood1", name: "banked ramp", normal: [0, 0.383, -0.924] },
  { map: "nhood2", name: "steep ramp", normal: [0, 0.507, 0.862] },
];

for (const ramp of ramps) test(`${ramp.map} ${ramp.name} supports wheels in both directions without false impacts`, async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(String(url).slice(1)));
  const manifest = readdirSync("levels", { recursive: true }).map(path => "/levels/" + path.replaceAll("\\", "/"));
  let level;
  try {
    level = await loadLevel({ id: ramp.map }, manifest);
    const { vertices, indices } = meshTriangles(level.group);
    const wanted = new THREE.Vector3(...ramp.normal).normalize();
    const bounds = new THREE.Box3();
    let normal, point;
    for (let i = 0; i < indices.length; i += 3) {
      const a = new THREE.Vector3().fromArray(vertices, indices[i] * 3);
      const b = new THREE.Vector3().fromArray(vertices, indices[i + 1] * 3);
      const c = new THREE.Vector3().fromArray(vertices, indices[i + 2] * 3);
      const faceNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      if (faceNormal.distanceTo(wanted) >= 0.002) continue;
      for (const vertex of [a, b, c]) bounds.expandByPoint(vertex);
      normal = faceNormal; point = a;
    }
    assert.ok(normal, "The authored ramp face must exist in the original collision data");
    const surface = bounds.getCenter(new THREE.Vector3());
    surface.y = (normal.dot(point) - surface.x * normal.x - surface.z * normal.z) / normal.y;
    const uphill = new THREE.Vector3(0, 1, 0).projectOnPlane(normal).normalize();
    for (const id of ["cougar", "rc"]) {
      const mesh = await loadCar(id, id);
      try {
        for (const direction of [-1, 1]) {
          const physics = new MeshPhysics(level.group);
          try {
            const forward = uphill.clone().multiplyScalar(direction);
            const right = normal.clone().cross(forward).normalize();
            const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, normal, forward));
            const start = surface.clone().addScaledVector(normal, 0.3);
            const car = physics.createCar(mesh);
            car.body.setTranslation(start, true); car.body.setRotation(rotation, true);
            car.body.setLinvel(forward.clone().multiplyScalar(40), true);
            let supportedFrames = 0, strongestImpact = 0;
            for (let i = 0; i < 12; i++) {
              physics.updateVehicle(car, 1 / 120, 1, 0, 0, false); physics.step();
              physics.checkCar(car, 1 / 120);
              const contacts = [0, 1, 2, 3].filter(wheel => car.vehicle.wheelIsInContact(wheel)).length;
              if (contacts >= 2) supportedFrames++;
              strongestImpact = Math.max(strongestImpact, car.impact);
            }
            const label = `${id}, direction ${direction}`;
            assert.ok(supportedFrames >= 8, `${label}: suspension lost the ramp (${supportedFrames} supported frames)`);
            assert.ok(strongestImpact < 1.5, `${label}: smooth ramp generated a crash impulse ${strongestImpact}`);
            const travel = new THREE.Vector3().copy(car.body.translation()).sub(start);
            assert.ok(travel.dot(forward) > 3, `${label}: car snagged on the ramp`);
            assert.ok(Math.abs(travel.dot(normal)) < 0.5, `${label}: car bounced away from the ramp`);
          } finally { physics.dispose(); }
        }
      } finally { mesh.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }); }
    }
  } finally { disposeLevel(level); globalThis.fetch = realFetch; }
});

test("Neighborhood 1 cars drive through the gentle-to-steep ramp join without snagging", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(String(url).slice(1)));
  const manifest = readdirSync("levels", { recursive: true }).map(path => "/levels/" + path.replaceAll("\\", "/"));
  let level;
  try {
    level = await loadLevel({ id: "nhood1" }, manifest);
    for (const id of ["rc", "cougar"]) {
      const physics = new MeshPhysics(level.group), mesh = await loadCar(id, id);
      try {
        const normal = new THREE.Vector3(0, 0.954, -0.299).normalize();
        const forward = new THREE.Vector3(0, 1, 0).projectOnPlane(normal).normalize();
        const right = normal.clone().cross(forward);
        const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, normal, forward));
        const point = new THREE.Vector3(175, -73.41, 570);
        const floor = physics.groundAt(point, 3, 20);
        assert.notEqual(floor, null, "The approach must begin on the actual ramp");
        point.y = floor;
        const start = point.addScaledVector(normal, 0.3), car = physics.createCar(mesh);
        car.body.setTranslation(start, true); car.body.setRotation(rotation, true);
        car.body.setLinvel(forward.clone().multiplyScalar(40), true);
        car.safePose = { position: start.clone(), rotation: rotation.clone() };
        let steepContacts = 0, resets = 0, strongestImpact = 0;
        for (let i = 0; i < 90; i++) {
          physics.updateVehicle(car, 1 / 120, 1, 0, 0, false); physics.step();
          const before = new THREE.Vector3().copy(car.body.translation());
          physics.checkCar(car, 1 / 120);
          if (before.distanceTo(car.body.translation()) > 1) resets++;
          strongestImpact = Math.max(strongestImpact, car.impact);
          if (car.body.translation().y > -68) steepContacts = Math.max(steepContacts,
            [0, 1, 2, 3].filter(wheel => car.vehicle.wheelIsInContact(wheel)).length);
        }
        assert.equal(resets, 0, `${id}: ramp entry must not trigger recovery`);
        assert.ok(steepContacts >= 2, `${id}: wheels must retain support past the ramp join`);
        assert.ok(car.body.translation().z > 586, `${id}: chassis caught on the ramp transition`);
        assert.ok(strongestImpact < 40, `${id}: join generated an excessive impulse ${strongestImpact}`);
      } finally {
        physics.dispose(); mesh.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
      }
    }
  } finally { disposeLevel(level); globalThis.fetch = realFetch; }
});
