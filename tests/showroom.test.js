import test from "node:test";
import * as THREE from "three";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STOCK_CARS, carDetails, Showroom } from "../src/showroom.js";
import { ORIGINAL_BOX_CARS, originalBoxPlacements, originalBoxArtwork, originalBoxModel } from "../src/car-boxes.js";
import { LEVELS, FRONTEND } from "../src/levels.js";
import { parsePrm, parseObjects, parseInfo, loadCar, loadLevel, disposeLevel, decodeBitmap, makeMeshes } from "../src/revolt.js";

test("showroom geometry loads without downloading race collision files", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    return new Response(readFileSync(String(url).slice(1)));
  };
  let level;
  try {
    const manifest = readdirSync("levels", {recursive:true}).map(p=>"/levels/"+p.replaceAll("\\","/"));
    level = await loadLevel(FRONTEND, manifest, { collisions: false });
    assert.ok(level.group.children.length > 0);
    assert.equal(level.group.userData.collisionGroup, undefined);
    assert.ok(!requests.some(path=>path.endsWith(".ncp")));
  } finally { globalThis.fetch=originalFetch; disposeLevel(level); }
});

test("frontend is a menu asset, not a playable track", () => {
  assert.equal(FRONTEND.kind, "menu");
  assert.ok(!LEVELS.some((level) => level.id === "frontend"));
});

test("all boxes use their original stock artwork and package geometry without car-preview renders", async () => {
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async url=>{requests.push(String(url));return new Response(readFileSync(String(url).slice(1)));};
  const buffer=path=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
  let showroom;
  try {
    const source=parsePrm(buffer("levels/frontend/carbox.m"));
    const placements=originalBoxPlacements(parseObjects(buffer("levels/frontend/frontend.fob"),parseInfo(readFileSync("levels/frontend/frontend.inf","utf8")).STARTPOS));
    const textures={3:decodeBitmap(buffer("levels/frontend/frontendd.bmp")),4:decodeBitmap(buffer("levels/frontend/frontende.bmp"))};
    const art=new Map([1,2,3,5].map(page=>[page,decodeBitmap(buffer(`cars/misc/carbox${page}.bmp`))]));
    const manifest=readdirSync("levels",{recursive:true}).map(p=>"/levels/"+p.replaceAll("\\","/"));
    showroom=await Showroom.create(null,manifest);
    assert.equal(showroom.boxes.length,28);
    for(const box of showroom.boxes) {
      const id=box.userData.carId,model=originalBoxModel(source,id),{page}=originalBoxArtwork(id);
      const placement=placements.get(id);
      assert.deepEqual(box.userData.home,placement.position);assert.deepEqual(box.position,placement.position);
      assert.ok(box.quaternion.angleTo(placement.quaternion)<.00001);assert.deepEqual(box.scale.toArray(),[1,1,1]);
      assert.deepEqual(model.vertices,source.vertices);
      assert.deepEqual(model.polygons[0],source.polygons[0],'Do not repaint the package back');
      assert.deepEqual(model.polygons.slice(2),source.polygons.slice(2),'Keep original side/frame/top UVs and colors');
      assert.equal(source.polygons[1].texture,4,'The source model must not be mutated');
      const expected=makeMeshes([model],{...textures,7:art.get(page)},[0,0,0]);
      assert.equal(box.children.length,expected.children.length);
      box.children.forEach((mesh,i)=>{
        const original=expected.children[i];
        for(const attribute of ['position','uv','color'])assert.deepEqual(mesh.geometry.attributes[attribute].array,original.geometry.attributes[attribute].array);
        assert.deepEqual(mesh.material.map.image.data,original.material.map.image.data,'Sample the original BMP directly');
        assert.equal(mesh.material.map.isCanvasTexture,undefined);
        assert.equal(mesh.material.alphaTest,0,'Original black printed details must be opaque');
      });
      expected.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
    }
    assert.ok(!requests.some(path=>/^\/cars\/.*\.(?:prm|hul)$/i.test(path)),'No car-model downloads for box labels');
    for(const texture of [...Object.values(textures),...art.values()])texture.dispose();
  } finally {
    globalThis.fetch=originalFetch;
    showroom?.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }
});

test("all 28 stock selections load their actual models, wheels and display metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const bytes = readFileSync(url.replace(/^\//, ""));
    return { ok: true, text: async () => bytes.toString(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  try {
    assert.equal(new Set(STOCK_CARS).size, 28);
    for (const id of STOCK_CARS) {
      const details = carDetails(readFileSync(`cars/${id}/parameters.txt`, "utf8"), id);
      const car = await loadCar(id, details.name);
      assert.equal(car.name, details.name);
      assert.equal(car.userData.engineClass, details.engineClass);
      assert.equal(car.userData.wheels.length, 4);
      assert.ok(details.speed > 0);
      assert.ok(details.weight > 0);
      car.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("every car uses its own original FOB position, orientation and full-size package", async () => {
  const buffer=path=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
  const info=parseInfo(readFileSync("levels/frontend/frontend.inf","utf8"));
  const objects=parseObjects(buffer("levels/frontend/frontend.fob"),info.STARTPOS);
  const entries=objects.filter(object=>object.type===46&&object.flags[0]>=0);
  const placements=originalBoxPlacements(objects);
  assert.equal(entries.length,28);assert.equal(placements.size,28);
  const important={rc:0,mite:1,beatall:5,dino:8,gencar:10,adeon:19,fone:20,cougar:23,sugo:24,toyeca:25,amw:26,panga:27};
  for(const [id,boxId]of Object.entries(important))assert.equal(placements.get(id).boxId,boxId);
  for(const object of entries){
    const id=ORIGINAL_BOX_CARS[object.flags[0]],pose=placements.get(id);
    assert.deepEqual(pose.position,object.position);
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(pose.quaternion);
    assert.ok(forward.distanceTo(new THREE.Vector3(object.forward[0],-object.forward[1],object.forward[2]).normalize())<.00001);
  }
  assert.equal([...placements.values()].filter(p=>p.position.y<10).length,6,'Six boxes must be on the floor');
});

test("original box sheets identify every stock car, including Panga's separate tile",()=>{
  for(let index=0;index<27;index++){
    const tile=originalBoxArtwork(ORIGINAL_BOX_CARS[index]);
    assert.deepEqual(tile,{page:Math.floor(index/9)+1,column:index%3,row:Math.floor(index%9/3)});
  }
  assert.deepEqual(originalBoxArtwork('panga'),{page:5,column:2,row:1});
});
