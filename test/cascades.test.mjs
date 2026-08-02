// Every expected cascade, asserted against a live run of real React.
//
// The table below is written out by hand rather than derived from data/cascades.json, so a change
// in React's behaviour, or a bug introduced into the instrumentation, fails here instead of
// quietly rewriting the recording and the page along with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, byId } from '../src/scenarios.mjs';
import { runScenario } from '../src/run.mjs';
import { attribute } from '../src/attribute.mjs';

// scenario/action -> component -> [render count in the update, why]
const EXPECTED = {
  'tree-explorer/app': { App: [1, 'state'], Header: [1, 'parent-render'], Sidebar: [1, 'parent-render'], SidebarNav: [1, 'parent-render'], SidebarStats: [1, 'parent-render'], Main: [1, 'parent-render'], MemoPanel: [0, 'memo-bailout'], PanelBody: [0, 'ancestor-skipped'], Footer: [1, 'parent-render'] },
  'tree-explorer/sidebar': { App: [0, 'above-the-update'], Header: [0, 'ancestor-skipped'], Sidebar: [1, 'state'], SidebarNav: [1, 'parent-render'], SidebarStats: [1, 'parent-render'], Main: [0, 'ancestor-skipped'], MemoPanel: [0, 'ancestor-skipped'], PanelBody: [0, 'ancestor-skipped'], Footer: [0, 'ancestor-skipped'] },
  'tree-explorer/sidebarnav': { App: [0, 'above-the-update'], Header: [0, 'ancestor-skipped'], Sidebar: [0, 'above-the-update'], SidebarNav: [1, 'state'], SidebarStats: [0, 'ancestor-skipped'], Main: [0, 'ancestor-skipped'], MemoPanel: [0, 'ancestor-skipped'], PanelBody: [0, 'ancestor-skipped'], Footer: [0, 'ancestor-skipped'] },
  'tree-explorer/main': { App: [0, 'above-the-update'], Header: [0, 'ancestor-skipped'], Sidebar: [0, 'ancestor-skipped'], SidebarNav: [0, 'ancestor-skipped'], SidebarStats: [0, 'ancestor-skipped'], Main: [1, 'state'], MemoPanel: [0, 'memo-bailout'], PanelBody: [0, 'ancestor-skipped'], Footer: [1, 'parent-render'] },
  'tree-explorer/memopanel': { App: [0, 'above-the-update'], Header: [0, 'ancestor-skipped'], Sidebar: [0, 'ancestor-skipped'], SidebarNav: [0, 'ancestor-skipped'], SidebarStats: [0, 'ancestor-skipped'], Main: [0, 'above-the-update'], MemoPanel: [1, 'state'], PanelBody: [1, 'parent-render'], Footer: [0, 'ancestor-skipped'] },
  'tree-explorer/panelbody': { App: [0, 'above-the-update'], Header: [0, 'ancestor-skipped'], Sidebar: [0, 'ancestor-skipped'], SidebarNav: [0, 'ancestor-skipped'], SidebarStats: [0, 'ancestor-skipped'], Main: [0, 'above-the-update'], MemoPanel: [0, 'above-the-update'], PanelBody: [1, 'state'], Footer: [0, 'ancestor-skipped'] },
  'tree-explorer/footer': { App: [0, 'above-the-update'], Header: [0, 'ancestor-skipped'], Sidebar: [0, 'ancestor-skipped'], SidebarNav: [0, 'ancestor-skipped'], SidebarStats: [0, 'ancestor-skipped'], Main: [0, 'above-the-update'], MemoPanel: [0, 'ancestor-skipped'], PanelBody: [0, 'ancestor-skipped'], Footer: [1, 'state'] },
  'memo-stable-props/bump': { App: [1, 'state'], MemoToolbar: [0, 'memo-bailout'], PlainLabel: [1, 'parent-render'] },
  'memo-inline-object/bump': { App: [1, 'state'], MemoToolbar: [1, 'props-changed'], PlainLabel: [1, 'parent-render'] },
  'memo-inline-arrow/bump': { App: [1, 'state'], MemoButton: [1, 'props-changed'] },
  'memo-usecallback/bump': { App: [1, 'state'], MemoButton: [0, 'memo-bailout'] },
  'usecallback-unstable-dep/bump': { App: [1, 'state'], MemoButton: [1, 'props-changed'] },
  'usecallback-primitive-dep/bump': { App: [1, 'state'], MemoButton: [0, 'memo-bailout'] },
  'usememo-unstable-dep/bump': { App: [1, 'state'], MemoTable: [1, 'props-changed'] },
  'usememo-primitive-dep/bump': { App: [1, 'state'], MemoTable: [0, 'memo-bailout'] },
  'context-single-object/theme': { App: [1, 'state'], Shell: [0, 'element-identity'], UserBadge: [1, 'context'], ThemeSwitch: [1, 'context'] },
  'context-split/theme': { App: [1, 'state'], Shell: [0, 'element-identity'], UserBadge: [0, 'ancestor-skipped'], ThemeSwitch: [1, 'context'] },
  'context-unstable-value/tick': { App: [0, 'above-the-update'], SessionProvider: [1, 'state'], Shell: [0, 'element-identity'], UserBadge: [1, 'context'] },
  'context-memo-value/tick': { App: [0, 'above-the-update'], SessionProvider: [1, 'state'], Shell: [0, 'element-identity'], UserBadge: [0, 'ancestor-skipped'] },
  'children-as-prop/bump': { App: [0, 'above-the-update'], Counter: [1, 'state'], Expensive: [0, 'element-identity'] },
  'children-inline/bump': { App: [0, 'above-the-update'], Counter: [1, 'state'], Expensive: [1, 'parent-render'] },
  'memo-children-inline/bump': { App: [1, 'state'], MemoPanel: [1, 'props-changed'], Expensive: [1, 'parent-render'] },
  'memo-children-hoisted/bump': { App: [1, 'state'], MemoPanel: [0, 'memo-bailout'], Expensive: [0, 'ancestor-skipped'] },
  'memo-blocks-parent-state/change': { App: [1, 'state'], MemoSection: [0, 'memo-bailout'], ThemeReader: [0, 'ancestor-skipped'] },
  'memo-does-not-block-context/change': { App: [1, 'state'], MemoSection: [0, 'memo-bailout'], ThemeReader: [1, 'context'] },
  'setstate-same-value/set': { App: [0, 'state-bailout'], Child: [0, 'ancestor-skipped'] },
  'setstate-new-value/set': { App: [1, 'state'], Child: [1, 'parent-render'] },
  'setstate-net-zero/set': { App: [1, 'state'], Child: [0, 'render-then-bailout'] },
  'state-in-leaf/bump': { App: [0, 'above-the-update'], Sibling: [0, 'ancestor-skipped'], LeafCounter: [1, 'state'] },
};

const results = new Map();
async function measured(key) {
  if (!results.has(key)) {
    const [scenarioId, actionId] = key.split('/');
    const scenario = byId.get(scenarioId);
    assert.ok(scenario, `no scenario ${scenarioId}`);
    results.set(key, attribute(scenario, await runScenario(scenario, actionId)));
  }
  return results.get(key);
}

test('the expected table covers exactly the scenarios that exist', () => {
  const actual = scenarios
    .flatMap((s) => s.actions.map((a) => `${s.id}/${a.id}`))
    .sort();
  assert.deepEqual(Object.keys(EXPECTED).sort(), actual);
});

for (const [key, expected] of Object.entries(EXPECTED)) {
  test(`${key}: render counts and causes match a live React run`, async () => {
    const run = await measured(key);
    const got = {};
    for (const node of run.nodes) got[node.name] = [node.renderCount, node.reason];
    assert.deepEqual(got, expected);
  });
}

test('no component render or skip is left unexplained anywhere', async () => {
  for (const key of Object.keys(EXPECTED)) {
    const run = await measured(key);
    assert.deepEqual(run.unexplained, [], `${key} has unexplained nodes`);
    assert.deepEqual(run.stray, [], `${key} rendered a component not in the declared tree`);
  }
});

// ------------------------------------------------------------------------------------------
// Paired assertions. Each optimisation that is claimed to prevent a render is asserted both in
// the variant where it works and in the variant where it does not.
// ------------------------------------------------------------------------------------------
const PAIRS = [
  { works: 'memo-stable-props/bump', defeated: 'memo-inline-object/bump', node: 'MemoToolbar' },
  { works: 'memo-usecallback/bump', defeated: 'memo-inline-arrow/bump', node: 'MemoButton' },
  { works: 'usecallback-primitive-dep/bump', defeated: 'usecallback-unstable-dep/bump', node: 'MemoButton' },
  { works: 'usememo-primitive-dep/bump', defeated: 'usememo-unstable-dep/bump', node: 'MemoTable' },
  { works: 'context-split/theme', defeated: 'context-single-object/theme', node: 'UserBadge' },
  { works: 'context-memo-value/tick', defeated: 'context-unstable-value/tick', node: 'UserBadge' },
  { works: 'children-as-prop/bump', defeated: 'children-inline/bump', node: 'Expensive' },
  { works: 'memo-children-hoisted/bump', defeated: 'memo-children-inline/bump', node: 'MemoPanel' },
  { works: 'memo-blocks-parent-state/change', defeated: 'memo-does-not-block-context/change', node: 'ThemeReader' },
];

for (const pair of PAIRS) {
  test(`${pair.node}: skips in ${pair.works} and re-renders in ${pair.defeated}`, async () => {
    const good = await measured(pair.works);
    const bad = await measured(pair.defeated);
    const g = good.nodes.find((n) => n.name === pair.node);
    const b = bad.nodes.find((n) => n.name === pair.node);
    assert.equal(g.renderCount, 0, `${pair.node} should not re-render in ${pair.works}`);
    assert.ok(b.renderCount > 0, `${pair.node} should re-render in ${pair.defeated}`);
  });
}

test('every pair group has both a works and a defeated variant', () => {
  const groups = new Map();
  for (const s of scenarios) {
    if (!groups.has(s.group)) groups.set(s.group, new Set());
    groups.get(s.group).add(s.variant);
  }
  for (const [group, variants] of groups) {
    if (variants.has('control') && variants.size === 1) continue;
    assert.ok(variants.has('works'), `group ${group} has no working variant`);
    assert.ok(variants.has('defeated'), `group ${group} has no defeated variant`);
  }
});

// ------------------------------------------------------------------------------------------
// The specific claims the page makes, each one asserted on measured detail rather than counts
// alone.
// ------------------------------------------------------------------------------------------
test('an inline object prop is the only changed prop that defeats the memo', async () => {
  const run = await measured('memo-inline-object/bump');
  const toolbar = run.nodes.find((n) => n.name === 'MemoToolbar');
  assert.deepEqual(toolbar.propsChanged, ['style']);
  const style = toolbar.propsDetail.find((p) => p.key === 'style');
  assert.equal(style.before, 'object');
  assert.equal(style.after, 'object');
  // The point of the scenario: the two objects hold exactly the same data.
  assert.equal(style.sameContent, true);
});

test('an inline arrow prop is a changed prop even though the function body is identical', async () => {
  const run = await measured('memo-inline-arrow/bump');
  const button = run.nodes.find((n) => n.name === 'MemoButton');
  assert.deepEqual(button.propsChanged, ['onSave']);
  assert.equal(button.propsDetail[0].sameContent, true);
});

test('a context consumer re-renders while the field it reads is the identical object', async () => {
  const run = await measured('context-single-object/theme');
  const badge = run.nodes.find((n) => n.name === 'UserBadge');
  assert.equal(badge.reason, 'context');
  assert.deepEqual(badge.contextChanged, ['Session']);
  // This is the whole lesson: the value object changed, `user` inside it did not.
  assert.deepEqual(badge.readsUnchanged, ['user']);
});

test('a memoised context value stops the consumer re-rendering on unrelated provider state', async () => {
  const unstable = await measured('context-unstable-value/tick');
  const stable = await measured('context-memo-value/tick');
  const a = unstable.nodes.find((n) => n.name === 'UserBadge');
  const b = stable.nodes.find((n) => n.name === 'UserBadge');
  assert.equal(a.renderCount, 1);
  assert.deepEqual(a.readsUnchanged, ['user'], 'the data it reads never changed');
  assert.equal(b.renderCount, 0);
  assert.equal(b.reason, 'ancestor-skipped');
});

test('React.memo does not stop a context update reaching a consumer below it', async () => {
  const run = await measured('memo-does-not-block-context/change');
  const section = run.nodes.find((n) => n.name === 'MemoSection');
  const reader = run.nodes.find((n) => n.name === 'ThemeReader');
  assert.equal(section.renderCount, 0, 'the memo boundary itself bails out');
  assert.equal(reader.renderCount, 1, 'and the component underneath it renders anyway');
  assert.equal(reader.reason, 'context');
});

test('useMemo with an unstable dependency runs the expensive function every render', async () => {
  const bad = await measured('usememo-unstable-dep/bump');
  const good = await measured('usememo-primitive-dep/bump');
  assert.equal(bad.countersAfterMount.filterRuns, 1);
  assert.equal(bad.counters.filterRuns, 2, 'ran again on the update');
  assert.equal(good.countersAfterMount.filterRuns, 1);
  assert.equal(good.counters.filterRuns, 1, 'did not run again');
});

test('passing a child as children stops it re-rendering with no memo anywhere', async () => {
  const run = await measured('children-as-prop/bump');
  const scenario = byId.get('children-as-prop');
  assert.equal(scenario.nodes.every((n) => !n.memo), true, 'no React.memo in this scenario');
  const expensive = run.nodes.find((n) => n.name === 'Expensive');
  assert.equal(expensive.renderCount, 0);
  assert.equal(expensive.reason, 'element-identity');
});

test('setting state to the value it already holds does not render at all', async () => {
  const run = await measured('setstate-same-value/set');
  assert.equal(run.nodes.find((n) => n.name === 'App').renderCount, 0);
  assert.equal(run.domChanged, false);
});

test('two updates that cancel out still render the owner once, but not its children', async () => {
  const run = await measured('setstate-net-zero/set');
  assert.equal(run.nodes.find((n) => n.name === 'App').renderCount, 1);
  assert.equal(run.nodes.find((n) => n.name === 'Child').renderCount, 0);
  assert.equal(run.domChanged, false, 'the render produced no DOM change at all');
});

// The counterfactual, measured rather than reasoned about. Every scenario is rebuilt with every
// component wrapped in React.memo and run again. A component the model says memo would have saved
// must actually stop rendering, and one it says memo would not have saved must keep rendering.
test('the "memo would have helped" prediction survives actually adding memo everywhere', async () => {
  let checkedTrue = 0;
  let checkedFalse = 0;
  for (const key of Object.keys(EXPECTED)) {
    const [scenarioId, actionId] = key.split('/');
    const scenario = byId.get(scenarioId);
    const base = await measured(key);
    const memoAll = attribute(scenario, await runScenario(scenario, actionId, { memoAll: true }));
    for (const node of base.nodes) {
      const after = memoAll.nodes.find((n) => n.name === node.name);
      if (node.memoWouldHelp === true) {
        assert.equal(after.renderCount, 0, `${key}/${node.name} was predicted to be saved by memo`);
        checkedTrue += 1;
      } else if (node.memoWouldHelp === false) {
        assert.ok(after.renderCount > 0, `${key}/${node.name} was predicted not to be saved by memo`);
        checkedFalse += 1;
      }
    }
  }
  assert.ok(checkedTrue >= 10, `expected at least 10 memo-would-help predictions, got ${checkedTrue}`);
  assert.ok(checkedFalse >= 8, `expected at least 8 memo-would-not-help predictions, got ${checkedFalse}`);
});

test('memo everywhere still leaves renders that memo cannot remove', async () => {
  let removed = 0;
  let remaining = 0;
  for (const key of Object.keys(EXPECTED)) {
    const [scenarioId, actionId] = key.split('/');
    const scenario = byId.get(scenarioId);
    const base = await measured(key);
    const memoAll = attribute(scenario, await runScenario(scenario, actionId, { memoAll: true }));
    for (const node of base.nodes) {
      const after = memoAll.nodes.find((n) => n.name === node.name);
      removed += node.renderCount - after.renderCount;
      remaining += after.renderCount;
    }
  }
  assert.ok(removed > 0, 'memo everywhere removed no renders at all, so the mode is not applying');
  assert.ok(remaining > 0, 'memo everywhere removed every render, which would mean the trees are trivial');
});

test('memo would have helped exactly where the data says the props were unchanged', async () => {
  for (const key of Object.keys(EXPECTED)) {
    const run = await measured(key);
    for (const node of run.nodes) {
      if (node.reason === 'parent-render') {
        assert.equal(
          node.memoWouldHelp,
          node.propsChanged.length === 0,
          `${key}/${node.name}`,
        );
      }
      if (node.reason === 'context' || node.reason === 'props-changed') {
        assert.equal(node.memoWouldHelp, false, `${key}/${node.name}`);
      }
    }
  }
});
