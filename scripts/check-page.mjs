#!/usr/bin/env node
// Load docs/index.html in a real Chromium and assert on what the browser actually did with it.
//
// The point is the failure mode where the page's whole inline script fails to parse. The file
// still looks fine, every Node test still passes, and the page is static HTML with an empty
// explorer. So this asserts on nodes that only the script can have created.
//
// Two traps avoided here. A stale server on a fixed port serves a different project's page, so
// this binds to port 0 and asserts on the served bytes. The shared Playwright browser can be
// navigated away by another agent mid-check, so this launches its own Chromium and re-asserts
// document.title inside every evaluation.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const TITLE = 'rerender-cascade';

const require = createRequire(join(root, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('playwright-core is not installed. This check cannot be skipped, so it fails.');
  console.error('Install it with: npm install');
  console.error('Without it, nothing verifies that the page script parses and runs; the Node');
  console.error('suite imports the modules directly and never loads the page.');
  process.exit(1);
}

const html = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(root, 'data', 'cascades.json'), 'utf8'));

let pass = 0;
let fail = 0;
const ok = (msg) => {
  console.log(`  ok    ${msg}`);
  pass += 1;
};
const bad = (msg) => {
  console.log(`  FAIL  ${msg}`);
  fail += 1;
};

// Expected totals, recomputed here from the recording rather than read off the page.
const expected = {
  nodeRuns: data.scenarios.reduce((n, s) => n + s.runs.reduce((m, r) => m + r.nodes.length, 0), 0),
  renders: data.scenarios.reduce(
    (n, s) => n + s.runs.reduce((m, r) => m + r.nodes.reduce((k, x) => k + x.renderCount, 0), 0),
    0,
  ),
  groups: new Set(data.scenarios.map((s) => s.group)).size,
};
const firstGroup = data.scenarios[0].group;
const firstGroupScenarios = data.scenarios.filter((s) => s.group === firstGroup);

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const served = await fetch(url).then((r) => r.text());
if (served.includes(`<title>${TITLE}</title>`) && served.includes('id="cascade-data"')) {
  ok(`port ${port} is serving this project's page`);
} else {
  bad('the local server is not serving this project page');
}

const consoleErrors = [];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', (err) => consoleErrors.push(`${width}px pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`${width}px console: ${msg.text()}`);
    });
    await page.goto(url, { waitUntil: 'load' });

    const report = await page.evaluate((expectedTitle) => {
      const identity = { title: document.title, matches: document.title === expectedTitle };

      const docWidth = document.documentElement.clientWidth;
      const inScroller = (el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
        }
        return false;
      };
      const overflowing = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > docWidth + 1 && !inScroller(el)) {
          overflowing.push(
            `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : ''} right=${Math.round(r.right)} doc=${docWidth}`,
          );
        }
      }

      const nodes = [...document.querySelectorAll('#variants .node')].map((n) => ({
        component: n.getAttribute('data-component'),
        renders: Number(n.getAttribute('data-renders')),
        text: n.textContent,
        colour: getComputedStyle(n).borderLeftColor,
      }));

      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const themeBefore = document.documentElement.getAttribute('data-theme');
      document.getElementById('theme-toggle').click();
      const themeAfterOne = document.documentElement.getAttribute('data-theme');
      const bgAfterOne = getComputedStyle(document.body).backgroundColor;
      document.getElementById('theme-toggle').click();
      const themeAfterTwo = document.documentElement.getAttribute('data-theme');
      const bgAfterTwo = getComputedStyle(document.body).backgroundColor;

      return {
        identity,
        overflowing,
        docWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scriptRan: document.documentElement.getAttribute('data-script'),
        scriptRenders: Number(document.documentElement.getAttribute('data-renders')),
        groupButtons: document.querySelectorAll('#groupbar button').length,
        variantPanels: document.querySelectorAll('#variants .variant').length,
        tableRows: document.querySelectorAll('#all-measurements tbody tr').length,
        cards: document.querySelectorAll('.cards .card').length,
        footText: (document.getElementById('explorer-foot') || {}).textContent || '',
        nodes,
        theme: { bodyBg, themeBefore, themeAfterOne, bgAfterOne, themeAfterTwo, bgAfterTwo },
      };
    }, TITLE);

    if (!report.identity.matches) {
      bad(`the browser is showing "${report.identity.title}", not this project's page`);
      break;
    }

    if (report.overflowing.length === 0 && report.scrollWidth <= report.docWidth + 1) {
      ok(`${width}px: no element overflows the page`);
    } else {
      bad(`${width}px: ${report.overflowing.length} element(s) overflow, scrollWidth ${report.scrollWidth} vs ${report.docWidth}`);
      report.overflowing.slice(0, 8).forEach((o) => console.log(`        ${o}`));
    }

    if (width !== 390) continue;

    // The whole point: these nodes exist only if the inline script parsed and ran.
    if (report.scriptRan === 'ran') ok('the inline script parsed and ran to the end');
    else bad('the inline script did not run; the page is static HTML');

    if (report.scriptRenders === expected.renders) {
      ok(`the script counted ${report.scriptRenders} measured re-renders, matching the recording`);
    } else {
      bad(`the script reports ${report.scriptRenders} re-renders, the recording says ${expected.renders}`);
    }

    if (report.groupButtons === expected.groups) ok(`${report.groupButtons} scenario group buttons`);
    else bad(`${report.groupButtons} group buttons, expected ${expected.groups}`);

    if (report.variantPanels === firstGroupScenarios.length) {
      ok(`${report.variantPanels} variant panel(s) drawn for the first group`);
    } else {
      bad(`${report.variantPanels} variant panels, expected ${firstGroupScenarios.length}`);
    }

    if (report.tableRows === expected.nodeRuns) ok(`${report.tableRows} rows in the full measurement table`);
    else bad(`${report.tableRows} table rows, expected ${expected.nodeRuns}`);

    if (report.cards >= 9) ok(`${report.cards} headline cards`);
    else bad(`${report.cards} headline cards, expected at least 9`);

    // Compare the drawn tree against the recording, node by node.
    const scenario = firstGroupScenarios[0];
    const run = scenario.runs[0];
    const drawn = new Map(report.nodes.map((n) => [n.component, n.renders]));
    let mismatched = 0;
    for (const node of run.nodes) {
      if (drawn.get(node.name) !== node.renderCount) mismatched += 1;
    }
    if (report.nodes.length > 0 && mismatched === 0) {
      ok(`the ${report.nodes.length} drawn tree nodes match the recorded render counts`);
    } else {
      bad(`${mismatched} drawn node(s) disagree with the recording (drew ${report.nodes.length})`);
    }

    if (/\d+ component render\(s\) measured/.test(report.footText)) {
      ok('the explorer summary line was computed in the browser');
    } else {
      bad(`the explorer summary line is missing: "${report.footText}"`);
    }

    const t = report.theme;
    if (t.themeAfterOne && t.themeAfterTwo && t.themeAfterOne !== t.themeAfterTwo) {
      ok(`the theme toggle flips both ways (${t.themeAfterOne} then ${t.themeAfterTwo})`);
    } else {
      bad(`the theme toggle did not flip both ways (${t.themeAfterOne} then ${t.themeAfterTwo})`);
    }
    if (t.bgAfterOne !== t.bgAfterTwo) {
      ok(`the background actually changes with the toggle (${t.bgAfterOne} vs ${t.bgAfterTwo})`);
    } else {
      bad(`the background did not change between themes (${t.bgAfterOne})`);
    }
  }

  // Both media-query and explicit-attribute dark mode must work, in both directions.
  for (const scheme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, colorScheme: scheme });
    await page.goto(url, { waitUntil: 'load' });
    const res = await page.evaluate((expectedTitle) => {
      if (document.title !== expectedTitle) return { wrongPage: true };
      const bg = () => getComputedStyle(document.body).backgroundColor;
      const auto = bg();
      document.documentElement.setAttribute('data-theme', 'dark');
      const forcedDark = bg();
      document.documentElement.setAttribute('data-theme', 'light');
      const forcedLight = bg();
      return { auto, forcedDark, forcedLight };
    }, TITLE);
    if (res.wrongPage) {
      bad('the browser navigated away from this page mid-check');
      continue;
    }
    const expectAuto = scheme === 'dark' ? res.forcedDark : res.forcedLight;
    if (res.auto === expectAuto) {
      ok(`prefers-color-scheme: ${scheme} gives the ${scheme} palette (${res.auto})`);
    } else {
      bad(`prefers-color-scheme: ${scheme} gave ${res.auto}, expected ${expectAuto}`);
    }
    if (res.forcedDark !== res.forcedLight) {
      ok(`with prefers-color-scheme: ${scheme}, data-theme still overrides in both directions`);
    } else {
      bad(`with prefers-color-scheme: ${scheme}, data-theme does not override`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (consoleErrors.length === 0) {
  ok('no page errors or console errors');
} else {
  bad(`${consoleErrors.length} page/console error(s)`);
  consoleErrors.slice(0, 5).forEach((e) => console.log(`        ${e}`));
}

console.log(`browser check: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
