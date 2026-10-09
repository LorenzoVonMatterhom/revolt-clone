import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STOCK_CARS, carDetails, labeledBox } from "../src/showroom.js";
import { LEVELS, FRONTEND } from "../src/levels.js";
import { parsePrm, loadCar } from "../src/revolt.js";

test("frontend is a menu asset, not a playable track", () => {
  assert.equal(FRONTEND.kind, "menu");
  assert.ok(!LEVELS.some((level) => level.id === "frontend"));
});

test("car labels preserve original box vertices and all other atlas UVs", () => {
  const bytes = readFileSync("levels/frontend/carbox.m");
  const source = parsePrm(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const labeled = labeledBox(source);
  assert.deepEqual(labeled.vertices, source.vertices);
  assert.equal(labeled.polygons[0].texture, 7);
  assert.equal(source.polygons[0].texture, 3);
  labeled.polygons.slice(1).forEach((polygon, i) => assert.deepEqual(polygon.uv, source.polygons[i + 1].uv));
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
