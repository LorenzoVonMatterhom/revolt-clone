import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { readFileSync, readdirSync } from "node:fs";
import { loadLevel, loadCar, disposeLevel } from "../src/revolt.js";
import { initializePhysics, meshTriangles, MeshPhysics, keyboardSteering } from "../src/physics.js";
import { LEVELS } from "../src/levels.js";

await initializePhysics();

function box(group, size, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function carMesh() {
  const mesh = new THREE.Group();
  mesh.userData.physics = {
    halfExtents: new THREE.Vector3(0.9, 0.3, 1.5), center: new THREE.Vector3(0, 1, 0),
    wheels: [-1, 1].flatMap((x) => [-1.3, 1.3].map((z) => ({ position: new THREE.Vector3(x, 0.5, z), radius: 0.5 }))),
  };
  return mesh;
}

test("terrain uses source vertices with instance transforms and collision flags", () => {
  const group = new THREE.Group();
  const instance = new THREE.Group();
  instance.position.set(12, 3, -7);
  instance.rotation.y = Math.PI / 2;
  group.add(instance);
  const mesh = box(instance, [2, 4, 6], [1, 0, 0]);
  const hidden = box(group, [100, 100, 100], [0, 0, 0]);
  hidden.userData.noCollision = true;
  const { vertices, indices } = meshTriangles(group);
  assert.equal(indices.length, mesh.geometry.index.count);
  const original = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0).applyMatrix4(mesh.matrixWorld);
  assert.ok(original.distanceTo(new THREE.Vector3().fromArray(vertices)) < 0.00001);
});

test("stacked terrain queries stay on the current deck and empty space has no floor", () => {
  const group = new THREE.Group();
  box(group, [20, 1, 20], [0, -0.5, 0]);
  box(group, [10, 1, 10], [0, 9.5, 0]);
  const physics = new MeshPhysics(group);
  assert.ok(Math.abs(physics.groundAt({ x: 0, y: 0.5, z: 0 }) - 0) < 0.001);
  assert.ok(Math.abs(physics.groundAt({ x: 0, y: 10.5, z: 0 }) - 10) < 0.001);
  assert.equal(physics.groundAt({ x: 40, y: 0, z: 0 }), null);
  physics.dispose();
});

test("CCD stops a fast chassis at the actual mesh wall", () => {
  const group = new THREE.Group();
  box(group, [100, 1, 100], [0, -0.5, 0]);
  box(group, [20, 10, 0.2], [0, 5, 8]);
  const physics = new MeshPhysics(group), car = physics.createCar(carMesh());
  car.body.setTranslation({ x: 0, y: 1, z: 0 }, true);
  car.body.setLinvel({ x: 0, y: 0, z: 150 }, true);
  for (let i = 0; i < 120; i++) physics.step();
  assert.ok(car.body.translation().z < 7, "Car must not tunnel through thin wall");
  physics.dispose();
});

test("wheel suspension supports a car and engine force drives along mesh terrain", () => {
  const group = new THREE.Group();
  box(group, [100, 1, 100], [0, -0.5, 0]);
  const physics = new MeshPhysics(group), car = physics.createCar(carMesh());
  car.body.setTranslation({ x: 0, y: 1, z: 0 }, true);
  for (let i = 0; i < 240; i++) { physics.updateVehicle(car, 1 / 120, 0, 0, 0, false); physics.step(); }
  assert.ok(car.body.translation().y > -0.5 && car.body.translation().y < 1, "Suspension should settle without sinking or floating");
  const before = car.body.translation().z;
  for (let i = 0; i < 120; i++) { physics.updateVehicle(car, 1 / 120, 1, 0, 0, false); physics.step(); }
  assert.ok(car.body.translation().z > before + 2, "Throttle should drive forward (+Z)");
  assert.ok([0, 1, 2, 3].some((i) => car.vehicle.wheelIsInContact(i)));
  physics.dispose();
});

test("steering sign follows world X and rear wheels stay straight", () => {
  for (const steering of [-1, 1]) {
    const group = new THREE.Group();
    box(group, [200, 1, 200], [0, -0.5, 0]);
    const physics = new MeshPhysics(group), car = physics.createCar(carMesh());
    car.body.setTranslation({ x: 0, y: 0.8, z: 0 }, true);
    for (let i = 0; i < 240; i++) { physics.updateVehicle(car, 1 / 120, 0.5, 0, steering, false); physics.step(); }
    assert.ok(car.body.translation().x * steering > 1, "Driving direction should match the steering sign");
    car.setup.wheels.forEach((wheel, i) => { if (wheel.position.z < 0) assert.equal(car.vehicle.wheelSteering(i), 0); });
    physics.dispose();
  }
});

test("left and right keys turn the original car toward the matching side of the chase camera", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(String(url).slice(1)));
  try {
    assert.equal(keyboardSteering(false, false), 0);
    assert.equal(keyboardSteering(true, true), 0);
    for (const heading of [0, Math.PI / 2]) for (const left of [true, false]) {
      const ground = new THREE.Group(); box(ground, [500, 1, 500], [0, -0.5, 0]);
      const physics = new MeshPhysics(ground);
      const mesh = await loadCar("rc", "RC Bandit"), car = physics.createCar(mesh);
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      car.body.setTranslation({ x: 0, y: 0.8, z: 0 }, true); car.body.setRotation(rotation, true);
      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
      camera.position.copy(new THREE.Vector3(0, 20, -40).applyQuaternion(rotation));
      camera.lookAt(new THREE.Vector3(0, 0, 40).applyQuaternion(rotation)); camera.updateMatrixWorld(true);
      for (let i = 0; i < 240; i++) { physics.updateVehicle(car, 1 / 120, 0.25, 0, keyboardSteering(left, !left), false); physics.step(); }
      const screen = new THREE.Vector3().copy(car.body.translation()).project(camera);
      assert.ok(left ? screen.x < -0.05 : screen.x > 0.05, "Keyboard steering must match the visible left/right direction");
      physics.dispose();
      mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("a body falls off a mesh edge without a synthetic floor", () => {
  const group = new THREE.Group();
  box(group, [4, 1, 4], [0, -0.5, 0]);
  const physics = new MeshPhysics(group);
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(10, 2, 0));
  physics.world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
  for (let i = 0; i < 120; i++) physics.step();
  assert.ok(body.translation().y < -10);
  physics.dispose();
});

test("player steering gain increases front-wheel angle without changing default AI steering", () => {
  const ground=new THREE.Group(); box(ground,[100,1,100],[0,-0.5,0]);
  const physics=new MeshPhysics(ground), car=physics.createCar(carMesh());
  physics.updateVehicle(car,1/120,0,0,1,false);
  const front=car.setup.wheels.findIndex(w=>w.position.z>0);
  const original=car.vehicle.wheelSteering(front);
  physics.updateVehicle(car,1/120,0,0,1,false,1,1.45);
  assert.ok(Math.abs(car.vehicle.wheelSteering(front)-original*1.45)<0.00001);
  car.setup.wheels.forEach((wheel,i)=>{if(wheel.position.z<0)assert.equal(car.vehicle.wheelSteering(i),0);});
  physics.dispose();
});

test("Cougar and RC Bandit reduce steering smoothly by at most ten percent at speed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(String(url).slice(1)));
  try {
    for (const id of ["cougar","rc"]) {
      const ground = new THREE.Group(); box(ground,[100,1,100],[0,-0.5,0]);
      const physics = new MeshPhysics(ground), mesh = await loadCar(id,id), car = physics.createCar(mesh);
      try {
        for (const input of [-1,-0.5,0.5,1]) {
          let restingAngles;
          for (const speed of [0,40,70,100,160,180,260,-70]) {
            car.body.setLinvel({x:0,y:0,z:speed},true);
            physics.updateVehicle(car,1/120,0,0,input,false,1,2.1);
            const angles=car.setup.wheels.map((_,i)=>car.vehicle.wheelSteering(i));
            restingAngles ??= angles;
            car.setup.wheels.forEach((wheel,i) => {
              const angle=angles[i];
              if (wheel.turnable) {
                const ratio = angle / restingAngles[i];
                assert.ok(ratio >= .899999 && ratio <= 1.000001);
                if (Math.abs(speed) >= 180) assert.ok(Math.abs(ratio - .9) < .000001);
                if (speed === 0) assert.equal(ratio, 1);
              }
              if (wheel.turnable && Math.abs(input)===1) assert.ok(angle * input >= 48.5 * Math.PI/180 && Math.abs(angle) <= 1.05001);
              if (!wheel.turnable) assert.equal(angle,0);
            });
          }
        }
        physics.updateVehicle(car,1/120,0,0,1,false);
        car.setup.wheels.forEach((wheel,i) => {
          if (wheel.turnable) assert.ok(Math.abs(car.vehicle.wheelSteering(i) - wheel.steerRatio) < 0.00001,"AI must retain stock steering");
        });
      } finally { physics.dispose(); mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();}); }
    }
  } finally { globalThis.fetch=originalFetch; }
});

test("oil retains lateral sliding and spin, then normal grip returns", () => {
  const simulate = (traction) => {
    const ground = new THREE.Group(); box(ground, [500,1,500], [0,-0.5,0]);
    const physics = new MeshPhysics(ground), car = physics.createCar(carMesh());
    car.body.setTranslation({x:0,y:0.8,z:0}, true);
    for (let i=0; i<120; i++) { physics.updateVehicle(car,1/120,0,0,0,false); physics.step(); }
    car.body.setLinvel({x:12,y:0,z:25}, true);
    car.body.setAngvel({x:0,y:1,z:0}, true);
    for (let i=0; i<120; i++) { physics.updateVehicle(car,1/120,0.2,0,0,false,traction); physics.step(); }
    const localVelocity = new THREE.Vector3().copy(car.body.linvel()).applyQuaternion(new THREE.Quaternion().copy(car.body.rotation()).invert());
    const result = { slide: Math.abs(localVelocity.x), spin: Math.abs(car.body.angvel().y) };
    physics.updateVehicle(car,1/120,0,0,0,false,1);
    assert.equal(car.body.angularDamping(),1.5);
    assert.ok(Math.abs(car.collider.friction()-0.3)<0.00001);
    assert.equal(car.vehicle.wheelSideFrictionStiffness(0),1);
    physics.dispose(); return result;
  };
  const dry=simulate(1), oil=simulate(0.025);
  assert.ok(oil.slide > dry.slide + 2, `Oil must retain side slip: ${JSON.stringify({dry,oil})}`);
  assert.ok(oil.spin > dry.spin + 0.1, `Oil must retain spin: ${JSON.stringify({dry,oil})}`);
});

test("reset placement rejects walls, stays under bridges, and never places a car in empty space", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);
  box(ground,[2,8,30],[0,4,0]);box(ground,[15,1,15],[20,9.5,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh()),rotation=new THREE.Quaternion();
  assert.ok(physics.placeCar(car,new THREE.Vector3(0,0,0),rotation));
  const position=new THREE.Vector3().copy(car.body.translation());
  assert.ok(Math.abs(position.x)>1.9,"Should move sideways away from an obstructed reset point");
  assert.equal(physics.overlapsCar(car,position,rotation),false);
  assert.ok(physics.placeCar(car,new THREE.Vector3(20,0,0),rotation));
  assert.ok(car.body.translation().y<3,"Must not jump to the bridge deck");
  const before=car.body.translation();
  assert.equal(physics.placeCar(car,new THREE.Vector3(500,0,500),rotation),false);
  assert.deepEqual(car.body.translation(),before);
  physics.dispose();
});

test("persistent deep penetration returns a car to its last clear pose", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);box(ground,[1,6,20],[5,3,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh());
  assert.ok(physics.placeCar(car,new THREE.Vector3(0,0,0),new THREE.Quaternion()));
  car.body.setTranslation({x:5,y:0.8,z:0},true);physics.world.propagateModifiedBodyPositionsToColliders();
  for(let i=0;i<60;i++) physics.checkCar(car,1/120);
  assert.ok(car.body.translation().x<2,"An embedded chassis should recover to clear terrain");
  assert.equal(physics.overlapsCar(car,new THREE.Vector3().copy(car.body.translation()),new THREE.Quaternion()),false);
  physics.dispose();
});

test("loaded cars use a convex chassis from the original body vertices", async () => {
  const originalFetch=globalThis.fetch;globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  let physics;
  try {
    const ground=new THREE.Group();box(ground,[200,1,200],[0,-0.5,0]);
    physics=new MeshPhysics(ground);
    const mesh=await loadCar("rc","RC Bandit"),car=physics.createCar(mesh);
    assert.ok(mesh.userData.physics.bodyVertices.length>12);
    assert.equal(car.collider.shape.type,RAPIER.ShapeType.ConvexPolyhedron);
    assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
    for(let i=0;i<300;i++){physics.updateVehicle(car,1/120,0,0,0,false);physics.step();physics.checkCar(car,1/120);}
    assert.ok(car.body.translation().y>-0.5&&car.body.translation().y<2);
    mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  } finally {globalThis.fetch=originalFetch;physics?.dispose();}
});

test("two-wheel and four-wheel drive receive equal total engine force, split by engine ratios", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);const physics=new MeshPhysics(ground);
  for(const powered of [[true,true,true,true],[true,false,true,false]]) {
    const mesh=carMesh();mesh.userData.physics.wheels.forEach((wheel,i)=>{wheel.powered=powered[i];wheel.engineRatio=i<2?2:1;});
    const car=physics.createCar(mesh);physics.updateVehicle(car,1/120,1,0,0,false);
    const force=mesh.userData.physics.wheels.reduce((sum,wheel,i)=>sum+car.vehicle.wheelEngineForce(i),0);
    assert.ok(Math.abs(force-720)<0.0001);
    powered.forEach((value,i)=>{if(!value)assert.equal(car.vehicle.wheelEngineForce(i),0);});
  }
  physics.dispose();
});

test("AI recovery rights tipped cars without resetting ordinary parked cars", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh());
  assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
  const parked=car.body.translation();
  for(let i=0;i<240;i++)physics.checkCar(car,1/120);
  assert.deepEqual(car.body.translation(),parked);
  car.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2),true);
  car.body.setTranslation({x:10,y:3,z:0},true);physics.world.propagateModifiedBodyPositionsToColliders();
  for(let i=0;i<240;i++)physics.checkCar(car,1/120);
  assert.ok(car.body.translation().x<2);
  assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(car.body.rotation()).y>0.9);
  physics.dispose();
});

test("resets cannot place a car on another car's roof", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);
  const physics=new MeshPhysics(ground),lower=physics.createCar(carMesh()),upper=physics.createCar(carMesh());
  assert.ok(physics.placeCar(lower,new THREE.Vector3(10,0,0),new THREE.Quaternion()));physics.step();
  const request=new THREE.Vector3(10,1.5,0);
  assert.ok(physics.placeCar(upper,request,new THREE.Quaternion()));
  const relative=new THREE.Vector3().copy(upper.body.translation()).sub(lower.body.translation());
  assert.ok(Math.hypot(relative.x,relative.z)>2,"Reset should move beside the other car, not above it");
  assert.equal(physics.overlapsCar(upper,new THREE.Vector3().copy(upper.body.translation()),new THREE.Quaternion()),false);
  physics.dispose();
});

test("persistent car-on-car support moves the upper car back to clear terrain", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);
  const physics=new MeshPhysics(ground);
  const first=carMesh(),second=carMesh();
  for(const mesh of [first,second]) {mesh.userData.physics.halfExtents.y=1;mesh.userData.physics.center.y=1.5;}
  const lower=physics.createCar(first),upper=physics.createCar(second);
  assert.ok(physics.placeCar(lower,new THREE.Vector3(0,0,0),new THREE.Quaternion()));physics.step();
  assert.ok(physics.placeCar(upper,new THREE.Vector3(20,0,0),new THREE.Quaternion()));
  upper.body.setTranslation({x:0,y:lower.body.translation().y+2,z:0},true);
  physics.world.propagateModifiedBodyPositionsToColliders();
  for(let i=0;i<120;i++) physics.checkCar(upper,1/120,[lower,upper]);
  assert.ok(upper.body.translation().x>10,"Should recover beside the lower car");
  physics.dispose();
});

test("collision-checked resets find clear starts on every original playable map", async () => {
  const originalFetch=globalThis.fetch;globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  const manifest=readdirSync("levels",{recursive:true}).map(p=>`/levels/${p.replaceAll("\\","/")}`);
  let mesh;
  try {
    mesh=await loadCar("rc","RC Bandit");
    for(const definition of LEVELS) {
      const level=await loadLevel(definition,manifest),physics=new MeshPhysics(level.group);
      try {
        const car=physics.createCar(mesh),rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),level.info.STARTROT[0]*Math.PI*2);
        assert.ok(physics.placeCar(car,new THREE.Vector3(),rotation),`${definition.id}: no clear spawn`);
        assert.equal(physics.overlapsCar(car,new THREE.Vector3().copy(car.body.translation()),rotation),false,`${definition.id}: reset overlap`);
      } finally {physics.dispose();disposeLevel(level);}
    }
  } finally {globalThis.fetch=originalFetch;mesh?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
});

test("wheel contacts follow sloped mesh triangles and tilt the chassis", () => {
  const group = new THREE.Group();
  const ramp = box(group, [40, 1, 100], [0, 0, 0]);
  ramp.rotation.x = -0.2;
  const physics = new MeshPhysics(group), car = physics.createCar(carMesh());
  const floor = physics.groundAt({ x: 0, y: 1, z: 0 });
  car.body.setTranslation({ x: 0, y: floor + 0.8, z: 0 }, true);
  for (let i = 0; i < 180; i++) { physics.updateVehicle(car, 1 / 120, 0.7, 0, 0, false); physics.step(); }
  const p = car.body.translation();
  const ground = physics.groundAt(p, 1, 5);
  assert.notEqual(ground, null);
  assert.ok(p.z > 2 && ground > floor + 0.3, "Car should climb actual ramp geometry");
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.body.rotation());
  assert.ok(forward.y > 0.05, "Car should pitch with the ramp instead of staying horizontal");
  assert.ok([0, 1, 2, 3].some((i) => car.vehicle.wheelIsInContact(i)));
  physics.dispose();
});

test("original RC Bandit rests on actual neighborhood mesh triangles", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(String(url).slice(1)));
  let level, physics;
  try {
    const manifest = readdirSync("levels", { recursive: true }).map((p) => `/levels/${p.replaceAll("\\", "/")}`);
    level = await loadLevel({ id: "nhood1" }, manifest);
    physics = new MeshPhysics(level.group);
    const mesh = await loadCar("rc", "RC Bandit"), car = physics.createCar(mesh);
    const floor = physics.groundAt({ x: 0, y: 0, z: 0 }, 3, 30);
    assert.notEqual(floor, null, "Original start position must have mesh terrain");
    car.body.setTranslation({ x: 0, y: floor + 0.8, z: 0 }, true);
    car.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), true);
    for (let i = 0; i < 600; i++) { physics.updateVehicle(car, 1 / 120, 0, 0, 0, false); physics.step(); }
    assert.ok(car.body.translation().y > floor - 1, "Car should not fall through actual world mesh");
    assert.ok(car.body.translation().y < floor + 2, "Car should not hover above actual mesh");
    assert.ok([0, 1, 2, 3].some((i) => car.vehicle.wheelIsInContact(i)), "Wheels should touch actual terrain");
    assert.ok(Math.abs(car.body.linvel().y) < 1, `Car should settle vertically: ${JSON.stringify({ position: car.body.translation(), velocity: car.body.linvel(), wheels: mesh.userData.physics.wheels, size: mesh.userData.physics.halfExtents, center: mesh.userData.physics.center })}`);
    assert.ok(Math.hypot(car.body.linvel().x, car.body.linvel().z) < 2, `Unpowered car should stay still: ${JSON.stringify(car.body.linvel())}`);
  } finally {
    physics?.dispose(); disposeLevel(level); globalThis.fetch = realFetch;
  }
});

test("an upright car stays at a wall under throttle and can back away without teleporting", () => {
  const ground=new THREE.Group();box(ground,[300,1,300],[0,-.5,0]);box(ground,[100,8,.2],[0,4,12]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh());
  try {
    assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
    let resets=0;
    for(let i=0;i<720;i++) {
      physics.updateVehicle(car,1/120,1,0,0,false);physics.step();
      const before=new THREE.Vector3().copy(car.body.translation());physics.checkCar(car,1/120);
      if(before.distanceTo(car.body.translation())>1)resets++;
    }
    assert.equal(resets,0,'Holding throttle into a solid wall must not teleport the car');
    assert.ok(car.body.translation().z<11,'The thin wall must remain solid');
    const wallPosition=car.body.translation().z;
    for(let i=0;i<240;i++){physics.updateVehicle(car,1/120,-1,0,0,false);physics.step();physics.checkCar(car,1/120);}
    assert.ok(car.body.translation().z<wallPosition-8,'Reverse must release contact');
  }finally{physics.dispose();}
});

test("sustained throttle reaches a stable speed and reverse remains slower", () => {
  const ground=new THREE.Group();box(ground,[10000,1,10000],[0,-.5,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh());
  try {
    physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion());
    for(let i=0;i<1440;i++){physics.updateVehicle(car,1/120,1,0,0,false);physics.step();}
    const forwardSpeed=car.body.linvel().z;
    assert.ok(forwardSpeed>120&&forwardSpeed<190,`Motor must settle instead of accelerating forever: ${forwardSpeed}`);
    assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()),'Measure reverse speed from a clear standstill');
    for(let i=0;i<1440;i++){physics.updateVehicle(car,1/120,-1,0,0,false);physics.step();}
    const reverseSpeed=-car.body.linvel().z;
    assert.ok(reverseSpeed>40&&reverseSpeed<80,`Reverse must be controllable: ${reverseSpeed}`);
  }finally{physics.dispose();}
});

test("crossing joined road triangles does not launch the chassis", () => {
  const ground=new THREE.Group();
  const road=new THREE.Mesh(new THREE.PlaneGeometry(100,400,10,100).toNonIndexed());
  road.rotation.x=-Math.PI/2;road.position.z=180;ground.add(road);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh());
  try {
    physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion());
    for(let i=0;i<240;i++){physics.updateVehicle(car,1/120,0,0,0,false);physics.step();}
    const restingY=car.body.translation().y;let maxY=restingY;
    for(let i=0;i<480;i++){physics.updateVehicle(car,1/120,.5,0,0,false);physics.step();maxY=Math.max(maxY,car.body.translation().y);}
    assert.ok(car.body.translation().z>50,'Drive must cross many triangle seams');
    assert.ok(maxY<restingY+.25,`Road seams must not launch the car: ${maxY-restingY}`);
  }finally{physics.dispose();}
});

test("a wall-only collision mesh remains solid without creating a road or suspension support", () => {
  const group=new THREE.Group();box(group,[.2,8,100],[4,4,0]);
  const physics=new MeshPhysics(group),car=physics.createCar(carMesh());
  try {
    assert.equal(physics.groundAt({x:0,y:4,z:0}),null);
    car.body.setTranslation({x:0,y:4,z:0},true);
    car.body.setLinvel({x:80,y:0,z:0},true);
    for(let i=0;i<12;i++){physics.updateVehicle(car,1/120,0,0,0,false);physics.step();}
    assert.ok(car.body.translation().x<3,'Tires must stop at the real wall');
    assert.ok(car.body.linvel().y<0,'Walls must not act as suspension ground');
  }finally{physics.dispose();}
});

test("overturned player cars wait for manual flipping instead of automatic recovery", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);
  const physics=new MeshPhysics(ground);
  try {
    for(const angle of [Math.PI/2,Math.PI]) {
      const car=physics.createCar(carMesh(),{autoRighting:false});
      assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
      const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle);
      car.body.setTranslation({x:20,y:3,z:10},true);car.body.setRotation(rotation,true);
      physics.world.propagateModifiedBodyPositionsToColliders();
      for(let i=0;i<1200;i++)physics.checkCar(car,1/120);
      assert.deepEqual(new THREE.Vector3().copy(car.body.translation()).toArray(),[20,3,10]);
      assert.ok(new THREE.Quaternion().copy(car.body.rotation()).angleTo(rotation)<0.0001);
      physics.removeCar(car);
    }
  }finally{physics.dispose();}
});

test("manual flip rights a car locally, preserves heading and clears impact velocity", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-0.5,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh(),{autoRighting:false});
  try {
    assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
    const heading=0.7;
    const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI));
    car.body.setTranslation({x:20,y:3,z:10},true);car.body.setRotation(rotation,true);
    car.body.setLinvel({x:2,y:-5,z:4},true);car.body.setAngvel({x:2,y:3,z:1},true);
    physics.world.propagateModifiedBodyPositionsToColliders();
    assert.ok(physics.flipCar(car));
    const position=car.body.translation(),upright=new THREE.Quaternion().copy(car.body.rotation());
    assert.ok(Math.hypot(position.x-20,position.z-10)<0.001,'Flip must not return to the earlier safe pose');
    assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(upright).y>0.999);
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(upright);
    assert.ok(Math.abs(Math.atan2(forward.x,forward.z)-heading)<0.001);
    assert.equal(new THREE.Vector3().copy(car.body.linvel()).length(),0);
    assert.equal(new THREE.Vector3().copy(car.body.angvel()).length(),0);
    assert.equal(physics.overlapsCar(car,new THREE.Vector3().copy(position),upright),false);
    assert.equal(physics.flipCar(car),false,'An upright car must not be repositioned');
  }finally{physics.dispose();}
});

test("manual flip leaves the car alone when no ground exists below it", () => {
  const ground=new THREE.Group();box(ground,[20,1,20],[0,-0.5,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh(),{autoRighting:false});
  try {
    car.body.setTranslation({x:100,y:4,z:100},true);
    car.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI),true);
    const position=car.body.translation(),rotation=car.body.rotation();
    assert.equal(physics.flipCar(car),false);
    assert.deepEqual(car.body.translation(),position);assert.deepEqual(car.body.rotation(),rotation);
  }finally{physics.dispose();}
});

test("failed automatic recovery backs off and does not block a manual reset", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-.5,0]);box(ground,[1,6,20],[5,3,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh());
  try {
    assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
    car.safePose.position.set(500,0,500); // No ground near this stale recovery pose.
    car.body.setTranslation({x:5,y:.8,z:0},true);
    physics.world.propagateModifiedBodyPositionsToColliders();
    const place=physics.placeCar.bind(physics);let attempts=0;
    physics.placeCar=(...args)=>{attempts++;return place(...args);};
    for(let i=0;i<720;i++)physics.checkCar(car,1/120);
    assert.ok(attempts>=2&&attempts<=3,`Failed placement retried ${attempts} times in six seconds`);
    assert.equal(car.body.translation().x,5,'Failed recovery must not move the car to invalid ground');
    assert.ok(car.recoveryCooldown>0);
    assert.ok(physics.placeCar(car,new THREE.Vector3(-10,0,0),new THREE.Quaternion()),'Manual placement must remain available during the retry delay');
    assert.ok(Math.abs(car.body.translation().x+10)<.01);
  }finally{physics.dispose();}
});

test("successful penetration recovery cannot teleport the car repeatedly in the next second", () => {
  const ground=new THREE.Group();box(ground,[100,1,100],[0,-.5,0]);box(ground,[1,6,20],[5,3,0]);
  const physics=new MeshPhysics(ground),car=physics.createCar(carMesh());
  try {
    assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
    const place=physics.placeCar.bind(physics);let recoveries=0;
    physics.placeCar=(...args)=>{recoveries++;return place(...args);};
    const embed=()=>{car.body.setTranslation({x:5,y:.8,z:0},true);car.body.setLinvel({x:0,y:0,z:0},true);physics.world.propagateModifiedBodyPositionsToColliders();};
    embed();for(let i=0;i<60;i++)physics.checkCar(car,1/120);
    assert.equal(recoveries,1);assert.ok(car.body.translation().x<2);
    embed();for(let i=0;i<60;i++)physics.checkCar(car,1/120);
    assert.equal(recoveries,1,'A second obstruction must not create another immediate respawn');
    for(let i=0;i<60;i++){physics.updateVehicle(car,1/120,-1,0,0,false);physics.step();physics.checkCar(car,1/120);}
    assert.ok(car.body.translation().z< -2,'Retry delay must leave reverse driving active');
  }finally{physics.dispose();}
});

for (const id of ["rc", "cougar", "sugo"]) test(`${id} turns strongly while accelerating at speed`, async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(String(url).slice(1)));
  let physics, mesh;
  try {
    const ground = new THREE.Group(); box(ground, [2000, 1, 2000], [0, -0.5, 0]);
    physics = new MeshPhysics(ground); mesh = await loadCar(id, id);
    const car = physics.createCar(mesh);
    physics.placeCar(car, new THREE.Vector3(), new THREE.Quaternion());
    for (let frame = 0; frame < 120; frame++) { physics.updateVehicle(car, 1/120, 0, 0, 0, false, 1, 2.1); physics.step(); }
    car.body.setLinvel({ x: 0, y: 0, z: 90 }, true);
    for (let frame = 0; frame < 72; frame++) { physics.updateVehicle(car, 1/120, 1, 0, 1, false, 1, 2.1); physics.step(); }
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(car.body.rotation());
    assert.ok(Math.atan2(direction.x, direction.z) > 0.65, `${id}: insufficient full-throttle turn ${Math.atan2(direction.x, direction.z)}, up ${new THREE.Vector3(0,1,0).applyQuaternion(car.body.rotation()).y}, position ${JSON.stringify(car.body.translation())}`);
    assert.ok(car.body.translation().x > 10, `${id}: car must actually follow the turn`);
  } finally { globalThis.fetch = savedFetch; physics?.dispose(); mesh?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
});
