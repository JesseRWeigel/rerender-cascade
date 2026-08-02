// The recording probe.
//
// Every component in every scenario calls `probe(name, props, extra)` as its first statement.
// The probe is a plain function call, not a hook and not a wrapper component, so instrumenting a
// tree cannot change what React does with it. `scripts/independent-check.mjs` relies on that: it
// runs the same component functions with a no-op probe and counts renders off React's own fibers.
//
// A flush is one `act()` window: a mount, or one user action and everything React did because of
// it. A component can render more than once inside a single flush; that is recorded, not collapsed.

export function createRecorder() {
  const flushes = [];
  let current = null;

  function begin(label) {
    if (current) throw new Error(`begin(${label}) while flush ${current.label} is still open`);
    current = { label, renders: [] };
  }

  function end() {
    if (!current) throw new Error('end() with no open flush');
    flushes.push(current);
    const done = current;
    current = null;
    return done;
  }

  function probe(name, props, extra) {
    if (!current) {
      throw new Error(`${name} rendered outside any flush window; the recording would be wrong`);
    }
    current.renders.push({
      name,
      props: props === undefined ? {} : props,
      ctx: (extra && extra.ctx) || {},
      reads: (extra && extra.reads) || {},
      state: extra && extra.state ? extra.state : null,
    });
  }

  return { begin, end, probe, flushes };
}

export function noopProbe() {}
