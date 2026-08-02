// Turn a recorded run into a per-component verdict with a cause.
//
// Nothing here decides whether a component re-rendered. That is read straight off the probe log,
// which is the component function reporting that it was called. This module only answers "why",
// and it answers it from measured facts: which prop keys changed identity, whether a consumed
// context value changed identity, whether the component that creates this element re-rendered.
//
// `unexplained` is a real outcome and the test suite asserts there are none. If React does
// something this model cannot account for, that shows up as a failure rather than as a plausible
// sentence on the page.
import { HOISTED } from './scenarios.mjs';

export const RENDER_CAUSES = {
  state: 'its own state changed',
  context: 'a context value it reads changed identity',
  'props-changed': 'React.memo compared props and found a change',
  'parent-render': 'the component that renders it re-rendered',
  unexplained: 'not explained by this model',
};

export const SKIP_REASONS = {
  'state-bailout': 'React compared the new state to the current state, found them equal, and did not render at all',
  'above-the-update': 'the state that changed lives below it, and React only re-renders downwards',
  'render-then-bailout': 'React re-rendered its parent because it could not know the result in advance, found the state unchanged, and reused the whole subtree instead of descending',
  'ancestor-skipped': 'its parent did not re-render, so React never reached it',
  'element-identity': 'React saw the same element object it already had and bailed out',
  'memo-bailout': 'React.memo compared props and found them all equal',
  unexplained: 'not explained by this model',
};

function changedKeys(prev, next) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const changed = [];
  for (const key of keys) {
    if (!Object.is((prev || {})[key], (next || {})[key])) changed.push(key);
  }
  return changed.sort();
}

function describeValue(v) {
  if (v === null) return 'null';
  if (typeof v === 'function') return 'function';
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'object') return 'object';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

// A render is "the same data in a new wrapper" when every changed prop is deep-equal-ish at one
// level. That is the shape of the classic mistake, so it is worth naming explicitly.
function looksIdenticalInContent(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return a.toString() === b.toString();
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.is(a[k], b[k]));
  }
  return false;
}

export function attribute(scenario, run) {
  const action = scenario.actions.find((a) => a.id === run.actionId);
  const lastMountRender = new Map();
  for (const r of run.mount.renders) lastMountRender.set(r.name, r);

  const updateRenders = new Map();
  for (const r of run.update.renders) {
    if (!updateRenders.has(r.name)) updateRenders.set(r.name, []);
    updateRenders.get(r.name).push(r);
  }

  const rendered = (name) => updateRenders.has(name);
  const nodeByName = new Map(scenario.nodes.map((n) => [n.name, n]));

  // Every strict ancestor of the component whose state changed. React updates downwards, so a
  // component in this set skipping is the update path working, not an optimisation firing.
  const ancestorsOfOwner = new Set();
  for (let cur = nodeByName.get(action.owner); cur && cur.parent; ) {
    ancestorsOfOwner.add(cur.parent);
    cur = nodeByName.get(cur.parent);
  }
  const descendantsOfOwner = new Set();
  {
    let added = true;
    while (added) {
      added = false;
      for (const n of scenario.nodes) {
        if (descendantsOfOwner.has(n.name) || !n.parent) continue;
        if (n.parent === action.owner || descendantsOfOwner.has(n.parent)) {
          descendantsOfOwner.add(n.name);
          added = true;
        }
      }
    }
  }

  // Did the component that owns the changed state end up with the same state it started with?
  // Only scenarios that record their state answer this; where nothing was recorded the answer is
  // null and no attribution is allowed to lean on it.
  const ownerMountRender = lastMountRender.get(action.owner);
  const ownerUpdateRenders = updateRenders.get(action.owner) || [];
  const ownerNow = ownerUpdateRenders[ownerUpdateRenders.length - 1];
  const ownerStateUnchanged =
    ownerNow && ownerNow.state && ownerMountRender && ownerMountRender.state
      ? Object.keys(ownerNow.state).every((k) =>
          Object.is(ownerNow.state[k], ownerMountRender.state[k]),
        )
      : false;

  const results = scenario.nodes.map((node) => {
    const renders = updateRenders.get(node.name) || [];
    const count = renders.length;
    const prev = lastMountRender.get(node.name);
    const base = {
      name: node.name,
      parent: node.parent,
      elementFrom: node.elementFrom,
      memo: node.memo,
      consumes: node.consumes,
      mountRenders: run.mount.renders.filter((r) => r.name === node.name).length,
      renderCount: count,
    };

    if (count === 0) {
      let reason;
      if (node.name === action.owner) reason = 'state-bailout';
      else if (ancestorsOfOwner.has(node.name)) reason = 'above-the-update';
      else if (node.parent && !rendered(node.parent)) reason = 'ancestor-skipped';
      else if (ownerStateUnchanged && descendantsOfOwner.has(node.name))
        reason = 'render-then-bailout';
      else if (node.elementFrom === HOISTED || (node.elementFrom && !rendered(node.elementFrom)))
        reason = 'element-identity';
      else if (node.memo) reason = 'memo-bailout';
      else reason = 'unexplained';
      return { ...base, rendered: false, reason, detail: SKIP_REASONS[reason], propsChanged: [] };
    }

    const now = renders[renders.length - 1];
    const propsChanged = prev ? changedKeys(prev.props, now.props) : [];
    const propsDetail = propsChanged.map((key) => {
      const before = prev ? prev.props[key] : undefined;
      const after = now.props[key];
      return {
        key,
        before: describeValue(before),
        after: describeValue(after),
        sameContent: looksIdenticalInContent(before, after),
      };
    });

    const contextChanged = [];
    for (const ctxName of Object.keys(now.ctx)) {
      const before = prev ? prev.ctx[ctxName] : undefined;
      if (!Object.is(before, now.ctx[ctxName])) contextChanged.push(ctxName);
    }
    const readsUnchanged = [];
    for (const field of Object.keys(now.reads)) {
      const before = prev ? prev.reads[field] : undefined;
      if (Object.is(before, now.reads[field])) readsUnchanged.push(field);
    }

    let cause;
    if (node.name === action.owner) cause = 'state';
    else if (contextChanged.length > 0) cause = 'context';
    else if (node.memo) cause = 'props-changed';
    else if (node.elementFrom && node.elementFrom !== HOISTED && rendered(node.elementFrom))
      cause = 'parent-render';
    else cause = 'unexplained';

    // Would React.memo have stopped this render? Only if nothing else would have pulled it in.
    let memoWouldHelp = null;
    if (cause === 'parent-render') {
      memoWouldHelp = propsChanged.length === 0;
    } else if (cause === 'props-changed') {
      memoWouldHelp = false;
    } else if (cause === 'context') {
      memoWouldHelp = false;
    }

    return {
      ...base,
      rendered: true,
      reason: cause,
      detail: RENDER_CAUSES[cause],
      propsChanged,
      propsDetail,
      contextChanged,
      readsUnchanged,
      memoWouldHelp,
    };
  });

  // A component that rendered but is not in the declared tree means the tree metadata is wrong.
  const declared = new Set(scenario.nodes.map((n) => n.name));
  const stray = [...updateRenders.keys()].filter((n) => !declared.has(n));

  return {
    scenarioId: scenario.id,
    actionId: run.actionId,
    actionLabel: action.label,
    owner: action.owner,
    stray,
    nodes: results,
    counters: run.counters,
    countersAfterMount: run.countersAfterMount,
    domChanged: run.domChanged,
    ownerStateUnchanged,
    totalUpdateRenders: run.update.renders.length,
    totalMountRenders: run.mount.renders.length,
    unexplained: results.filter((r) => r.reason === 'unexplained').map((r) => r.name),
  };
}
