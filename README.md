# rerender-cascade

A component tree, a state change at any node, and the exact list of which components React
re-rendered and why. Every number comes out of running real React in Node, instrumenting the
render calls, and counting. There is no hand-written table of "this re-renders" anywhere in the
project, because that is the kind of thing that is wrong in a way nobody notices.

The interesting part is not the cases where intuition is right. It is the cases where a
`React.memo` is present and does nothing, where a context consumer re-renders on a field it does
not read, where `useMemo` is written correctly and still never hits, and where a child skips its
render with no memoisation of any kind. Each of those is a runnable scenario paired with a variant
where the same optimisation works, and both are asserted.

Open `docs/index.html` for the interactive version.

## What it measures

Each scenario is a small React tree plus one or more actions. For each action the project mounts
the tree, fires exactly one state change inside `act()`, and records every component function React
called. It then attributes each render to one of:

| cause | meaning |
| --- | --- |
| `state` | its own state changed |
| `context` | a context value it reads changed identity |
| `props-changed` | `React.memo` compared props and found a change |
| `parent-render` | the component that renders it re-rendered |

and each non-render to one of:

| skip reason | meaning |
| --- | --- |
| `state-bailout` | React compared the new state to the current state and did not render at all |
| `above-the-update` | the state that changed lives below it |
| `render-then-bailout` | React re-rendered the parent, found the state unchanged, and reused the subtree |
| `ancestor-skipped` | its parent did not re-render, so React never reached it |
| `element-identity` | React saw the same element object it already had |
| `memo-bailout` | `React.memo` compared props and found them all equal |

`unexplained` is a real outcome and the test suite asserts there are none of them. If React does
something the attribution model cannot account for, that fails a test rather than becoming a
plausible sentence on the page.

## Results

<!-- measured:start -->
Measured against React 19.2.8 and react-dom 19.2.8: 23 scenarios,
29 recorded state changes, 124 component verdicts,
53 re-renders and 71 skips.

| case | component | where the optimisation fails | where it works |
| --- | --- | --- | --- |
| React.memo, defeated by one inline object | `MemoToolbar` | `memo-inline-object`: **1** | `memo-stable-props`: **0** |
| React.memo, defeated by one inline arrow | `MemoButton` | `memo-inline-arrow`: **1** | `memo-usecallback`: **0** |
| useCallback that does nothing | `MemoButton` | `usecallback-unstable-dep`: **1** | `usecallback-primitive-dep`: **0** |
| useMemo that never hits | `MemoTable` | `usememo-unstable-dep`: **1** | `usememo-primitive-dep`: **0** |
| A context consumer that does not use the field that changed | `UserBadge` | `context-single-object`: **1** | `context-split`: **0** |
| Unrelated state inside a provider | `UserBadge` | `context-unstable-value`: **1** | `context-memo-value`: **0** |
| A child that skips with no memo at all | `Expensive` | `children-inline`: **1** | `children-as-prop`: **0** |
| React.memo on a wrapper that takes children | `MemoPanel` | `memo-children-inline`: **1** | `memo-children-hoisted`: **0** |
| React.memo does not stop a context update | `ThemeReader` | `memo-does-not-block-context`: **1** | `memo-blocks-parent-state`: **0** |

Two more measured results that are not a pair:

- `usememo-unstable-dep` runs its expensive function **2** times across a mount and one
  click; `usememo-primitive-dep` runs it **1**. The dependency array is the only difference.
- `setstate-same-value`: setting state to the value it already holds renders `App`
  **0** times. `setstate-net-zero`, where two updates in one event cancel out, renders
  `App` **1** time and `Child` **0**. Same final state, different render count.
<!-- measured:end -->

The last row of the table is the one worth staring at. In `memo-does-not-block-context` the
`React.memo` boundary bails out, and the component underneath it re-renders anyway: a context
update reaches its consumer through a memoised component that did not render. A memo boundary is
not a wall.

`context-unstable-value` is the other one. `UserBadge` re-renders, and the `user` object it reads
is measured to be the identical object it already had. Only the wrapper changed.

## How to run it

```
npm install
npm test                       # every expected cascade, asserted against a live React run
node scripts/record.mjs        # re-measure and rewrite data/cascades.json
node scripts/build-docs.mjs    # regenerate docs/index.html from that data
node scripts/build-readme.mjs  # regenerate the measured block above
bash scripts/verify.sh         # everything, including the browser and the sabotage suite
```

`npm install` pulls `playwright-core`. The browser check is not optional and does not skip: a page
whose entire inline script fails to parse still renders as static HTML and still passes every Node
test, so the only way to know the script ran is to load the page and assert on something only the
script could have produced.

## How the numbers are checked

- **Real React, every time.** `src/run.mjs` mounts each scenario with `react-dom/client` into a
  jsdom document and fires the action inside `act()`. `data/cascades.json` is regenerated on every
  verify and compared, so it cannot drift from what React does today.
- **An independent recount.** `scripts/independent-check.mjs` registers as a React DevTools
  renderer and walks React's own fiber tree after every commit, counting the `PerformedWork` flag.
  It shares no code with the instrumentation, sets up its own jsdom, and runs the scenarios with a
  no-op probe, which also proves the instrumentation does not change the cascade it measures. It
  additionally checks the declared component tree against the fiber tree React actually built, and
  measures for itself whether the DOM changed.
- **Negative controls.** Every optimisation the project claims prevents a render is paired with a
  run where the same optimisation does not, and verify fails if any group loses its pair.
- **Sabotage.** `scripts/sabotage.sh` breaks the probe, the attribution, a scenario's fix, the
  recorded data, the published page's numbers, the page's script syntax, and the independent
  recount's own correctness rule. Each sabotage is proved to have changed real output before any
  conclusion is drawn from it, then the corresponding check must fail.

## One measured disagreement, kept rather than smoothed over

The probe counts "React called this component function". The fiber flags count "React committed
work for this component". These agree everywhere except `setstate-net-zero`, where two state
updates in one event cancel out: React calls `App`, discovers the resulting state is unchanged,
and throws the work away without ever setting `PerformedWork`. The probe sees one render, the
fibers see none, and the DOM does not change. The independent checker allows that single
divergence only for the component whose state was set, only for a difference of one, and only when
it has independently measured that the DOM did not change. Everything else is a failure.

## What is not covered

- Class components, `useSyncExternalStore`, Suspense, transitions and concurrent interruption are
  not modelled. Every scenario is a synchronous update to a function component tree.
- The React Compiler is not in the picture. These are the costs the compiler exists to remove, and
  measuring what it removes would be a separate project.
- Rendering cost is not measured, only render counts. A component that re-renders cheaply and one
  that re-renders expensively look identical here.
- Scenarios use `React.createElement` rather than JSX so the project runs in Node with no build
  step.
- The attribution model explains what happened in these trees. It is not a general React explainer,
  and a tree with a shape it has not seen could produce `unexplained`, which is exactly what that
  outcome is for.

## Status

```
$ bash scripts/verify.sh
STATUS_PLACEHOLDER
```

## Licence

MIT. See `LICENSE`.
