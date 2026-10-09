import test from "node:test";
import assert from "node:assert/strict";
import { gameAssetUrl } from "../src/assets.js";

test("asset paths support both localhost and repository-scoped hosting", () => {
  assert.equal(gameAssetUrl("/cars/rc/body.prm", "/"), "/cars/rc/body.prm");
  assert.equal(gameAssetUrl("/levels/nhood1/nhood1.w", "/revolt-clone/"), "/revolt-clone/levels/nhood1/nhood1.w");
  assert.equal(gameAssetUrl("wavs/petrol.wav", "/revolt-clone"), "/revolt-clone/wavs/petrol.wav");
  assert.equal(gameAssetUrl("https://example.com/sound.wav", "/revolt-clone/"), "https://example.com/sound.wav");
});
