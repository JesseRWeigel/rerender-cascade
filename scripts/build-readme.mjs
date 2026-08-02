#!/usr/bin/env node
// Regenerate the measured table inside README.md from data/cascades.json.
//
// A pasted number in a README is a claim like any other and goes stale the moment anything moves.
// This block is generated, and --check fails if the file no longer matches the recording.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADLINES } from '../src/headlines.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const readmeFile = join(root, 'README.md');
const data = JSON.parse(readFileSync(join(root, 'data', 'cascades.json'), 'utf8'));

const START = '<!-- measured:start -->';
const END = '<!-- measured:end -->';

const nodeOf = (scenarioId, actionId, name) => {
  const s = data.scenarios.find((x) => x.id === scenarioId);
  if (!s) throw new Error(`no scenario ${scenarioId}`);
  const r = s.runs.find((x) => x.actionId === actionId);
  if (!r) throw new Error(`no action ${scenarioId}/${actionId}`);
  const n = r.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no component ${name} in ${scenarioId}/${actionId}`);
  return n;
};

const rows = HEADLINES.map((hl) => {
  const bad = nodeOf(hl.defeated[0], hl.defeated[1], hl.node);
  const good = nodeOf(hl.works[0], hl.works[1], hl.node);
  return `| ${hl.title} | \`${hl.node}\` | \`${hl.defeated[0]}\`: **${bad.renderCount}** | \`${hl.works[0]}\`: **${good.renderCount}** |`;
});

const totals = {
  scenarios: data.scenarios.length,
  actions: data.scenarios.reduce((n, s) => n + s.runs.length, 0),
  verdicts: data.scenarios.reduce((n, s) => n + s.runs.reduce((m, r) => m + r.nodes.length, 0), 0),
  renders: data.scenarios.reduce(
    (n, s) => n + s.runs.reduce((m, r) => m + r.nodes.reduce((k, x) => k + x.renderCount, 0), 0),
    0,
  ),
  skips: data.scenarios.reduce(
    (n, s) => n + s.runs.reduce((m, r) => m + r.nodes.filter((x) => x.renderCount === 0).length, 0),
    0,
  ),
};

const memoAllTotal = data.scenarios.reduce(
  (n, s) => n + s.runs.reduce((m, r) => m + r.nodes.reduce((k, x) => k + x.memoAllRenderCount, 0), 0),
  0,
);

const filterRuns = (id) => {
  const s = data.scenarios.find((x) => x.id === id);
  return s.runs[0].counters.filterRuns;
};

const block = `${START}
Measured against React ${data.react} and react-dom ${data.reactDom}: ${totals.scenarios} scenarios,
${totals.actions} recorded state changes, ${totals.verdicts} component verdicts,
${totals.renders} re-renders and ${totals.skips} skips.

| case | component | where the optimisation fails | where it works |
| --- | --- | --- | --- |
${rows.join('\n')}

Two more measured results that are not a pair:

- \`usememo-unstable-dep\` runs its expensive function **${filterRuns('usememo-unstable-dep')}** times across a mount and one
  click; \`usememo-primitive-dep\` runs it **${filterRuns('usememo-primitive-dep')}**. The dependency array is the only difference.
- Every scenario replayed with \`React.memo\` wrapped around **every** component drops the total
  from **${totals.renders}** re-renders to **${memoAllTotal}**. Memo everywhere removes
  ${totals.renders - memoAllTotal} of them and cannot touch the other ${memoAllTotal}, which is the
  measured answer to "would memo have fixed this".
- \`setstate-same-value\`: setting state to the value it already holds renders \`App\`
  **${nodeOf('setstate-same-value', 'set', 'App').renderCount}** times. \`setstate-net-zero\`, where two updates in one event cancel out, renders
  \`App\` **${nodeOf('setstate-net-zero', 'set', 'App').renderCount}** time and \`Child\` **${nodeOf('setstate-net-zero', 'set', 'Child').renderCount}**. Same final state, different render count.
${END}`;

const existing = readFileSync(readmeFile, 'utf8');
if (!existing.includes(START) || !existing.includes(END)) {
  console.error(`README.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}
const rebuilt =
  existing.slice(0, existing.indexOf(START)) + block + existing.slice(existing.indexOf(END) + END.length);

if (process.argv.includes('--check')) {
  if (rebuilt !== existing) {
    console.error('The measured block in README.md does not match data/cascades.json.');
    console.error('Run: node scripts/build-readme.mjs');
    process.exit(1);
  }
  console.log(`README.md measured block matches the recording (${rows.length} paired cases)`);
} else {
  writeFileSync(readmeFile, rebuilt);
  console.log(`updated the measured block in README.md (${rows.length} paired cases)`);
}
