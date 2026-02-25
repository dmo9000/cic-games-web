#!/usr/bin/env node
// Usage: xvfb-run node render-steam-capsules.js
const puppeteer = require('puppeteer');
const path = require('path');

const capsules = [
  { name: 'main-capsule-1232x706',     width: 1232, height: 706 },
  { name: 'header-capsule-920x430',    width: 920,  height: 430 },
  { name: 'small-capsule-462x174',     width: 462,  height: 174 },
  { name: 'vertical-capsule-748x896',  width: 748,  height: 896 },
];

const BASE_URL = 'http://localhost';
const OUTPUT_DIR = path.join(__dirname, 'steamstatic');
const RENDER_DELAY_MS = 8000; // wait for 3D scene + models to load

(async () => {
  for (const cap of capsules) {
    // Fresh browser per capsule to avoid WebGL context loss
    const browser = await puppeteer.launch({
      headless: false, // use headed mode with Xvfb for real WebGL
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        `--window-size=${cap.width},${cap.height}`,
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: cap.width,
      height: cap.height,
      deviceScaleFactor: 1,
    });

    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`  [console.error] ${msg.text()}`);
    });
    page.on('pageerror', err => console.log(`  [pageerror] ${err.message}`));

    const url = `${BASE_URL}/steamstatic/${cap.name}/`;
    console.log(`Rendering ${cap.name} (${cap.width}x${cap.height})...`);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, RENDER_DELAY_MS));

    const outPath = path.join(OUTPUT_DIR, `${cap.name}.png`);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`  -> ${outPath}`);

    await browser.close();
  }

  console.log('Done.');
})();
