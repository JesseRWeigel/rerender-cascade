// Scenario definitions.
//
// Each scenario is a small but real React tree plus one or more actions. `build(probe)` returns a
// live element; nothing here is a description of React, it is React. The `nodes` list is
// structural metadata only (who is whose parent, which components are wrapped in React.memo, which
// read context). It never states what will re-render. That is measured.
//
// Scenarios come in pairs: a `defeated` variant where an optimisation does not work, and a `works`
// variant that differs by one line. Both are asserted, so a claim like "useCallback prevents this
// render" is always paired with a run proving it can fail.
import React from 'react';

const h = React.createElement;

// Sugar for "probe first, then render". Keeping this a plain call rather than a HOC matters: a
// wrapper component would add a fiber and change the very cascade being measured.
function comp(name, fn) {
  const c = (props) => fn(props);
  Object.defineProperty(c, 'name', { value: name });
  return c;
}

// An element created once and reused across every render of its creator, so React always sees
// the object it already has and can bail out of that subtree.
export const HOISTED = '(hoisted)';

const scenarios = [];
const def = (s) => {
  scenarios.push(s);
  return s;
};

// ---------------------------------------------------------------------------------------------
// 1. Free exploration: every node owns a counter, so a state change can be triggered anywhere.
// ---------------------------------------------------------------------------------------------
def({
  id: 'tree-explorer',
  group: 'explorer',
  variant: 'control',
  title: 'Trigger a state change at any node',
  question: 'Where does an update actually travel when you set state at an arbitrary node?',
  claim: 'A state change renders the owning component and everything below it, and nothing above or beside it, except where a React.memo boundary with unchanged props stops it.',
  nodes: [
    { name: 'App', parent: null },
    { name: 'Header', parent: 'App' },
    { name: 'Sidebar', parent: 'App' },
    { name: 'SidebarNav', parent: 'Sidebar' },
    { name: 'SidebarStats', parent: 'Sidebar' },
    { name: 'Main', parent: 'App' },
    { name: 'MemoPanel', parent: 'Main', memo: true },
    { name: 'PanelBody', parent: 'MemoPanel' },
    { name: 'Footer', parent: 'Main' },
  ],
  actions: [
    { id: 'app', label: 'set state in App', owner: 'App' },
    { id: 'sidebar', label: 'set state in Sidebar', owner: 'Sidebar' },
    { id: 'sidebarnav', label: 'set state in SidebarNav', owner: 'SidebarNav' },
    { id: 'main', label: 'set state in Main', owner: 'Main' },
    { id: 'memopanel', label: 'set state in MemoPanel', owner: 'MemoPanel' },
    { id: 'panelbody', label: 'set state in PanelBody', owner: 'PanelBody' },
    { id: 'footer', label: 'set state in Footer', owner: 'Footer' },
  ],
  build(probe) {
    const handles = {};
    const counters = {};
    const counter = (name) => {
      const [n, set] = React.useState(0);
      handles[name] = { bump: () => set((v) => v + 1) };
      return n;
    };

    const Header = comp('Header', (props) => {
      probe('Header', props);
      return h('h1', null, 'header');
    });
    const SidebarNav = comp('SidebarNav', (props) => {
      const n = counter('SidebarNav');
      probe('SidebarNav', props);
      return h('nav', null, n);
    });
    const SidebarStats = comp('SidebarStats', (props) => {
      probe('SidebarStats', props);
      return h('p', null, 'stats');
    });
    const Sidebar = comp('Sidebar', (props) => {
      const n = counter('Sidebar');
      probe('Sidebar', props);
      return h('aside', null, n, h(SidebarNav), h(SidebarStats));
    });
    const PanelBody = comp('PanelBody', (props) => {
      const n = counter('PanelBody');
      probe('PanelBody', props);
      return h('p', null, n);
    });
    const MemoPanel = React.memo(
      comp('MemoPanel', (props) => {
        const n = counter('MemoPanel');
        probe('MemoPanel', props);
        return h('section', null, props.title, n, h(PanelBody));
      }),
    );
    const Footer = comp('Footer', (props) => {
      const n = counter('Footer');
      probe('Footer', props);
      return h('footer', null, n);
    });
    const Main = comp('Main', (props) => {
      const n = counter('Main');
      probe('Main', props);
      return h('main', null, n, h(MemoPanel, { title: 'panel' }), h(Footer));
    });
    const App = comp('App', (props) => {
      const n = counter('App');
      probe('App', props);
      return h('div', null, n, h(Header), h(Sidebar), h(Main));
    });
    return { element: h(App), handles, counters, act: (id, hs) => hs[owners[id]].bump() };
  },
});
const owners = {
  app: 'App',
  sidebar: 'Sidebar',
  sidebarnav: 'SidebarNav',
  main: 'Main',
  memopanel: 'MemoPanel',
  panelbody: 'PanelBody',
  footer: 'Footer',
};

// ---------------------------------------------------------------------------------------------
// 2. React.memo and prop identity.
// ---------------------------------------------------------------------------------------------
function memoPropsScenario({ id, variant, title, claim, inlineObject }) {
  return def({
    id,
    group: 'memo-prop-identity',
    variant,
    title,
    question: 'Does React.memo stop the child re-rendering when the parent re-renders?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'MemoToolbar', parent: 'App', memo: true },
      { name: 'PlainLabel', parent: 'App' },
    ],
    actions: [{ id: 'bump', label: 'set count in App', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const PlainLabel = comp('PlainLabel', (props) => {
        probe('PlainLabel', props);
        return h('span', null, 'label');
      });
      const MemoToolbar = React.memo(
        comp('MemoToolbar', (props) => {
          probe('MemoToolbar', props);
          return h('div', null, props.label);
        }),
      );
      const App = comp('App', (props) => {
        const [count, setCount] = React.useState(0);
        handles.App = { bump: () => setCount((c) => c + 1) };
        probe('App', props);
        // The single line that differs between the two variants.
        const toolbarProps = inlineObject
          ? { label: 'Save', style: { padding: 8 } }
          : { label: 'Save' };
        return h('div', null, count, h(MemoToolbar, toolbarProps), h(PlainLabel));
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.bump() };
    },
  });
}
memoPropsScenario({
  id: 'memo-stable-props',
  variant: 'works',
  title: 'React.memo with only primitive props',
  claim: 'MemoToolbar does not re-render when App re-renders, because every prop is === to last time.',
  inlineObject: false,
});
memoPropsScenario({
  id: 'memo-inline-object',
  variant: 'defeated',
  title: 'React.memo defeated by an inline object prop',
  claim: 'Adding style={{ padding: 8 }} makes MemoToolbar re-render on every parent render. The memo is still there and does nothing.',
  inlineObject: true,
});

// ---------------------------------------------------------------------------------------------
// 3. Inline arrow vs useCallback.
// ---------------------------------------------------------------------------------------------
function callbackScenario({ id, variant, title, claim, stable }) {
  return def({
    id,
    group: 'memo-callback-identity',
    variant,
    title,
    question: 'Does passing a function to a memoised child break the memo?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'MemoButton', parent: 'App', memo: true },
    ],
    actions: [{ id: 'bump', label: 'set count in App', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const MemoButton = React.memo(
        comp('MemoButton', (props) => {
          probe('MemoButton', props);
          return h('button', { onClick: props.onSave }, 'save');
        }),
      );
      const App = comp('App', (props) => {
        const [count, setCount] = React.useState(0);
        handles.App = { bump: () => setCount((c) => c + 1) };
        const stableSave = React.useCallback(() => {}, []);
        probe('App', props);
        const onSave = stable ? stableSave : () => {};
        return h('div', null, count, h(MemoButton, { onSave }));
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.bump() };
    },
  });
}
callbackScenario({
  id: 'memo-inline-arrow',
  variant: 'defeated',
  title: 'React.memo defeated by an inline arrow function',
  claim: 'A fresh arrow function every render is a changed prop, so MemoButton re-renders every time.',
  stable: false,
});
callbackScenario({
  id: 'memo-usecallback',
  variant: 'works',
  title: 'useCallback with an empty dependency array',
  claim: 'The same function identity every render, so MemoButton skips its render.',
  stable: true,
});

// ---------------------------------------------------------------------------------------------
// 4. useCallback whose dependency array makes it useless.
// ---------------------------------------------------------------------------------------------
function callbackDepsScenario({ id, variant, title, claim, unstableDep }) {
  return def({
    id,
    group: 'usecallback-deps',
    variant,
    title,
    question: 'Does wrapping a handler in useCallback guarantee a stable identity?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'MemoButton', parent: 'App', memo: true },
    ],
    actions: [{ id: 'bump', label: 'set count in App', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const MemoButton = React.memo(
        comp('MemoButton', (props) => {
          probe('MemoButton', props);
          return h('button', { onClick: props.onSave }, 'save');
        }),
      );
      const App = comp('App', (props) => {
        const [count, setCount] = React.useState(0);
        const [mode] = React.useState('fast');
        handles.App = { bump: () => setCount((c) => c + 1) };
        // A brand new object every render. Putting it in the dependency array of useCallback
        // means the dependency is never equal to last render's, so the callback is rebuilt.
        const options = { mode };
        const dep = unstableDep ? options : mode;
        const onSave = React.useCallback(() => dep, [dep]);
        probe('App', props);
        return h('div', null, count, h(MemoButton, { onSave }));
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.bump() };
    },
  });
}
callbackDepsScenario({
  id: 'usecallback-unstable-dep',
  variant: 'defeated',
  title: 'useCallback with an object in the dependency array',
  claim: 'The dependency is a fresh object every render, so useCallback returns a fresh function every render and the memo below it never bails out.',
  unstableDep: true,
});
callbackDepsScenario({
  id: 'usecallback-primitive-dep',
  variant: 'works',
  title: 'The same useCallback with a primitive dependency',
  claim: 'One character of difference in the dependency array and MemoButton stops re-rendering.',
  unstableDep: false,
});

// ---------------------------------------------------------------------------------------------
// 5. useMemo whose dependency array makes it useless.
// ---------------------------------------------------------------------------------------------
function memoHookScenario({ id, variant, title, claim, unstableDep }) {
  return def({
    id,
    group: 'usememo-deps',
    variant,
    title,
    question: 'Does useMemo stop the expensive work re-running?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'MemoTable', parent: 'App', memo: true },
    ],
    actions: [{ id: 'bump', label: 'set count in App', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = { filterRuns: 0 };
      const MemoTable = React.memo(
        comp('MemoTable', (props) => {
          probe('MemoTable', props);
          return h('div', null, props.rows.length);
        }),
      );
      const App = comp('App', (props) => {
        const [count, setCount] = React.useState(0);
        const [status] = React.useState('open');
        handles.App = { bump: () => setCount((c) => c + 1) };
        // The bug: `filters` is rebuilt every render, so [filters] never matches.
        const inlineFilters = { status };
        const memoFilters = React.useMemo(() => ({ status }), [status]);
        const filters = unstableDep ? inlineFilters : memoFilters;
        const rows = React.useMemo(() => {
          counters.filterRuns += 1;
          return [filters.status, 'a', 'b'];
        }, [filters]);
        probe('App', props);
        return h('div', null, count, h(MemoTable, { rows }));
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.bump() };
    },
  });
}
memoHookScenario({
  id: 'usememo-unstable-dep',
  variant: 'defeated',
  title: 'useMemo with a freshly built object in the dependency array',
  claim: 'The memo never hits: the expensive function runs on every render and its result is a new array, so MemoTable re-renders too.',
  unstableDep: true,
});
memoHookScenario({
  id: 'usememo-primitive-dep',
  variant: 'works',
  title: 'The same useMemo once the dependency is stable',
  claim: 'The expensive function runs once, the result keeps its identity, and MemoTable skips.',
  unstableDep: false,
});

// ---------------------------------------------------------------------------------------------
// 6. Context granularity: one object versus two contexts.
// ---------------------------------------------------------------------------------------------
function contextGranularityScenario({ id, variant, title, claim, split }) {
  return def({
    id,
    group: 'context-granularity',
    variant,
    title,
    question: 'Does a component that reads only ctx.user re-render when only ctx.theme changes?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'Shell', parent: 'App', elementFrom: '(hoisted)' },
      { name: 'UserBadge', parent: 'Shell', consumes: split ? ['User'] : ['Session'] },
      { name: 'ThemeSwitch', parent: 'Shell', consumes: split ? ['Theme'] : ['Session'] },
    ],
    actions: [{ id: 'theme', label: 'change only the theme', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const SessionContext = React.createContext(null);
      const UserContext = React.createContext(null);
      const ThemeContext = React.createContext(null);

      const UserBadge = comp('UserBadge', (props) => {
        if (split) {
          const user = React.useContext(UserContext);
          probe('UserBadge', props, { ctx: { User: user }, reads: { user } });
          return h('span', null, user.name);
        }
        const session = React.useContext(SessionContext);
        probe('UserBadge', props, { ctx: { Session: session }, reads: { user: session.user } });
        return h('span', null, session.user.name);
      });
      const ThemeSwitch = comp('ThemeSwitch', (props) => {
        if (split) {
          const theme = React.useContext(ThemeContext);
          probe('ThemeSwitch', props, { ctx: { Theme: theme }, reads: { theme } });
          return h('span', null, theme);
        }
        const session = React.useContext(SessionContext);
        probe('ThemeSwitch', props, { ctx: { Session: session }, reads: { theme: session.theme } });
        return h('span', null, session.theme);
      });
      const Shell = comp('Shell', (props) => {
        probe('Shell', props);
        return h('div', null, h(UserBadge), h(ThemeSwitch));
      });
      const shellElement = h(Shell);

      const App = comp('App', (props) => {
        const [theme, setTheme] = React.useState('light');
        const [user] = React.useState({ name: 'ada' });
        handles.App = { changeTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) };
        probe('App', props);
        if (split) {
          return h(
            UserContext.Provider,
            { value: user },
            h(ThemeContext.Provider, { value: theme }, shellElement),
          );
        }
        // One context object holding two unrelated fields. Changing either one changes the
        // identity of the whole value.
        return h(SessionContext.Provider, { value: { user, theme } }, shellElement);
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.changeTheme() };
    },
  });
}
contextGranularityScenario({
  id: 'context-single-object',
  variant: 'defeated',
  title: 'One context object holding two unrelated fields',
  claim: 'UserBadge re-renders on a theme change even though session.user is the same object it already had.',
  split: false,
});
contextGranularityScenario({
  id: 'context-split',
  variant: 'works',
  title: 'The same tree with the context split in two',
  claim: 'UserBadge does not re-render on a theme change.',
  split: true,
});

// ---------------------------------------------------------------------------------------------
// 7. Context value identity: an unrelated state change in the provider.
// ---------------------------------------------------------------------------------------------
function contextValueScenario({ id, variant, title, claim, memoiseValue }) {
  return def({
    id,
    group: 'context-value-identity',
    variant,
    title,
    question: 'Does an unrelated state change inside a provider re-render its consumers?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'SessionProvider', parent: 'App' },
      { name: 'Shell', parent: 'SessionProvider', elementFrom: 'App' },
      { name: 'UserBadge', parent: 'Shell', consumes: ['Session'] },
    ],
    actions: [{ id: 'tick', label: 'set unrelated state in SessionProvider', owner: 'SessionProvider' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const SessionContext = React.createContext(null);

      const UserBadge = comp('UserBadge', (props) => {
        const session = React.useContext(SessionContext);
        probe('UserBadge', props, { ctx: { Session: session }, reads: { user: session.user } });
        return h('span', null, session.user.name);
      });
      const Shell = comp('Shell', (props) => {
        probe('Shell', props);
        return h('div', null, h(UserBadge));
      });
      const SessionProvider = comp('SessionProvider', (props) => {
        const [tick, setTick] = React.useState(0);
        const [user] = React.useState({ name: 'ada' });
        handles.SessionProvider = { tick: () => setTick((t) => t + 1) };
        const memoised = React.useMemo(() => ({ user }), [user]);
        const value = memoiseValue ? memoised : { user };
        probe('SessionProvider', props);
        return h(SessionContext.Provider, { value }, tick, props.children);
      });
      const App = comp('App', (props) => {
        probe('App', props);
        return h(SessionProvider, null, h(Shell));
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.SessionProvider.tick() };
    },
  });
}
contextValueScenario({
  id: 'context-unstable-value',
  variant: 'defeated',
  title: 'A context value object rebuilt on every provider render',
  claim: 'Unrelated state in the provider re-renders every consumer, because the value object is new even though the data in it is identical.',
  memoiseValue: false,
});
contextValueScenario({
  id: 'context-memo-value',
  variant: 'works',
  title: 'The same provider with useMemo around the value',
  claim: 'The provider re-renders, its consumers do not.',
  memoiseValue: true,
});

// ---------------------------------------------------------------------------------------------
// 8. The children bail-out: no memo anywhere and the child still skips.
// ---------------------------------------------------------------------------------------------
function childrenScenario({ id, variant, title, claim, asChildren }) {
  return def({
    id,
    group: 'children-bailout',
    variant,
    title,
    question: 'Can a child skip re-rendering with no React.memo, no useMemo and no useCallback?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'Counter', parent: 'App' },
      { name: 'Expensive', parent: 'Counter', elementFrom: asChildren ? 'App' : 'Counter' },
    ],
    actions: [{ id: 'bump', label: 'set count in Counter', owner: 'Counter' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const Expensive = comp('Expensive', (props) => {
        probe('Expensive', props);
        return h('p', null, 'expensive');
      });
      const Counter = comp('Counter', (props) => {
        const [count, setCount] = React.useState(0);
        handles.Counter = { bump: () => setCount((c) => c + 1) };
        probe('Counter', props);
        // Either the element arrived from above as children, or this component creates it.
        return h('div', null, count, asChildren ? props.children : h(Expensive));
      });
      const App = comp('App', (props) => {
        probe('App', props);
        return asChildren ? h(Counter, null, h(Expensive)) : h(Counter);
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.Counter.bump() };
    },
  });
}
childrenScenario({
  id: 'children-as-prop',
  variant: 'works',
  title: 'The child is passed in as children',
  claim: 'Counter re-renders on every click and Expensive never re-renders, with no memo of any kind, because App did not re-render so the element object is the one React already has.',
  asChildren: true,
});
childrenScenario({
  id: 'children-inline',
  variant: 'defeated',
  title: 'The same tree with the child created inside Counter',
  claim: 'Moving one JSX element re-renders Expensive on every click.',
  asChildren: false,
});

// ---------------------------------------------------------------------------------------------
// 9. React.memo around a component that receives children.
// ---------------------------------------------------------------------------------------------
function memoChildrenScenario({ id, variant, title, claim, hoist }) {
  return def({
    id,
    group: 'memo-with-children',
    variant,
    title,
    question: 'Does React.memo help a wrapper component that takes children?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'MemoPanel', parent: 'App', memo: true },
      { name: 'Expensive', parent: 'MemoPanel', elementFrom: hoist ? '(hoisted)' : 'App' },
    ],
    actions: [{ id: 'bump', label: 'set count in App', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const Expensive = comp('Expensive', (props) => {
        probe('Expensive', props);
        return h('p', null, 'expensive');
      });
      const MemoPanel = React.memo(
        comp('MemoPanel', (props) => {
          probe('MemoPanel', props);
          return h('section', null, props.children);
        }),
      );
      const App = comp('App', (props) => {
        const [count, setCount] = React.useState(0);
        handles.App = { bump: () => setCount((c) => c + 1) };
        const hoisted = React.useMemo(() => h(Expensive), []);
        probe('App', props);
        // Inline JSX children means a new element object, and therefore a new children prop,
        // on every single render of App.
        return h('div', null, count, h(MemoPanel, null, hoist ? hoisted : h(Expensive)));
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.bump() };
    },
  });
}
memoChildrenScenario({
  id: 'memo-children-inline',
  variant: 'defeated',
  title: 'React.memo on a wrapper with inline children',
  claim: 'The children prop is a new element object every render, so the memo never bails out and the whole subtree re-renders.',
  hoist: false,
});
memoChildrenScenario({
  id: 'memo-children-hoisted',
  variant: 'works',
  title: 'The same wrapper with the children element held stable',
  claim: 'With the children element kept in a useMemo, MemoPanel and everything under it skip.',
  hoist: true,
});

// ---------------------------------------------------------------------------------------------
// 10. React.memo stops a parent render but does not stop a context update.
// ---------------------------------------------------------------------------------------------
function memoContextScenario({ id, variant, title, claim, viaContext }) {
  return def({
    id,
    group: 'memo-vs-context',
    variant,
    title,
    question: 'Does a React.memo boundary with unchanged props protect the subtree under it?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'MemoSection', parent: 'App', memo: true },
      { name: 'ThemeReader', parent: 'MemoSection', consumes: viaContext ? ['Theme'] : [] },
    ],
    actions: [{ id: 'change', label: viaContext ? 'change the theme in context' : 'set unrelated state in App', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const ThemeContext = React.createContext('light');
      const ThemeReader = comp('ThemeReader', (props) => {
        if (viaContext) {
          const theme = React.useContext(ThemeContext);
          probe('ThemeReader', props, { ctx: { Theme: theme }, reads: { theme } });
          return h('span', null, theme);
        }
        probe('ThemeReader', props);
        return h('span', null, 'static');
      });
      const MemoSection = React.memo(
        comp('MemoSection', (props) => {
          probe('MemoSection', props);
          return h('section', null, h(ThemeReader));
        }),
      );
      const App = comp('App', (props) => {
        const [theme, setTheme] = React.useState('light');
        handles.App = { change: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) };
        probe('App', props);
        const tree = h('div', null, h(MemoSection));
        return viaContext ? h(ThemeContext.Provider, { value: theme }, tree) : tree;
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.change() };
    },
  });
}
memoContextScenario({
  id: 'memo-blocks-parent-state',
  variant: 'works',
  title: 'React.memo blocking a parent state change',
  claim: 'App re-renders, MemoSection and ThemeReader do not.',
  viaContext: false,
});
memoContextScenario({
  id: 'memo-does-not-block-context',
  variant: 'defeated',
  title: 'The same memo boundary with a context read below it',
  claim: 'MemoSection still bails out, and ThemeReader underneath it re-renders anyway. A context update reaches a consumer through a memo boundary that did not re-render.',
  viaContext: true,
});

// ---------------------------------------------------------------------------------------------
// 11. Setting state to the value it already has.
// ---------------------------------------------------------------------------------------------
function sameValueScenario({ id, variant, title, claim, sameValue }) {
  return def({
    id,
    group: 'setstate-same-value',
    variant,
    title,
    question: 'What happens when you set state to the value it already holds?',
    claim,
    nodes: [
      { name: 'App', parent: null },
      { name: 'Child', parent: 'App' },
    ],
    actions: [{ id: 'set', label: sameValue ? 'setCount(0) when count is already 0' : 'setCount(1) when count is 0', owner: 'App' }],
    build(probe) {
      const handles = {};
      const counters = {};
      const Child = comp('Child', (props) => {
        probe('Child', props);
        return h('span', null, 'child');
      });
      const App = comp('App', (props) => {
        const [count, setCount] = React.useState(0);
        handles.App = { set: () => setCount(sameValue ? 0 : 1) };
        probe('App', props, { state: { count } });
        return h('div', null, count, h(Child));
      });
      return { element: h(App), handles, counters, act: (_, hs) => hs.App.set() };
    },
  });
}
sameValueScenario({
  id: 'setstate-same-value',
  variant: 'control',
  title: 'setState with the value it already has',
  claim: 'React compares the new state to the old one. The measured render count for App is the interesting number here, and it is not always zero.',
  sameValue: true,
});
sameValueScenario({
  id: 'setstate-new-value',
  variant: 'control',
  title: 'The same setState with a genuinely new value',
  claim: 'App and Child both render once.',
  sameValue: false,
});

// The case the same-value bail-out does not cover: two updater functions in one event whose net
// effect is no change. React cannot compute the result eagerly, so it has to render to find out.
def({
  id: 'setstate-net-zero',
  group: 'setstate-same-value',
  variant: 'control',
  title: 'Two updates in one event that cancel out',
  question: 'Does an unchanged final state always mean no render?',
  claim: 'The measured render count for App here is the point of this scenario, and it differs from the plain same-value case above.',
  nodes: [
    { name: 'App', parent: null },
    { name: 'Child', parent: 'App' },
  ],
  actions: [{ id: 'set', label: 'setCount(c => c + 1) then setCount(c => c - 1)', owner: 'App' }],
  build(probe) {
    const handles = {};
    const counters = {};
    const Child = comp('Child', (props) => {
      probe('Child', props);
      return h('span', null, 'child');
    });
    const App = comp('App', (props) => {
      const [count, setCount] = React.useState(0);
      handles.App = {
        set: () => {
          setCount((c) => c + 1);
          setCount((c) => c - 1);
        },
      };
      probe('App', props, { state: { count } });
      return h('div', null, count, h(Child));
    });
    return { element: h(App), handles, counters, act: (_, hs) => hs.App.set() };
  },
});

// ---------------------------------------------------------------------------------------------
// 12. State that lives low in the tree.
// ---------------------------------------------------------------------------------------------
def({
  id: 'state-in-leaf',
  group: 'state-locality',
  variant: 'control',
  title: 'State pushed down into the leaf that uses it',
  question: 'What does moving state downwards actually buy?',
  claim: 'Only the leaf re-renders. Its parent and its sibling do not.',
  nodes: [
    { name: 'App', parent: null },
    { name: 'Sibling', parent: 'App' },
    { name: 'LeafCounter', parent: 'App' },
  ],
  actions: [{ id: 'bump', label: 'set count in LeafCounter', owner: 'LeafCounter' }],
  build(probe) {
    const handles = {};
    const counters = {};
    const Sibling = comp('Sibling', (props) => {
      probe('Sibling', props);
      return h('span', null, 'sibling');
    });
    const LeafCounter = comp('LeafCounter', (props) => {
      const [count, setCount] = React.useState(0);
      handles.LeafCounter = { bump: () => setCount((c) => c + 1) };
      probe('LeafCounter', props);
      return h('button', null, count);
    });
    const App = comp('App', (props) => {
      probe('App', props);
      return h('div', null, h(Sibling), h(LeafCounter));
    });
    return { element: h(App), handles, counters, act: (_, hs) => hs.LeafCounter.bump() };
  },
});

for (const s of scenarios) {
  const names = s.nodes.map((n) => n.name);
  if (new Set(names).size !== names.length) {
    throw new Error(`scenario ${s.id} has duplicate component names, which would make attribution ambiguous`);
  }
  for (const node of s.nodes) {
    if (node.parent && !names.includes(node.parent)) {
      throw new Error(`scenario ${s.id}: parent ${node.parent} of ${node.name} is not in the tree`);
    }
    node.elementFrom = node.elementFrom || node.parent;
    if (node.elementFrom && node.elementFrom !== HOISTED && !names.includes(node.elementFrom)) {
      throw new Error(`scenario ${s.id}: elementFrom ${node.elementFrom} of ${node.name} is not in the tree`);
    }
    node.memo = Boolean(node.memo);
    node.consumes = node.consumes || [];
  }
  for (const action of s.actions) {
    if (!names.includes(action.owner)) {
      throw new Error(`scenario ${s.id}: action ${action.id} owner ${action.owner} is not in the tree`);
    }
  }
}

export { scenarios };
export const byId = new Map(scenarios.map((s) => [s.id, s]));
