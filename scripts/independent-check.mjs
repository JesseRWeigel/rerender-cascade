#!/usr/bin/env node
// An independent recount, sharing no code with the instrumentation.
//
// src/probe.mjs counts renders by having each component function report that it was called.
// src/attribute.mjs then explains those counts. If either of those is wrong, comparing the page
// against them would not notice. So this file measures the same thing a completely different way:
// it registers as a React DevTools renderer, and after every commit it walks React's own fiber
// tree looking for the PerformedWork flag, which is the bit React sets on a fiber that rendered.
// That is where the real React DevTools gets its "why did this render" data from too.
//
// It imports the scenarios, because those are the subject under test, and it passes them a no-op
// probe. That is deliberate: it proves the instrumentation does not change the cascade it claims
// to be observing. It imports nothing from src/probe.mjs, src/attribute.mjs, src/run.mjs or
// src/dom.mjs, and it never reads data it did not produce except to compare.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// --- 1. DOM, set up here rather than imported, so a bug in src/dom.mjs cannot hide behind this.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- 2. Register as a DevTools renderer BEFORE react-dom is loaded. react-dom looks this hook up
// once at module scope; installing it afterwards does nothing at all.
const PERFORMED_WORK = 0b1;
let commitLog = [];
let collecting = false;
// Fiber objects present in the previously committed tree. React keeps two fiber objects per
// position and swaps between them, so a fiber that is the very same object as last commit was
// never touched and its PerformedWork bit is left over from whenever it last did render. Without
// this, a bailed-out subtree looks like it rendered on every commit forever.
let previousFibers = new Set();

globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  isDisabled: false,
  supportsFiber: true,
  renderers: new Map(),
  inject(renderer) {
    this.renderers.set(this.renderers.size + 1, renderer);
    return this.renderers.size;
  },
  onScheduleFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  onCommitFiberRoot(_id, fiberRoot) {
    if (!collecting) return;
    const worked = [];
    const tree = [];
    const seenNow = new Set();
    const walk = (fiber, functionAncestor) => {
      if (!fiber) return;
      seenNow.add(fiber);
      let nextAncestor = functionAncestor;
      if (typeof fiber.type === 'function') {
        const name = fiber.type.name || '(anonymous)';
        tree.push({ name, parent: functionAncestor });
        if ((fiber.flags & PERFORMED_WORK) !== 0 && !previousFibers.has(fiber)) worked.push(name);
        nextAncestor = name;
      }
      walk(fiber.child, nextAncestor);
      walk(fiber.sibling, functionAncestor);
    };
    walk(fiberRoot.current, null);
    previousFibers = seenNow;
    commitLog.push({ worked, tree });
  },
};

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = React;
const { scenarios } = await import('../src/scenarios.mjs');

const noop = () => {};

async function measure(scenario, actionId) {
  const built = scenario.build(noop);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const reactRoot = createRoot(container);

  commitLog = [];
  previousFibers = new Set();
  collecting = true;
  await act(async () => {
    reactRoot.render(built.element);
  });
  const mountCommits = commitLog;
  const mountTree = mountCommits.length ? mountCommits[mountCommits.length - 1].tree : [];
  const htmlBefore = container.innerHTML;

  commitLog = [];
  await act(async () => {
    built.act(actionId, built.handles);
  });
  const updateCommits = commitLog;
  collecting = false;
  const htmlAfter = container.innerHTML;

  await act(async () => {
    reactRoot.unmount();
  });
  container.remove();

  const counts = {};
  for (const commit of updateCommits) {
    for (const name of commit.worked) counts[name] = (counts[name] || 0) + 1;
  }
  const mountCounts = {};
  for (const commit of mountCommits) {
    for (const name of commit.worked) mountCounts[name] = (mountCounts[name] || 0) + 1;
  }
  return {
    counts,
    mountCounts,
    mountTree,
    commits: updateCommits.length,
    domChanged: htmlBefore !== htmlAfter,
  };
}

let pass = 0;
let fail = 0;
const ok = (msg) => {
  pass += 1;
  if (process.env.VERBOSE) console.log(`  ok    ${msg}`);
};
const bad = (msg) => {
  fail += 1;
  console.log(`  FAIL  ${msg}`);
};

const recorded = JSON.parse(readFileSync(join(root, 'data', 'cascades.json'), 'utf8'));
const recordedById = new Map(recorded.scenarios.map((s) => [s.id, s]));

if (recorded.scenarios.length !== scenarios.length) {
  bad(`data/cascades.json has ${recorded.scenarios.length} scenarios, the source defines ${scenarios.length}`);
}

for (const scenario of scenarios) {
  const rec = recordedById.get(scenario.id);
  if (!rec) {
    bad(`data/cascades.json has no entry for ${scenario.id}`);
    continue;
  }
  for (const action of scenario.actions) {
    const recRun = rec.runs.find((r) => r.actionId === action.id);
    if (!recRun) {
      bad(`${scenario.id}/${action.id} is missing from data/cascades.json`);
      continue;
    }
    const seen = await measure(scenario, action.id);

    // 2a. The declared tree must match the tree React actually built.
    const declared = scenario.nodes
      .map((n) => `${n.name}<${n.parent || 'root'}>`)
      .sort()
      .join(' ');
    const actual = [...new Set(seen.mountTree.map((n) => `${n.name}<${n.parent || 'root'}>`))]
      .sort()
      .join(' ');
    if (declared === actual) {
      ok(`${scenario.id}: declared tree matches React's fiber tree`);
    } else {
      bad(`${scenario.id}: declared tree does not match React's fiber tree`);
      console.log(`        declared: ${declared}`);
      console.log(`        fibers:   ${actual}`);
    }

    // 2b. The DOM either changed or it did not, measured here rather than trusted.
    if (seen.domChanged === recRun.domChanged) {
      ok(`${scenario.id}/${action.id}: domChanged=${seen.domChanged} agrees`);
    } else {
      bad(
        `${scenario.id}/${action.id}: the DOM ${seen.domChanged ? 'changed' : 'did not change'}, ` +
          `data/cascades.json says domChanged=${recRun.domChanged}`,
      );
    }

    // 2c. Every render count, recounted off the fibers.
    //
    // The two mechanisms answer slightly different questions and there is exactly one case where
    // they legitimately differ: React can call a component function, discover the state it
    // returned is unchanged, and throw the work away without ever setting PerformedWork. The probe
    // sees the function body run; the fibers see no committed work. That divergence is allowed
    // only for the component whose state was set, only for a difference of one, and only when
    // the DOM measured here did not change and the recording agrees it did not. Anything else is
    // a disagreement and fails.
    for (const node of recRun.nodes) {
      const fiberCount = seen.counts[node.name] || 0;
      const discarded =
        node.name === recRun.owner &&
        node.renderCount === fiberCount + 1 &&
        seen.domChanged === false &&
        recRun.domChanged === false &&
        recRun.ownerStateUnchanged === true;
      if (fiberCount === node.renderCount) {
        ok(`${scenario.id}/${action.id}: ${node.name} rendered ${fiberCount} time(s)`);
      } else if (discarded) {
        ok(`${scenario.id}/${action.id}: ${node.name} ran once and React discarded the work`);
        console.log(
          `  note  ${scenario.id}/${action.id}: ${node.name} ran ${node.renderCount} time(s) but React committed ` +
            `no work for it, and the DOM did not change`,
        );
      } else {
        bad(
          `${scenario.id}/${action.id}: ${node.name} rendered ${fiberCount} time(s) by React's own fiber flags, ` +
            `data/cascades.json says ${node.renderCount}`,
        );
      }
      const fiberMount = seen.mountCounts[node.name] || 0;
      if (fiberMount !== node.mountRenders) {
        bad(
          `${scenario.id}/${action.id}: ${node.name} mounted ${fiberMount} time(s) by fiber flags, ` +
            `data/cascades.json says ${node.mountRenders}`,
        );
      } else {
        ok(`${scenario.id}/${action.id}: ${node.name} mount count agrees`);
      }
    }

    // 2d. Nothing rendered that the recording does not know about.
    const known = new Set(recRun.nodes.map((n) => n.name));
    for (const name of Object.keys(seen.counts)) {
      if (!known.has(name)) bad(`${scenario.id}/${action.id}: ${name} rendered but is not in the recording`);
    }
  }
}

console.log(`independent fiber recount: ${pass} agreed, ${fail} disagreed`);
if (fail > 0) process.exit(1);
