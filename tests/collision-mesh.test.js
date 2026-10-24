import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as THREE from "three";
import { collisionMesh } from "../src/collision-mesh.js";
import { loadCar, loadLevel, disposeLevel } from "../src/revolt.js";
import { initializePhysics, MeshPhysics, meshTriangles } from "../src/physics.js";

await initializePhysics();
test("the static HTML manifest includes original instance collision files", () => {
  const html = readFileSync("index.html", "utf8");
  const manifest = JSON.parse(html.match(/const __REVOLT_FILES__ = (\[.*?\]);/)[1]);
  for (const path of readdirSync("levels", {recursive:true}).filter(path=>path.endsWith(".ncp"))) {
    assert.ok(manifest.includes("/levels/"+path.replaceAll("\\","/")), path + " must be available in the published game");
  }
});
function planeFile(flags = 1) {
  const buffer = new ArrayBuffer(114), view = new DataView(buffer);
  view.setUint16(0, 1, true); view.setUint32(2, flags, true);
  const planes = [[0,-1,0,0], [1,0,0,-500], [0,0,1,-500], [-1,0,0,-500], [0,0,-1,-500]];
  planes.flat().forEach((value, i) => view.setFloat32(10 + i * 4, value, true));
  return buffer;
}
test("NCP planes reconstruct the intended floor with correct scale, origin and winding", () => {
  const mesh = collisionMesh(planeFile(), [100, 20, 100]);
  const positions = mesh.geometry.attributes.position;
  assert.equal(positions.count, 6);
  const bounds = new THREE.Box3().setFromObject(mesh);
  assert.deepEqual(bounds.min.toArray(), [-60,2,-60]);
  assert.deepEqual(bounds.max.toArray(), [40,2,40]);
  const a = new THREE.Vector3().fromBufferAttribute(positions, 0);
  const b = new THREE.Vector3().fromBufferAttribute(positions, 1).sub(a);
  const c = new THREE.Vector3().fromBufferAttribute(positions, 2).sub(a);
  assert.ok(b.cross(c).y > 0);
});
test("camera-only and no-collision faces never block a car", () => {
  for (const flags of [1 | 8, 1 | 128]) assert.equal(collisionMesh(planeFile(flags)).geometry.attributes.position.count, 0);
  assert.throws(() => collisionMesh(new ArrayBuffer(1)), /header/);
  assert.throws(() => collisionMesh(planeFile().slice(0,100)), /Truncated/);
});
test("Cougar crosses render-only decoration without invisible impacts, but still hits a solid wall", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(String(url).slice(1)));
  let physics, mesh;
  try {
    const group = new THREE.Group(), solids = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(60,8,0.1), new THREE.MeshBasicMaterial({ transparent:true, opacity:0 })));
    solids.add(collisionMesh(planeFile()));
    const wall = new THREE.Mesh(new THREE.BoxGeometry(60,8,0.2));
    wall.position.set(0,4,35); solids.add(wall);
    group.userData.collisionGroup = solids;
    physics = new MeshPhysics(group);
    mesh = await loadCar("cougar", "Cougar"); const car = physics.createCar(mesh);
    assert.ok(physics.placeCar(car, new THREE.Vector3(0,0,-15), new THREE.Quaternion()));
    let crossed = false, maxHeight = -Infinity;
    for (let i=0; i<480; i++) {
      physics.updateVehicle(car,1/120,1,0,0,false); physics.step();
      crossed ||= car.body.translation().z > 5;
      maxHeight = Math.max(maxHeight,car.body.translation().y);
    }
    assert.ok(crossed,"Cougar must cross the decorative plane instead of hitting it");
    assert.ok(maxHeight < 2,"Clear-road driving must not launch the car");
    assert.ok(car.body.translation().z < 31,"Real wall must still stop Cougar");
  } finally { physics?.dispose(); globalThis.fetch=realFetch; mesh?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();}); }
});
test("original tracks use authored collision rather than all decorative render polygons", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(String(url).slice(1)));
  const manifest = readdirSync("levels", {recursive:true}).map(path=>"/levels/"+path.replaceAll("\\","/"));
  try {
    for (const id of ["nhood1","ship1","ship2"]) {
      const level = await loadLevel({id},manifest);
      try {
        const solid = level.group.userData.collisionGroup;
        assert.ok(solid);
        assert.equal(solid.visible,false);
        const nativeCount = meshTriangles(level.group).indices.length;
        delete level.group.userData.collisionGroup; solid.userData.noCollision=true;
        const visualCount = meshTriangles(level.group).indices.length;
        assert.ok(nativeCount > 0 && nativeCount < visualCount, id + " should exclude decorative geometry");
      } finally { disposeLevel(level); }
    }
  } finally { globalThis.fetch=realFetch; }
});

test("Cougar's native neighborhood wall contact stays solid without repeated penetration resets", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(String(url).slice(1)));
  const manifest = readdirSync('levels', {recursive:true}).map(path=>'/levels/'+path.replaceAll('\\','/'));
  let level,physics,mesh;
  try {
    level=await loadLevel({id:'nhood1'},manifest);
    physics=new MeshPhysics(level.group);
    mesh=await loadCar('cougar','Cougar');const car=physics.createCar(mesh);
    assert.ok(physics.placeCar(car,new THREE.Vector3(),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),level.info.STARTROT[0]*Math.PI*2)));
    let deepFrames=0,resets=0,impacts=0;
    for(let i=0;i<720;i++) {
      physics.updateVehicle(car,1/120,1,0,.2,false,1,2.1);physics.step();
      const before=new THREE.Vector3().copy(car.body.translation());
      physics.checkCar(car,1/120);
      if(before.distanceTo(car.body.translation())>2)resets++;
      if(car.embeddedTime>0)deepFrames++;
      if(car.impact>1.5)impacts++;
    }
    assert.ok(impacts>0,'The drive must actually hit the native wall');
    assert.equal(resets,0,'A solid wall must stop the car instead of penetration/reset loops');
    assert.ok(deepFrames<12,`Wall penetration must not persist: ${deepFrames} frames`);
    const stuckAt=new THREE.Vector3().copy(car.body.translation());
    for(let i=0;i<240;i++){physics.updateVehicle(car,1/120,-1,0,0,false,1,2.1);physics.step();physics.checkCar(car,1/120);}
    assert.ok(stuckAt.distanceTo(car.body.translation())>8,'Reverse must free the car from the wall');
  } finally {physics?.dispose();disposeLevel(level);globalThis.fetch=realFetch;mesh?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
});

test("original chassis slide across flat and banked triangle seams without being launched", async () => {
  const realFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  try {
    for(const slope of [0,0.2])for(const upsideDown of [false,true])for(const id of ['rc','cougar']) {
      const group=new THREE.Group(),vertices=[];
      // Independently reconstructed face corners differ by NCP rounding noise.
      for(let x=-10;x<10;x++)for(let z=-10;z<50;z++) {
        const noise=((x+z)%2)*0.00002;
        const a=[x*4,x*4*slope,-z*4],b=[(x+1)*4+noise,(x+1)*4*slope,-z*4];
        const c=[(x+1)*4,(x+1)*4*slope,-(z+1)*4],d=[x*4+noise,x*4*slope,-(z+1)*4];
        vertices.push(...a,...b,...c,...a,...c,...d);
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      group.add(new THREE.Mesh(geometry));
      const physics=new MeshPhysics(group),mesh=await loadCar(id,id);
      try {
        const car=physics.createCar(mesh);
        const startHeight=upsideDown?car.setup.center.y+car.setup.halfExtents.y:0.3;
        car.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),upsideDown?Math.PI:0),true);
        car.body.setTranslation({x:0,y:startHeight,z:0},true);
        car.body.setLinvel({x:0,y:0,z:-100},true);
        let maxRise=0,maxUpwardSpeed=0;
        for(let i=0;i<180;i++) {
          physics.step();
          maxRise=Math.max(maxRise,car.body.translation().y-startHeight);
          maxUpwardSpeed=Math.max(maxUpwardSpeed,car.body.linvel().y);
        }
        const label=`${id}, bank ${slope}, inverted ${upsideDown}`;
        assert.ok(maxRise<0.25,`${label}: seam launched the chassis ${maxRise} units`);
        assert.ok(maxUpwardSpeed<3,`${label}: seam imparted upward speed ${maxUpwardSpeed}`);
        assert.ok(car.body.translation().z < -80,`${label}: chassis snagged on a seam`);
      }finally{
        physics.dispose();geometry.dispose();
        mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
      }
    }
  }finally{globalThis.fetch=realFetch;}
});

test("Neighborhood 1 sidewalk descents do not launch cars at the curb lip", async () => {
  const realFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  const manifest=readdirSync('levels',{recursive:true}).map(path=>'/levels/'+path.replaceAll('\\','/'));
  let level;
  try {
    level=await loadLevel({id:'nhood1'},manifest);
    for(const id of ['cougar','rc']) {
      const mesh=await loadCar(id,id);
      try {
        for(const speed of [20,40,80,140])for(const heading of [0,0.5]) {
          const physics=new MeshPhysics(level.group);
          try {
            const car=physics.createCar(mesh);
            const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading);
            // Native sidewalk top y=3.8, curb z=-81.4, road y=-3.7.
            assert.ok(physics.placeCar(car,new THREE.Vector3(40,3.8,-100),rotation));
            for(let i=0;i<240;i++){physics.updateVehicle(car,1/120,0,0,0,false);physics.step();}
            const startHeight=car.body.translation().y;
            car.body.setLinvel({x:Math.sin(heading)*speed,y:0,z:Math.cos(heading)*speed},true);
            let maxRise=0,upwardBeforeDrop=0,resets=0;
            for(let i=0;i<360;i++) {
              physics.updateVehicle(car,1/120,0,0,0,false);physics.step();
              const before=new THREE.Vector3().copy(car.body.translation());
              physics.checkCar(car,1/120);
              const position=car.body.translation();
              if(before.distanceTo(position)>1)resets++;
              maxRise=Math.max(maxRise,position.y-startHeight);
              if(position.z< -78)upwardBeforeDrop=Math.max(upwardBeforeDrop,car.body.linvel().y);
              if(position.z> -40)break; // Finish before reaching the opposite wall.
            }
            const label=`${id}, speed ${speed}, heading ${heading}`;
            assert.equal(resets,0,`${label}: normal curb descent triggered recovery`);
            assert.ok(maxRise<0.25,`${label}: curb launched car ${maxRise} units above sidewalk`);
            assert.ok(upwardBeforeDrop<2,`${label}: curb imparted upward speed ${upwardBeforeDrop} before descent`);
            assert.ok(car.body.translation().z> -78,`${label}: car snagged on curb lip`);
          }finally{physics.dispose();}
        }
      }finally{mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
    }
  }finally{disposeLevel(level);globalThis.fetch=realFetch;}
});

test("Humma clears the Neighborhood 1 car-jump approach without a repeating respawn loop", async () => {
  const realFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
  const manifest=readdirSync('levels',{recursive:true}).map(path=>'/levels/'+path.replaceAll('\\','/'));
  let level,mesh;
  try {
    level=await loadLevel({id:'nhood1'},manifest);mesh=await loadCar('sugo','Humma');
    for(const speed of [0,60,120]) {
      const physics=new MeshPhysics(level.group),car=physics.createCar(mesh,{autoRighting:false});
      try {
        assert.ok(physics.placeCar(car,new THREE.Vector3(1650,0,-1660),new THREE.Quaternion()));
        car.body.setLinvel({x:0,y:0,z:speed},true);
        const place=physics.placeCar.bind(physics);let recoveries=0,furthest=-Infinity;
        physics.placeCar=(...args)=>{recoveries++;return place(...args);};
        for(let i=0;i<1200;i++) {
          physics.updateVehicle(car,1/120,1,0,0,false,1,2.1);physics.step();
          physics.checkCar(car,1/120);furthest=Math.max(furthest,car.body.translation().z);
        }
        assert.ok(recoveries<=1,`Humma at speed ${speed} respawned ${recoveries} times in ten seconds`);
        assert.ok(furthest> -1600,`Humma at speed ${speed} remained locked on the jump approach`);
        if(speed===0)assert.equal(recoveries,0,'Normal acceleration into the jump must not trigger recovery');
      }finally{physics.dispose();}
    }
  }finally{disposeLevel(level);mesh?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});globalThis.fetch=realFetch;}
});
