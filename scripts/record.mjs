#!/usr/bin/env node
// Run every scenario against real React and write data/cascades.json.
//
// --check re-runs everything and fails if the committed file differs, so the data on the page can
// never drift away from what React does today.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { scenarios } from '../src/scenarios.mjs';
import { runScenario } from '../src/run.mjs';
import { attribute } from '../src/attribute.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outFile = join(root, 'data', 'cascades.json');
const require = createRequire(join(root, 'package.json'));

export async function collect() {
  const out = [];
  for (const scenario of scenarios) {
    const runs = [];
    for (const action of scenario.actions) {
      const run = await runScenario(scenario, action.id);
      runs.push(attribute(scenario, run));
    }
    out.push({
      id: scenario.id,
      group: scenario.group,
      variant: scenario.variant,
      title: scenario.title,
      question: scenario.question,
      claim: scenario.claim,
      nodes: scenario.nodes.map((n) => ({
        name: n.name,
        parent: n.parent,
        elementFrom: n.elementFrom,
        memo: n.memo,
        consumes: n.consumes,
      })),
      runs,
    });
  }
  return {
    schema: 1,
    react: require('react/package.json').version,
    reactDom: require('react-dom/package.json').version,
    scenarios: out,
  };
}

const json = (data) => `${JSON.stringify(data, null, 2)}\n`;

if (process.argv[1] && process.argv[1].endsWith('record.mjs')) {
  const data = await collect();
  const text = json(data);
  if (process.argv.includes('--check')) {
    let existing;
    try {
      existing = readFileSync(outFile, 'utf8');
    } catch {
      console.error(`${outFile} does not exist. Run: node scripts/record.mjs`);
      process.exit(1);
    }
    if (existing !== text) {
      console.error('data/cascades.json does not match a fresh run against React.');
      console.error('Run: node scripts/record.mjs');
      process.exit(1);
    }
    console.log(`data/cascades.json matches a fresh run (React ${data.react})`);
  } else {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, text);
    const runs = data.scenarios.reduce((n, s) => n + s.runs.length, 0);
    console.log(`wrote ${data.scenarios.length} scenarios, ${runs} recorded actions, React ${data.react}`);
  }
}
