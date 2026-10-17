import { chromium, webkit } from "playwright";

// Install a fixture inside the game's module scope only in this browser test.
function installFlipHarness() {
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
    state() {
      return { elapsed: elapsedRace, up: new THREE.Vector3(0, 1, 0).applyQuaternion(player.mesh.quaternion).y,
        position: player.position.toArray(), lap: player.lap, checkpoint: player.nextCheckpoint };
    },
  };
}

for (const [name, engine] of [["Chrome", chromium], ["Safari", webkit]]) {
  const browser = await engine.launch(name === "Chrome" ? { args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  try {
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
        (_, open, main, close) => open + main + "\n(" + installFlipHarness.toString() + ")();\n" + close);
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
    await page.locator("#carSelect").selectOption({ label: "Cougar" });
    await page.waitForFunction(() => document.querySelector("#scene")?.dataset.selectedCar === "cougar");
    await page.locator("#menuTrack").selectOption("ship1");
    await page.waitForFunction(() => window.revoltMap?.id === "ship1" && !document.querySelector("#startBtn").disabled, undefined, { timeout: 60000 });
    await page.locator("#startBtn").tap();
    await page.waitForFunction(() => document.querySelector("#scene")?.dataset.view === "race", undefined, { timeout: 30000 });
    console.log(name, "mobile Cougar race started");
    if (!await page.locator('.touch-controls button[data-code="KeyW"]').isVisible()) throw new Error("Gas button is hidden");
    console.log(name, "touch gas button visible");
    if (await page.locator('.touch-controls button[data-code="Space"]').count()) throw new Error("Slide button should be removed");
    const fire = page.getByRole("button", { name: "Fire power-up", exact: true });
    if (!await fire.isVisible()) throw new Error("Fire button is hidden");
    await page.evaluate(() => {
      const select = document.querySelector("#debugPowerup");
      select.value = "firework";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held === "firework");
    await fire.tap();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#scene").dataset.powerups).held !== "firework");
    console.log(name, "Fire button used a power-up; Slide is removed");
    const flip = page.getByRole("button", { name: "Flip car", exact: true });
    if (!await flip.isVisible()) throw new Error("Flip button is hidden on mobile");
    const overturned = await page.evaluate(() => window.__flipTest.overturn());
    await page.waitForFunction(elapsed => window.__flipTest.state().elapsed > elapsed + 3,
      overturned.elapsed, { timeout: 60000 });
    const beforeFlip = await page.evaluate(() => window.__flipTest.state());
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
    await fire.tap();
    await page.waitForFunction(() => document.querySelector("#powerStatus").textContent.startsWith("Pulse:"));
    await page.waitForTimeout(300);
    if (shaderErrors.length) throw new Error(shaderErrors.join("\n"));
    console.log(name, "Electro pulse rendered without shader errors");
    await page.locator("#menuBtn").tap();
    await page.locator("#menuTrack").selectOption("ship2");
    await page.waitForFunction(() => window.revoltMap?.id === "ship2" && !document.querySelector("#startBtn").disabled, undefined, { timeout: 60000 });
    await page.locator("#startBtn").tap();
    await page.waitForFunction(() => document.querySelector("#scene")?.dataset.view === "race", undefined, { timeout: 30000 });
    console.log(name, "Both Toytanic races loaded with pool water");
  } finally { await browser.close(); }
}
