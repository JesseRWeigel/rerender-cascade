#!/usr/bin/env node
// Print the live measurement, one line per component per action, with nothing else on stdout.
//
// This exists so a sabotage can be PROVED to have changed real output before anything is
// concluded from it. An attack that quietly does nothing looks exactly like a check with a gap.
import { scenarios } from '../src/scenarios.mjs';
import { runScenario } from '../src/run.mjs';
import { attribute } from '../src/attribute.mjs';

for (const scenario of scenarios) {
  for (const action of scenario.actions) {
    const run = attribute(scenario, await runScenario(scenario, action.id));
    for (const node of run.nodes) {
      console.log(
        [
          scenario.id,
          action.id,
          node.name,
          node.renderCount,
          node.reason,
          (node.propsChanged || []).join('+') || '-',
          (node.contextChanged || []).join('+') || '-',
        ].join('\t'),
      );
    }
    const counters = Object.keys(run.counters || {});
    for (const key of counters) console.log([scenario.id, action.id, `counter:${key}`, run.counters[key]].join('\t'));
  }
}
