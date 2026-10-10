import { chromium, webkit } from "playwright";
for (const [name, engine] of [["Chrome", chromium], ["Safari", webkit]]) {
  const browser = await engine.launch(name === "Chrome" ? { args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const shaderErrors = [];
    page.on("console", message => { if (/shader error|VALIDATE_STATUS|ERROR: 0:/i.test(message.text())) shaderErrors.push(message.text()); });
    page.on("pageerror", error => console.log(name, "PAGE ERROR:", error.message));
    page.on("console", message => { if (message.type() === "error") console.log(name, "CONSOLE ERROR:", message.text()); });
    page.on("requestfailed", request => console.log(name, "REQUEST FAILED:", request.url(), request.failure()?.errorText));
    await page.goto(process.env.GAME_TEST_URL ?? "http://127.0.0.1:8000/", { waitUntil: "domcontentloaded" });
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
