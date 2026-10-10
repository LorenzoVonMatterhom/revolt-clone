import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on("pageerror", error => console.log("PAGE ERROR:", error.message));
  page.on("console", message => { if (message.type() === "error") console.log("CONSOLE ERROR:", message.text()); });
  page.on("requestfailed", request => console.log("REQUEST FAILED:", request.url(), request.failure()?.errorText));
  await page.goto(process.env.GAME_TEST_URL ?? "http://127.0.0.1:8000/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.querySelector("#scene")?.dataset.view === "menu" ||
    document.querySelector("#startDescription")?.textContent.startsWith("Could not start game:"),
    { timeout: 120000 });
  const failure = await page.locator("#startDescription").textContent();
  if (failure?.startsWith("Could not start game:")) throw new Error(failure);
  console.log("Showroom loaded");
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => document.querySelector("#scene")?.dataset.view === "race", { timeout: 30000 });
  console.log("Race started");
} finally { await browser.close(); }
