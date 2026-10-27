import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STOCK_CARS, carDetails, Showroom, CAR_DISPLAY, boxShelfPose } from "../src/showroom.js";
import { LEVELS, FRONTEND } from "../src/levels.js";
import { parsePrm, parseWorld, loadCar, loadLevel, disposeLevel, decodeBitmap, makeMeshes } from "../src/revolt.js";

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

test("showroom boxes use the untouched original model and BMP textures without rendering car previews", async () => {
  const originalFetch=globalThis.fetch, requests=[];
  globalThis.fetch=async url=>{requests.push(String(url));return new Response(readFileSync(String(url).slice(1)));};
  const buffer=path=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
  try {
    const model=parsePrm(buffer("levels/frontend/carbox.m"));
    const textures={3:decodeBitmap(buffer("levels/frontend/frontendd.bmp")),4:decodeBitmap(buffer("levels/frontend/frontende.bmp"))};
    const expected=makeMeshes([model],textures,[0,0,0]);
    const manifest=readdirSync("levels",{recursive:true}).map(p=>"/levels/"+p.replaceAll("\\","/"));
    // No renderer is needed: original package artwork is used directly.
    const showroom=await Showroom.create(null,manifest);
    assert.equal(showroom.boxes.length,28);
    for(const box of showroom.boxes) {
      assert.equal(box.children.length,expected.children.length);
      box.children.forEach((mesh,i)=>{
        const original=expected.children[i];
        for(const attribute of ['position','uv','color']) assert.deepEqual(mesh.geometry.attributes[attribute].array,original.geometry.attributes[attribute].array);
        assert.deepEqual(mesh.material.map.image.data,original.material.map.image.data);
        assert.equal(mesh.material.map.isCanvasTexture,undefined);
      });
    }
    assert.ok(!requests.some(path=>/^\/cars\/.*\.(?:prm|bmp|hul)$/i.test(path)),'Showroom must not load cars for label previews');
    showroom.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
    expected.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
    Object.values(textures).forEach(t=>t.dispose());
  } finally {globalThis.fetch=originalFetch;}
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

test("all car boxes sit within the four original L-shaped shelf surfaces", () => {
  const bytes=readFileSync("levels/frontend/frontend.w");
  const world=parseWorld(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const shelves=[];
  for(const mesh of world.meshes) for(const face of mesh.polygons) {
    const points=face.indices.slice(0,face.flags&1?4:3).map(i=>mesh.vertices[i].position.map((value,axis)=>value*(axis===1?-.1:.1)));
    const min=[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis])));
    const max=[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis])));
    if(face.texture===0&&max[1]-min[1]<.1&&CAR_DISPLAY.shelfHeights.some(y=>Math.abs(y-min[1])<.1)) shelves.push({min,max});
  }
  for(let index=0;index<STOCK_CARS.length;index++) {
    const {position:p,rotation:r}=boxShelfPose(index),scale=CAR_DISPLAY.scale;
    for(const x of [-8.4378,8.4378]) for(const z of [-10.5508,0]) {
      const px=p[0]+(x*Math.cos(r)+z*Math.sin(r))*scale;
      const pz=p[2]+(-x*Math.sin(r)+z*Math.cos(r))*scale;
      const floor=p[1]-6.8308*scale;
      assert.ok(shelves.some(s=>Math.abs(s.min[1]-floor)<.1&&px>=s.min[0]-.05&&px<=s.max[0]+.05&&pz>=s.min[2]-.05&&pz<=s.max[2]+.05),`Box ${index} must be supported by an existing shelf`);
    }
  }
});
