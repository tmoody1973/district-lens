/** Records the animated intro (intro.html) to clips/intro.webm — 7.2s. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: "clips/raw", size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.goto("file://" + path.resolve("intro.html"));
  await page.waitForTimeout(7200);
  const video = page.video();
  await context.close();
  fs.renameSync(await video.path(), "clips/intro.webm");
  await browser.close();
  console.log("intro recorded");
})();
