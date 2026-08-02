// Run one scenario action against real react-dom and return what actually happened.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { freshContainer } from './dom.mjs';
import { createRecorder } from './probe.mjs';
import { setMemoAll } from './scenarios.mjs';

const { act } = React;

// Every scenario gets a brand new root, so one action can never be measured against a tree that a
// previous action already dirtied.
// `memoAll` rebuilds the identical tree with every component wrapped in React.memo. Comparing the
// two runs is what turns "React.memo would have prevented this render" from a claim into a
// measurement.
export async function runScenario(scenario, actionId, { memoAll = false } = {}) {
  const action = scenario.actions.find((a) => a.id === actionId);
  if (!action) throw new Error(`scenario ${scenario.id} has no action ${actionId}`);

  const recorder = createRecorder();
  setMemoAll(memoAll);
  let built;
  try {
    built = scenario.build(recorder.probe);
  } finally {
    setMemoAll(false);
  }
  const container = freshContainer();
  const root = createRoot(container);

  recorder.begin('mount');
  await act(async () => {
    root.render(built.element);
  });
  const mount = recorder.end();

  const countersAfterMount = { ...built.counters };
  const htmlAfterMount = container.innerHTML;

  recorder.begin(action.id);
  await act(async () => {
    built.act(action.id, built.handles);
  });
  const update = recorder.end();

  const htmlAfterUpdate = container.innerHTML;
  await act(async () => {
    root.unmount();
  });

  return {
    scenarioId: scenario.id,
    actionId: action.id,
    memoAll,
    mount,
    update,
    htmlAfterMount,
    htmlAfterUpdate,
    domChanged: htmlAfterMount !== htmlAfterUpdate,
    counters: built.counters,
    countersAfterMount,
  };
}

// The whole matrix: every action of every scenario.
export async function runAll(scenarios) {
  const out = [];
  for (const scenario of scenarios) {
    for (const action of scenario.actions) {
      out.push(await runScenario(scenario, action.id));
    }
  }
  return out;
}
