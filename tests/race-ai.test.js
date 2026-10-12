import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as THREE from "three";
import { RaceAI, makeRaceRoute, makeAiRoute, findAiRecovery, trafficSpeedLimit } from "../src/race-ai.js";
import { loadLevel, loadCar, disposeLevel } from "../src/revolt.js";
import { initializePhysics, MeshPhysics } from "../src/physics.js";
import { LEVELS } from "../src/levels.js";

test("AI targets nearby route distances and slows before the first neighborhood corner", () => {
  const ai = new RaceAI([new THREE.Vector3(0,0,0), new THREE.Vector3(500,0,0), new THREE.Vector3(500,0,-500), new THREE.Vector3(0,0,-500)]);
  const controls = ai.update(1/60, new THREE.Vector3(400,0,0), Math.PI/2, new THREE.Vector3(60,0,0));
  assert.ok(Math.abs(controls.steering) < 0.01, "Must not steer diagonally toward a distant segment");
  assert.ok(controls.brake > 0, "Must slow before a sharp turn");
});

test("opponents accelerate at full throttle and cruise faster on long straights", () => {
  const points=[new THREE.Vector3(),new THREE.Vector3(3000,0,0),new THREE.Vector3(3000,0,3000),new THREE.Vector3(0,0,3000)];
  for(const pace of [0.88,0.92,0.96]) {
    const ai=new RaceAI(points,pace);
    const launch=ai.update(1/60,new THREE.Vector3(10,0,0),Math.PI/2,new THREE.Vector3());
    assert.equal(launch.throttle,1);
    const cruising=ai.update(1/60,new THREE.Vector3(100,0,0),Math.PI/2,new THREE.Vector3(80,0,0));
    assert.ok(cruising.throttle>0.75,"Must keep accelerating beyond the previous cruising limit");
    assert.equal(cruising.brake,0);
  }
});

test("corner braking ramps up near the turn rather than crawling throughout the approach", () => {
  const points=[new THREE.Vector3(),new THREE.Vector3(1000,0,0),new THREE.Vector3(1000,0,1000),new THREE.Vector3(0,0,1000)];
  const far=new RaceAI(points),near=new RaceAI(points);
  const approach=far.update(1/60,new THREE.Vector3(800,0,0),Math.PI/2,new THREE.Vector3(55,0,0));
  const corner=near.update(1/60,new THREE.Vector3(980,0,0),Math.PI/2,new THREE.Vector3(55,0,0));
  assert.ok(approach.throttle>0.5);
  assert.ok(corner.brake>approach.brake);
});

test("route follows original straight segments without spline overshoot", () => {
  const route = makeRaceRoute([new THREE.Vector3(0,0,0),new THREE.Vector3(100,0,0),new THREE.Vector3(100,0,100),new THREE.Vector3(0,0,100)]);
  assert.equal(route.getLength(), 400);
  for (let i = 0; i < 100; i++) {
    const point = route.getPointAt(i / 100);
    assert.ok(point.x >= 0 && point.x <= 100 && point.z >= 0 && point.z <= 100);
  }
});

test("AI ignores elevated race-position markers when an authored driving line exists", () => {
  const markers=[new THREE.Vector3(0,200,0),new THREE.Vector3(100,-75,0),new THREE.Vector3(100,80,100)];
  const drivingLine=[new THREE.Vector3(),new THREE.Vector3(100,0,0),new THREE.Vector3(100,0,100)];
  assert.equal(makeAiRoute(markers,drivingLine),drivingLine);
});

test("opponents brake for close traffic, ignore adjacent lanes and bridge decks, and do not reverse into queues", () => {
  const size=new THREE.Vector3(3,2,6),position=new THREE.Vector3(),velocity=new THREE.Vector3(0,0,60);
  const stopped={position:new THREE.Vector3(0,0,14),velocity:new THREE.Vector3(),halfExtents:size,heading:0};
  assert.equal(trafficSpeedLimit(position,0,velocity,size,[stopped]),0);
  assert.equal(trafficSpeedLimit(position,0,velocity,size,[{...stopped,position:new THREE.Vector3(20,0,14)}]),Infinity);
  assert.equal(trafficSpeedLimit(position,0,velocity,size,[{...stopped,position:new THREE.Vector3(0,15,14)}]),Infinity);
  const ai=new RaceAI([position,new THREE.Vector3(0,0,1000),new THREE.Vector3(1000,0,1000),new THREE.Vector3(1000,0,0)]);
  for(let i=0;i<15;i++) {
    const controls=ai.update(0.1,position,0,new THREE.Vector3(),{traffic:[stopped],halfExtents:size});
    assert.equal(controls.throttle,0);assert.equal(controls.brake,1);assert.equal(controls.recovery,undefined);
  }
  assert.equal(ai.recoveryCount,0);
});

test("stuck recovery does not advance laps and electrical cuts do not trigger recovery", () => {
  const points = [new THREE.Vector3(),new THREE.Vector3(100,0,0),new THREE.Vector3(100,0,100),new THREE.Vector3(0,0,100)];
  const ai = new RaceAI(points);
  let recovery;
  for (let i = 0; i < 80; i++) recovery = ai.update(0.1, points[0], 0, new THREE.Vector3(), {disabled:true}).recovery;
  assert.equal(ai.recoveryCount, 0);
  for (let i = 0; i < 80; i++) {
    const controls = ai.update(0.1, points[0], 0, new THREE.Vector3());
    if (controls.recovery) recovery = controls.recovery;
  }
  assert.ok(recovery); assert.equal(ai.laps, 0); assert.ok(ai.recoveryCount > 0);
});

await initializePhysics();
const manifest = readdirSync("levels", {recursive:true}).map((path) => `/levels/${path.replaceAll("\\", "/")}`);
test("an original opponent reaches a bounded cruising speed on a straight", async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  let physics,mesh;
  try {
    const ground=new THREE.Group();
    const floor=new THREE.Mesh(new THREE.BoxGeometry(500,1,6000));floor.position.y=-0.5;ground.add(floor);
    physics=new MeshPhysics(ground);mesh=await loadCar("volken","Volken Turbo");
    const car=physics.createCar(mesh);car.body.setTranslation({x:0,y:0.8,z:0},true);
    const ai=new RaceAI([new THREE.Vector3(),new THREE.Vector3(0,0,2000),new THREE.Vector3(1000,0,2000),new THREE.Vector3(1000,0,0)],0.92,car.setup);
    for(let frame=0;frame<1200;frame++) {
      const rotation=car.body.rotation(),forward=new THREE.Vector3(0,0,1).applyQuaternion(rotation);
      const controls=ai.update(1/120,new THREE.Vector3().copy(car.body.translation()),Math.atan2(forward.x,forward.z),new THREE.Vector3().copy(car.body.linvel()));
      physics.updateVehicle(car,1/120,controls.throttle,controls.brake,controls.steering,false);physics.step();
    }
    assert.ok(car.body.linvel().z>120&&car.body.linvel().z<190,`Actual opponent speed: ${car.body.linvel().z}`);
    assert.ok(car.body.translation().z>1200,`Opponent must keep making progress: ${car.body.translation().z}`);
  } finally {
    globalThis.fetch=originalFetch;physics?.dispose();mesh?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }
});
for (const {id} of LEVELS.filter(level=>level.kind==="race"&&level.id!=="stunts")) test(`opponent completes a full ${id} lap on original collision meshes`, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(String(url).slice(1)));
  let level, physics, mesh;
  try {
    level = await loadLevel({id}, manifest); physics = new MeshPhysics(level.group); physics.world.timestep = 1/60;
    mesh = await loadCar("volken", "Volken Turbo"); const car = physics.createCar(mesh);
    const ai = new RaceAI(makeAiRoute(level.path, level.aiPath), 0.92,car.setup);
    const position = new THREE.Vector3(0, 0.8, 0), velocity = new THREE.Vector3();
    assert.ok(physics.placeCar(car,position,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),level.info.STARTROT[0]*Math.PI*2)));
    let steering = 0;
    for (let frame = 0; frame < 60 * 1200 && ai.laps === 0; frame++) {
      position.copy(car.body.translation()); velocity.copy(car.body.linvel());
      const rotation = car.body.rotation();
      const forward = new THREE.Vector3(0,0,1).applyQuaternion(rotation);
      const upsideDown = new THREE.Vector3(0,1,0).applyQuaternion(rotation).y < 0.25;
      const controls = ai.update(1/60, position, Math.atan2(forward.x, forward.z), velocity, {upsideDown});
      if (controls.recovery) {
        const recovery = findAiRecovery(physics, ai, controls.recoveryDistance);
        if (recovery) {
          if(physics.placeCar(car,recovery.position,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),recovery.heading))) {
            steering=0; ai.acceptRecovery(recovery.distance);
          }
        }
      }
      steering = THREE.MathUtils.lerp(steering, controls.steering, 1-Math.exp(-7.5/60));
      physics.updateVehicle(car,1/60,controls.throttle,controls.brake,steering,false); physics.step(); physics.checkCar(car,1/60);
    }
    assert.ok(ai.laps >= 1, `Stopped on segment ${ai.segment}/${ai.points.length}, progress ${(ai.distance/ai.length).toFixed(3)}, recoveries ${ai.recoveryCount}, position ${position.toArray()}, recovery ${ai.at(ai.distance+25).toArray()}, floor ${physics.groundAt(ai.at(ai.distance+25), 100, 200)}`);
    assert.ok(ai.recoveryCount < 30, `Too many recoveries: ${ai.recoveryCount}`);
  } finally {
    physics?.dispose(); disposeLevel(level); globalThis.fetch = originalFetch;
    mesh?.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
  }
});

test("all three original opponents complete a Neighborhood lap while colliding with each other", async (t) => {
  const originalFetch=globalThis.fetch;globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  let level,physics;const meshes=[];
  try {
    level=await loadLevel({id:"nhood1"},manifest);physics=new MeshPhysics(level.group);physics.world.timestep=1/60;
    const heading=level.info.STARTROT[0]*Math.PI*2;
    const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading);
    const opponents=[];
    for(const [i,id] of ["volken","phat","cougar"].entries()) {
      const mesh=await loadCar(id,id);meshes.push(mesh);const car=physics.createCar(mesh);
      const position=new THREE.Vector3([3.2,-1.4,3.8][i],0,-20*(i+1)).applyQuaternion(rotation);
      assert.ok(physics.placeCar(car,position,rotation));
      opponents.push({car,ai:new RaceAI(level.aiPath,[0.92,0.88,0.96][i],car.setup),steering:0});
      physics.step();
    }
    for(let frame=0;frame<60*1200&&opponents.some(opponent=>opponent.ai.laps<1);frame++) {
      for(const opponent of opponents) {
        const {car,ai}=opponent;
        if(ai.laps>=1){
          if(!opponent.parked){assert.ok(physics.parkCar(car));opponent.parked=true;}
          physics.updateVehicle(car,1/60,0,1,0,false);continue;
        }
        const rotation=car.body.rotation(),position=new THREE.Vector3().copy(car.body.translation());
        const forward=new THREE.Vector3(0,0,1).applyQuaternion(rotation);
        const traffic=opponents.filter(other=>other!==opponent).map(other=>{
          const direction=new THREE.Vector3(0,0,1).applyQuaternion(other.car.body.rotation());
          return {position:new THREE.Vector3().copy(other.car.body.translation()),velocity:new THREE.Vector3().copy(other.car.body.linvel()),heading:Math.atan2(direction.x,direction.z),halfExtents:other.car.setup.halfExtents};
        });
        const controls=ai.update(1/60,position,Math.atan2(forward.x,forward.z),new THREE.Vector3().copy(car.body.linvel()),{upsideDown:new THREE.Vector3(0,1,0).applyQuaternion(rotation).y<0.25,traffic,halfExtents:car.setup.halfExtents});
        if(controls.recovery) {
          const recovery=findAiRecovery(physics,ai,controls.recoveryDistance);
          if(recovery&&physics.placeCar(car,recovery.position,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),recovery.heading))) {
            ai.acceptRecovery(recovery.distance);opponent.steering=0;
          }
        }
        opponent.steering=THREE.MathUtils.lerp(opponent.steering,controls.steering,1-Math.exp(-7.5/60));
        physics.updateVehicle(car,1/60,controls.throttle,controls.brake,opponent.steering,false);
      }
      physics.step();opponents.forEach(opponent=>physics.checkCar(opponent.car,1/60,opponents.map(other=>other.car)));
    }
    t.diagnostic(opponents.map((opponent,i)=>`${meshes[i].name}: ${opponent.ai.laps} laps, ${opponent.ai.recoveryCount} recoveries`).join("; "));
    opponents.forEach((opponent,i)=>assert.ok(opponent.ai.laps>=1,`${meshes[i].name} stalled at ${opponent.ai.distance/opponent.ai.length}`));
  } finally {globalThis.fetch=originalFetch;physics?.dispose();disposeLevel(level);meshes.forEach(mesh=>mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();}));}
});
