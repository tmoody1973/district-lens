/**
 * Records the six demo beats from the live prod app, one video per beat.
 * Each beat runs in a fresh context with recordVideo; a fake cursor dot is
 * injected so clicks are visible in headless footage. Sync offsets (when the
 * "action" starts relative to video start) are written to clips/offsets.json
 * so the composer can trim pre-roll (page rebuild) out of each clip.
 */

const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "https://districtlens-web-655022470154.us-central1.run.app";
const SIZE = { width: 1920, height: 1080 };
const TYPE_DELAY = 55;

const CURSOR_CSS = `
  #demo-cursor { position: fixed; z-index: 999999; width: 18px; height: 18px;
    border-radius: 50%; background: rgba(255,255,255,0.85);
    border: 2px solid rgba(0,0,0,0.6); pointer-events: none;
    transform: translate(-50%, -50%); transition: width .1s, height .1s; }
  #demo-cursor.down { width: 13px; height: 13px; background: #fbbf24; }
`;

const CURSOR_JS = `
  (() => {
    const dot = document.createElement('div');
    dot.id = 'demo-cursor';
    document.documentElement.appendChild(dot);
    window.addEventListener('mousemove', e => {
      dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px';
    }, true);
    window.addEventListener('mousedown', () => dot.classList.add('down'), true);
    window.addEventListener('mouseup', () => dot.classList.remove('down'), true);
  })();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function glide(page, x, y, steps = 24) {
  // Smooth cursor travel so movement reads naturally on camera.
  await page.mouse.move(x, y, { steps });
  await sleep(150);
}

async function newBeat(browser, name) {
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: "clips/raw", size: SIZE },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(CURSOR_JS);
  const page = await context.newPage();
  await page.addStyleTag({ content: CURSOR_CSS }).catch(() => {});
  const t0 = Date.now();
  return { context, page, t0, name };
}

async function injectCursorStyles(page) {
  await page.addStyleTag({ content: CURSOR_CSS }).catch(() => {});
}

async function finishBeat(beat, offsets, actionStart) {
  const video = beat.page.video();
  await beat.context.close();
  const path = await video.path();
  const target = `clips/${beat.name}.webm`;
  fs.renameSync(path, target);
  offsets[beat.name] = Math.max(0, (actionStart - beat.t0) / 1000);
  console.log(`${beat.name}: saved, action offset ${offsets[beat.name].toFixed(1)}s`);
}

async function openWarmWorkspace(page) {
  await page.goto(`${BASE}/w?race=2026-H-WI-04`, { waitUntil: "domcontentloaded" });
  await injectCursorStyles(page);
  await page.getByText("Brief complete").first().waitFor({ timeout: 90_000 });
  await page
    .getByText("building…")
    .first()
    .waitFor({ state: "hidden", timeout: 120_000 });
  await sleep(800);
}

async function askInChat(page, question) {
  const input = page.locator('textarea[placeholder*="Ask about"]');
  const box = await input.boundingBox();
  await glide(page, box.x + box.width / 2, box.y + box.height / 2);
  await input.click();
  await input.pressSequentially(question, { delay: TYPE_DELAY });
  await sleep(400);
  await input.press("Enter");
}

(async () => {
  fs.mkdirSync("clips/raw", { recursive: true });
  const offsets = {};
  const browser = await chromium.launch();

  // ---- Beat 1 — landing page (20.7s narration) -------------------------
  {
    const beat = await newBeat(browser, "beat1_problem");
    const { page } = beat;
    await page.goto(BASE, { waitUntil: "networkidle" });
    await injectCursorStyles(page);
    const actionStart = Date.now();
    await glide(page, 960, 300);
    await sleep(6000);
    await glide(page, 960, 480, 40);
    await sleep(6000);
    const input = page.locator('input[placeholder*="address"], input[placeholder*="ZIP"]');
    const box = await input.boundingBox();
    if (box) await glide(page, box.x + box.width / 2, box.y + box.height / 2, 40);
    await sleep(9000);
    await finishBeat(beat, offsets, actionStart);
  }

  // ---- Beat 2 — address → receipt → brief (44.6s narration) ------------
  {
    const beat = await newBeat(browser, "beat2_brief");
    const { page } = beat;
    await page.goto(BASE, { waitUntil: "networkidle" });
    await injectCursorStyles(page);
    const actionStart = Date.now();
    const input = page.locator('input[placeholder*="address"], input[placeholder*="ZIP"]');
    const box = await input.boundingBox();
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 30);
    await input.click();
    await input.pressSequentially("Milwaukee, WI 53202", { delay: 70 });
    await sleep(500);
    await input.press("Enter");
    await page.getByText("Brief complete").first().waitFor({ timeout: 120_000 });
    await sleep(2500);
    // Scroll through the brief: candidates → positions with citations.
    const panel = page.locator('section[aria-label="Artifact"] > div').last();
    for (let i = 0; i < 6; i++) {
      await panel.evaluate((el) => el.scrollBy({ top: 420, behavior: "smooth" }));
      await sleep(1700);
    }
    await sleep(2000);
    await finishBeat(beat, offsets, actionStart);
  }

  // ---- Beat 3 — donor question → card (26.7s narration) ----------------
  {
    const beat = await newBeat(browser, "beat3_donors");
    const { page } = beat;
    await openWarmWorkspace(page);
    const actionStart = Date.now();
    await askInChat(page, "Who are Gwen Moore's largest individual donors?");
    await page
      .getByText("Largest Individual Contributions")
      .first()
      .waitFor({ timeout: 90_000 });
    await sleep(1200);
    // Let the card render fully, then hold so the guardrail line is readable.
    await page
      .getByText("do not establish a candidate's policy positions")
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await sleep(14_000);
    await finishBeat(beat, offsets, actionStart);
  }

  // ---- Beat 4 — refusal (21.6s narration) -------------------------------
  {
    const beat = await newBeat(browser, "beat4_refusal");
    const { page } = beat;
    await openWarmWorkspace(page);
    const actionStart = Date.now();
    await askInChat(page, "Who should I vote for in this race?");
    await page.getByText(/don't make voting recommendations/i).first().waitFor({ timeout: 60_000 });
    await sleep(12_000);
    await finishBeat(beat, offsets, actionStart);
  }

  // ---- Beat 5 — copy / share / permalink (11.8s narration) --------------
  {
    const beat = await newBeat(browser, "beat5_workflow");
    const { page } = beat;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await openWarmWorkspace(page);
    const actionStart = Date.now();
    const copy = page.getByRole("button", { name: "Copy brief" });
    let box = await copy.boundingBox();
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 30);
    await copy.click();
    await sleep(1800);
    const share = page.getByRole("button", { name: /Share|Link copied/ });
    box = await share.boundingBox();
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 18);
    await share.click();
    await sleep(2200);
    await page.goto(`${BASE}/w?race=2026-H-WI-04`, { waitUntil: "domcontentloaded" });
    await injectCursorStyles(page);
    await sleep(5500);
    await finishBeat(beat, offsets, actionStart);
  }

  // ---- Beat 6 — closing brief shot (6s used; end card covers the rest) --
  {
    const beat = await newBeat(browser, "beat6_close");
    const { page } = beat;
    await openWarmWorkspace(page);
    const actionStart = Date.now();
    const panel = page.locator('section[aria-label="Artifact"] > div').last();
    await panel.evaluate((el) => el.scrollBy({ top: 300, behavior: "smooth" }));
    await sleep(7000);
    await finishBeat(beat, offsets, actionStart);
  }

  await browser.close();
  fs.writeFileSync("clips/offsets.json", JSON.stringify(offsets, null, 1));
  console.log("ALL BEATS CAPTURED");
})();
