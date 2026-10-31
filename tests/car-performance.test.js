import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { parseCarPerformance, carTopSpeed, CAR_MASS_SCALE, SPEED_UNITS_PER_MPH } from "../src/car-performance.js";
import { loadCar } from "../src/revolt.js";
import { STOCK_CARS, carDetails } from "../src/showroom.js";
import { initializePhysics, MeshPhysics, smoothPlayerSteering } from "../src/physics.js";

test("parameter parsing scopes mass and friction to the correct body and wheels", () => {
  const spec=parseCarPerformance(`{\n; TopSpeed 999\nTopSpeed 33.5\nSteerRate 2.5\nCoM 0 -5 1\nBODY {\nMass 1.2\nStaticFriction .8\nInertia 1050 0 0\n0 1200 0\n0 0 300\n}\nWHEEL 0 {\nMass .15\nRadius 10\nStaticFriction 1.5\n}\n}\0`);
  assert.equal(spec.topSpeed,33.5);assert.equal(spec.bodyMass,1.2);
  assert.deepEqual(spec.centerOfMass,[0,-5,1]);assert.deepEqual(spec.inertia,[1050,1200,300]);
  assert.equal(spec.wheels[0].mass,.15);assert.equal(spec.wheels[0].radius,1);
  assert.equal(spec.bodyFriction,.8);assert.equal(spec.wheels[0].staticFriction,1.5);
  assert.equal(carTopSpeed(spec),33.5*2.25*2,"The global double-speed setting applies to every model");
  assert.equal(carTopSpeed(spec)/SPEED_UNITS_PER_MPH,67,"HUD mph must use the same unit conversion as the car motor");
});

test("authored steering response varies between slow and fast steering cars", () => {
  assert.ok(smoothPlayerSteering(0,1,.1,8)>smoothPlayerSteering(0,1,.1,2.5));
});

await initializePhysics();
test("changing wheel torque or body mass in the parameter file changes acceleration", async t => {
  const originalFetch=globalThis.fetch,text=readFileSync("cars/rc/parameters.txt","utf8");
  const speeds=[];
  try {
    for(const variant of ["stock","more torque","more mass"]) {
      const parameters=variant==="more torque"?text.replace(/EngineRatio\s+6500\.000000/g,"EngineRatio 13000.000000")
        :variant==="more mass"?text.replace(/(BODY\s*\{[\s\S]*?Mass\s+)1\.200000/,(_,prefix)=>prefix+"2.400000"):text;
      globalThis.fetch=async url=>new Response(String(url).endsWith("parameters.txt")?parameters:readFileSync(String(url).slice(1)));
      const ground=new THREE.Group(),floor=new THREE.Mesh(new THREE.BoxGeometry(1000,1,1000));floor.position.y=-.5;ground.add(floor);
      const mesh=await loadCar("rc","RC Bandit"),physics=new MeshPhysics(ground),car=physics.createCar(mesh);
      try {
        assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
        for(let i=0;i<120;i++){physics.updateVehicle(car,1/120,0,0,0,false);physics.step();}
        for(let i=0;i<60;i++){physics.updateVehicle(car,1/120,1,0,0,false);physics.step();}
        speeds.push(car.body.linvel().z);
      } finally {physics.dispose();mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});floor.geometry.dispose();floor.material.dispose();}
    }
    assert.ok(speeds[1]>speeds[0]*1.1,`Extra wheel torque must increase acceleration: ${speeds}`);
    assert.ok(speeds[2]<speeds[0]*.8,`Extra body mass must reduce acceleration: ${speeds}`);
    t.diagnostic(`Half-second speed, stock/more torque/more mass: ${speeds.map(v=>v.toFixed(1)).join("/")}`);
  } finally {globalThis.fetch=originalFetch;}
});

test("all stock cars use file mass and speed, and rookies cannot match pro straight-line performance", async t => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  const results=[];
  try {
    for(const id of STOCK_CARS) {
      const text=readFileSync(`cars/${id}/parameters.txt`,"utf8"),spec=parseCarPerformance(text),details=carDetails(text,id);
      const mesh=await loadCar(id,id),ground=new THREE.Group();
      const floor=new THREE.Mesh(new THREE.BoxGeometry(1000,1,12000));floor.position.y=-.5;ground.add(floor);
      const physics=new MeshPhysics(ground),car=physics.createCar(mesh);
      try {
        assert.equal(car.setup.topSpeed,spec.topSpeed);assert.equal(car.setup.bodyMass,spec.bodyMass);
        const mass=(spec.bodyMass+spec.wheels.reduce((sum,w)=>sum+w.mass,0))*CAR_MASS_SCALE;
        assert.ok(Math.abs(car.body.mass()-mass)<.00001,`${id}: actual mass must match body plus wheels`);
        assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion()));
        for(let i=0;i<1440;i++) {physics.updateVehicle(car,1/120,1,0,0,false,1,2.1);physics.step();}
        const speed=car.body.linvel().z;
        assert.ok(speed>carTopSpeed(spec)*.65&&speed<carTopSpeed(spec),`${id}: speed ${speed} must follow its own motor limit`);
        assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(car.body.rotation()).y>.9,`${id}: straight launch must remain upright`);
        results.push({id,rating:details.rating,speed});
      } finally {physics.dispose();mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});floor.geometry.dispose();floor.material.dispose();}
    }
    const rookies=results.filter(r=>r.rating===0),pros=results.filter(r=>r.rating===4);
    const fastestRookie=Math.max(...rookies.map(r=>r.speed)),slowestPro=Math.min(...pros.map(r=>r.speed));
    assert.ok(fastestRookie<slowestPro*.9,`Fastest rookie ${fastestRookie} must be clearly slower than slowest pro ${slowestPro}`);
    t.diagnostic(results.map(r=>`${r.id}: ${r.speed.toFixed(1)}`).join("; "));
  } finally {globalThis.fetch=originalFetch;}
});
