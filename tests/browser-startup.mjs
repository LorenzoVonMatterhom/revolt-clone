import { chromium, webkit } from "playwright";

// Install a fixture inside the game's module scope only in this browser test.
function installDrivingHarness() {
  // Keep software-rendered WebKit responsive for UI interactions.
  renderer.setPixelRatio(0.5); renderer.shadowMap.enabled = false;
  window.__lapTest = {
    paused: false,
    drive(from, to) {
      // Authored position samples own the player pose during lap/HUD checks.
      // Keep autonomous physics from replacing it between browser actions.
      this.paused = true;
      const route = makeRaceRoute(loadedLevel.aiRoute);
      const normal = checkpoints[0].normal;
      let phase = 0, closest = Infinity;
      for (let i = 1; i <= 4000; i++) {
        const a = route.getPointAt((i - 1) / 4000), b = route.getPointAt(i / 4000);
        const before = a.dot(normal), after = b.dot(normal);
        if (before >= 0 || after < 0) continue;
        const fraction = before / (before - after), at = a.clone().lerp(b, fraction);
        if (Math.hypot(at.x, at.z) < closest && Math.abs(at.y) < 80) {
          closest = Math.hypot(at.x, at.z); phase = (i - 1 + fraction) / 4000;
        }
      }
      // Sample real driving positions through the production player/HUD logic.
      for (let i = 0; i <= 4000; i++) {
        const t = (phase + 0.0001 + from + (to - from) * i / 4000) % 1;
        player.position.copy(route.getPointAt(t)).add(new THREE.Vector3(0, 2, 0));
        player.velocity.copy(route.getTangentAt(t)); // Slow finish crossings count too.
        player.updateProgress(nearestTrackData(player.position));
      }
      player.car.body.setTranslation(player.position, true);
      player.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      updateHud();
      return this.state();
    },
    completeReset() {
      resetFade?.update(1); resetFade?.update(1);
      updateHud();
      return this.state();
    },
    state() {
      return { lap: player.lap, checkpoint: player.nextCheckpoint, finished: player.finished, hud: lapEl.textContent };
    },
  };
  window.__flipTest = {
    overturn(moveAside = true) {
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.heading);
      const position = player.position.clone();
      if (moveAside) position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(rotation), 20);
      if (!physics.placeCar(player.car, position, rotation)) throw new Error("No clear flip fixture position");
      const at = player.car.body.translation(); at.y += 3;
      player.car.body.setTranslation(at, true);
      rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
      player.car.body.setRotation(rotation, true);
      player.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      player.syncPhysics();
      return this.state();
    },
    advance(seconds) {
      for (let i = 0; i < Math.ceil(seconds / PHYSICS_STEP); i++) stepRacePhysics();
      return this.state();
    },
    state() {
      return { elapsed: elapsedRace, up: new THREE.Vector3(0, 1, 0).applyQuaternion(player.mesh.quaternion).y,
        position: player.position.toArray(), lap: player.lap, checkpoint: player.nextCheckpoint };
    },
  };
}

async function openGamePage(browser, name) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const shaderErrors = [];
  page.on("console", message => { if (/shader error|VALIDATE_STATUS|ERROR: 0:/i.test(message.text())) shaderErrors.push(message.text()); });
  page.on("pageerror", error => console.log(name, "PAGE ERROR:", error.message));
  page.on("console", message => { if (message.type() === "error") console.log(name, "CONSOLE ERROR:", message.text()); });
  page.on("requestfailed", request => console.log(name, "REQUEST FAILED:", request.url(), request.failure()?.errorText));
  const gameUrl = process.env.GAME_TEST_URL ?? "http://127.0.0.1:8000/";
  await page.route(gameUrl, async route => {
    const response = await route.fetch();
    const body = await response.text();
    const instrumented = body.replace(/(<script[^>]*data-game-module="main\.js"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_, open, main, close) => open + main.replace("function stepRacePhysics() {",
        "function stepRacePhysics() {\n  if (window.__lapTest?.paused) return;") +
        "\n(" + installDrivingHarness.toString() + ")();\n" + close);
    if (instrumented === body) throw new Error("Could not instrument the embedded game module");
    await route.fulfill({ response, body: instrumented });
  });
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.querySelector("#scene")?.dataset.view === "menu" ||
    document.querySelector("#startDescription")?.textContent.startsWith("Could not start game:"),
    undefined, { timeout: 120000 });
  const failure = await page.locator("#startDescription").textContent();
  if (failure?.startsWith("Could not start game:")) throw new Error(failure);
  console.log(name, "mobile showroom loaded");
  return { page, shaderErrors };
}

for (const [name, engine] of [["Chrome", chromium], ["Safari", webkit]]) {
  const browser = await engine.launch(name === "Chrome" ? { args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  try {
    let { page, shaderErrors } = await openGamePage(browser, name);
    await page.locator("#carSelect").selectOption({ label: "Cougar" });
    await page.waitForFunction(() => document.querySelector("#scene")?.dataset.selectedCar === "cougar");
    await page.locator("#menuTrack").selectOption("ship1");
    await page.waitForFunction(() => window.revoltMap?.id === "ship1" && !document.querySelector("#startBtn").disabled, undefined, { timeout: 60000 });
    await page.locator("#startBtn").tap();
    await page.waitForFunction(() => document.querySelector("#scene")?.dataset.view === "race" && document.querySelector("#scene").dataset.raceReady === "true", undefined, { timeout: 30000 });
    console.log(name, "mobile Cougar race started");
    if (!await page.locator('.touch-controls button[data-code="KeyW"]').isVisible()) throw new Error("Gas button is hidden");
    console.log(name, "touch gas button visible");
    const debug = page.locator("#debugPanel");
    if (!await debug.isVisible() || !await page.locator("#debugPowerup").isVisible()) throw new Error("Power-up debug selector is hidden on mobile");
    console.log(name, "mobile power-up debug selector is visible");
    if (await page.locator('.touch-controls button[data-code="Space"]').count()) throw new Error("Slide button should be removed");
    const fire = page.getByRole("button", { name: "Fire power-up", exact: true });
    if (!await fire.isVisible()) throw new Error("Fire button is hidden");
    await page.evaluate(() => {
      const select = document.querySelector("#debugPowerup");
      select.value = "firework";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held === "firework");
    await fire.tap({ force: true });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held !== "firework");
    console.log(name, "Fire button used a power-up; Slide is removed");
    const flip = page.getByRole("button", { name: "Flip car", exact: true });
    if (!await flip.isVisible()) throw new Error("Flip button is hidden on mobile");
    const beforeFlip = await page.evaluate(() => {
      window.__flipTest.overturn();
      return window.__flipTest.advance(3);
    });
    if (beforeFlip.up > -0.8) throw new Error("Player car automatically righted itself");
    await flip.tap();
    await page.waitForFunction(() => window.__flipTest.state().up > 0.9);
    const afterFlip = await page.evaluate(() => window.__flipTest.state());
    if (Math.hypot(afterFlip.position[0] - beforeFlip.position[0], afterFlip.position[2] - beforeFlip.position[2]) > 5)
      throw new Error("Flip moved the player back to a checkpoint");
    if (afterFlip.lap !== beforeFlip.lap || afterFlip.checkpoint !== beforeFlip.checkpoint)
      throw new Error("Flip reset race progress");
    await page.evaluate(() => window.__flipTest.overturn(false));
    await page.keyboard.press("v");
    await page.waitForFunction(() => window.__flipTest.state().up > 0.9);
    console.log(name, "Flip button and V right the car locally; inverted cars do not auto-reset");
    await page.evaluate(() => {
      const select = document.querySelector("#debugPowerup");
      select.value = "electro"; select.dispatchEvent(new Event("change", { bubbles:true }));
    });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held === "electro");
    await fire.tap({ force: true });
    await page.waitForFunction(() => document.querySelector("#powerStatus").textContent.startsWith("Pulse:"));
    await page.waitForTimeout(300);
    if (shaderErrors.length) throw new Error(shaderErrors.join("\n"));
    console.log(name, "Electro pulse rendered without shader errors");
    await page.evaluate(() => {
      const select = document.querySelector("#debugPowerup");
      select.value = "battery"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held === "battery");
    await fire.tap({ force: true });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).boost > 0);
    await page.waitForTimeout(300);
    if (shaderErrors.length) throw new Error(shaderErrors.join("\n"));
    console.log(name, "Orange battery glow rendered without shader errors");
    await page.evaluate(() => {
      const select = document.querySelector("#debugPowerup");
      select.value = "shockwave"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held === "shockwave");
    await fire.tap({ force: true });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held !== "shockwave");
    await page.waitForTimeout(300);
    if (shaderErrors.length) throw new Error(shaderErrors.join("\n"));
    console.log(name, "Blue-white shockwave and bead trail rendered without shader errors");
    await page.locator("#menuBtn").tap();
    await page.locator("#menuTrack").selectOption("ship2");
    await page.waitForFunction(() => window.revoltMap?.id === "ship2" && !document.querySelector("#startBtn").disabled, undefined, { timeout: 60000 });
    await page.locator("#startBtn").tap();
    await page.waitForFunction(() => document.querySelector("#scene")?.dataset.view === "race" && document.querySelector("#scene").dataset.raceReady === "true", undefined, { timeout: 30000 });
    console.log(name, "Both Toytanic races loaded with pool water");
    await page.locator("#debugToggle").evaluate(button => button.click());
    if (await page.locator("#debugPowerup").isVisible()) throw new Error("Debug panel did not hide");
    await page.locator("#debugToggle").evaluate(button => button.click());
    if (!await page.locator("#debugPowerup").isVisible()) throw new Error("Debug panel did not reopen");
    console.log(name, "power-up debug Show/Hide button works");
    // Give deterministic lap fixtures their own WebGL/physics world. The live
    // driving/power-up smoke test above never resumes a sampled/teleported pose.
    await page.close();
    ({ page, shaderErrors } = await openGamePage(browser, name));
    for (const track of ["nhood1", "nhood2"]) {
      await page.locator("#menuTrack").selectOption(track);
      await page.waitForFunction(id => window.revoltMap?.id === id && !document.querySelector("#startBtn").disabled, track, { timeout: 60000 });
      await page.locator("#startBtn").tap();
      await page.waitForFunction(() => document.querySelector("#scene")?.dataset.view === "race" && document.querySelector("#scene").dataset.raceReady === "true");
      const secondLap = await page.evaluate(() => window.__lapTest.drive(0, 1));
      if (secondLap.hud !== "2/3") throw new Error(`${track}: first lap did not update HUD: ${JSON.stringify(secondLap)}`);
      const beforeReset = await page.evaluate(() => window.__lapTest.drive(0, 0.55));
      const reset = page.locator("#resetBtn");
      if (!await reset.isVisible() || !await reset.isEnabled()) throw new Error(`${track}: Reset button is unavailable`);
      // Invoke the actual button handler without waiting for software WebKit's
      // render-frame stability heuristic after sampling an entire circuit.
      await reset.dispatchEvent("click");
      const afterReset = await page.evaluate(() => window.__lapTest.completeReset());
      if (afterReset.lap !== beforeReset.lap || afterReset.checkpoint !== beforeReset.checkpoint)
        throw new Error(`${track}: Reset erased lap/checkpoint progress`);
      const thirdLap = await page.evaluate(() => window.__lapTest.drive(0.55, 1));
      if (thirdLap.hud !== "3/3") throw new Error(`${track}: second lap did not update HUD: ${JSON.stringify(thirdLap)}`);
      const finish = await page.evaluate(() => window.__lapTest.drive(0, 1));
      if (!finish.finished || finish.hud !== "3/3") throw new Error(`${track}: third lap did not finish: ${JSON.stringify(finish)}`);
      console.log(name, track, "HUD advances 1/3 → 2/3 → 3/3 and finishes; Reset preserves checkpoints");
      if (track !== "nhood2") await page.locator("#menuBtn").tap();
    }
    if (shaderErrors.length) throw new Error(shaderErrors.join("\n"));
  } finally { await browser.close(); }
}
