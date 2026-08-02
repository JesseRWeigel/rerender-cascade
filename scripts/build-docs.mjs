#!/usr/bin/env node
// Generate docs/index.html from data/cascades.json.
//
// Every number on the page comes out of the recording, which comes out of running React. There is
// no hand-written table of "this re-renders". --check regenerates and compares, so the page cannot
// drift away from the measurements.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADLINES } from '../src/headlines.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dataFile = join(root, 'data', 'cascades.json');
const outFile = join(root, 'docs', 'index.html');

const data = JSON.parse(readFileSync(dataFile, 'utf8'));

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const scenarioById = new Map(data.scenarios.map((s) => [s.id, s]));
const groups = [];
for (const s of data.scenarios) {
  let g = groups.find((x) => x.id === s.group);
  if (!g) {
    g = { id: s.group, scenarios: [] };
    groups.push(g);
  }
  g.scenarios.push(s);
}

// Totals, all derived rather than typed.
const totalActions = data.scenarios.reduce((n, s) => n + s.runs.length, 0);
const totalNodeRuns = data.scenarios.reduce(
  (n, s) => n + s.runs.reduce((m, r) => m + r.nodes.length, 0),
  0,
);
const totalRenders = data.scenarios.reduce(
  (n, s) => n + s.runs.reduce((m, r) => m + r.nodes.reduce((k, x) => k + x.renderCount, 0), 0),
  0,
);
const totalSkips = data.scenarios.reduce(
  (n, s) => n + s.runs.reduce((m, r) => m + r.nodes.filter((x) => x.renderCount === 0).length, 0),
  0,
);

const nodeOf = (scenarioId, actionId, name) => {
  const s = scenarioById.get(scenarioId);
  const r = s.runs.find((x) => x.actionId === actionId);
  return r.nodes.find((x) => x.name === name);
};


const headlineCards = HEADLINES.map((hl) => {
  const good = nodeOf(hl.works[0], hl.works[1], hl.node);
  const bad = nodeOf(hl.defeated[0], hl.defeated[1], hl.node);
  const badScenario = scenarioById.get(hl.defeated[0]);
  const goodScenario = scenarioById.get(hl.works[0]);
  return `      <article class="card">
        <h3>${esc(hl.title)}</h3>
        <p class="expectation">${esc(hl.expectation)}</p>
        <dl class="pair">
          <div class="row bad">
            <dt><code>${esc(badScenario.id)}</code></dt>
            <dd><b>${esc(hl.node)}</b> rendered <b class="n">${bad.renderCount}</b> time${bad.renderCount === 1 ? '' : 's'} <span class="why">${esc(bad.detail)}</span></dd>
          </div>
          <div class="row good">
            <dt><code>${esc(goodScenario.id)}</code></dt>
            <dd><b>${esc(hl.node)}</b> rendered <b class="n">${good.renderCount}</b> time${good.renderCount === 1 ? '' : 's'} <span class="why">${esc(good.detail)}</span></dd>
          </div>
        </dl>
        <p class="jump"><button type="button" class="link" data-goto="${esc(badScenario.group)}">open both runs</button></p>
      </article>`;
}).join('\n');

const tableRows = data.scenarios
  .flatMap((s) =>
    s.runs.flatMap((r) =>
      r.nodes.map(
        (n) => `        <tr>
          <td><code>${esc(s.id)}</code></td>
          <td>${esc(r.actionId)}</td>
          <td><code>${esc(n.name)}</code></td>
          <td class="num">${n.renderCount}</td>
          <td>${esc(n.reason)}</td>
        </tr>`,
      ),
    ),
  )
  .join('\n');

// The payload the page scripts against. Trimmed to what the page actually draws.
const payload = {
  react: data.react,
  reactDom: data.reactDom,
  totals: { scenarios: data.scenarios.length, actions: totalActions, nodeRuns: totalNodeRuns, renders: totalRenders, skips: totalSkips },
  groups: groups.map((g) => ({
    id: g.id,
    scenarios: g.scenarios.map((s) => ({
      id: s.id,
      variant: s.variant,
      title: s.title,
      question: s.question,
      claim: s.claim,
      nodes: s.nodes,
      runs: s.runs.map((r) => ({
        actionId: r.actionId,
        actionLabel: r.actionLabel,
        owner: r.owner,
        domChanged: r.domChanged,
        memoAllTotal: r.memoAllTotal,
        counters: r.counters,
        countersAfterMount: r.countersAfterMount,
        nodes: r.nodes.map((n) => ({
          name: n.name,
          parent: n.parent,
          memo: n.memo,
          consumes: n.consumes,
          renderCount: n.renderCount,
          memoAllRenderCount: n.memoAllRenderCount,
          reason: n.reason,
          detail: n.detail,
          propsChanged: n.propsChanged || [],
          propsDetail: n.propsDetail || [],
          contextChanged: n.contextChanged || [],
          readsUnchanged: n.readsUnchanged || [],
          memoWouldHelp: n.memoWouldHelp === undefined ? null : n.memoWouldHelp,
        })),
      })),
    })),
  })),
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rerender-cascade</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --panel: #f5f6f8;
  --panel-2: #eceef2;
  --ink: #14171c;
  --muted: #5a6472;
  --line: #d3d8e0;
  --render: #b02a37;
  --render-bg: #fdecee;
  --skip: #1a6b3c;
  --skip-bg: #e8f5ec;
  --accent: #2f5fd0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1218;
    --panel: #171b23;
    --panel-2: #1e232d;
    --ink: #e6e9ee;
    --muted: #9aa4b2;
    --line: #2b323d;
    --render: #ff9aa3;
    --render-bg: #35191d;
    --skip: #86e0ab;
    --skip-bg: #10291c;
    --accent: #86aaff;
  }
}
/* The viewer's toggle is written onto the root element and must win in both directions, so these
   come last and are not wrapped in a media query. */
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #ffffff; --panel: #f5f6f8; --panel-2: #eceef2; --ink: #14171c; --muted: #5a6472;
  --line: #d3d8e0; --render: #b02a37; --render-bg: #fdecee; --skip: #1a6b3c; --skip-bg: #e8f5ec;
  --accent: #2f5fd0;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1218; --panel: #171b23; --panel-2: #1e232d; --ink: #e6e9ee; --muted: #9aa4b2;
  --line: #2b323d; --render: #ff9aa3; --render-bg: #35191d; --skip: #86e0ab; --skip-bg: #10291c;
  --accent: #86aaff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
code, .num, .n { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.wrap { max-width: 62rem; margin: 0 auto; padding: 1.25rem 1rem 4rem; }
h1 { font-size: 1.6rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
h2 { font-size: 1.15rem; margin: 2.4rem 0 .5rem; }
h3 { font-size: 1rem; margin: 0 0 .35rem; }
p { margin: .5rem 0; }
.lede { color: var(--muted); max-width: 46rem; }
.topbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; justify-content: space-between; }
button { font: inherit; cursor: pointer; }
.toggle {
  background: var(--panel); color: var(--ink); border: 1px solid var(--line);
  border-radius: .5rem; padding: .3rem .7rem;
}
.stats { display: flex; flex-wrap: wrap; gap: .4rem; margin: .9rem 0 0; padding: 0; list-style: none; }
.stats li {
  background: var(--panel); border: 1px solid var(--line); border-radius: .5rem;
  padding: .3rem .6rem; font-size: .82rem; color: var(--muted);
}
.stats b { color: var(--ink); font-family: ui-monospace, monospace; }
.cards { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: .7rem; padding: .85rem .9rem; min-width: 0; }
.expectation { color: var(--muted); font-size: .87rem; margin: .1rem 0 .6rem; }
.pair { margin: 0; }
.pair .row { display: grid; grid-template-columns: 1fr; gap: .1rem; padding: .4rem .55rem; border-radius: .45rem; margin-bottom: .35rem; min-width: 0; }
.pair dt { font-size: .78rem; color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
.pair dd { margin: 0; font-size: .87rem; min-width: 0; overflow-wrap: anywhere; }
.pair .bad { background: var(--render-bg); }
.pair .bad .n { color: var(--render); }
.pair .good { background: var(--skip-bg); }
.pair .good .n { color: var(--skip); }
.why { display: block; color: var(--muted); font-size: .8rem; }
.link { background: none; border: 0; color: var(--accent); padding: 0; text-decoration: underline; font-size: .85rem; }
.jump { margin: .3rem 0 0; }
.groupbar { display: flex; flex-wrap: wrap; gap: .35rem; margin: .6rem 0 1rem; padding: 0; }
.groupbar button {
  background: var(--panel); color: var(--ink); border: 1px solid var(--line);
  border-radius: 999px; padding: .25rem .7rem; font-size: .82rem;
}
.groupbar button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.variants { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr)); }
.variant { background: var(--panel); border: 1px solid var(--line); border-radius: .7rem; padding: .85rem .9rem; min-width: 0; }
.variant h3 { display: flex; flex-wrap: wrap; gap: .4rem; align-items: baseline; }
.badge { font-size: .68rem; letter-spacing: .04em; text-transform: uppercase; border-radius: .35rem; padding: .1rem .4rem; border: 1px solid var(--line); color: var(--muted); }
.badge.defeated { color: var(--render); border-color: var(--render); }
.badge.works { color: var(--skip); border-color: var(--skip); }
.claim { font-size: .87rem; color: var(--muted); }
.actions { display: flex; flex-wrap: wrap; gap: .3rem; margin: .5rem 0 .6rem; }
.actions button {
  background: var(--panel-2); color: var(--ink); border: 1px solid var(--line);
  border-radius: .45rem; padding: .22rem .55rem; font-size: .8rem;
}
.actions button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.tree { list-style: none; margin: 0; padding: 0; }
.node { border-left: 3px solid transparent; padding: .32rem .5rem; border-radius: .3rem; margin-bottom: .22rem; min-width: 0; }
.node.rendered { border-left-color: var(--render); background: var(--render-bg); }
.node.skipped { border-left-color: var(--skip); background: var(--skip-bg); }
.node .head { display: flex; flex-wrap: wrap; gap: .35rem; align-items: baseline; }
.node .name { font-family: ui-monospace, monospace; font-size: .88rem; overflow-wrap: anywhere; }
.node .count { font-family: ui-monospace, monospace; font-size: .78rem; }
.node.rendered .count { color: var(--render); }
.node.skipped .count { color: var(--skip); }
.node .tag { font-size: .68rem; border: 1px solid var(--line); border-radius: .3rem; padding: 0 .25rem; color: var(--muted); }
.node .cause { font-size: .8rem; color: var(--muted); overflow-wrap: anywhere; }
.node .fact { font-size: .78rem; color: var(--muted); margin: .12rem 0 0; overflow-wrap: anywhere; }
.node .fact b { color: var(--ink); font-weight: 600; }
.foot { font-size: .82rem; color: var(--muted); margin-top: .5rem; }
.scroller { overflow-x: auto; border: 1px solid var(--line); border-radius: .6rem; }
table { border-collapse: collapse; width: 100%; font-size: .82rem; }
th, td { text-align: left; padding: .3rem .55rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { background: var(--panel-2); position: sticky; top: 0; }
td.num { text-align: right; font-family: ui-monospace, monospace; }
footer { margin-top: 2.5rem; color: var(--muted); font-size: .85rem; }
footer code { background: var(--panel); padding: .05rem .3rem; border-radius: .3rem; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="topbar">
    <h1>React re-render cascade, measured</h1>
    <button type="button" class="toggle" id="theme-toggle" aria-label="Switch colour theme">theme</button>
  </div>
  <p class="lede">
    Every number on this page came out of running React ${esc(data.react)} in Node, mounting the tree,
    firing one state change, and counting which component functions React called. Nothing here is
    written from memory, and each optimisation that is claimed to prevent a render is shown next to
    a run where the same optimisation does not.
  </p>
  <ul class="stats">
    <li><b id="stat-scenarios">${payload.totals.scenarios}</b> scenarios</li>
    <li><b id="stat-actions">${payload.totals.actions}</b> recorded state changes</li>
    <li><b id="stat-noderuns">${payload.totals.nodeRuns}</b> component verdicts</li>
    <li><b id="stat-renders">${payload.totals.renders}</b> measured re-renders</li>
    <li><b id="stat-skips">${payload.totals.skips}</b> measured skips</li>
    <li>react-dom <b>${esc(data.reactDom)}</b></li>
  </ul>
</header>

<h2>Where the intuition is wrong</h2>
<p class="lede">Each pair below differs by one line of code. The counts are the real ones.</p>
<div class="cards">
${headlineCards}
</div>

<h2>Every scenario, side by side</h2>
<p class="lede">Pick a case. Red means React called the component function; green means it did not.</p>
<div class="groupbar" id="groupbar" role="group" aria-label="scenario groups"></div>
<div class="variants" id="variants"></div>
<p class="foot" id="explorer-foot"></p>

<h2>Every measurement</h2>
<p class="lede">All ${payload.totals.nodeRuns} component verdicts, one row each.</p>
<div class="scroller">
  <table id="all-measurements">
    <thead><tr><th>scenario</th><th>action</th><th>component</th><th>renders</th><th>why</th></tr></thead>
    <tbody>
${tableRows}
    </tbody>
  </table>
</div>

<footer>
  <p>
    Regenerate everything with <code>node scripts/record.mjs &amp;&amp; node scripts/build-docs.mjs</code>.
    <code>bash scripts/verify.sh</code> re-runs React, recounts every render off React's own fiber
    flags with code that shares nothing with the instrumentation, and fails if this page and the
    measurements disagree.
  </p>
</footer>
</div>
<script id="cascade-data" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('cascade-data').textContent);

  // Theme. The button writes data-theme onto the root element; the stylesheet's [data-theme]
  // rules are last and unconditional, so the choice wins whatever the system prefers.
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function label() {
    var current = root.getAttribute('data-theme');
    toggle.textContent = (current || (systemDark() ? 'dark' : 'light')) === 'dark' ? 'light mode' : 'dark mode';
  }
  toggle.addEventListener('click', function () {
    var current = root.getAttribute('data-theme') || (systemDark() ? 'dark' : 'light');
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    label();
  });
  label();

  var groupbar = document.getElementById('groupbar');
  var variants = document.getElementById('variants');
  var foot = document.getElementById('explorer-foot');
  var chosenAction = {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function depthOf(nodes, node) {
    var d = 0;
    var byName = {};
    nodes.forEach(function (n) { byName[n.name] = n; });
    var cur = node;
    while (cur && cur.parent) { d += 1; cur = byName[cur.parent]; }
    return d;
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function factsFor(node, run) {
    var facts = [];
    if (node.propsChanged.length) {
      node.propsDetail.forEach(function (p) {
        facts.push(
          'prop ' + p.key + ' changed identity (' + p.before + ' to ' + p.after + ')' +
          (p.sameContent ? ', holding the same data as before' : '')
        );
      });
    }
    if (node.contextChanged.length) {
      facts.push('context ' + node.contextChanged.join(', ') + ' changed identity');
    }
    if (node.readsUnchanged.length) {
      facts.push('the field it reads (' + node.readsUnchanged.join(', ') + ') is the identical value it already had');
    }
    if (node.memoWouldHelp === true) {
      facts.push(
        'measured: with React.memo on every component in this tree, ' + node.name +
        ' rendered ' + plural(node.memoAllRenderCount, 'time') + ' instead of ' +
        plural(node.renderCount, 'time')
      );
    } else if (node.memoWouldHelp === false && node.renderCount > 0) {
      facts.push(
        'measured: even with React.memo on every component in this tree, ' + node.name +
        ' still rendered ' + plural(node.memoAllRenderCount, 'time')
      );
    }
    if (node.name === run.owner && node.renderCount === 0) {
      facts.push('this is the component whose state was set, and React still did not render it');
    }
    return facts;
  }

  function renderRun(scenario, run) {
    var list = el('ul', 'tree');
    scenario.nodes.forEach(function (spec) {
      var node = null;
      run.nodes.forEach(function (n) { if (n.name === spec.name) node = n; });
      if (!node) return;
      var li = el('li', 'node ' + (node.renderCount > 0 ? 'rendered' : 'skipped'));
      li.style.marginLeft = (depthOf(scenario.nodes, spec) * 12) + 'px';
      li.setAttribute('data-component', node.name);
      li.setAttribute('data-renders', String(node.renderCount));
      var head = el('div', 'head');
      head.appendChild(el('span', 'name', node.name));
      head.appendChild(el('span', 'count', node.renderCount > 0 ? ('rendered x' + node.renderCount) : 'did not render'));
      if (spec.memo) head.appendChild(el('span', 'tag', 'React.memo'));
      (spec.consumes || []).forEach(function (c) { head.appendChild(el('span', 'tag', 'reads ' + c + ' context')); });
      if (node.name === run.owner) head.appendChild(el('span', 'tag', 'state set here'));
      li.appendChild(head);
      li.appendChild(el('div', 'cause', node.detail));
      factsFor(node, run).forEach(function (f) { li.appendChild(el('p', 'fact', f)); });
      list.appendChild(li);
    });
    return list;
  }

  function renderGroup(groupId) {
    var group = null;
    DATA.groups.forEach(function (g) { if (g.id === groupId) group = g; });
    if (!group) return;
    variants.innerHTML = '';
    group.scenarios.forEach(function (scenario) {
      var panel = el('div', 'variant');
      panel.setAttribute('data-scenario', scenario.id);
      var h = el('h3');
      h.appendChild(el('span', null, scenario.title));
      h.appendChild(el('span', 'badge ' + scenario.variant, scenario.variant));
      panel.appendChild(h);
      panel.appendChild(el('p', 'claim', scenario.claim));

      var active = chosenAction[scenario.id] || scenario.runs[0].actionId;
      if (scenario.runs.length > 1) {
        var bar = el('div', 'actions');
        scenario.runs.forEach(function (run) {
          var b = el('button', null, run.actionLabel);
          b.type = 'button';
          b.setAttribute('aria-pressed', String(run.actionId === active));
          b.addEventListener('click', function () {
            chosenAction[scenario.id] = run.actionId;
            renderGroup(groupId);
          });
          bar.appendChild(b);
        });
        panel.appendChild(bar);
      } else {
        panel.appendChild(el('p', 'claim', 'action: ' + scenario.runs[0].actionLabel));
      }

      var run = scenario.runs[0];
      scenario.runs.forEach(function (r) { if (r.actionId === active) run = r; });
      panel.appendChild(renderRun(scenario, run));

      var extra = [];
      var counterKeys = Object.keys(run.counters || {});
      counterKeys.forEach(function (k) {
        extra.push(k + ': ' + run.countersAfterMount[k] + ' after mount, ' + run.counters[k] + ' after the update');
      });
      extra.push(run.domChanged ? 'the DOM changed' : 'the DOM did not change at all');
      extra.push('with React.memo on every component: ' + plural(run.memoAllTotal, 'render') +
        ' instead of ' + plural(run.nodes.reduce(function (n, x) { return n + x.renderCount; }, 0), 'render'));
      panel.appendChild(el('p', 'foot', extra.join(' | ')));
      variants.appendChild(panel);
    });

    var total = 0;
    var skipped = 0;
    group.scenarios.forEach(function (s) {
      var active = chosenAction[s.id] || s.runs[0].actionId;
      s.runs.forEach(function (r) {
        if (r.actionId !== active) return;
        r.nodes.forEach(function (n) { total += n.renderCount; if (n.renderCount === 0) skipped += 1; });
      });
    });
    foot.textContent = plural(group.scenarios.length, 'variant') + ' shown, ' +
      plural(total, 'component render') + ' measured across them, ' +
      plural(skipped, 'component') + ' skipped.';

    Array.prototype.forEach.call(groupbar.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-group') === groupId));
    });
  }

  DATA.groups.forEach(function (g) {
    var b = el('button', null, g.id);
    b.type = 'button';
    b.setAttribute('data-group', g.id);
    b.addEventListener('click', function () { renderGroup(g.id); });
    groupbar.appendChild(b);
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (b) {
    b.addEventListener('click', function () {
      renderGroup(b.getAttribute('data-goto'));
      document.getElementById('groupbar').scrollIntoView({ block: 'start' });
    });
  });

  renderGroup(DATA.groups[0].id);

  // Proof for anything checking this page that the script parsed and ran to the end. A page whose
  // script fails to parse still looks fine, and every unit test still passes.
  root.setAttribute('data-script', 'ran');
  root.setAttribute('data-renders', String(DATA.totals.renders));
})();
</script>
</body>
</html>
`;

mkdirSync(dirname(outFile), { recursive: true });

if (process.argv.includes('--check')) {
  let existing;
  try {
    existing = readFileSync(outFile, 'utf8');
  } catch {
    console.error(`${outFile} does not exist. Run: node scripts/build-docs.mjs`);
    process.exit(1);
  }
  if (existing !== html) {
    console.error('docs/index.html does not match a fresh build from data/cascades.json.');
    console.error('Run: node scripts/build-docs.mjs');
    process.exit(1);
  }
  console.log(`docs/index.html matches data/cascades.json (${payload.totals.nodeRuns} verdicts)`);
} else {
  writeFileSync(outFile, html);
  console.log(`wrote docs/index.html: ${payload.totals.nodeRuns} verdicts, ${payload.totals.renders} renders, ${payload.totals.skips} skips`);
}
