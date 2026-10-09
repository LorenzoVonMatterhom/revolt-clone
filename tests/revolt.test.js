import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { LEVELS, FRONTEND } from "../src/levels.js";
import { parseWorld, parseInstances, parsePrm, parsePositions, parseInfo, decodeBitmap, makeMeshes, resolveModel } from "../src/revolt.js";

function buffer(path) {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

for (const level of [...LEVELS, FRONTEND]) test(`${level.id}: original geometry, UVs, textures and instances resolve`, () => {
  const root = `levels/${level.id}`, base = `${root}/${level.id}`;
  const files = readdirSync(root);
  const world = parseWorld(buffer(`${base}.w`));
  const instances = parseInstances(buffer(`${base}.fin`));
  const info = parseInfo(readFileSync(`${base}.inf`, "utf8"));
  assert.equal(info.STARTPOS.length, 3);
  assert.ok(info.STARTPOS.every(Number.isFinite));
  assert.ok(world.meshes.length > 0);
  const textures = new Map();
  const checkMesh = (mesh) => {
    for (const polygon of mesh.polygons) {
      let page = polygon.texture;
      if (polygon.flags & 512) {
        assert.ok(world.animations[page]?.length, `Animation ${page} exists`);
        page = world.animations[page][0].texture;
      }
      if (page >= 0) {
        const file = `${level.id}${String.fromCharCode(97 + page)}.bmp`;
        assert.ok(files.includes(file), `Texture page ${file} exists`);
        if (!textures.has(page)) textures.set(page, decodeBitmap(buffer(`${root}/${file}`)));
      }
      assert.ok(polygon.uv.flat().every(Number.isFinite));
    }
  };
  world.meshes.forEach(checkMesh);
  for (const instance of instances) {
    const model = resolveModel(instance.name, files);
    assert.ok(model, `Instance ${instance.name} resolves`);
    checkMesh(parsePrm(buffer(`${root}/${model}`)));
    assert.ok(instance.position.every(Number.isFinite));
    assert.ok(instance.matrix.every(Number.isFinite));
  }
  const path = parsePositions(existsSync(`${base}.pan`) ? buffer(`${base}.pan`) : new ArrayBuffer(0));
  assert.ok(path.every((p) => p.every(Number.isFinite)));
  const rendered = makeMeshes(world.meshes, Object.fromEntries(textures), info.STARTPOS, world.animations);
  let actualTriangles = 0;
  rendered.traverse((mesh) => {
    if (mesh.geometry) {
      actualTriangles += mesh.geometry.attributes.position.count / 3;
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    }
  });
  const expectedTriangles = world.meshes.flatMap((m) => m.polygons).reduce((sum, p) => sum + (p.flags & 1 ? 2 : 1), 0);
  assert.equal(actualTriangles, expectedTriangles);
  rendered.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  textures.forEach((t) => t.dispose());
});
