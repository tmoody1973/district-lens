/**
 * Renders the title card, end card, and per-sentence caption strips as PNGs
 * via headless Chromium (homebrew ffmpeg has no drawtext/libass — and the
 * browser's typography is better anyway). Emits assets/captions.json with
 * per-beat sentence timing windows for compose.py's overlay enable= filters.
 */

const { chromium } = require("playwright");
const fs = require("fs");

const script = JSON.parse(fs.readFileSync("narration/script.json", "utf8"));
const durations = JSON.parse(fs.readFileSync("narration/durations.json", "utf8"));

const PAGE = (body, bg) => `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: ${bg};
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; }
  .stack { text-align: center; display: flex; flex-direction: column; gap: 34px; }
  h1 { color: #fff; font-size: 108px; font-weight: 700; letter-spacing: -2px; }
  .sub { color: #d4d4d8; font-size: 42px; font-weight: 400; }
  .meta { color: #a1a1aa; font-size: 30px; }
  .accent { color: #fbbf24; font-size: 48px; font-weight: 600; margin-top: 18px; }
  .caption { position: absolute; bottom: 64px; left: 50%; transform: translateX(-50%);
    max-width: 1500px; background: rgba(0,0,0,0.72); color: #fff;
    font-size: 34px; line-height: 1.35; padding: 14px 30px; border-radius: 8px;
    text-align: center; }
</style></head><body>${body}</body></html>`;

function sentences(text) {
  return text.split(/(?<=[.!?]) +/).map((s) => s.trim()).filter(Boolean);
}

function pretty(s) {
  return s
    .replaceAll("F E C", "FEC").replaceAll("M C P", "MCP")
    .replaceAll("A P I", "API").replaceAll("S D K", "SDK")
    .replaceAll("A D K", "ADK").replaceAll(" A I ", " AI ")
    .replaceAll("three point one", "3.1").replaceAll("three point five", "3.5")
    .replaceAll("Congress dot gov", "Congress.gov");
}

(async () => {
  fs.mkdirSync("assets/captions", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Title card
  await page.setContent(PAGE(`<div class="stack">
    <h1>DistrictLens</h1>
    <div class="sub">Evidence-first congressional race intelligence</div>
    <div class="meta">Google Cloud Rapid Agent Hackathon · MongoDB track</div>
  </div>`, "#18181b"));
  await page.screenshot({ path: "assets/title.png" });

  // End card
  await page.setContent(PAGE(`<div class="stack">
    <h1>DistrictLens</h1>
    <div class="sub">Gemini 3.1 Pro · Gemini 3.5 Flash grounding · ADK (code-first)</div>
    <div class="sub">MongoDB MCP partner integration · Cloud Run · Agents CLI evals</div>
    <div class="accent">Evidence in. Decision yours.</div>
  </div>`, "#18181b"));
  await page.screenshot({ path: "assets/endcard.png" });

  // Caption strips: transparent PNGs, one per sentence, with timing windows.
  const timing = {};
  for (const beat of script.beats) {
    const sents = sentences(beat.text);
    const total = sents.reduce((n, s) => n + s.length, 0) || 1;
    const dur = durations[beat.id];
    let cursor = 0;
    timing[beat.id] = [];
    for (let i = 0; i < sents.length; i++) {
      const span = (dur * sents[i].length) / total;
      const file = `assets/captions/${beat.id}_${i}.png`;
      await page.setContent(PAGE(`<div class="caption">${pretty(sents[i])}</div>`, "transparent"));
      await page.screenshot({ path: file, omitBackground: true });
      timing[beat.id].push({ file, start: +cursor.toFixed(2), end: +(cursor + span).toFixed(2) });
      cursor += span;
    }
  }
  fs.writeFileSync("assets/captions.json", JSON.stringify(timing, null, 1));
  await browser.close();
  console.log("cards + captions rendered");
})();
